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
const OPTION_INTENT_RE =
  /(?:\u9009\u9879|\u4e0b\u62c9|\u9009\u62e9|option|dropdown|listbox|combobox)/i;
const INTERACTIVE_SELECTOR =
  "a, button, input, select, textarea, option, [role='button'], [role='combobox'], [role='option'], [onclick], .ant-select-selector, .ant-select-item-option, .ant-select-item-option-content, .el-select, .el-select-dropdown__item";
const ACTIVE_LAYER_SELECTOR = [
  "[role='dialog']",
  ".ant-modal",
  ".ant-modal-root",
  ".el-dialog",
  ".el-drawer",
  ".ant-drawer",
  ".ant-select-dropdown",
  ".el-select-dropdown",
  ".el-popper",
  "[role='listbox']",
  ".ant-picker-dropdown",
  ".ant-dropdown",
  ".ant-popover",
].join(", ");
const DROPDOWN_LAYER_SELECTOR = [
  ".ant-select-dropdown",
  ".el-select-dropdown",
  ".el-popper",
  "[role='listbox']",
  ".ant-picker-dropdown",
  ".ant-dropdown",
].join(", ");

const EXCLUDED_CELL_CLASSES = /cell|el-table__cell|td|th/i;

type CandidateContext = {
  isTopMostAtPoint: boolean;
  insideActiveLayer: boolean;
  insideTopLayer: boolean;
  insideDropdownLayer: boolean;
  insideDialogLayer: boolean;
  activeLayerRole: "none" | "dialog" | "dropdown";
};

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
  if (EXCLUDED_CELL_CLASSES.test(snapshot.className) || ["td", "th"].includes(snapshot.tag.toLowerCase())) {
    return false;
  }
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

const getCandidateContext = async (locator: Locator): Promise<CandidateContext> => {
  return locator
    .evaluate(
      (
        el,
        {
          activeLayerSelector,
          dropdownLayerSelector,
        }: {
          activeLayerSelector: string;
          dropdownLayerSelector: string;
        },
      ) => {
        const element = el as HTMLElement;
        const isVisible = (node: Element | null): node is HTMLElement => {
          if (!(node instanceof HTMLElement)) {
            return false;
          }
          const style = window.getComputedStyle(node);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity || "1") === 0
          ) {
            return false;
          }
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const rankLayer = (node: HTMLElement): number => {
          const zIndex = Number.parseInt(window.getComputedStyle(node).zIndex || "0", 10);
          const rect = node.getBoundingClientRect();
          const area = rect.width * rect.height;
          return (Number.isFinite(zIndex) ? zIndex : 0) * 1_000_000 + Math.round(area);
        };

        const activeLayers = Array.from(document.querySelectorAll(activeLayerSelector))
          .filter(isVisible)
          .map((node, index) => ({
            node,
            index,
            rank: rankLayer(node),
          }))
          .sort((left, right) => right.rank - left.rank || right.index - left.index);

        const topLayer = activeLayers[0]?.node ?? null;
        const rect = element.getBoundingClientRect();
        const sampleX = Math.min(Math.max(rect.left + Math.min(rect.width / 2, Math.max(rect.width - 2, 1)), 1), window.innerWidth - 1);
        const sampleY = Math.min(Math.max(rect.top + Math.min(rect.height / 2, Math.max(rect.height - 2, 1)), 1), window.innerHeight - 1);
        const topNode = rect.width > 0 && rect.height > 0 ? document.elementFromPoint(sampleX, sampleY) : null;
        const topElement = topNode instanceof HTMLElement ? topNode : null;
        const insideTopHit =
          !!topElement && (topElement === element || topElement.contains(element) || element.contains(topElement));

        const activeLayer = element.closest(activeLayerSelector) as HTMLElement | null;
        const dropdownLayer = element.closest(dropdownLayerSelector) as HTMLElement | null;
        const dialogLayer = element.closest("[role='dialog'], .ant-modal, .ant-modal-root, .el-dialog, .el-drawer, .ant-drawer") as HTMLElement | null;
        const topLayerRole: CandidateContext["activeLayerRole"] = !topLayer
          ? "none"
          : topLayer.matches(dropdownLayerSelector)
            ? "dropdown"
            : "dialog";

        return {
          isTopMostAtPoint: insideTopHit,
          insideActiveLayer: Boolean(activeLayer),
          insideTopLayer: Boolean(topLayer && (topLayer === element || topLayer.contains(element))),
          insideDropdownLayer: Boolean(dropdownLayer),
          insideDialogLayer: Boolean(dialogLayer),
          activeLayerRole: topLayerRole,
        };
      },
      {
        activeLayerSelector: ACTIVE_LAYER_SELECTOR,
        dropdownLayerSelector: DROPDOWN_LAYER_SELECTOR,
      },
    )
    .catch(() => ({
      isTopMostAtPoint: true,
      insideActiveLayer: false,
      insideTopLayer: false,
      insideDropdownLayer: false,
      insideDialogLayer: false,
      activeLayerRole: "none" as const,
    }));
};

