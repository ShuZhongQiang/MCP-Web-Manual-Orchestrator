import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { browserManager } from "../core/browser.js";
import { SCREENSHOT_RENDER_WAIT_MS } from "../config.js";
import { elementStore } from "../core/elementStore.js";
import { logicalStepStore } from "../core/logicalStepStore.js";
import { preActionCaptureStore } from "../core/preActionCaptureStore.js";
import { stepRecorder } from "../core/stepRecorder.js";
import { getRunDir } from "../utils/file.js";
import { clearHighlight, renderHighlight } from "../utils/highlight.js";

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

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

export const registerScreenshotTool = (server: FastMCP): void => {
  server.addTool({
    name: "highlight_and_capture",
    description: "捕获高亮元素截图 | Capture highlighted element screenshot",
    parameters: z.object({
      element_id: z.string().min(1),
      step: z.number().int().nonnegative().optional(),
      action: z.string().min(1),
      text: z.string().min(1).optional(),
      run_id: z.string().min(1),
    }),
    execute: async ({
      element_id,
      step,
      action,
      text,
      run_id,
    }: {
      element_id: string;
      step?: number;
      action: string;
      text?: string;
      run_id: string;
    }) => {
      const page = await browserManager.getPage(run_id);
      const runDir = getRunDir(run_id);
      const safeAction = action.replaceAll(/[\\/:*?"<>|]/g, "_");
      const startedAt = Date.now();
      const pageUrlBefore = page.url();
      const activeStep = logicalStepStore.getActive(run_id);
      const desc = text ?? activeStep?.desc ?? action;
      const resolvedStep = resolveScreenshotStep({
        runId: run_id,
        action,
        text: desc,
        explicitStep: step,
      });
      const existingStep = stepRecorder.findLatest(run_id, (item) => item.step === resolvedStep);
      const isPreActionCapture = !existingStep && action.toLowerCase().includes("click");

      const recordSuccess = (stepNumber: number, imagePath: string): string => {
        stepRecorder.add(
          run_id,
          logicalStepStore.applyContext(run_id, stepNumber, {
            step: stepNumber,
            desc,
            image: imagePath,
            action,
            status: "SUCCESS",
            retryCount: 0,
            latencyMs: Date.now() - startedAt,
            pageUrlBefore,
            pageUrlAfter: page.url(),
            createdAt: new Date().toISOString(),
            captureOnly: isPreActionCapture,
          }),
        );
        logicalStepStore.clearActive(run_id, stepNumber);
        return imagePath;
      };

      const resolveFallback = (expectedStep: number): string | undefined => {
        if (!action.toLowerCase().includes("click")) {
          return undefined;
        }
        const cached =
          preActionCaptureStore.get(run_id, {
            elementId: element_id,
            action,
            step: expectedStep,
          }) ??
          preActionCaptureStore.get(run_id, {
            elementId: element_id,
            step: expectedStep,
          });
        if (!cached) {
          return undefined;
        }
        if (!existsSync(cached.screenshotPath)) {
          return undefined;
        }
        return cached.screenshotPath;
      };

      const screenshotPath = path.join(runDir, `${resolvedStep}_${safeAction}.png`);

      try {
        const locator = await elementStore.get(run_id, element_id);
        await locator.scrollIntoViewIfNeeded();
        const box = await locator.boundingBox();
        if (!box) {
          throw new Error("Could not get bounding box of element");
        }
        await renderHighlight(page, box, desc);
        await page.waitForTimeout(SCREENSHOT_RENDER_WAIT_MS);
        await page.screenshot({ path: screenshotPath });
        await clearHighlight(page);
        return recordSuccess(resolvedStep, screenshotPath);
      } catch {
        await clearHighlight(page).catch(() => undefined);
        const fallbackPath = resolveFallback(resolvedStep);
        if (fallbackPath) {
          return recordSuccess(resolvedStep, fallbackPath);
        }
        stepRecorder.add(
          run_id,
          logicalStepStore.applyContext(run_id, resolvedStep, {
            step: resolvedStep,
            desc,
            action,
            status: "FAILED",
            errorCode: "SCREENSHOT_FAILED",
            retryCount: 0,
            latencyMs: Date.now() - startedAt,
            pageUrlBefore,
            pageUrlAfter: page.url(),
            createdAt: new Date().toISOString(),
          }),
        );
        logicalStepStore.clearActive(run_id, resolvedStep);
        throw new Error("Failed to capture screenshot");
      }
    },
  });
};
