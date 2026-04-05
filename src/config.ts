import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_NAME = "MCP Web Manual Orchestrator";
export const APP_VERSION = "1.0.0";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
// 无论�?src(tsx) 还是 dist(node) 运行，config 文件的上一级都是项目根目录
export const PROJECT_ROOT = path.resolve(CURRENT_DIR, "..");

const resolveManualBaseDir = (): string => {
  const envManualDir = process.env.MANUALS_DIR?.trim();
  if (!envManualDir) {
    return path.resolve(PROJECT_ROOT, "manualsByAi");
  }

  if (path.isAbsolute(envManualDir)) {
    return path.resolve(envManualDir);
  }

  // 对相对路径按项目根目录解析，避免受启动进�?cwd 影响
  return path.resolve(PROJECT_ROOT, envManualDir);
};

export const BASE_MANUAL_DIR = resolveManualBaseDir();

export const VIEWPORT = { width: 1280, height: 800 };
export const BROWSER_HEADLESS = false;
export const ELEMENT_WAIT_TIMEOUT_MS = 2000;
export const SCREENSHOT_RENDER_WAIT_MS = 500;
