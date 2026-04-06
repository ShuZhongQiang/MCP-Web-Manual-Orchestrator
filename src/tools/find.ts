import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { Locator } from "playwright";
import { browserManager } from "../core/browser.js";
import { ELEMENT_WAIT_TIMEOUT_MS } from "../config.js";
import { elementStore } from "../core/elementStore.js";
import type { ElementCandidate, ElementSnapshot } from "../types.js";

const VALIDATION_HINT_RE =
  /(?:\u5fc5\u586b|\u4e0d\u80fd\u4e3a\u7a7a|\u8bf7\u586b\u5199|\u8bf7\u8f93\u5165|\u8bf7\u9009\u62e9|\u6821\u9a8c\u5931\u8d25|\u9a8c\u8bc1\u5931\u8d25|required|is required|cannot be empty|must be filled)/i;
const FIELD_PREFIX_RE = /^\u8bf7(?:\u9009\u62e9|\u586b\u5199|\u8f93\u5165)\s*/i;
const ACTION_PREFIX_RE = /^(?:\u8bf7)?(?:\u70b9\u51fb|\u70b9\u6309|\u5355\u51fb|click|tap)\s*/i;
const CONTROL_SUFFIX_RE =
  /(?:\u6309\u94ae|\u94fe\u63a5|\u8f93\u5165\u6846|\u6587\u672c\u6846|\u4e0b\u62c9\u6846|\u4e0b\u62c9|\u9009\u9879|\u9009\u62e9\u5668|button|link|input|textbox|combobox|select|field)$/i;
const CLICK_INTENT_RE = /(?:\u70b9\u51fb|\u70b9\u6309|\u5355\u51fb|click|tap|button|\u6309\u94ae|\u94fe\u63a5)/i;
const INPUT_INTENT_RE =
  /(?:\u8f93\u5165|\u586b\u5199|\u8f93\u5165\u6846|\u6587\u672c\u6846|\u4e0b\u62c9|\u9009\u62e9|input|textbox|combobox|select|field)/i;
const INTERACTIVE_SELECTOR =
  "a, button, input, select, textarea, option, [role='button'], [role='combobox'], [role='option'], [onclick], .ant-select-selector, .el-select";

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

const normalize = (value: string): string => value.trim().toLowerCase();

