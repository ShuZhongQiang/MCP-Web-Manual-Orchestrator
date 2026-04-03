import path from "node:path";

export const APP_NAME = "MCP Web Manual Orchestrator";
export const APP_VERSION = "1.0.0";
// 输出根目录：优先环境变量 MANUALS_DIR，否则默认写入项目根下的 manualsByAi
export const BASE_MANUAL_DIR = process.env.MANUALS_DIR ? path.resolve(process.env.MANUALS_DIR) : path.resolve(process.cwd(), "manualsByAi");
export const VIEWPORT = { width: 1280, height: 800 };
export const BROWSER_HEADLESS = false;
export const ELEMENT_WAIT_TIMEOUT_MS = 2000;
export const SCREENSHOT_RENDER_WAIT_MS = 500;
export const ENABLE_TOOL_ALIASES = process.env.MCP_ENABLE_TOOL_ALIASES === "1";
