import { writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { FastMCP } from "fastmcp";

import { elementStore } from "../core/elementStore.js";
import { preActionCaptureStore } from "../core/preActionCaptureStore.js";
import { stepRecorder } from "../core/stepRecorder.js";
import type { StepRecord } from "../types.js";
import { getRunDir, toRelativeImagePath } from "../utils/file.js";
import { buildManualHtml } from "../utils/html.js";

const parseSteps = (stepsJson: string): StepRecord[] => {
  if (stepsJson.trim().length === 0) {
    return [];
  }
  const parsed = JSON.parse(stepsJson) as unknown;
  return z
    .array(
      z
        .object({
          step: z.coerce.number(),
          desc: z.string().optional(),
          text: z.string().optional(),
          image: z.string().optional(),
          screenshot: z.string().optional(),
          action: z.string().optional(),
          status: z.enum(["SUCCESS", "FAILED", "WARNING"]).optional(),
          errorCode: z.string().optional(),
          retryCount: z.number().optional(),
          latencyMs: z.number().optional(),
          pageUrlBefore: z.string().optional(),
          pageUrlAfter: z.string().optional(),
          createdAt: z.string().optional(),
        })
        .transform((item): StepRecord => {
          const desc = item.desc ?? item.text;
          if (!desc) {
            throw new Error(`Step ${item.step} is missing both 'desc' and 'text'`);
          }
          return {
            step: item.step,
            desc,
            image: item.image ?? item.screenshot,
            action: item.action,
            status: item.status,
            errorCode: item.errorCode,
            retryCount: item.retryCount,
            latencyMs: item.latencyMs,
            pageUrlBefore: item.pageUrlBefore,
            pageUrlAfter: item.pageUrlAfter,
            createdAt: item.createdAt,
          };
        }),
    )
    .parse(parsed);
};

export const registerGenerateManualTool = (server: FastMCP): void => {
  const definition = {
    description: "生成 HTML 操作手册",
    parameters: z.object({
      steps_json: z.string().default("[]"),
      run_id: z.string().min(1),
      clear_after_generate: z.boolean().default(false),
    }),
    execute: async ({
      steps_json,
      run_id,
      clear_after_generate,
    }: {
      steps_json: string;
      run_id: string;
      clear_after_generate: boolean;
    }) => {
      const runDir = getRunDir(run_id);
      const htmlPath = path.join(runDir, "manual.html");

      const inputSteps = parseSteps(steps_json);
      const persisted = stepRecorder.get(run_id);
      const merged = inputSteps.length > 0 ? inputSteps : persisted;
      const sorted = [...merged].sort((a, b) => a.step - b.step);

      const normalized = sorted.map((item) => ({
        ...item,
        image: item.image ? toRelativeImagePath(item.image, runDir) : undefined,
      }));

      const now = new Date();
      const generatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      const html = buildManualHtml(run_id, generatedAt, normalized);
      writeFileSync(htmlPath, html, "utf-8");
      if (clear_after_generate) {
        stepRecorder.clear(run_id);
        elementStore.clearRun(run_id);
        preActionCaptureStore.clearRun(run_id);
      }

      return htmlPath;
    },
  };

  server.addTool({
    name: "generate_manual",
    ...definition,
  });

  
};
