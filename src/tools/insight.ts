import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { Locator } from "playwright";
import { browserManager } from "../core/browser.js";
import { ENABLE_TOOL_ALIASES } from "../config.js";
import { elementStore } from "../core/elementStore.js";
import { stepRecorder } from "../core/stepRecorder.js";
import type { ElementSnapshot } from "../types.js";

const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, [role='button'], [onclick]";

const compactObject = (source: Record<string, string>): Record<string, string> => {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value.length > 0));
};

const getSnapshot = async (maxTextLen: number, locator: Locator): Promise<ElementSnapshot> => {
  return locator.evaluate((el, limit: number) => {
    const normalize = (v: string) => v.trim().replace(/\s+/g, " ").slice(0, limit);
    const element = el as HTMLElement;
    return {
      tag: element.tagName.toLowerCase(),
      text: normalize(element.textContent ?? ""),
      role: normalize(element.getAttribute("role") ?? ""),
      ariaLabel: normalize(element.getAttribute("aria-label") ?? ""),
      placeholder: normalize((element as HTMLInputElement).placeholder ?? ""),
      idAttr: normalize(element.id ?? ""),
      nameAttr: normalize(element.getAttribute("name") ?? ""),
      className: normalize(element.className ?? ""),
      typeAttr: normalize((element as HTMLInputElement).type ?? ""),
    };
  }, maxTextLen);
};

const collectPageElements = async ({
  runId,
  includeHidden,
  query,
  maxTextLen,
}: {
  runId: string;
  includeHidden: boolean;
  query?: string;
  maxTextLen: number;
}): Promise<Array<{ element_id: string; snapshot: ElementSnapshot }>> => {
  const page = await browserManager.getPage(runId);
  const source = page.locator(INTERACTIVE_SELECTOR);
  const total = await source.count();
  const keyword = (query ?? "").toLowerCase().trim();
  const elements: Array<{ element_id: string; snapshot: ElementSnapshot }> = [];

  for (let i = 0; i < total; i += 1) {
    const item = source.nth(i);
    const visible = includeHidden ? true : await item.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    const snapshot = await getSnapshot(maxTextLen, item).catch(() => undefined);
    if (!snapshot) {
      continue;
    }
    const searchable =
      `${snapshot.text} ${snapshot.ariaLabel} ${snapshot.placeholder} ${snapshot.idAttr} ${snapshot.nameAttr}`.toLowerCase();
    if (keyword && !searchable.includes(keyword)) {
      continue;
    }
    const elementId = elementStore.set(runId, item, snapshot);
    elements.push({ element_id: elementId, snapshot });
  }
  return elements;
};