const sanitizeTarget = (value: string): string => value.trim().replace(/[“”"'`]/g, "").replace(/\s+/g, " ");

const buildLookupTargets = (target: string): string[] => {
  const variants = new Set<string>();
  const addVariant = (value: string): void => {
    const normalized = sanitizeTarget(value);
    if (normalized.length > 0) {
      variants.add(normalized);
    }
  };

  const strippedField = target.replace(FIELD_PREFIX_RE, "");
  const strippedAction = strippedField.replace(ACTION_PREFIX_RE, "");
  const strippedControl = strippedAction.replace(CONTROL_SUFFIX_RE, "");

  addVariant(target);
  addVariant(strippedField);
  addVariant(strippedAction);
  addVariant(strippedControl);

  return [...variants];
};

const toSearchTokens = (target: string): string[] => {
  const lookupTargets = buildLookupTargets(target).map((item) => normalize(item));
  const parts = lookupTargets.flatMap((item) =>
    item
      .split(/[\s,\uFF0C\u3002.!?\uFF01\uFF1F:\uFF1A]+/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length >= 2),
  );
  const tokens = new Set<string>([...lookupTargets, ...parts]);
  return [...tokens].filter((item) => item.length > 0);
};

const matchesTarget = (searchable: string, target: string): boolean => {
  const tokens = toSearchTokens(target);
  return tokens.some((token) => searchable.includes(token));
};

const isInteractiveSnapshot = (snapshot: ElementSnapshot): boolean => {
  const tag = snapshot.tag.toLowerCase();
  const role = snapshot.role.toLowerCase();
  if (["a", "button", "input", "select", "textarea", "option"].includes(tag)) {
    return true;
  }
  if (["button", "combobox", "option", "menuitem", "link", "tab", "radio", "checkbox"].includes(role)) {
    return true;
  }
  return /(ant-select|el-select|dropdown|selector)/i.test(snapshot.className);
};

const isInputLikeSnapshot = (snapshot: ElementSnapshot): boolean => {
  const tag = snapshot.tag.toLowerCase();
  const role = snapshot.role.toLowerCase();
  if (["input", "select", "textarea", "option"].includes(tag)) {
    return true;
  }
  if (["combobox", "textbox", "spinbutton", "listbox"].includes(role)) {
    return true;
  }
  return /(ant-select|el-select|input|textarea|combobox|selector)/i.test(snapshot.className);
};

const getScoreBias = (target: string, strategyName: string, snapshot: ElementSnapshot): number => {
  const interactive = isInteractiveSnapshot(snapshot);
  const inputLike = isInputLikeSnapshot(snapshot);
  const normalizedTarget = normalize(target);
  const hasClickIntent = CLICK_INTENT_RE.test(normalizedTarget);
  const hasInputIntent = INPUT_INTENT_RE.test(normalizedTarget);

  let scoreBias = interactive ? 24 : -8;
  if (strategyName.startsWith("text") && !interactive) {
    scoreBias -= 24;
  }
  if (strategyName.startsWith("text") && /^h[1-6]$/.test(snapshot.tag.toLowerCase())) {
    scoreBias -= 16;
  }
  if (hasClickIntent) {
    scoreBias += interactive ? 28 : -55;
  }
  if (hasInputIntent) {
    scoreBias += inputLike ? 28 : -42;
  }
  return scoreBias;
};

const isValidationOnlyNode = (snapshot: ElementSnapshot): boolean => {
  if (isInteractiveSnapshot(snapshot)) {
    return false;
  }
  const text = `${snapshot.text} ${snapshot.ariaLabel}`;
  return VALIDATION_HINT_RE.test(text);
};

const getInspectFallbackLocator = async (runId: string, target: string): Promise<Locator | undefined> => {
  const page = await browserManager.getPage(runId);
  const interactive = page.locator(INTERACTIVE_SELECTOR);
  const total = await interactive.count();

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
    if (matchesTarget(searchable, target)) {
      return item;
    }
  }
  return undefined;
};

const buildCandidates = async (runId: string, target: string, maxCandidates: number): Promise<ElementCandidate[]> => {
  const page = await browserManager.getPage(runId);
  const strategyDefs: Array<{ name: string; score: number; locator: Locator }> = [];
  const lookupTargets = buildLookupTargets(target);

  const addStrategy = (name: string, score: number, locator: Locator): void => {
    strategyDefs.push({ name, score, locator });
  };

  if (isLikelyCssSelector(target)) {
    addStrategy("stableSelector", 140, page.locator(target));
  }

  for (const [index, lookupTarget] of lookupTargets.entries()) {
    const offset = index * 8;
    addStrategy(`label${index}`, 126 - offset, page.getByLabel(lookupTarget, { exact: false }));
    addStrategy(`placeholder${index}`, 122 - offset, page.getByPlaceholder(lookupTarget, { exact: false }));
    addStrategy(`comboboxRole${index}`, 118 - offset, page.getByRole("combobox", { name: lookupTarget }));
    addStrategy(`optionRole${index}`, 114 - offset, page.getByRole("option", { name: lookupTarget }));
    addStrategy(`buttonRole${index}`, 124 - offset, page.getByRole("button", { name: lookupTarget }));
    addStrategy(`text${index}`, 96 - offset, page.getByText(lookupTarget, { exact: false }));
  }

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
      const snapshot = await getElementSnapshot(item).catch(() => undefined);
      if (!snapshot || isValidationOnlyNode(snapshot)) {
        continue;
      }
      const fingerprint = `${snapshot.tag}|${snapshot.text}|${snapshot.ariaLabel}|${snapshot.placeholder}|${snapshot.idAttr}`;
      if (dedupe.has(fingerprint)) {
        continue;
      }
      dedupe.add(fingerprint);
      const elementId = elementStore.set(runId, item, snapshot);
      const adjustedScore = strategy.score - i + getScoreBias(target, strategy.name, snapshot);
      candidates.push({
        element_id: elementId,
        strategy: strategy.name,
        score: adjustedScore,
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
      await collectFromStrategy({ name: "inspectSummary", score: 70, locator: inspectFallback });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
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
};
