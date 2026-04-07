import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveRunDirPath } from "./run.js";

export const getRunDir = (runId: string): string => {
  const runDir = resolveRunDirPath(runId);
  mkdirSync(runDir, { recursive: true });
  return runDir;
};

export const toRelativeImagePath = (imagePath: string, runDir: string): string => {
  const rel = path.isAbsolute(imagePath) ? path.relative(runDir, imagePath) : imagePath;
  return rel.replaceAll("\\", "/");
};
