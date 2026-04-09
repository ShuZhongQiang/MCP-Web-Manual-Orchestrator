import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { browserManager } from "../core/browser.js";
import { elementStore } from "../core/elementStore.js";
import { logicalStepStore } from "../core/logicalStepStore.js";
import { stepRecorder } from "../core/stepRecorder.js";

export const registerInputTool = (server: FastMCP): void => {
  server.addTool({
    name: "input_text",
    description: "输入内容 | Input content",
    parameters: z.object({
      element_id: z.string().min(1),
      value: z.string(),
      run_id: z.string().min(1),
      text: z.string().min(1).optional(),
      step: z.number().int().positive().optional(),
      retry_count: z.number().int().min(0).max(2).default(1),
    }),
    execute: async ({
      element_id,
      value,
      run_id,
      text,
      step,
      retry_count,
    }: {
      element_id: string;
      value: string;
      run_id: string;
      text?: string;
      step?: number;
      retry_count: number;
    }) => {
      const page = await browserManager.getPage(run_id);
      const stepNumber = logicalStepStore.resolve(run_id, step);
      const activeStep = logicalStepStore.getActive(run_id);
      const desc = text ?? activeStep?.desc ?? `输入内容: ${value}`;
      const pageUrlBefore = page.url();
      const startedAt = Date.now();
      let errorCode: string | undefined;

      for (let retry = 0; retry <= retry_count; retry += 1) {
        try {
          const locator = await elementStore.get(run_id, element_id);
          await locator.scrollIntoViewIfNeeded();
          await locator.fill(value);
          stepRecorder.add(
            run_id,
            logicalStepStore.applyContext(run_id, stepNumber, {
              step: stepNumber,
              desc,
              action: "input",
              status: "SUCCESS",
              retryCount: retry,
              latencyMs: Date.now() - startedAt,
              pageUrlBefore,
              pageUrlAfter: page.url(),
              createdAt: new Date().toISOString(),
            }),
          );
          return `Input '${value}' successfully`;
        } catch {
          errorCode = "INPUT_FAILED";
          if (retry < retry_count) {
            await page.waitForTimeout(200 * (retry + 1));
          }
        }
      }

      stepRecorder.add(
        run_id,
        logicalStepStore.applyContext(run_id, stepNumber, {
          step: stepNumber,
          desc,
          action: "input",
          status: "FAILED",
          errorCode,
          retryCount: retry_count,
          latencyMs: Date.now() - startedAt,
          pageUrlBefore,
          pageUrlAfter: page.url(),
          createdAt: new Date().toISOString(),
        }),
      );
      throw new Error("Input failed after retries");
    },
  });
};
