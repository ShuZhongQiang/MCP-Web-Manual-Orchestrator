import path from "node:path";
import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { browserManager } from "../core/browser.js";
import { SCREENSHOT_RENDER_WAIT_MS } from "../config.js";
import { elementStore } from "../core/elementStore.js";
import { logicalStepStore } from "../core/logicalStepStore.js";
import { stepRecorder } from "../core/stepRecorder.js";
import { getRunDir } from "../utils/file.js";
import { clearHighlight, renderHighlight, renderRowHighlight } from "../utils/highlight.js";
import { findTextInPage, type TextMatchContainerType } from "./findText.js";

type HighlightMode = "row" | "element" | "region";

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const normalize = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

const resolveScreenshotStep = ({
  runId,
  action,
  text,
  explicitStep,
}: {
  runId: string;
  action: string;
  text: string;
  explicitStep?: number;
}): number => {
  if (typeof explicitStep === "number") {
    return logicalStepStore.resolve(runId, explicitStep);
  }
  const active = logicalStepStore.getActive(runId);
  if (active) {
    return active.step;
  }
  const normalizedText = normalize(text);
  const existing = stepRecorder.findLatest(
    runId,
    (item) =>
      normalize(item.action ?? "") === normalize(action) &&
      normalize(item.desc) === normalizedText &&
      !item.image,
  );
  if (existing) {
    return existing.step;
  }
  return logicalStepStore.resolve(runId);
};

const padRegion = (box: Box, padding = 10): Box => ({
  x: Math.max(0, box.x - padding),
  y: Math.max(0, box.y - padding),
  width: box.width + padding * 2,
  height: box.height + padding * 2,
});

const shouldRenderRowHighlight = (
  highlightMode: HighlightMode,
  containerType: TextMatchContainerType,
): boolean => highlightMode === "row" && containerType === "row";

export const registerVerifyAndCaptureTool = (server: FastMCP): void => {
  server.addTool({
    name: "verify_and_capture",
    description:
      "Search page text, highlight the matched result area, and capture a screenshot. Designed for verification steps such as confirming a newly added row appears in a table.",
    parameters: z.object({
      run_id: z.string().min(1),
      search_text: z.string().min(1).describe("Target text to verify, such as a created name, phone number, or ID."),
      step: z.number().int().nonnegative().optional(),
      action: z.string().default("查看确认").describe("Action label recorded for the step."),
      text: z.string().optional().describe("Optional step description."),
      context_hint: z.string().optional().describe("Optional hint to improve match relevance."),
      highlight_mode: z
        .enum(["row", "element", "region"])
        .default("row")
        .describe("How to highlight the matched result before taking the screenshot."),
    }),
    execute: async ({
      run_id,
      search_text,
      step,
      action,
      text,
      context_hint,
      highlight_mode,
    }: {
      run_id: string;
      search_text: string;
      step?: number;
      action?: string;
      text?: string;
      context_hint?: string;
      highlight_mode?: HighlightMode;
    }) => {
      const page = await browserManager.getPage(run_id);
      const runDir = getRunDir(run_id);
      const actionLabel = action ?? "查看确认";
      const safeAction = actionLabel.replaceAll(/[\\/:*?"<>|]/g, "_");
      const startedAt = Date.now();
      const pageUrlBefore = page.url();
      const activeStep = logicalStepStore.getActive(run_id);
      const desc = text ?? activeStep?.desc ?? `${actionLabel}: ${search_text}`;
      const resolvedStep = resolveScreenshotStep({
        runId: run_id,
        action: actionLabel,
        text: desc,
        explicitStep: step,
      });
      const screenshotPath = path.join(runDir, `${resolvedStep}_${safeAction}.png`);

      const recordSuccess = (stepNumber: number, imagePath: string): string => {
        stepRecorder.add(
          run_id,
          logicalStepStore.applyContext(run_id, stepNumber, {
            step: stepNumber,
            desc,
            image: imagePath,
            action: actionLabel,
            status: "SUCCESS",
            retryCount: 0,
            latencyMs: Date.now() - startedAt,
            pageUrlBefore,
            pageUrlAfter: page.url(),
            createdAt: new Date().toISOString(),
          }),
        );
        logicalStepStore.clearActive(run_id, stepNumber);
        return imagePath;
      };

      try {
        const matches = await findTextInPage({
          runId: run_id,
          searchText: search_text,
          maxResults: 5,
          contextHint: context_hint,
        });

        if (matches.length === 0) {
          throw new Error(`Verification text not found on page: "${search_text}"`);
        }

        const primaryMatch =
          highlight_mode === "row"
            ? matches.find((item) => item.container_type === "row") ?? matches[0]
            : matches[0];

        const locator = await elementStore.get(run_id, primaryMatch.element_id);
        await locator.scrollIntoViewIfNeeded();

        const boundingBox = await locator.boundingBox();
        if (!boundingBox) {
          throw new Error("Could not resolve matched element bounds for screenshot");
        }

        const box = highlight_mode === "region" ? padRegion(boundingBox) : boundingBox;

        if (shouldRenderRowHighlight(highlight_mode ?? "row", primaryMatch.container_type)) {
          await renderRowHighlight(page, box, desc);
        } else {
          await renderHighlight(page, box, desc);
        }

        await page.waitForTimeout(SCREENSHOT_RENDER_WAIT_MS);
        await page.screenshot({ path: screenshotPath });
        await clearHighlight(page);
        return recordSuccess(resolvedStep, screenshotPath);
      } catch (error) {
        await clearHighlight(page).catch(() => undefined);
        stepRecorder.add(
          run_id,
          logicalStepStore.applyContext(run_id, resolvedStep, {
            step: resolvedStep,
            desc,
            action: actionLabel,
            status: "FAILED",
            errorCode: "VERIFY_CAPTURE_FAILED",
            retryCount: 0,
            latencyMs: Date.now() - startedAt,
            pageUrlBefore,
            pageUrlAfter: page.url(),
            createdAt: new Date().toISOString(),
          }),
        );
        logicalStepStore.clearActive(run_id, resolvedStep);
        throw error;
      }
    },
  });
};
