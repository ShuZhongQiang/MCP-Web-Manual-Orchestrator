import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { browserManager } from "../core/browser.js";
import { logicalStepStore } from "../core/logicalStepStore.js";
import { stepRecorder } from "../core/stepRecorder.js";

export const registerNavigateTool = (server: FastMCP): void => {
  server.addTool({
    name: "navigate",
    description: "打开网页",
    parameters: z.object({
      run_id: z.string().min(1),
      url: z.string().url(),
      text: z.string().min(1).optional(),
      step: z.number().int().positive().optional(),
    }),
    execute: async ({
      run_id,
      url,
      text,
      step,
    }: {
      run_id: string;
      url: string;
      text?: string;
      step?: number;
    }) => {
      const page = await browserManager.getPage(run_id);
      const stepNumber = logicalStepStore.resolve(run_id, step);
      const activeStep = logicalStepStore.getActive(run_id);
      const desc = text ?? activeStep?.desc ?? `打开网页: ${url}`;
      const pageUrlBefore = page.url();
      const startedAt = Date.now();

      try {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        stepRecorder.add(
          run_id,
          logicalStepStore.applyContext(run_id, stepNumber, {
            step: stepNumber,
            desc,
            action: "navigate",
            status: "SUCCESS",
            retryCount: 0,
            latencyMs: Date.now() - startedAt,
            pageUrlBefore,
            pageUrlAfter: page.url(),
            createdAt: new Date().toISOString(),
          }),
        );
        return `Successfully navigated to ${url}`;
      } catch {
        stepRecorder.add(
          run_id,
          logicalStepStore.applyContext(run_id, stepNumber, {
            step: stepNumber,
            desc,
            action: "navigate",
            status: "FAILED",
            errorCode: "NAVIGATE_FAILED",
            retryCount: 0,
            latencyMs: Date.now() - startedAt,
            pageUrlBefore,
            pageUrlAfter: page.url(),
            createdAt: new Date().toISOString(),
          }),
        );
        throw new Error(`Failed to navigate to ${url}`);
      }
    },
  });
};
