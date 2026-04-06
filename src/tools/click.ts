import path from "node:path";
import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { browserManager } from "../core/browser.js";
import { SCREENSHOT_RENDER_WAIT_MS } from "../config.js";
import { elementStore } from "../core/elementStore.js";
import { preActionCaptureStore } from "../core/preActionCaptureStore.js";
import { selfHealStore } from "../core/selfHealStore.js";
import { stepRecorder } from "../core/stepRecorder.js";
import type { ElementSnapshot } from "../types.js";
import { getRunDir } from "../utils/file.js";
import { clearHighlight, renderHighlight } from "../utils/highlight.js";
import { buildValidationErrorMessage, inspectValidation, type ValidationReport } from "../utils/validation.js";

const CLICK_NAVIGATION_WAIT_MS = 2500;
const CLICK_URL_CHANGE_DETECT_MS = 400;
const MAX_SELF_HEAL_ROUNDS = 2;
const SUBMIT_ACTION_RE =
  /(?:\u63d0\u4ea4|\u4fdd\u5b58|\u786e\u8ba4|\u53d1\u5e03|\u521b\u5efa|\u767b\u5f55|\u6ce8\u518c|submit|save|confirm|sign\s?in|log\s?in)/i;

const isLikelySubmitClick = (desc: string, snapshot?: ElementSnapshot): boolean => {
  if (SUBMIT_ACTION_RE.test(desc)) {
    return true;
  }
  if (!snapshot) {
    return false;
  }
  if (snapshot.tag === "button" && snapshot.typeAttr.toLowerCase() === "submit") {
    return true;
  }
  const snapshotHint = `${snapshot.text} ${snapshot.ariaLabel} ${snapshot.nameAttr} ${snapshot.idAttr}`;
  return SUBMIT_ACTION_RE.test(snapshotHint);
};

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const buildSelfHealKey = (desc: string, elementId: string, snapshot?: ElementSnapshot): string => {
  const source = [
    desc,
    snapshot?.tag ?? "",
    snapshot?.typeAttr ?? "",
    snapshot?.idAttr ?? "",
    snapshot?.nameAttr ?? "",
    snapshot?.text ?? "",
    snapshot?.ariaLabel ?? "",
  ]
    .map(normalize)
    .filter((item) => item.length > 0)
    .join("|");
  return source || `submit:${elementId}`;
};

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
      const snapshot = elementStore.getSnapshot(run_id, element_id);
      const shouldInspectValidation = isLikelySubmitClick(desc, snapshot);
      const selfHealKey = shouldInspectValidation ? buildSelfHealKey(desc, element_id, snapshot) : undefined;

      if (selfHealKey && selfHealStore.get(run_id, selfHealKey) >= MAX_SELF_HEAL_ROUNDS) {
        stepRecorder.add(run_id, {
          step,
          desc,
          action: "click",
          status: "FAILED",
          errorCode: "SELF_HEAL_LIMIT_REACHED",
          retryCount: 0,
          latencyMs: Date.now() - startedAt,
          pageUrlBefore,
          pageUrlAfter: page.url(),
          createdAt: new Date().toISOString(),
        });
        throw new Error(
          `SELF_HEAL_LIMIT_REACHED ${JSON.stringify({
            max_rounds: MAX_SELF_HEAL_ROUNDS,
            message: `Validation self-heal reached max rounds: ${MAX_SELF_HEAL_ROUNDS}`,
          })}`,
        );
      }

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

          if (shouldInspectValidation) {
            const validation = await inspectValidation({ runId: run_id, page });
            if (validation.failed) {
              lastValidation = validation;
              if (selfHealKey) {
                selfHealStore.increment(run_id, selfHealKey);
              }
              errorCode = "VALIDATION_ERROR";
              stepRecorder.add(run_id, {
                step,
                desc,
                action: "click",
                status: "FAILED",
                errorCode,
                retryCount: retry,
                latencyMs: Date.now() - startedAt,
                pageUrlBefore,
                pageUrlAfter: page.url(),
                createdAt: new Date().toISOString(),
              });
              throw new Error(buildValidationErrorMessage(validation));
            }
          }

          if (selfHealKey) {
            selfHealStore.reset(run_id, selfHealKey);
          }

          stepRecorder.add(run_id, {
            step,
            desc,
            action: "click",
            status: "SUCCESS",
            retryCount: retry,
            latencyMs: Date.now() - startedAt,
            pageUrlBefore,
            pageUrlAfter: page.url(),
            createdAt: new Date().toISOString(),
          });

          return "Clicked successfully";
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidationError = message.startsWith("VALIDATION_ERROR");
          if (isValidationError) {
            throw (error instanceof Error ? error : new Error(message));
          }
          errorCode = errorCode ?? "CLICK_FAILED";
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
