import path from "node:path";
import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { browserManager } from "../core/browser.js";
import { SCREENSHOT_RENDER_WAIT_MS } from "../config.js";
import { elementStore } from "../core/elementStore.js";
import { preActionCaptureStore } from "../core/preActionCaptureStore.js";
import { stepRecorder } from "../core/stepRecorder.js";
import { getRunDir } from "../utils/file.js";
import { clearHighlight, renderHighlight } from "../utils/highlight.js";
import { buildValidationErrorMessage, inspectValidation, type ValidationReport } from "../utils/validation.js";

const CLICK_NAVIGATION_WAIT_MS = 2500;
const CLICK_URL_CHANGE_DETECT_MS = 400;

const captureBeforeClick = async ({
  runId,
  step,
  action,
  text,
  elementId,
}: {
  runId: string;
  step: number;
  action: string;
  text: string;
  elementId: string;
}): Promise<void> => {
  const page = await browserManager.getPage(runId);
  const locator = await elementStore.get(runId, elementId).catch(() => undefined);
  if (!locator) {
    return;
  }
  const safeAction = action.replaceAll(/[\\/:*?"<>|]/g, "_");
  const screenshotPath = path.join(getRunDir(runId), `${step}_${safeAction}.png`);
  try {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) {
      return;
    }
    await renderHighlight(page, box, text);
    await page.waitForTimeout(SCREENSHOT_RENDER_WAIT_MS);
    await page.screenshot({ path: screenshotPath });
    preActionCaptureStore.add(runId, {
      elementId,
      action,
      step,
      text,
      screenshotPath,
    });
  } catch {
    // Ignore pre-capture errors so click behavior stays unchanged.
  } finally {
    await clearHighlight(page).catch(() => undefined);
  }
};

export const registerClickTool = (server: FastMCP): void => {
  const definition = {
    description: "点击元素",
    parameters: z.object({
      element_id: z.string().min(1),
      run_id: z.string().min(1),
      text: z.string().min(1).optional(),
      retry_count: z.number().int().min(0).max(2).default(1),
    }),
    execute: async ({
      element_id,
      run_id,
      text,
      retry_count,
    }: {
      element_id: string;
      run_id: string;
      text?: string;
      retry_count: number;
    }) => {
      const page = await browserManager.getPage(run_id);
      const step = stepRecorder.getNextStep(run_id);
      const desc = text ?? "点击元素";
      const pageUrlBefore = page.url();
      const startedAt = Date.now();

      await captureBeforeClick({
        runId: run_id,
        step,
        action: "click",
        text: desc,
        elementId: element_id,
      });

      let errorCode: string | undefined;
      let lastValidation: ValidationReport | undefined;
      for (let retry = 0; retry <= retry_count; retry += 1) {
        try {
          const locator = await elementStore.get(run_id, element_id);
          const urlBeforeClick = page.url();
          const waitForUrlChange = page
            .waitForURL((url) => url.toString() !== urlBeforeClick, { timeout: CLICK_URL_CHANGE_DETECT_MS })
            .then(() => true)
            .catch(() => false);
          await locator.scrollIntoViewIfNeeded();
          await locator.click();
          const urlChanged = await waitForUrlChange;
          if (urlChanged) {
            await page.waitForLoadState("domcontentloaded", { timeout: CLICK_NAVIGATION_WAIT_MS }).catch(() => undefined);
          }
          await page.waitForTimeout(120);

          const validation = await inspectValidation({ runId: run_id, page });
          const status: "FAILED" | "SUCCESS" = validation.failed ? "FAILED" : "SUCCESS";
          if (validation.failed) {
            lastValidation = validation;
            errorCode = "VALIDATION_ERROR";
          }

          stepRecorder.add(run_id, {
            step,
            desc,
            action: "click",
            status,
            errorCode,
            retryCount: retry,
            latencyMs: Date.now() - startedAt,
            pageUrlBefore,
            pageUrlAfter: page.url(),
            createdAt: new Date().toISOString(),
          });

          if (validation.failed) {
            throw new Error(buildValidationErrorMessage(validation));
          }

          return "Clicked successfully";
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidationError = message.startsWith("VALIDATION_ERROR");
          if (!isValidationError) {
            errorCode = errorCode ?? "CLICK_FAILED";
          }
          if (retry < retry_count) {
            await page.waitForTimeout(200 * (retry + 1));
          }
        }
      }
      stepRecorder.add(run_id, {
        step,
        desc,
        action: "click",
        status: "FAILED",
        errorCode: errorCode ?? (lastValidation ? "VALIDATION_ERROR" : "CLICK_FAILED"),
        retryCount: retry_count,
        latencyMs: Date.now() - startedAt,
        pageUrlBefore,
        pageUrlAfter: page.url(),
        createdAt: new Date().toISOString(),
      });
      if (lastValidation) {
        throw new Error(buildValidationErrorMessage(lastValidation));
      }
      throw new Error("Click failed after retries");
    },
  };

  server.addTool({
    name: "click",
    ...definition,
  });
};
