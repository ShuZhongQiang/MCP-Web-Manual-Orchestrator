import { writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { FastMCP } from "fastmcp";

import { elementStore } from "../core/elementStore.js";
import { preActionCaptureStore } from "../core/preActionCaptureStore.js";
import { stepRecorder } from "../core/stepRecorder.js";
import type { ManualDocument, ManualModule, StepRecord } from "../types.js";
import { getRunDir, toRelativeImagePath } from "../utils/file.js";
import { buildManualHtml } from "../utils/html.js";

const statusPriority: Record<NonNullable<StepRecord["status"]>, number> = {
  SUCCESS: 1,
  WARNING: 2,
  FAILED: 3,
};

type ParsedManualPayload = {
  title?: string;
  summary?: string;
  modules?: ManualModule[];
  steps: StepRecord[];
};

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const stepSchema = z
  .object({
    step: z.coerce.number().int().positive(),
    desc: z.string().optional(),
    text: z.string().optional(),
    image: z.string().optional(),
    screenshot: z.string().optional(),
    action: z.string().optional(),
    module: z.string().optional(),
    moduleTitle: z.string().optional(),
    module_title: z.string().optional(),
    moduleDescription: z.string().optional(),
    module_description: z.string().optional(),
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
      module: item.module ?? item.moduleTitle ?? item.module_title,
      moduleDescription: item.moduleDescription ?? item.module_description,
      status: item.status,
      errorCode: item.errorCode,
      retryCount: item.retryCount,
      latencyMs: item.latencyMs,
      pageUrlBefore: item.pageUrlBefore,
      pageUrlAfter: item.pageUrlAfter,
      createdAt: item.createdAt,
    };
  });

const moduleSchema = z
  .object({
    title: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    summary: z.string().optional(),
    steps: z.array(z.coerce.number().int().positive()).optional(),
    stepNumbers: z.array(z.coerce.number().int().positive()).optional(),
    step_numbers: z.array(z.coerce.number().int().positive()).optional(),
  })
  .transform((item): ManualModule => {
    const title = item.title ?? item.name;
    if (!title || title.trim().length === 0) {
      throw new Error("Manual module is missing 'title'");
    }
    return {
      title,
      description: item.description ?? item.summary,
      steps: item.steps ?? item.stepNumbers ?? item.step_numbers,
    };
  });

const manualObjectSchema = z
  .object({
    title: z.string().optional(),
    manualTitle: z.string().optional(),
    manual_title: z.string().optional(),
    operationName: z.string().optional(),
    operation_name: z.string().optional(),
    summary: z.string().optional(),
    overview: z.string().optional(),
    description: z.string().optional(),
    modules: z.array(moduleSchema).optional(),
    steps: z.array(stepSchema).optional(),
    stepList: z.array(stepSchema).optional(),
    step_list: z.array(stepSchema).optional(),
  })
  .transform((item): ParsedManualPayload => {
    const steps = item.steps ?? item.stepList ?? item.step_list;
    if (!steps || steps.length === 0) {
      throw new Error("Manual payload is missing non-empty 'steps'");
    }
    return {
      title:
        item.title ??
        item.manualTitle ??
        item.manual_title ??
        item.operationName ??
        item.operation_name,
      summary: item.summary ?? item.overview ?? item.description,
      modules: item.modules,
      steps,
    };
  });

const parseSteps = (stepsJson: string): ParsedManualPayload => {
  if (stepsJson.trim().length === 0) {
    return { steps: [] };
  }
  const parsed = JSON.parse(stepsJson) as unknown;
  if (Array.isArray(parsed)) {
    return {
      steps: z.array(stepSchema).parse(parsed),
    };
  }
  return manualObjectSchema.parse(parsed);
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
  module: incoming.module ?? current.module,
  moduleDescription: incoming.moduleDescription ?? current.moduleDescription,
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
    module: inputStep.module ?? recorded.module,
    moduleDescription: inputStep.moduleDescription ?? recorded.moduleDescription,
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

const ensureSentence = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  return /[。！？.!?]$/.test(trimmed) ? trimmed : `${trimmed}。`;
};

const summarizeActions = (steps: StepRecord[]): string => {
  const labels = Array.from(
    new Set(
      steps
        .map((item) => item.action)
        .filter((item): item is string => Boolean(item))
        .map((item) => {
          if (item === "navigate") {
            return "页面进入";
          }
          if (item === "click") {
            return "关键点击";
          }
          if (item === "input") {
            return "信息填写";
          }
          if (item === "select") {
            return "选项选择";
          }
          return item;
        }),
    ),
  );
  if (labels.length === 0) {
    return "页面操作";
  }
  return labels.slice(0, 3).join("、");
};

