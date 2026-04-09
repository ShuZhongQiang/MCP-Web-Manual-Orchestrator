import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { Locator } from "playwright";
import { browserManager } from "../core/browser.js";
import { elementStore } from "../core/elementStore.js";
import type { ElementSnapshot } from "../types.js";

const normalize = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

export type TextMatchContainerType = "cell" | "row" | "block" | "element";

type FindTextParams = {
  runId: string;
  searchText: string;
  exactMatch?: boolean;
  maxResults?: number;
  contextHint?: string;
};

type FindTextResult = {
  element_id: string;
  snapshot: ElementSnapshot;
  container_type: TextMatchContainerType;
};

type BrowserMatch = {
  marker_id: string;
  container_type: TextMatchContainerType;
};

const getSnapshot = async (locator: Locator, maxTextLen: number): Promise<ElementSnapshot> =>
  locator.evaluate((el, limit: number) => {
    const normalizeText = (value: string): string => value.trim().replace(/\s+/g, " ").slice(0, limit);
    const element = el as HTMLElement;
    return {
      tag: element.tagName.toLowerCase(),
      text: normalizeText(element.textContent ?? ""),
      role: normalizeText(element.getAttribute("role") ?? ""),
      ariaLabel: normalizeText(element.getAttribute("aria-label") ?? ""),
      placeholder: normalizeText((element as HTMLInputElement).placeholder ?? ""),
      idAttr: normalizeText(element.id ?? ""),
      nameAttr: normalizeText(element.getAttribute("name") ?? ""),
      className: normalizeText(String(element.className ?? "")),
      typeAttr: normalizeText((element as HTMLInputElement).type ?? ""),
    };
  }, maxTextLen);

export const findTextInPage = async ({
  runId,
  searchText,
  exactMatch = false,
  maxResults = 5,
  contextHint,
}: FindTextParams): Promise<FindTextResult[]> => {
  const page = await browserManager.getPage(runId);
  const normalizedSearch = normalize(searchText);
  const normalizedHint = normalize(contextHint ?? "");

  const matches = await page.evaluate(
    ({
      query,
      hint,
      isExact,
      limit,
    }: {
      query: string;
      hint: string;
      isExact: boolean;
      limit: number;
    }): BrowserMatch[] => {
      const normalizeText = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();
      const normalizedQuery = normalizeText(query);

      const isVisible = (node: Element | null): node is HTMLElement => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          return false;
        }
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) {
            return NodeFilter.FILTER_REJECT;
          }
          const tag = parent.tagName.toLowerCase();
          if (["script", "style", "noscript", "svg", "path"].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (!node.textContent?.trim()) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const processedParents = new Set<HTMLElement>();
      const candidates: Array<{
        element: HTMLElement;
        normalizedText: string;
        score: number;
        isInTable: boolean;
        isCell: boolean;
        tag: string;
      }> = [];

      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        if (!parent || !isVisible(parent) || processedParents.has(parent)) {
          continue;
        }
        processedParents.add(parent);

        const rawText = (parent.textContent ?? "").trim().slice(0, 400);
        const normalizedText = normalizeText(rawText);
        if (!normalizedText) {
          continue;
        }

        const matched = isExact
          ? normalizedText === normalizedQuery
          : normalizedText.includes(normalizedQuery);
        if (!matched) {
          continue;
        }

        const lengthRatio = normalizedQuery.length / normalizedText.length;
        let score = Math.round(lengthRatio * 80) + 20;
        if (Math.abs(normalizedText.length - normalizedQuery.length) <= 5) {
          score += 15;
        }
        if (hint && !normalizedText.includes(hint)) {
          score -= 10;
        }

        const tag = parent.tagName.toLowerCase();
        candidates.push({
          element: parent,
          normalizedText,
          score,
          isInTable: Boolean(parent.closest("table, [role='grid'], [role='table'], .ant-table, .el-table")),
          isCell: ["td", "th"].includes(tag),
          tag,
        });
      }

      candidates.sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (left.normalizedText.length !== right.normalizedText.length) {
          return left.normalizedText.length - right.normalizedText.length;
        }
        if (left.isCell !== right.isCell) {
          return left.isCell ? -1 : 1;
        }
        return 0;
      });

      return candidates.slice(0, limit).map((candidate) => {
        let targetElement: HTMLElement = candidate.element;
        let containerType: TextMatchContainerType = "element";

        if (candidate.isCell || candidate.isInTable) {
          const row = candidate.element.closest("tr");
          if (row && isVisible(row)) {
            targetElement = row;
            containerType = "row";
          } else if (candidate.isCell) {
            containerType = "cell";
          }
        } else if (["div", "section", "article", "li", "p"].includes(candidate.tag)) {
          containerType = "block";
        }

        const markerId = `mcp-text-match-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        targetElement.setAttribute("data-mcp-text-match-id", markerId);

        return {
          marker_id: markerId,
          container_type: containerType,
        };
      });
    },
    {
      query: normalizedSearch,
      hint: normalizedHint,
      isExact: exactMatch,
      limit: maxResults,
    },
  );

  const results: FindTextResult[] = [];

  for (const match of matches) {
    const locator = page.locator(`[data-mcp-text-match-id="${match.marker_id}"]`).first();
    const count = await locator.count().catch(() => 0);
    if (count === 0) {
      continue;
    }

    const snapshot = await getSnapshot(locator, 200).catch(() => undefined);
    if (!snapshot) {
      continue;
    }

    results.push({
      element_id: elementStore.set(runId, locator, snapshot),
      snapshot,
      container_type: match.container_type,
    });
  }

  await page
    .evaluate(() => {
      document.querySelectorAll("[data-mcp-text-match-id]").forEach((element) => {
        element.removeAttribute("data-mcp-text-match-id");
      });
    })
    .catch(() => undefined);

  return results;
};

export const registerFindTextTool = (server: FastMCP): void => {
  server.addTool({
    name: "find_text_in_page",
    description:
      "Find visible text anywhere in the page, including non-interactive elements such as table cells. Use this for verification steps like confirming a newly added record appears in a list.",
    parameters: z.object({
      run_id: z.string().min(1),
      search_text: z.string().min(1).describe("Target text to search for, such as a name or phone number."),
      exact_match: z.boolean().default(false).describe("Whether the text must match exactly. Default is partial match."),
      max_results: z.number().int().min(1).max(20).default(5).describe("Maximum number of matches to return."),
      context_hint: z.string().optional().describe("Optional hint to improve relevance, such as a module or table name."),
    }),
    execute: async ({
      run_id,
      search_text,
      exact_match,
      max_results,
      context_hint,
    }: {
      run_id: string;
      search_text: string;
      exact_match?: boolean;
      max_results?: number;
      context_hint?: string;
    }) => {
      const results = await findTextInPage({
        runId: run_id,
        searchText: search_text,
        exactMatch: exact_match,
        maxResults: max_results,
        contextHint: context_hint,
      });

      if (results.length === 0) {
        throw new Error(
          `Text not found in page: "${search_text}". Try a different text or use find_element for interactive controls.`,
        );
      }

      return JSON.stringify({
        run_id,
        search_text,
        found_count: results.length,
        results: results.map((item) => ({
          element_id: item.element_id,
          container_type: item.container_type,
          tag: item.snapshot.tag,
          text: item.snapshot.text,
          role: item.snapshot.role,
          id_attr: item.snapshot.idAttr,
          class_name: item.snapshot.className.slice(0, 80),
        })),
      });
    },
  });
};
