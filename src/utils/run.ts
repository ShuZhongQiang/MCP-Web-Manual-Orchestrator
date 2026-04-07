import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { BASE_MANUAL_DIR } from "../config.js";

const RUN_ID_PATTERN = /^\d{8}_\d{9}$/;

export const assertValidRunId = (runId: string): void => {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      `RUN_ID_INVALID_FORMAT run_id '${runId}' must match YYYYMMDD_HHMMSSfff, for example 20260330_153012123.`,
    );
  }
};

export const resolveRunDirPath = (runId: string): string => {
  assertValidRunId(runId);
  return path.join(BASE_MANUAL_DIR, `run_${runId}`);
};

export const assertRunDirAvailableForNewSession = (runId: string): string => {
  const runDir = resolveRunDirPath(runId);
  if (!existsSync(runDir)) {
    return runDir;
  }

  const entries = readdirSync(runDir, { withFileTypes: true });
  const hasContent = entries.some((entry) => entry.name !== "." && entry.name !== "..");
  if (hasContent) {
    throw new Error(
      `RUN_ID_ALREADY_EXISTS run directory '${runDir}' already exists and is not empty. Generate a fresh run_id in YYYYMMDD_HHMMSSfff format.`,
    );
  }

  return runDir;
};