export const registerInsightTools = (server: FastMCP): void => {
  const inspectSummaryDefinition = {
    description: "返回当前页面结构与可交互元素摘要",
    parameters: z.object({
      run_id: z.string().min(1),
      max_elements: z.number().int().min(1).max(200).default(30),
      offset: z.number().int().min(0).default(0),
      include_hidden: z.boolean().default(false),
      query: z.string().optional(),
      compact: z.boolean().default(true),
      max_text_len: z.number().int().min(20).max(300).default(80),
    }),
    execute: async ({
      run_id,
      max_elements,
      offset,
      include_hidden,
      query,
      compact,
      max_text_len,
    }: {
      run_id: string;
      max_elements: number;
      offset: number;
      include_hidden: boolean;
      query?: string;
      compact: boolean;
      max_text_len: number;
    }) => {
      const page = await browserManager.getPage(run_id);
      const all = await collectPageElements({
        runId: run_id,
        includeHidden: include_hidden,
        query,
        maxTextLen: max_text_len,
      });
      const paged = all.slice(offset, offset + max_elements);
      const elements = paged.map((item, index) => {
        const base = {
          element_id: item.element_id,
          tag: item.snapshot.tag,
          text: item.snapshot.text,
          role: item.snapshot.role,
          idAttr: item.snapshot.idAttr,
          nameAttr: item.snapshot.nameAttr,
          ariaLabel: item.snapshot.ariaLabel,
          placeholder: item.snapshot.placeholder,
          typeAttr: item.snapshot.typeAttr,
        };
        const raw = compact ? base : { ...base, className: item.snapshot.className };
        const content = compact ? compactObject(raw) : raw;
        return {
          index: offset + index + 1,
          ...content,
        };
      });
      const tagSummary = elements.reduce<Record<string, number>>((acc, item) => {
        const key = String((item as Record<string, unknown>).tag ?? "unknown");
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
      const result = {
        run_id,
        title: await page.title(),
        url: page.url(),
        total_matched: all.length,
        returned_count: elements.length,
        offset,
        has_more: offset + max_elements < all.length,
        tag_summary: tagSummary,
        elements,
      };
      return JSON.stringify(result);
    },
  };

  server.addTool({
    name: "inspect_summary",
    ...inspectSummaryDefinition,
  });

  if (ENABLE_TOOL_ALIASES) {
    server.addTool({
      name: "inspect_page",
      ...inspectSummaryDefinition,
    });
    server.addTool({
      name: "browser.inspect_page",
      ...inspectSummaryDefinition,
    });
    server.addTool({
      name: "browser.inspect_summary",
      ...inspectSummaryDefinition,
    });
  }

  const inspectDetailDefinition = {
    description: "返回指定 element_id 的详细信息",
    parameters: z.object({
      run_id: z.string().min(1),
      element_ids: z.array(z.string().min(1)).min(1).max(200),
      compact: z.boolean().default(false),
    }),
    execute: async ({
      run_id,
      element_ids,
      compact,
    }: {
      run_id: string;
      element_ids: string[];
      compact: boolean;
    }) => {
      const details = element_ids.map((elementId) => {
        const snapshot = elementStore.getSnapshot(run_id, elementId);
        if (!snapshot) {
          return {
            element_id: elementId,
            exists: false,
          };
        }
        return {
          element_id: elementId,
          exists: true,
          snapshot: compact ? compactObject(snapshot) : snapshot,
        };
      });
      return JSON.stringify({
        run_id,
        count: details.length,
        details,
      });
    },
  };

  server.addTool({
    name: "inspect_detail",
    ...inspectDetailDefinition,
  });

  if (ENABLE_TOOL_ALIASES) {
    server.addTool({
      name: "browser.inspect_detail",
      ...inspectDetailDefinition,
    });
  }

  const elementMemoryDefinition = {
    description: "查看最近缓存的 element_id 与其摘要信息",
    parameters: z.object({
      run_id: z.string().min(1),
      limit: z.number().int().min(1).max(200).default(30),
    }),
    execute: async ({ run_id, limit }: { run_id: string; limit: number }) => {
      const elements = elementStore.list(run_id, limit);
      return JSON.stringify({
        run_id,
        count: elements.length,
        elements,
      });
    },
  };

  server.addTool({
    name: "list_elements",
    ...elementMemoryDefinition,
  });

  if (ENABLE_TOOL_ALIASES) {
    server.addTool({
      name: "browser.list_elements",
      ...elementMemoryDefinition,
    });
  }

  const runContextDefinition = {
    description: "返回某个 run_id 的步骤上下文",
    parameters: z.object({
      run_id: z.string().min(1),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    execute: async ({ run_id, limit }: { run_id: string; limit: number }) => {
      const steps = stepRecorder.get(run_id).slice(0, limit);
      return JSON.stringify({
        run_id,
        step_count: steps.length,
        next_step: stepRecorder.getNextStep(run_id),
        steps,
      });
    },
  };

  server.addTool({
    name: "get_run_context",
    ...runContextDefinition,
  });

  if (ENABLE_TOOL_ALIASES) {
    server.addTool({
      name: "browser.get_run_context",
      ...runContextDefinition,
    });
  }
};
