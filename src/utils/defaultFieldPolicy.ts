import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../config.js";

type BuiltinGeneratorName = "current_date";

type DefaultFieldRuleDefinition = {
  id: string;
  pattern: string;
  flags?: string;
  value?: string;
  generator?: BuiltinGeneratorName;
  priority?: number;
};

type DefaultFieldPolicyDefinition = {
  option_placeholder_patterns?: string[];
  rules?: DefaultFieldRuleDefinition[];
};

type CompiledFieldRule = DefaultFieldRuleDefinition & {
  regex: RegExp;
};

const DEFAULT_OPTION_PLACEHOLDER_PATTERNS = [
  "^\\u8bf7\\u9009\\u62e9$",
  "^please select$",
  "^select$",
  "^\\u8bf7\\u9009\\u62e9\\u4e00\\u9879$",
  "^\\u8bf7\\u9009\\u62e9\\u7c7b\\u578b$",
  "^\\u8bf7\\u9009\\u62e9\\u5206\\u7c7b$",
];

const DEFAULT_FIELD_RULES: DefaultFieldRuleDefinition[] = [
  {
    id: "phone",
    pattern: "\\u624b\\u673a|phone|mobile",
    value: "13800138000",
    priority: 100,
  },
  {
    id: "email",
    pattern: "\\u90ae\\u7bb1|email|mail",
    value: "test@example.com",
    priority: 100,
  },
  {
    id: "postal",
    pattern: "\\u90ae\\u7f16|zip|postal",
    value: "100000",
    priority: 100,
  },
  {
    id: "date",
    pattern: "\\u65e5\\u671f|date|time",
    generator: "current_date",
    priority: 100,
  },
  {
    id: "price",
    pattern: "\\u4ef7\\u683c|price|amount|\\u5355\\u4ef7|fee|cost",
    value: "9.9",
    priority: 100,
  },
  {
    id: "inventory",
    pattern: "\\u5e93\\u5b58|stock|quantity|number|count|qty|inventory",
    value: "100",
    priority: 100,
  },
  {
    id: "category",
    pattern: "\\u5206\\u7c7b|category|type|kind|group",
    value: "\\u6d4b\\u8bd5\\u5206\\u7c7b",
    priority: 90,
  },
  {
    id: "name",
    pattern: "\\u540d\\u79f0|name|title|product",
    value: "\\u6d4b\\u8bd5\\u9879\\u76ee",
    priority: 90,
  },
  {
    id: "description",
    pattern: "\\u63cf\\u8ff0|description|desc|remark|note|summary",
    value: "\\u6d4b\\u8bd5\\u63cf\\u8ff0",
    priority: 90,
  },
];

const currentLocalDate = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const resolveEnvPolicyFilePath = (): string | undefined => {
  const configured = process.env.FIELD_DEFAULT_VALUE_POLICY_FILE?.trim();
  if (!configured) {
    return undefined;
  }
  return path.isAbsolute(configured) ? configured : path.resolve(PROJECT_ROOT, configured);
};

const parsePolicyDefinition = (raw: string, source: string): DefaultFieldPolicyDefinition => {
  try {
    const parsed = JSON.parse(raw) as DefaultFieldPolicyDefinition;
    return parsed ?? {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid default field policy from ${source}: ${message}`);
  }
};

const loadPolicyOverrides = (): DefaultFieldPolicyDefinition[] => {
  const overrides: DefaultFieldPolicyDefinition[] = [];
  const filePath = resolveEnvPolicyFilePath();
  if (filePath && existsSync(filePath)) {
    overrides.push(parsePolicyDefinition(readFileSync(filePath, "utf-8"), filePath));
  }
  const inlineJson = process.env.FIELD_DEFAULT_VALUE_POLICY_JSON?.trim();
  if (inlineJson) {
    overrides.push(parsePolicyDefinition(inlineJson, "FIELD_DEFAULT_VALUE_POLICY_JSON"));
  }
  return overrides;
};

const decodeUnicodeEscapes = (value: string): string => {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) =>
    String.fromCharCode(Number.parseInt(code, 16)),
  );
};

const builtinGenerators: Record<BuiltinGeneratorName, () => string> = {
  current_date: currentLocalDate,
};

const mergePolicyDefinitions = (): {
  optionPlaceholderRegexes: RegExp[];
  fieldRules: CompiledFieldRule[];
} => {
  const overrides = loadPolicyOverrides();
  const optionPlaceholderPatterns = [
    ...DEFAULT_OPTION_PLACEHOLDER_PATTERNS,
    ...overrides.flatMap((item) => item.option_placeholder_patterns ?? []),
  ];
  const fieldRules = [...DEFAULT_FIELD_RULES, ...overrides.flatMap((item) => item.rules ?? [])]
    .map((item, index) => ({
      ...item,
      regex: new RegExp(item.pattern, item.flags ?? "i"),
      priority: item.priority ?? 0,
      stableIndex: index,
    }))
    .sort(
      (left, right) => (right.priority ?? 0) - (left.priority ?? 0) || right.stableIndex - left.stableIndex,
    )
    .map(({ stableIndex, ...item }) => item);

  return {
    optionPlaceholderRegexes: optionPlaceholderPatterns.map((item) => new RegExp(item, "i")),
    fieldRules,
  };
};

const compiledPolicy = mergePolicyDefinitions();

const resolveRuleValue = (rule: CompiledFieldRule): string => {
  if (rule.generator) {
    return builtinGenerators[rule.generator]();
  }
  return decodeUnicodeEscapes(rule.value ?? "");
};

export const resolveConfiguredDefaultFieldValue = (fieldName: string, fallback = "\\u6d4b\\u8bd5\\u503c"): string => {
  const normalized = fieldName.toLowerCase();
  const matched = compiledPolicy.fieldRules.find((item) => item.regex.test(normalized));
  return matched ? resolveRuleValue(matched) : decodeUnicodeEscapes(fallback);
};

export const pickConfiguredOptionValue = (options: string[]): string | undefined => {
  return options
    .map((item) => item.trim())
    .find(
      (item) =>
        item.length > 0 && !compiledPolicy.optionPlaceholderRegexes.some((pattern) => pattern.test(item)),
    );
};
