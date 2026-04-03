import { z } from "zod";
import { browserManager } from "../core/browser.js";
import { ENABLE_TOOL_ALIASES } from "../config.js";
import { stepRecorder } from "../core/stepRecorder.js";
export const registerNavigateTool = (server) => {
    const definition = {
        description: "打开网页",
        parameters: z.object({
            run_id: z.string().min(1),
            url: z.string().url(),
        }),
        execute: async ({ run_id, url }) => {
            const page = await browserManager.getPage(run_id);
            const step = stepRecorder.getNextStep(run_id);
            const pageUrlBefore = page.url();
            const startedAt = Date.now();
            try {
                await page.goto(url, { waitUntil: "domcontentloaded" });
                stepRecorder.add(run_id, {
                    step,
                    desc: `打开网页: ${url}`,
                    action: "navigate",
                    status: "SUCCESS",
                    retryCount: 0,
                    latencyMs: Date.now() - startedAt,
                    pageUrlBefore,
                    pageUrlAfter: page.url(),
                    createdAt: new Date().toISOString(),
                });
                return `Successfully navigated to ${url}`;
            }
            catch {
                stepRecorder.add(run_id, {
                    step,
                    desc: `打开网页: ${url}`,
                    action: "navigate",
                    status: "FAILED",
                    errorCode: "NAVIGATE_FAILED",
                    retryCount: 0,
                    latencyMs: Date.now() - startedAt,
                    pageUrlBefore,
                    pageUrlAfter: page.url(),
                    createdAt: new Date().toISOString(),
                });
                throw new Error(`Failed to navigate to ${url}`);
            }
        },
    };
    server.addTool({
        name: "navigate",
        ...definition,
    });
    if (ENABLE_TOOL_ALIASES) {
        server.addTool({
            name: "browser.navigate",
            ...definition,
        });
    }
};
