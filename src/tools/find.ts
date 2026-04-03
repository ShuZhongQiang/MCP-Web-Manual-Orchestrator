import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { Locator } from "playwright";
import { browserManager } from "../core/browser.js";
import { ELEMENT_WAIT_TIMEOUT_MS, ENABLE_TOOL_ALIASES } from "../config.js";
import { elementStore } from "../core/elementStore.js";
import type { ElementCandidate, ElementSnapshot } from "../types.js";

const getElementSnapshot = async (locator: Locator): Promise<ElementSnapshot> => {
  return locator.evaluate((el) => {
    const element = el as HTMLElement;
    return {
      tag: element.tagName.toLowerCase(),
      text: (element.textContent ?? "").trim().slice(0, 120),
      role: element.getAttribute("role") ?? "",
      ariaLabel: element.getAttribute("aria-label") ?? "",
      placeholder: (element as HTMLInputElement).placeholder ?? "",
      idAttr: element.id ?? "",
      nameAttr: element.getAttribute("name") ?? "",
      className: element.className ?? "",
      typeAttr: (element as HTMLInputElement).type ?? "",
    };
  });
};

const isLikelyCssSelector = (target: string): boolean => {
  return /^[\s]*[#.\[]/.test(target);
};

const getInspectFallbackLocator = async (runId: string, target: string): Promise<Locator | undefined> => {
  const page = await browserManager.getPage(runId);
  const interactive = page.locator("a, button, input, select, textarea, [role='button'], [onclick]");
  const total = await interactive.count();
  const keyword = target.toLowerCase();
  for (let i = 0; i < total; i += 1) {
    const item = interactive.nth(i);
    const visible = await item.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    const snapshot = await getElementSnapshot(item).catch(() => undefined);
    if (!snapshot) {
      continue;
    }
    const searchable =
      `${snapshot.text} ${snapshot.ariaLabel} ${snapshot.placeholder} ${snapshot.idAttr} ${snapshot.nameAttr}`.toLowerCase();
    if (searchable.includes(keyword)) {
      return item;
    }
  }
  return undefined;
};

const buildCandidates = async (runId: string, target: string, maxCandidates: number): Promise<ElementCandidate[]> => {
  const page = await browserManager.getPage(runId);
  const strategyDefs: Array<{ name: string; score: number; locator: Locator }> = [];
  if (isLikelyCssSelector(target)) {
    strategyDefs.push({ name: "stableSelector", score: 120, locator: page.locator(target) });
  }
  strategyDefs.push(
    { name: "text", score: 100, locator: page.getByText(target, { exact: false }) },
    { name: "label", score: 90, locator: page.getByLabel(target) },
    { name: "placeholder", score: 80, locator: page.getByPlaceholder(target) },
    { name: "buttonRole", score: 70, locator: page.getByRole("button", { name: target }) },
  );
  const candidates: ElementCandidate[] = [];
  const dedupe = new Set<string>();
  const collectFromStrategy = async (strategy: { name: string; score: number; locator: Locator }): Promise<void> => {
    let count = 0;
    try {
      count = await strategy.locator.count();
    } catch {
      return;
    }
    const upper = Math.min(count, maxCandidates);
    for (let i = 0; i < upper; i += 1) {
      const item = strategy.locator.nth(i);
      try {
        await item.waitFor({ state: "visible", timeout: Math.min(ELEMENT_WAIT_TIMEOUT_MS, 800) });
      } catch {
        continue;
      }
      const snapshot = await getElementSnapshot(item);
      const fingerprint = `${snapshot.tag}|${snapshot.text}|${snapshot.ariaLabel}|${snapshot.placeholder}|${snapshot.idAttr}`;
      if (dedupe.has(fingerprint)) {
        continue;
      }
      dedupe.add(fingerprint);
      const elementId = elementStore.set(runId, item, snapshot);
      candidates.push({
        element_id: elementId,
        strategy: strategy.name,
        score: strategy.score - i,
        snapshot,
      });
      if (candidates.length >= maxCandidates) {
        return;
      }
    }
  };

  for (const strategy of strategyDefs) {
    await collectFromStrategy(strategy);
    if (candidates.length >= maxCandidates) {
      return candidates;
    }
  }

  if (candidates.length === 0) {
    const inspectFallback = await getInspectFallbackLocator(runId, target);
    if (inspectFallback) {
      await collectFromStrategy({ name: "inspectSummary", score: 60, locator: inspectFallback });
    }
  }

  return candidates;
};

export const registerFindTool = (server: FastMCP): void => {
  const definition = {
    description: "定位页面元素",
    parameters: z.object({
      run_id: z.string().min(1),
      target: z.string().min(1),
      return_candidates: z.boolean().default(false),
      max_candidates: z.number().int().min(1).max(20).default(8),
      retry_count: z.number().int().min(0).max(2).default(1),
    }),
    execute: async ({
      run_id,
      target,
      return_candidates,
      max_candidates,
      retry_count,
    }: {
      run_id: string;
      target: string;
      return_candidates: boolean;
      max_candidates: number;
      retry_count: number;
    }) => {
      let candidates: ElementCandidate[] = [];
      for (let attempt = 0; attempt <= retry_count; attempt += 1) {
        candidates = await buildCandidates(run_id, target, max_candidates);
        if (candidates.length > 0) {
          break;
        }
        const page = await browserManager.getPage(run_id);
        await page.waitForTimeout(Math.min(ELEMENT_WAIT_TIMEOUT_MS, 400) + attempt * 200);
      }
      if (candidates.length === 0) {
        throw new Error(`Element not found for target: ${target}`);
      }
      if (return_candidates) {
        return JSON.stringify({
          selected_element_id: candidates[0].element_id,
          target,
          count: candidates.length,
          candidates,
        });
      }
      return candidates[0].element_id;
    },
  };

  server.addTool({
    name: "find_element",
    ...definition,
  });

  if (ENABLE_TOOL_ALIASES) {
    server.addTool({
      name: "browser.find",
      ...definition,
    });
  }
};
