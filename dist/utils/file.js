import { mkdirSync } from "node:fs";
import path from "node:path";
import { BASE_MANUAL_DIR } from "../config.js";
export const getRunDir = (runId) => {
    const runDir = path.join(BASE_MANUAL_DIR, `run_${runId}`);
    mkdirSync(runDir, { recursive: true });
    return runDir;
};
export const toRelativeImagePath = (imagePath, runDir) => {
    const rel = path.isAbsolute(imagePath) ? path.relative(runDir, imagePath) : imagePath;
    return rel.replaceAll("\\", "/");
};