const buildSummary = (inputSummary: string | undefined, title: string, steps: StepRecord[]): string => {
  if (inputSummary && inputSummary.trim().length > 0) {
    return ensureSentence(inputSummary);
  }
  const titleCore = title.replace(/操作手册$|操作指南$|使用手册$|流程手册$/u, "");
  return ensureSentence(
    `本文档说明如何完成“${titleCore}”相关操作，共 ${steps.length} 个步骤，涵盖${summarizeActions(steps)}等关键环节`,
  );
};

const scoreTitleCandidate = (value: string): number => {
  let score = value.length;
  if (/(新增|创建|添加|编辑|修改|删除|导入|导出|提交|审核|发布|保存|登录|注册)/u.test(value)) {
    score += 20;
  }
  if (/(按钮|输入框|页面|菜单|列表|弹窗|步骤|模块)/u.test(value)) {
    score -= 10;
  }
  return score;
};

const normalizeTitleCore = (value: string): string => {
  let normalized = value.trim();
  normalized = normalized.replace(/^(点击|单击|打开|访问|进入|填写|输入|选择|确认|提交|保存)/u, "");
  normalized = normalized.replace(/(按钮|输入框|下拉框|菜单|页面|表单|功能|模块)$/u, "");
  normalized = normalized.replace(/\s+/g, "");
  normalized = normalized.replace(/^添加/u, "");
  normalized = normalized.replace(/^新增/u, "");
  normalized = normalized.replace(/^创建/u, "");
  normalized = normalized.replace(/^新建/u, "");
  normalized = normalized.trim();
  if (normalized.length === 0) {
    return "";
  }
  if (/(新增|创建|添加|新建)$/u.test(value)) {
    return `${normalized}新增`;
  }
  if (/(编辑|修改)$/u.test(value)) {
    return `${normalized}编辑`;
  }
  if (/(删除)$/u.test(value)) {
    return `${normalized}删除`;
  }
  return normalized;
};

