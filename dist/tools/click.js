import { z } from "zod";
import { browserManager } from "../core/browser.js";
import { ENABLE_TOOL_ALIASES } from "../config.js";
import { elementStore } from "../core/elementStore.js";
import { stepRecorder } from "../core/stepRecorder.js";
const CLICK_NAVIGATION_WAIT_MS = 2500;
const CLICK_URL_CHANGE_DETECT_MS = 400;
export const registerClickTool = (server) => {
    const definition = {
        description: "点击元素",
        parameters: z.object({
            element_id: z.string().min(1),
            run_id: z.string().min(1),
            text: z.string().min(1).optional(),
            retry_count: z.number().int().min(0).max(2).default(1),
        }),
        execute: async ({ element_id, run_id, text, retry_count, }) => {
            const page = await browserManager.getPage(run_id);
            const step = stepRecorder.getNextStep(run_id);
            const desc = text ?? "点击元素";
            const pageUrlBefore = page.url();
            const startedAt = Date.now();
            let errorCode;
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
                    await page.waitForTimeout(100);
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
                }
                catch {
                    errorCode = "CLICK_FAILED";
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
