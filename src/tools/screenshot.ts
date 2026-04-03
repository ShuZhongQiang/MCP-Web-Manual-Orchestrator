import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { browserManager } from "../core/browser.js";
import { ENABLE_TOOL_ALIASES, SCREENSHOT_RENDER_WAIT_MS } from "../config.js";
import { elementStore } from "../core/elementStore.js";
import { preActionCaptureStore } from "../core/preActionCaptureStore.js";
import { stepRecorder } from "../core/stepRecorder.js";
import { getRunDir } from "../utils/file.js";
import { clearHighlight, renderHighlight } from "../utils/highlight.js";

export const registerScreenshotTool = (server: FastMCP): void => {
  const definition = {
    description: "高亮元素并截图",
    parameters: z.object({
      element_id: z.string().min(1),
      step: z.number().int().nonnegative().optional(),
      action: z.string().min(1),
      text: z.string().min(1),
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
      text: string;
      run_id: string;
    }) => {
      const page = await browserManager.getPage(run_id);
      const runDir = getRunDir(run_id);
      const safeAction = action.replaceAll(/[\\/:*?"<>|]/g, "_");
      const startedAt = Date.now();
      const pageUrlBefore = page.url();

      const recordSuccess = (stepNumber: number, imagePath: string): string => {
        stepRecorder.add(run_id, {
          step: stepNumber,
          desc: text,
          image: imagePath,
          action,
          status: "SUCCESS",
          retryCount: 0,
          latencyMs: Date.now() - startedAt,
          pageUrlBefore,
          pageUrlAfter: page.url(),
          createdAt: new Date().toISOString(),
        });
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

      const initialStep = step ?? stepRecorder.getNextStep(run_id);
      const screenshotPath = path.join(runDir, `${initialStep}_${safeAction}.png`);

      try {
        const locator = await elementStore.get(run_id, element_id);
        await locator.scrollIntoViewIfNeeded();
        const box = await locator.boundingBox();
        if (!box) {
          throw new Error("Could not get bounding box of element");
        }
        await renderHighlight(page, box, text);
        await page.waitForTimeout(SCREENSHOT_RENDER_WAIT_MS);
        await page.screenshot({ path: screenshotPath });
        await clearHighlight(page);
        return recordSuccess(initialStep, screenshotPath);
      } catch {
        await clearHighlight(page).catch(() => undefined);
        const fallbackPath = resolveFallback(initialStep);
        if (fallbackPath) {
          return recordSuccess(initialStep, fallbackPath);
        }
        stepRecorder.add(run_id, {
          step: initialStep,
          desc: text,
          action,
          status: "FAILED",
          errorCode: "SCREENSHOT_FAILED",
          retryCount: 0,
          latencyMs: Date.now() - startedAt,
          pageUrlBefore,
          pageUrlAfter: page.url(),
          createdAt: new Date().toISOString(),
        });
        throw new Error("Failed to capture screenshot");
      }
    },
  };

  server.addTool({
    name: "highlight_and_capture",
    ...definition,
  });

  if (ENABLE_TOOL_ALIASES) {
    server.addTool({
      name: "browser.screenshot",
      ...definition,
    });
  }
};
