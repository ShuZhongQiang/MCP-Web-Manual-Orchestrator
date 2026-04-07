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

const statusPriority: Record<NonNullable<StepRecord["status"]>, number> = {
  SUCCESS: 1,
  WARNING: 2,
  FAILED: 3,
};

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

const chooseStatus = (
  current?: StepRecord["status"],
  incoming?: StepRecord["status"],
): StepRecord["status"] | undefined => {
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }
  return statusPriority[incoming] >= statusPriority[current] ? incoming : current;
};

const mergeRecordedSteps = (current: StepRecord, incoming: StepRecord): StepRecord => ({
  step: current.step,
  desc:
    incoming.captureOnly && !current.captureOnly
      ? current.desc
      : current.desc.length >= incoming.desc.length
        ? current.desc
        : incoming.desc,
  image: incoming.image ?? current.image,
  action: incoming.action ?? current.action,
  status: chooseStatus(current.status, incoming.status),
  errorCode: incoming.errorCode ?? current.errorCode,
  retryCount:
    typeof incoming.retryCount === "number"
      ? Math.max(current.retryCount ?? 0, incoming.retryCount)
      : current.retryCount,
  latencyMs:
    typeof incoming.latencyMs === "number"
      ? Math.max(current.latencyMs ?? 0, incoming.latencyMs)
      : current.latencyMs,
  pageUrlBefore: current.pageUrlBefore ?? incoming.pageUrlBefore,
  pageUrlAfter: incoming.pageUrlAfter ?? current.pageUrlAfter,
  createdAt: incoming.createdAt ?? current.createdAt,
});

const coalesceSteps = (steps: StepRecord[]): StepRecord[] => {
  const ordered = [...steps].sort((a, b) => {
    if (a.step !== b.step) {
      return a.step - b.step;
    }
    return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  });
  const merged = new Map<number, StepRecord>();
  for (const item of ordered) {
    const current = merged.get(item.step);
    merged.set(item.step, current ? mergeRecordedSteps(current, item) : { ...item, captureOnly: false });
  }
  return [...merged.values()].sort((a, b) => a.step - b.step);
};

const mergeInputWithRecorded = (inputStep: StepRecord, recorded?: StepRecord): StepRecord => {
  if (!recorded) {
    return inputStep;
  }
  return {
    ...recorded,
    ...inputStep,
    desc: inputStep.desc || recorded.desc,
    image: inputStep.image ?? recorded.image,
    action: inputStep.action ?? recorded.action,
    status: recorded.status ?? inputStep.status,
    errorCode: recorded.errorCode ?? inputStep.errorCode,
    retryCount: recorded.retryCount ?? inputStep.retryCount,
    latencyMs: recorded.latencyMs ?? inputStep.latencyMs,
    pageUrlBefore: recorded.pageUrlBefore ?? inputStep.pageUrlBefore,
    pageUrlAfter: recorded.pageUrlAfter ?? inputStep.pageUrlAfter,
    createdAt: recorded.createdAt ?? inputStep.createdAt,
  };
};

const buildMissingStepsError = (steps: number[]): Error => {
  const sorted = [...new Set(steps)].sort((a, b) => a - b);
  return new Error(
    `STEP_MAPPING_MISSING Execution records were written to unmapped logical steps: ${sorted.join(", ")}. ` +
      "Re-run the flow and pass the same explicit step number to navigate/click/input_text/highlight_and_capture for each logical manual step.",
  );
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
      const persisted = coalesceSteps(stepRecorder.get(run_id));
      if (inputSteps.length === 0) {
        throw new Error(
          "STEPS_JSON_REQUIRED generate_manual requires non-empty steps_json so the final manual follows the user's logical step order instead of raw execution logs.",
        );
      }

      const inputStepNumbers = new Set(inputSteps.map((item) => item.step));
      const unmappedSteps = persisted
        .filter((item) => !inputStepNumbers.has(item.step))
        .map((item) => item.step);
      if (unmappedSteps.length > 0) {
        throw buildMissingStepsError(unmappedSteps);
      }

      const persistedByStep = new Map(persisted.map((item) => [item.step, item]));
      const merged = inputSteps.map((item) => mergeInputWithRecorded(item, persistedByStep.get(item.step)));
      const sorted = [...merged].sort((a, b) => a.step - b.step);

      const normalized = sorted.map((item) => ({
        ...item,
        image: item.image ? toRelativeImagePath(item.image, runDir) : undefined,
        captureOnly: undefined,
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