const deriveTitleCandidate = (steps: StepRecord[]): string | undefined => {
  const texts = steps.map((item) => item.desc.trim()).filter((item) => item.length > 0);
  const candidates: string[] = [];

  for (const text of texts) {
    const directPatterns = [
      /(?:新增|添加|创建|新建)([\u4e00-\u9fa5A-Za-z0-9_-]{1,12})/u,
      /([\u4e00-\u9fa5A-Za-z0-9_-]{1,12})(?:新增|添加|创建|新建)/u,
      /(?:编辑|修改)([\u4e00-\u9fa5A-Za-z0-9_-]{1,12})/u,
      /([\u4e00-\u9fa5A-Za-z0-9_-]{1,12})(?:编辑|修改)/u,
      /(?:删除)([\u4e00-\u9fa5A-Za-z0-9_-]{1,12})/u,
      /(?:登录|注册|审核|发布|导入|导出)([\u4e00-\u9fa5A-Za-z0-9_-]{0,12})/u,
    ];
    for (const pattern of directPatterns) {
      const match = text.match(pattern);
      if (match) {
        const candidate = normalizeTitleCore(match[0]);
        if (candidate.length > 0) {
          candidates.push(candidate);
        }
      }
    }

    const actionMatch = text.match(
      /(?:点击|单击|打开|访问|进入|填写|输入|选择|确认)([\u4e00-\u9fa5A-Za-z0-9_-]{2,18})/u,
    );
    if (actionMatch) {
      const candidate = normalizeTitleCore(actionMatch[1]);
      if (candidate.length > 0) {
        candidates.push(candidate);
      }
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  const scored = new Map<string, number>();
  for (const candidate of candidates) {
    scored.set(candidate, (scored.get(candidate) ?? 0) + scoreTitleCandidate(candidate));
  }

  return [...scored.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

const ensureManualTitle = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "Web 自动化操作手册";
  }
  if (/(手册|指南|说明|SOP|guide|manual|handbook)$/iu.test(trimmed)) {
    return trimmed;
  }
  if (/操作$/u.test(trimmed)) {
    return `${trimmed}手册`;
  }
  if (/流程$/u.test(trimmed)) {
    return `${trimmed}说明`;
  }
  return `${trimmed}操作手册`;
};

const resolveTitle = (inputTitle: string | undefined, steps: StepRecord[]): string => {
  if (inputTitle && inputTitle.trim().length > 0) {
    return ensureManualTitle(inputTitle);
  }
  const candidate = deriveTitleCandidate(steps);
  return ensureManualTitle(candidate ?? "Web 自动化操作");
};

const buildModuleDescription = (moduleTitle: string, steps: StepRecord[]): string => {
  const actionSummary = steps
    .slice(0, 3)
    .map((item) => item.desc.trim())
    .filter((item) => item.length > 0)
    .join("、");
  const suffix = steps.length > 3 ? "等操作" : "相关操作";
  return ensureSentence(
    `本模块聚焦于${moduleTitle}，包含 ${steps.length} 个步骤，主要覆盖${actionSummary || moduleTitle}${suffix}`,
  );
};

const createFallbackModuleTitle = (title: string): string => {
  return title.replace(/操作手册$|操作指南$|使用手册$|流程手册$/u, "") || "操作流程";
};

const resolveModules = (
  inputModules: ManualModule[] | undefined,
  steps: StepRecord[],
  title: string,
): ManualDocument["modules"] => {
  const stepMap = new Map(steps.map((item) => [item.step, item]));
  const builders = new Map<
    string,
    {
      title: string;
      description?: string;
      stepNumbers: Set<number>;
    }
  >();

  const ensureBuilder = (moduleTitle: string, moduleDescription?: string) => {
    const key = normalize(moduleTitle);
    const current = builders.get(key);
    if (current) {
      if (!current.description && moduleDescription && moduleDescription.trim().length > 0) {
        current.description = moduleDescription;
      }
      return current;
    }
    const created = {
      title: moduleTitle.trim(),
      description: moduleDescription?.trim(),
      stepNumbers: new Set<number>(),
    };
    builders.set(key, created);
    return created;
  };

  for (const moduleItem of inputModules ?? []) {
    const builder = ensureBuilder(moduleItem.title, moduleItem.description);
    for (const stepNumber of moduleItem.steps ?? []) {
      if (stepMap.has(stepNumber)) {
        builder.stepNumbers.add(stepNumber);
      }
    }
  }

  for (const step of steps) {
    if (!step.module || step.module.trim().length === 0) {
      continue;
    }
    const builder = ensureBuilder(step.module, step.moduleDescription);
    builder.stepNumbers.add(step.step);
  }

  if (builders.size === 0) {
    const builder = ensureBuilder(createFallbackModuleTitle(title));
    for (const step of steps) {
      builder.stepNumbers.add(step.step);
    }
  }

  const assignedSteps = new Set<number>();
  for (const builder of builders.values()) {
    for (const stepNumber of builder.stepNumbers) {
      assignedSteps.add(stepNumber);
    }
  }

  const unassignedSteps = steps.map((item) => item.step).filter((stepNumber) => !assignedSteps.has(stepNumber));
  if (unassignedSteps.length > 0) {
    if (builders.size === 1) {
      const only = builders.values().next().value as { stepNumbers: Set<number> };
      for (const stepNumber of unassignedSteps) {
        only.stepNumbers.add(stepNumber);
      }
    } else {
      const builder = ensureBuilder("补充步骤");
      for (const stepNumber of unassignedSteps) {
        builder.stepNumbers.add(stepNumber);
      }
    }
  }

  return [...builders.values()]
    .map((builder) => {
      const stepNumbers = [...builder.stepNumbers].filter((item) => stepMap.has(item)).sort((a, b) => a - b);
      const moduleSteps = stepNumbers.map((item) => stepMap.get(item)).filter((item): item is StepRecord => Boolean(item));
      if (moduleSteps.length === 0) {
        return undefined;
      }
      return {
        title: builder.title,
        description:
          builder.description && builder.description.trim().length > 0
            ? ensureSentence(builder.description)
            : buildModuleDescription(builder.title, moduleSteps),
        steps: stepNumbers,
      };
    })
    .filter((item): item is ManualDocument["modules"][number] => Boolean(item))
    .sort((a, b) => {
      const stepA = a.steps[0] ?? Number.MAX_SAFE_INTEGER;
      const stepB = b.steps[0] ?? Number.MAX_SAFE_INTEGER;
      if (stepA !== stepB) {
        return stepA - stepB;
      }
      return a.title.localeCompare(b.title);
    });
};

const buildManualDocument = (
  input: ParsedManualPayload,
  steps: StepRecord[],
): ManualDocument => {
  const title = resolveTitle(input.title, steps);
  return {
    title,
    summary: buildSummary(input.summary, title, steps),
    modules: resolveModules(input.modules, steps, title),
    steps,
  };
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

      const parsedInput = parseSteps(steps_json);
      const inputSteps = parsedInput.steps;
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

      const document = buildManualDocument(parsedInput, normalized);
      const now = new Date();
      const generatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      const html = buildManualHtml(run_id, generatedAt, document);
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