const getScoreBias = (
  target: string,
  strategyName: string,
  snapshot: ElementSnapshot,
  context: CandidateContext,
): number => {
  const interactive = isInteractiveSnapshot(snapshot);
  const inputLike = isInputLikeSnapshot(snapshot);
  const normalizedTarget = normalize(target);
  const hasClickIntent = CLICK_INTENT_RE.test(normalizedTarget);
  const hasInputIntent = INPUT_INTENT_RE.test(normalizedTarget);
  const hasOptionIntent = OPTION_INTENT_RE.test(normalizedTarget);

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
  if (!context.isTopMostAtPoint) {
    scoreBias -= 120;
  }
  if (context.activeLayerRole !== "none") {
    scoreBias += context.insideTopLayer ? 48 : -140;
    if (context.activeLayerRole === "dropdown") {
      scoreBias += context.insideDropdownLayer ? 42 : -110;
    }
    if (context.activeLayerRole === "dialog") {
      scoreBias += context.insideDialogLayer ? 28 : -36;
    }
  }
  if (hasOptionIntent) {
    scoreBias += context.insideDropdownLayer ? 68 : -90;
    scoreBias += snapshot.role.toLowerCase() === "option" || snapshot.tag.toLowerCase() === "option" ? 40 : 0;
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
    const context = await getCandidateContext(item);
    if (context.activeLayerRole !== "none" && !context.insideTopLayer) {
      continue;
    }
    if (!context.isTopMostAtPoint && !context.insideDropdownLayer) {
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
    addStrategy(
      `activeOptionRole${index}`,
      138 - offset,
      page.locator(DROPDOWN_LAYER_SELECTOR).getByRole("option", { name: lookupTarget, exact: false }),
    );
    addStrategy(
      `activeOptionText${index}`,
      134 - offset,
      page.locator(DROPDOWN_LAYER_SELECTOR).getByText(lookupTarget, { exact: false }),
    );
    addStrategy(
      `activeDialogText${index}`,
      128 - offset,
      page.locator("[role='dialog'], .ant-modal, .ant-modal-root, .el-dialog, .el-drawer, .ant-drawer").getByText(lookupTarget, { exact: false }),
    );
    addStrategy(`label${index}`, 126 - offset, page.getByLabel(lookupTarget, { exact: false }));
    addStrategy(`placeholder${index}`, 122 - offset, page.getByPlaceholder(lookupTarget, { exact: false }));
    addStrategy(`comboboxRole${index}`, 118 - offset, page.getByRole("combobox", { name: lookupTarget, exact: false }));
    addStrategy(`optionRole${index}`, 114 - offset, page.getByRole("option", { name: lookupTarget, exact: false }));
    addStrategy(`buttonRole${index}`, 124 - offset, page.getByRole("button", { name: lookupTarget, exact: false }));
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
      const context = await getCandidateContext(item);
      if (context.activeLayerRole !== "none" && !context.insideTopLayer) {
        continue;
      }
      if (!context.isTopMostAtPoint && !context.insideDropdownLayer) {
        continue;
      }
      const fingerprint = `${snapshot.tag}|${snapshot.text}|${snapshot.ariaLabel}|${snapshot.placeholder}|${snapshot.idAttr}`;
      if (dedupe.has(fingerprint)) {
        continue;
      }
      dedupe.add(fingerprint);
      const elementId = elementStore.set(runId, item, snapshot);
      const adjustedScore = strategy.score - i + getScoreBias(target, strategy.name, snapshot, context);
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
