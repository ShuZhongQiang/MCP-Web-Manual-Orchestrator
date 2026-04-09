import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { logicalStepStore } from "../core/logicalStepStore.js";

export const registerStepTool = (server: FastMCP): void => {
  server.addTool({
    name: "begin_step",
    description: "启动运行时管理的逻辑步骤并分配共享 step_id | Start a runtime-managed logical step and allocate a shared step_id",
    parameters: z.object({
      run_id: z.string().min(1),
      desc: z.string().min(1).optional(),
      module: z.string().min(1).optional(),
      module_description: z.string().min(1).optional(),
    }),
    execute: async ({
      run_id,
      desc,
      module,
      module_description,
    }: {
      run_id: string;
      desc?: string;
      module?: string;
      module_description?: string;
    }) => {
      const context = logicalStepStore.begin(run_id, {
        desc,
        module,
        moduleDescription: module_description,
      });
      return JSON.stringify({
        run_id,
        step_id: context.step,
        desc: context.desc,
        module: context.module,
        module_description: context.moduleDescription,
      });
    },
  });
};
