import { z } from "zod";
import { FastMCP } from "fastmcp";
import { APP_NAME, APP_VERSION, BASE_MANUAL_DIR, PROJECT_ROOT } from "./config.js";
import { browserManager } from "./core/browser.js";
import { elementStore } from "./core/elementStore.js";
import { preActionCaptureStore } from "./core/preActionCaptureStore.js";
import { selfHealStore } from "./core/selfHealStore.js";
import { stepRecorder } from "./core/stepRecorder.js";
import { logicalStepStore } from "./core/logicalStepStore.js";
import { registerClickTool } from "./tools/click.js";
import { registerFindTool } from "./tools/find.js";
import { registerGenerateManualTool } from "./tools/generateManual.js";
import { registerInsightTools } from "./tools/insight.js";
import { registerInputTool } from "./tools/input.js";
import { registerNavigateTool } from "./tools/navigate.js";
import { registerScreenshotTool } from "./tools/screenshot.js";
import { registerStepTool } from "./tools/step.js";

const main = async () => {
  const server = new FastMCP({
    name: APP_NAME,
    version: APP_VERSION,
  });

  registerNavigateTool(server);
  registerStepTool(server);
  registerFindTool(server);
  registerClickTool(server);
  registerInputTool(server);
  registerScreenshotTool(server);
  registerGenerateManualTool(server);
  registerInsightTools(server);

  server.addTool({
    name: "close_session",
    description: "结束当前 run 的浏览器会话并清理内存 | End the current run's browser session and clean up memory",
    parameters: z.object({
      run_id: z.string().min(1),
    }),
    execute: async ({ run_id }: { run_id: string }) => {
      await browserManager.closeContext(run_id);
      elementStore.clearRun(run_id);
      preActionCaptureStore.clearRun(run_id);
      selfHealStore.clearRun(run_id);
      stepRecorder.clear(run_id);
      logicalStepStore.clearRun(run_id);
      return `Session ${run_id} closed successfully`;
    },
  });

  process.on("SIGINT", async () => {
    await browserManager.closeAll();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await browserManager.closeAll();
    process.exit(0);
  });

  await server.start({
    transportType: "stdio",
  });

  const envBase = process.env.MANUALS_DIR;
  console.log(`[Manuals] PROJECT_ROOT = ${PROJECT_ROOT}`);
  console.log(`[Manuals] BASE_MANUAL_DIR = ${BASE_MANUAL_DIR}`);
  if (envBase) {
    console.log(`[Manuals] MANUALS_DIR override detected: ${envBase}`);
  } else {
    console.log('[Manuals] Using default project-root manuals path');
  }
};

main().catch(console.error);
