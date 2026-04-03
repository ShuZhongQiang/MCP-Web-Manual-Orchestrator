import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { browserManager } from "../core/browser.js";
import { ENABLE_TOOL_ALIASES } from "../config.js";
import { elementStore } from "../core/elementStore.js";
import { stepRecorder } from "../core/stepRecorder.js";

const CLICK_NAVIGATION_WAIT_MS = 2500;
const CLICK_URL_CHANGE_DETECT_MS = 400;

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
      let errorCode: string | undefined;
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

          // Generic validation/error detection after click (表单校验/错误提示)
          const validation = await page.evaluate(() => {
            const selectors = [
              ".ant-form-item-explain-error",
              ".ant-message-error",
              ".ant-notification-notice-message",
              ".el-form-item__error",
              ".el-message--error",
              ".alert-danger",
              ".invalid-feedback",
              "[aria-invalid=\"true\"]",
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel) as HTMLElement | null;
              if (el && (el.offsetParent !== null || getComputedStyle(el).display !== "none")) {
                const text = (el.textContent || "").trim().slice(0, 200);
                return { failed: true, message: text || sel };
              }
            }
            const body = document.body?.innerText || "";
            const re = /(必填|必填项|不能为空|请填写|校验失败|验证失败|Required|is required)/i;
            if (re.test(body)) {
              return { failed: true, message: body.match(re)?.[0] || "VALIDATION" };
            }
            return { failed: false };
          });

          const status = validation.failed ? "FAILED" : "SUCCESS" as const;
          if (validation.failed) {
            errorCode = "VALIDATION_ERROR";
          }

          stepRecorder.add(run_id, {
            step,
            desc,
            action: "click",
            status,
            retryCount: retry,
            latencyMs: Date.now() - startedAt,
            pageUrlBefore,
            pageUrlAfter: page.url(),
            createdAt: new Date().toISOString(),
          });

          if (validation.failed) {
            throw new Error("Click resulted in validation error");
          }

          return "Clicked successfully";
        } catch (e) {
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
        errorCode,
        retryCount: retry_count,
        latencyMs: Date.now() - startedAt,
        pageUrlBefore,
        pageUrlAfter: page.url(),
        createdAt: new Date().toISOString(),
      });
      throw new Error("Click failed after retries");
    },
  };

  server.addTool({
    name: "click",
    ...definition,
  });

  if (ENABLE_TOOL_ALIASES) {
    server.addTool({
      name: "browser.click",
      ...definition,
    });
  }
};
