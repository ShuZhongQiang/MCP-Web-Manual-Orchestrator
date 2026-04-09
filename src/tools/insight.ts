import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { Locator, Page } from "playwright";
import { browserManager } from "../core/browser.js";
import { elementStore } from "../core/elementStore.js";
import { stepRecorder } from "../core/stepRecorder.js";
import type { ElementSnapshot } from "../types.js";
import { inspectValidation, type ValidationReport } from "../utils/validation.js";

const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, [role='button'], [onclick]";
const ACTIVE_LAYER_SELECTOR = [
  "[role='dialog']",
  ".ant-modal",
  ".ant-modal-root",
  ".el-dialog",
  ".el-drawer",
  ".ant-drawer",
  ".ant-select-dropdown",
  ".el-select-dropdown",
  ".el-popper",
  "[role='listbox']",
  ".ant-picker-dropdown",
  ".ant-dropdown",
  ".ant-popover",
].join(", ");
const DROPDOWN_LAYER_SELECTOR = [
  ".ant-select-dropdown",
  ".el-select-dropdown",
  ".el-popper",
  "[role='listbox']",
  ".ant-picker-dropdown",
  ".ant-dropdown",
].join(", ");
const FORM_CONTAINER_SELECTOR =
  "form, .ant-modal, .ant-modal-root, .el-dialog, .el-drawer, .ant-drawer, .ant-form, .el-form";
const FIELD_CONTAINER_SELECTOR =
  ".ant-form-item, .el-form-item, .form-group, [class*='form-item'], [class*='field']";
const FORM_CONTROL_SELECTOR = [
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "[role='combobox']",
  "[role='textbox']",
  "[role='spinbutton']",
  "[role='checkbox']",
  "[role='radio']",
  "[contenteditable='true']",
  ".ant-select-selector",
  ".ant-input-number",
  ".ant-input-number-input",
  ".ant-picker",
  ".ant-picker-input input",
  ".el-select",
  ".el-input__inner",
  ".el-textarea__inner",
  ".el-date-editor",
].join(", ");

type ActiveLayerKind = "dialog" | "drawer" | "dropdown" | "popover" | "other";

type ActiveLayerRecord = {
  dom_id: string;
  kind: ActiveLayerKind;
  role: string;
  className: string;
  text: string;
  zIndex: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  hasBackdrop: boolean;
  optionTexts: string[];
  element_id?: string;
};

type FormFieldRecord = {
  dom_id: string;
  label: string;
  required: boolean;
  control_type: string;
  empty: boolean;
  disabled: boolean;
  value_preview: string;
  placeholder: string;
  aria_label: string;
  name_attr: string;
  id_attr: string;
  option_preview: string[];
  element_id?: string;
};

type FormPlanStatus = "pending" | "satisfied" | "skipped" | "blocked";
type FormPlanValueSource =
  | "user_provided"
  | "default_heal"
  | "existing_value"
  | "unresolved";
type FormPlanQueueReason =
  | "user_intent"
  | "validation_missing"
  | "required_empty"
  | "already_filled"
  | "optional_empty";
type FormPlanAction = "input_text" | "click" | "click -> option click" | "skip";

type CompiledFormPlanField = {
  index: number;
  field_name: string;
  control_type: string;
  required: boolean;
  element_id?: string;
  current_value: string;
  planned_value?: string;
  value_source: FormPlanValueSource;
  queue_reason: FormPlanQueueReason;
  expected_action: FormPlanAction;
  status: FormPlanStatus;
  priority: number;
  empty: boolean;
  disabled: boolean;
  option_preview: string[];
};

const FORM_INTENT_RE =
  /(?:新增|创建|新建|添加|编辑|填写|填报|完善表单|提交|保存|确认|录入|create|add|new|edit|fill|submit|save|confirm)/i;
const FORM_VALUE_PREFIX_RE = /^(?:请(?:输入|选择)|please\s+(?:enter|select)\s*)/i;
const FORM_FIELD_SUFFIX_RE =
  /(?:输入框|下拉框|文本框|文本域|选择框|选择器|日期框|时间框|字段|选项|内容|值|栏位|控件)$/iu;

const normalizeText = (value: string): string => value.trim().replace(/\s+/g, " ");

const normalizeFieldKey = (value: string): string => {
  return normalizeText(value)
    .replace(FORM_VALUE_PREFIX_RE, "")
    .replace(/[*＊]/gu, "")
    .replace(/[：:]/gu, "")
    .replace(/[（(][^()（）]{0,30}[)）]/gu, "")
    .replace(FORM_FIELD_SUFFIX_RE, "")
    .toLowerCase();
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const currentLocalDate = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const generateDefaultFieldValue = (field: string): string => {
  const normalized = field.toLowerCase();
  if (/手机|phone|mobile/.test(normalized)) {
    return "13800138000";
  }
  if (/邮箱|email|mail/.test(normalized)) {
    return "test@example.com";
  }
  if (/邮编|zip|postal/.test(normalized)) {
    return "100000";
  }
  if (/日期|date|time/.test(normalized)) {
    return currentLocalDate();
  }
  if (/价格|price|amount|单价|fee|cost/.test(normalized)) {
    return "9.9";
  }
  if (/库存|stock|quantity|number|count|qty|inventory/.test(normalized)) {
    return "100";
  }
  if (/分类|category|type|kind|group/.test(normalized)) {
    return "咖啡";
  }
  if (/名称|name|title|product/.test(normalized)) {
    return "测试项目";
  }
  if (/描述|description|desc|remark|note|summary/.test(normalized)) {
    return "测试描述";
  }
  return "测试值";
};

const buildFieldAliases = (field: FormFieldRecord): string[] => {
  const raw = [
    field.label,
    field.placeholder,
    field.aria_label,
    field.name_attr,
    field.id_attr,
  ]
    .map((item) => normalizeText(item))
    .filter((item) => item.length > 0);
  return [...new Set(raw)];
};

const buildFieldKeys = (field: FormFieldRecord): string[] => {
  return buildFieldAliases(field)
    .map((item) => normalizeFieldKey(item))
    .filter((item) => item.length > 0);
};

const matchesFieldHint = (field: FormFieldRecord, candidate?: string): boolean => {
  if (!candidate) {
    return false;
  }
  const candidateKey = normalizeFieldKey(candidate);
  if (candidateKey.length === 0) {
    return false;
  }
  return buildFieldKeys(field).some(
    (item) => item === candidateKey || item.includes(candidateKey) || candidateKey.includes(item),
  );
};

const extractQuotedTaskValue = (userIntent: string): string | undefined => {
  const match = userIntent.match(/[“"'`](.{1,40}?)[”"'`]/u);
  return match?.[1] ? normalizeText(match[1]) : undefined;
};

const isNameLikeField = (field: FormFieldRecord): boolean => {
  return buildFieldKeys(field).some((item) => /(名称|name|title|product|商品名|项目名)/i.test(item));
};

/*
const extractUserProvidedValue = (
  userIntent: string | undefined,
  field: FormFieldRecord,
): string | undefined => {
  const source = normalizeText(userIntent ?? "");
  if (source.length === 0) {
    return undefined;
  }
  for (const alias of buildFieldAliases(field)) {
    const cleanedAlias = normalizeText(alias).replace(FORM_VALUE_PREFIX_RE, "");
    if (cleanedAlias.length < 2) {
      continue;
    }
    const escaped = escapeRegExp(cleanedAlias);
    const patterns = [
      new RegExp(
        `${escaped}\\s*(?:[:：=]|为|是|填为|填写为|填写|输入|设为|设置为|改为|修改为)\\s*[“"'`]?(.*?)[”"'`]?($|[，。,；;\\n])`,
        "iu",
      ),
      new RegExp(
        `(?:将|把)\\s*${escaped}\\s*(?:设置|设成|改成|改为|设为)?\\s*[“"'`]?(.*?)[”"'`]?($|[，。,；;\\n])`,
        "iu",
      ),
    ];
    for (const pattern of patterns) {
      const value = pattern.exec(source)?.[1];
      const normalized = normalizeText(value ?? "");
      if (normalized.length > 0 && !FORM_INTENT_RE.test(normalized)) {
        return normalized;
      }
    }
  }
  if (isNameLikeField(field)) {
    return extractQuotedTaskValue(source);
  }
  return undefined;
};
*/

const extractUserProvidedValue = (
  userIntent: string | undefined,
  field: FormFieldRecord,
): string | undefined => {
  const source = normalizeText(userIntent ?? "");
  if (source.length === 0) {
    return undefined;
  }
  for (const alias of buildFieldAliases(field)) {
    const cleanedAlias = normalizeText(alias).replace(FORM_VALUE_PREFIX_RE, "");
    if (cleanedAlias.length < 2) {
      continue;
    }
    const escaped = escapeRegExp(cleanedAlias);
    const patterns = [
      new RegExp(
        `${escaped}\\s*(?:[:\\uFF1A=]|\\u4e3a|\\u662f|\\u586b\\u4e3a|\\u586b\\u5199\\u4e3a|\\u586b\\u5199|\\u8f93\\u5165|\\u8bbe\\u4e3a|\\u8bbe\\u7f6e\\u4e3a|\\u6539\\u4e3a|\\u4fee\\u6539\\u4e3a)\\s*[\\u201c\\u201d\"']?(.*?)[\\u201c\\u201d\"']?($|[\\uFF0C\\u3002,\\uFF1B;\\n])`,
        "iu",
      ),
      new RegExp(
        `(?:\\u5c06|\\u628a)\\s*${escaped}\\s*(?:\\u8bbe\\u7f6e|\\u8bbe\\u6210|\\u6539\\u6210|\\u6539\\u4e3a|\\u8bbe\\u4e3a)?\\s*[\\u201c\\u201d\"']?(.*?)[\\u201c\\u201d\"']?($|[\\uFF0C\\u3002,\\uFF1B;\\n])`,
        "iu",
      ),
    ];
    for (const pattern of patterns) {
      const value = pattern.exec(source)?.[1];
      const normalized = normalizeText(value ?? "");
      if (normalized.length > 0 && !FORM_INTENT_RE.test(normalized)) {
        return normalized;
      }
    }
  }
  if (isNameLikeField(field)) {
    return extractQuotedTaskValue(source);
  }
  return undefined;
};

const resolveFormPlanAction = (field: FormFieldRecord): FormPlanAction => {
  if (field.disabled) {
    return "skip";
  }
  if (field.control_type === "combobox" || field.control_type === "select") {
    return "click -> option click";
  }
  if (field.control_type === "checkbox" || field.control_type === "radio") {
    return "click";
  }
  return "input_text";
};

const hasFormIntent = (userIntent?: string): boolean => {
  return FORM_INTENT_RE.test(userIntent ?? "");
};

const compileFormPlanFields = ({
  fields,
  validation,
  userIntent,
}: {
  fields: FormFieldRecord[];
  validation: ValidationReport;
  userIntent?: string;
}): CompiledFormPlanField[] => {
  return fields.map((field, index) => {
    const userValue = extractUserProvidedValue(userIntent, field);
    const validationMatched =
      validation.issues.some(
        (issue) =>
          (field.element_id && issue.element_id === field.element_id) ||
          matchesFieldHint(field, issue.field) ||
          matchesFieldHint(field, issue.label),
      ) || validation.missingFields.some((item) => matchesFieldHint(field, item));

    const currentValue = normalizeText(field.value_preview);
    const expectedAction = resolveFormPlanAction(field);

    let status: FormPlanStatus = "skipped";
    let queueReason: FormPlanQueueReason = "optional_empty";
    let valueSource: FormPlanValueSource = "unresolved";
    let plannedValue: string | undefined;
    let priority = 90;

    if (field.disabled && (userValue || validationMatched || field.required)) {
      status = "blocked";
      queueReason = userValue ? "user_intent" : validationMatched ? "validation_missing" : "required_empty";
      valueSource = userValue ? "user_provided" : currentValue ? "existing_value" : "unresolved";
      plannedValue = userValue;
      priority = userValue ? 5 : validationMatched ? 10 : 20;
    } else if (userValue) {
      status = "pending";
      queueReason = "user_intent";
      valueSource = "user_provided";
      plannedValue = userValue;
      priority = field.required ? 1 : 2;
    } else if (currentValue.length > 0) {
      status = "satisfied";
      queueReason = "already_filled";
      valueSource = "existing_value";
      priority = field.required ? 30 : 60;
    } else if (validationMatched) {
      status = "pending";
      queueReason = "validation_missing";
      valueSource = "default_heal";
      plannedValue = generateDefaultFieldValue(field.label || field.placeholder || field.name_attr || "字段");
      priority = 3;
    } else if (field.required && field.empty) {
      status = "pending";
      queueReason = "required_empty";
      valueSource = "default_heal";
      plannedValue = generateDefaultFieldValue(field.label || field.placeholder || field.name_attr || "字段");
      priority = 4;
    }

    return {
      index: index + 1,
      field_name: field.label,
      control_type: field.control_type,
      required: field.required,
      element_id: field.element_id,
      current_value: currentValue,
      planned_value: plannedValue,
      value_source: valueSource,
      queue_reason: queueReason,
      expected_action: expectedAction,
      status,
      priority,
      empty: field.empty,
      disabled: field.disabled,
      option_preview: field.option_preview,
    };
  });
};

const compactObject = (source: Record<string, string>): Record<string, string> => {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value.length > 0));
};

const getSnapshot = async (maxTextLen: number, locator: Locator): Promise<ElementSnapshot> => {
  return locator.evaluate((el, limit: number) => {
    const normalize = (v: string) => v.trim().replace(/\s+/g, " ").slice(0, limit);
    const element = el as HTMLElement;
    return {
      tag: element.tagName.toLowerCase(),
      text: normalize(element.textContent ?? ""),
      role: normalize(element.getAttribute("role") ?? ""),
      ariaLabel: normalize(element.getAttribute("aria-label") ?? ""),
      placeholder: normalize((element as HTMLInputElement).placeholder ?? ""),
      idAttr: normalize(element.id ?? ""),
      nameAttr: normalize(element.getAttribute("name") ?? ""),
      className: normalize(element.className ?? ""),
      typeAttr: normalize((element as HTMLInputElement).type ?? ""),
    };
  }, maxTextLen);
};

const markAndStoreElement = async ({
  page,
  runId,
  markerAttr,
  markerValue,
  maxTextLen = 120,
}: {
  page: Page;
  runId: string;
  markerAttr: string;
  markerValue: string;
  maxTextLen?: number;
}): Promise<{ element_id?: string; snapshot?: ElementSnapshot }> => {
  const locator = page.locator(`[${markerAttr}="${markerValue}"]`).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) {
    return {};
  }
  const snapshot = await getSnapshot(maxTextLen, locator).catch(() => undefined);
  return {
    element_id: elementStore.set(runId, locator, snapshot),
    snapshot,
  };
};

const collectActiveLayers = async ({
  page,
  maxLayers,
}: {
  page: Page;
  maxLayers: number;
}): Promise<ActiveLayerRecord[]> => {
  const markerPrefix = `mcp-active-layer-${Date.now()}-`;
  return page.evaluate(
    ({
      activeLayerSelector,
      dropdownLayerSelector,
      maxItems,
      markerPrefix: prefix,
    }: {
      activeLayerSelector: string;
      dropdownLayerSelector: string;
      maxItems: number;
      markerPrefix: string;
    }) => {
      const isVisible = (node: Element | null): node is HTMLElement => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const style = window.getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity || "1") === 0
        ) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalizeText = (value: string): string => value.trim().replace(/\s+/g, " ").slice(0, 160);
      const classify = (node: HTMLElement): ActiveLayerKind => {
        if (node.matches(dropdownLayerSelector)) {
          return "dropdown";
        }
        if (node.matches(".ant-drawer, .el-drawer, [class*='drawer']")) {
          return "drawer";
        }
        if (node.matches(".ant-popover, .ant-dropdown, [class*='popover'], [class*='dropdown']")) {
          return "popover";
        }
        if (node.matches("[role='dialog'], .ant-modal, .ant-modal-root, .el-dialog")) {
          return "dialog";
        }
        return "other";
      };

      const rank = (node: HTMLElement, index: number): number => {
        const zIndex = Number.parseInt(window.getComputedStyle(node).zIndex || "0", 10);
        const kindPriority =
          classify(node) === "dropdown"
            ? 5
            : classify(node) === "popover"
              ? 4
              : classify(node) === "dialog"
                ? 3
                : classify(node) === "drawer"
                  ? 2
                  : 1;
        return (Number.isFinite(zIndex) ? zIndex : 0) * 1_000_000 + kindPriority * 1_000 + index;
      };

      const optionTextList = (node: HTMLElement): string[] => {
        return Array.from(
          node.querySelectorAll("[role='option'], .ant-select-item-option-content, .el-select-dropdown__item, option"),
        )
          .filter(isVisible)
          .map((item) => normalizeText(item.textContent ?? ""))
          .filter((text, index, items) => text.length > 0 && items.indexOf(text) === index)
          .slice(0, 8);
      };

      const layers = Array.from(document.querySelectorAll(activeLayerSelector))
        .filter(isVisible)
        .map((node, index) => ({
          node,
          index,
          score: rank(node, index),
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, maxItems)
        .map(({ node }, index) => {
          const domId = `${prefix}${index + 1}`;
          node.setAttribute("data-mcp-active-layer-id", domId);
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          const zIndex = Number.parseInt(style.zIndex || "0", 10);
          const backdrop =
            document.querySelector(".ant-modal-mask, .el-overlay, .v-modal, [class*='mask'], [class*='overlay']") instanceof HTMLElement;
          return {
            dom_id: domId,
            kind: classify(node),
            role: String(node.getAttribute("role") ?? ""),
            className: normalizeText(node.className ?? ""),
            text: normalizeText(node.textContent ?? ""),
            zIndex: Number.isFinite(zIndex) ? zIndex : 0,
            bounds: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            hasBackdrop: backdrop,
            optionTexts: classify(node) === "dropdown" ? optionTextList(node) : [],
          };
        });

      return layers;
    },
    {
      activeLayerSelector: ACTIVE_LAYER_SELECTOR,
      dropdownLayerSelector: DROPDOWN_LAYER_SELECTOR,
      maxItems: maxLayers,
      markerPrefix,
    },
  );
};

const enrichActiveLayers = async ({
  page,
  runId,
  layers,
}: {
  page: Page;
  runId: string;
  layers: ActiveLayerRecord[];
}): Promise<ActiveLayerRecord[]> => {
  const enriched: ActiveLayerRecord[] = [];
  for (const layer of layers) {
    const stored = await markAndStoreElement({
      page,
      runId,
      markerAttr: "data-mcp-active-layer-id",
      markerValue: layer.dom_id,
      maxTextLen: 80,
    });
    enriched.push({
      ...layer,
      element_id: stored.element_id,
    });
  }
  return enriched;
};

const chooseFormScope = (layers: ActiveLayerRecord[]): { markerValue?: string; scopeType: string } => {
  const dialogLike = layers.find((item) => item.kind === "dialog" || item.kind === "drawer");
  if (dialogLike) {
    return {
      markerValue: dialogLike.dom_id,
      scopeType: dialogLike.kind,
    };
  }
  const popoverLike = layers.find((item) => item.kind === "popover");
  if (popoverLike) {
    return {
      markerValue: popoverLike.dom_id,
      scopeType: popoverLike.kind,
    };
  }
  return {
    scopeType: "page",
  };
};

const collectFormFields = async ({
  page,
  scopeMarker,
  maxFields,
  includeOptional,
}: {
  page: Page;
  scopeMarker?: string;
  maxFields: number;
  includeOptional: boolean;
}): Promise<{
  scope_summary: {
    scope_type: string;
    has_form_container: boolean;
    active_dropdown_options: string[];
  };
  fields: FormFieldRecord[];
}> => {
  const markerPrefix = `mcp-form-control-${Date.now()}-`;
  return page.evaluate(
    ({
      scopeMarkerValue,
      fieldContainerSelector,
      formContainerSelector,
      formControlSelector,
      dropdownLayerSelector,
      maxItems,
      includeOptionalFields,
      markerPrefix: prefix,
    }: {
      scopeMarkerValue?: string;
      fieldContainerSelector: string;
      formContainerSelector: string;
      formControlSelector: string;
      dropdownLayerSelector: string;
      maxItems: number;
      includeOptionalFields: boolean;
      markerPrefix: string;
    }) => {
      const isVisible = (node: Element | null): node is HTMLElement => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const style = window.getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity || "1") === 0
        ) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalizeText = (value: string): string => value.trim().replace(/\s+/g, " ").slice(0, 120);
      const hasRequiredClassName = (className: string): boolean =>
        /(required|is-required|ant-form-item-required)/i.test(className);

      const getScopeRoot = (): HTMLElement => {
        if (scopeMarkerValue) {
          const marked = document.querySelector(`[data-mcp-active-layer-id="${scopeMarkerValue}"]`) as HTMLElement | null;
          if (marked) {
            return marked;
          }
        }
        return document.body;
      };

      const resolveInteractiveControl = (origin: HTMLElement): HTMLElement | null => {
        if (origin.matches(formControlSelector)) {
          return origin;
        }
        return origin.querySelector(
          [
            "input:not([type='hidden'])",
            "textarea",
            "select",
            "[role='combobox']",
            "[role='textbox']",
            "[role='spinbutton']",
            "[role='checkbox']",
            "[role='radio']",
            ".ant-select-selector",
            ".ant-input-number-input",
            ".ant-picker-input input",
            ".el-input__inner",
            ".el-textarea__inner",
          ].join(", "),
        ) as HTMLElement | null;
      };

      const getContainer = (control: HTMLElement): HTMLElement | null =>
        (control.closest(fieldContainerSelector) as HTMLElement | null) ??
        (control.closest(formContainerSelector) as HTMLElement | null);

      const getLabel = (control: HTMLElement): string => {
        const container = getContainer(control);
        if (container) {
          const label = container.querySelector(
            "label, .ant-form-item-label label, .el-form-item__label, [data-field-label]",
          ) as HTMLElement | null;
          const text = normalizeText(label?.textContent ?? "");
          if (text) {
            return text;
          }
        }
        const idAttr = control.getAttribute("id") ?? "";
        if (idAttr) {
          const label = document.querySelector(`label[for="${idAttr.replace(/["\\]/g, "\\$&")}"]`) as HTMLElement | null;
          const text = normalizeText(label?.textContent ?? "");
          if (text) {
            return text;
          }
        }
        return normalizeText(
          control.getAttribute("aria-label") ??
            (control as HTMLInputElement).placeholder ??
            control.getAttribute("name") ??
            control.getAttribute("id") ??
            "",
        );
      };

      const isRequired = (control: HTMLElement): boolean => {
        const inputLike = control as HTMLInputElement;
        if (inputLike.required || control.getAttribute("aria-required") === "true") {
          return true;
        }
        if ((control.getAttribute("data-required") ?? "").toLowerCase() === "true") {
          return true;
        }
        if (hasRequiredClassName(String(control.className ?? ""))) {
          return true;
        }
        const container = getContainer(control);
        if (!container) {
          return false;
        }
        if ((container.getAttribute("data-required") ?? "").toLowerCase() === "true") {
          return true;
        }
        if (hasRequiredClassName(String(container.className ?? ""))) {
          return true;
        }
        const label = container.querySelector(
          "label, .ant-form-item-label label, .el-form-item__label, [data-field-label]",
        ) as HTMLElement | null;
        if (!label) {
          return false;
        }
        const labelText = normalizeText(label.textContent ?? "");
        const beforeContent = normalizeText(window.getComputedStyle(label, "::before").content ?? "");
        const afterContent = normalizeText(window.getComputedStyle(label, "::after").content ?? "");
        return /[*＊]/.test(labelText) || /[*＊]/.test(beforeContent) || /[*＊]/.test(afterContent);
      };

      const isDisabled = (control: HTMLElement): boolean => {
        const inputLike = control as HTMLInputElement;
        if (Boolean(inputLike.disabled) || control.getAttribute("aria-disabled") === "true") {
          return true;
        }
        const host = control.closest(
          ".ant-select, .ant-input-number, .ant-picker, .el-select, .el-input, .el-date-editor",
        ) as HTMLElement | null;
        return host?.getAttribute("aria-disabled") === "true";
      };

      const getControlType = (control: HTMLElement): string => {
        const tag = control.tagName.toLowerCase();
        const role = (control.getAttribute("role") ?? "").toLowerCase();
        const className = String(control.className ?? "");
        const typeAttr = ((control as HTMLInputElement).type ?? "").toLowerCase();
        if (typeAttr === "checkbox" || role === "checkbox") {
          return "checkbox";
        }
        if (typeAttr === "radio" || role === "radio") {
          return "radio";
        }
        if (tag === "textarea" || /textarea/i.test(className)) {
          return "textarea";
        }
        if (tag === "select" || role === "listbox") {
          return "select";
        }
        if (/ant-picker|el-date-editor/i.test(className) || ["date", "datetime-local", "month", "time"].includes(typeAttr)) {
          return "date";
        }
        if (/ant-select|el-select|selector|dropdown/i.test(className) || role === "combobox") {
          return "combobox";
        }
        if (/ant-input-number/i.test(className) || role === "spinbutton" || ["number", "range"].includes(typeAttr)) {
          return "number";
        }
        if (tag === "input") {
          return "input";
        }
        return "input";
      };

      const readValue = (control: HTMLElement): { empty: boolean; preview: string; options: string[] } => {
        if (control instanceof HTMLSelectElement) {
          const options = Array.from(control.options)
            .map((item) => normalizeText(item.label ?? item.textContent ?? ""))
            .filter((text) => text.length > 0)
            .slice(0, 8);
          const preview = normalizeText(control.selectedOptions[0]?.label ?? control.value ?? "");
          return {
            empty: preview.length === 0,
            preview,
            options,
          };
        }
        if (control instanceof HTMLInputElement) {
          const type = (control.type ?? "").toLowerCase();
          if (["checkbox", "radio"].includes(type)) {
            return {
              empty: !control.checked,
              preview: control.checked ? "checked" : "",
              options: [],
            };
          }
          const preview = normalizeText(control.value ?? "");
          return {
            empty: preview.length === 0,
            preview,
            options: [],
          };
        }
        if (control instanceof HTMLTextAreaElement) {
          const preview = normalizeText(control.value ?? "");
          return {
            empty: preview.length === 0,
            preview,
            options: [],
          };
        }
        const nestedInput = control.querySelector("input, textarea, select") as
          | HTMLInputElement
          | HTMLTextAreaElement
          | HTMLSelectElement
          | null;
        if (nestedInput instanceof HTMLSelectElement) {
          const options = Array.from(nestedInput.options)
            .map((item) => normalizeText(item.label ?? item.textContent ?? ""))
            .filter((text) => text.length > 0)
            .slice(0, 8);
          const preview = normalizeText(nestedInput.selectedOptions[0]?.label ?? nestedInput.value ?? "");
          return {
            empty: preview.length === 0,
            preview,
            options,
          };
        }
        if (nestedInput) {
          const preview = normalizeText((nestedInput as HTMLInputElement).value ?? "");
          return {
            empty: preview.length === 0,
            preview,
            options: [],
          };
        }
        const text = normalizeText(control.textContent ?? "");
        const empty = text.length === 0 || /^(?:\u8bf7\u9009\u62e9|please select|select|\u8bf7\u8f93\u5165|please enter)$/i.test(text);
        return {
          empty,
          preview: empty ? "" : text,
          options: [],
        };
      };

      const scopeRoot = getScopeRoot();
      const fieldNodes: HTMLElement[] = [];
      const seen = new Set<HTMLElement>();
      const pushControl = (node: HTMLElement | null): void => {
        if (!node || seen.has(node) || !isVisible(node)) {
          return;
        }
        seen.add(node);
        fieldNodes.push(node);
      };

      Array.from(scopeRoot.querySelectorAll(fieldContainerSelector)).forEach((container) => {
        pushControl(resolveInteractiveControl(container as HTMLElement));
      });
      Array.from(scopeRoot.querySelectorAll(formControlSelector)).forEach((control) => {
        pushControl(resolveInteractiveControl(control as HTMLElement));
      });

      const activeDropdown = Array.from(document.querySelectorAll(dropdownLayerSelector))
        .filter(isVisible)
        .map((node, index) => ({
          node: node as HTMLElement,
          index,
          score: (() => {
            const zIndex = Number.parseInt(window.getComputedStyle(node).zIndex || "0", 10);
            return (Number.isFinite(zIndex) ? zIndex : 0) * 1_000_000 + index;
          })(),
        }))
        .sort((left, right) => right.score - left.score || right.index - left.index)[0]?.node;
      const activeDropdownOptions = activeDropdown
        ? Array.from(
            activeDropdown.querySelectorAll("[role='option'], .ant-select-item-option-content, .el-select-dropdown__item, option"),
          )
            .filter(isVisible)
            .map((item) => normalizeText(item.textContent ?? ""))
            .filter((text, index, items) => text.length > 0 && items.indexOf(text) === index)
            .slice(0, 8)
        : [];

      const fields = fieldNodes
        .map((control, index) => {
          const label = getLabel(control);
          const required = isRequired(control);
          if (!includeOptionalFields && !required) {
            return null;
          }
          const domId = `${prefix}${index + 1}`;
          control.setAttribute("data-mcp-form-control-id", domId);
          const valueInfo = readValue(control);
          const type = getControlType(control);
          const optionPreview =
            type === "select"
              ? valueInfo.options
              : type === "combobox" && activeDropdownOptions.length > 0
                ? activeDropdownOptions
                : [];
          return {
            dom_id: domId,
            label,
            required,
            control_type: type,
            empty: valueInfo.empty,
            disabled: isDisabled(control),
            value_preview: valueInfo.preview,
            placeholder: normalizeText((control as HTMLInputElement).placeholder ?? ""),
            aria_label: normalizeText(control.getAttribute("aria-label") ?? ""),
            name_attr: normalizeText(control.getAttribute("name") ?? ""),
            id_attr: normalizeText(control.getAttribute("id") ?? ""),
            option_preview: optionPreview,
          };
        })
        .filter((item): item is FormFieldRecord => Boolean(item))
        .slice(0, maxItems);

      return {
        scope_summary: {
          scope_type: scopeRoot === document.body ? "page" : normalizeText(scopeRoot.getAttribute("role") ?? scopeRoot.className ?? "layer"),
          has_form_container: Boolean(scopeRoot.querySelector(formContainerSelector) || scopeRoot.matches(formContainerSelector)),
          active_dropdown_options: activeDropdownOptions,
        },
        fields,
      };
    },
    {
      scopeMarkerValue: scopeMarker,
      fieldContainerSelector: FIELD_CONTAINER_SELECTOR,
      formContainerSelector: FORM_CONTAINER_SELECTOR,
      formControlSelector: FORM_CONTROL_SELECTOR,
      dropdownLayerSelector: DROPDOWN_LAYER_SELECTOR,
      maxItems: maxFields,
      includeOptionalFields: includeOptional,
      markerPrefix,
    },
  );
};

const collectPageElements = async ({
  runId,
  includeHidden,
  query,
  maxTextLen,
}: {
  runId: string;
  includeHidden: boolean;
  query?: string;
  maxTextLen: number;
}): Promise<Array<{ element_id: string; snapshot: ElementSnapshot }>> => {
  const page = await browserManager.getPage(runId);
  const source = page.locator(INTERACTIVE_SELECTOR);
  const total = await source.count();
  const keyword = (query ?? "").toLowerCase().trim();
  const elements: Array<{ element_id: string; snapshot: ElementSnapshot }> = [];

  for (let i = 0; i < total; i += 1) {
    const item = source.nth(i);
    const visible = includeHidden ? true : await item.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    const snapshot = await getSnapshot(maxTextLen, item).catch(() => undefined);
    if (!snapshot) {
      continue;
    }
    const searchable =
      `${snapshot.text} ${snapshot.ariaLabel} ${snapshot.placeholder} ${snapshot.idAttr} ${snapshot.nameAttr}`.toLowerCase();
    if (keyword && !searchable.includes(keyword)) {
      continue;
    }
    const elementId = elementStore.set(runId, item, snapshot);
    elements.push({ element_id: elementId, snapshot });
  }
  return elements;
};

export const registerInsightTools = (server: FastMCP): void => {
  const inspectSummaryDefinition = {
    description: "返回当前页面结构与可交互元素摘要",
    parameters: z.object({
      run_id: z.string().min(1),
      max_elements: z.number().int().min(1).max(200).default(30),
      offset: z.number().int().min(0).default(0),
      include_hidden: z.boolean().default(false),
      query: z.string().optional(),
      compact: z.boolean().default(true),
      max_text_len: z.number().int().min(20).max(300).default(80),
    }),
    execute: async ({
      run_id,
      max_elements,
      offset,
      include_hidden,
      query,
      compact,
      max_text_len,
    }: {
      run_id: string;
      max_elements: number;
      offset: number;
      include_hidden: boolean;
      query?: string;
      compact: boolean;
      max_text_len: number;
    }) => {
      const page = await browserManager.getPage(run_id);
      const all = await collectPageElements({
        runId: run_id,
        includeHidden: include_hidden,
        query,
        maxTextLen: max_text_len,
      });
      const paged = all.slice(offset, offset + max_elements);
      const elements = paged.map((item, index) => {
        const base = {
          element_id: item.element_id,
          tag: item.snapshot.tag,
          text: item.snapshot.text,
          role: item.snapshot.role,
          idAttr: item.snapshot.idAttr,
          nameAttr: item.snapshot.nameAttr,
          ariaLabel: item.snapshot.ariaLabel,
          placeholder: item.snapshot.placeholder,
          typeAttr: item.snapshot.typeAttr,
        };
        const raw = compact ? base : { ...base, className: item.snapshot.className };
        const content = compact ? compactObject(raw) : raw;
        return {
          index: offset + index + 1,
          ...content,
        };
      });
      const tagSummary = elements.reduce<Record<string, number>>((acc, item) => {
        const key = String((item as Record<string, unknown>).tag ?? "unknown");
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
      const result = {
        run_id,
        title: await page.title(),
        url: page.url(),
        total_matched: all.length,
        returned_count: elements.length,
        offset,
        has_more: offset + max_elements < all.length,
        tag_summary: tagSummary,
        elements,
      };
      return JSON.stringify(result);
    },
  };

  server.addTool({
    name: "inspect_summary",
    ...inspectSummaryDefinition,
  });

  const inspectDetailDefinition = {
    description: "Return detailed info for specified element_id",
    parameters: z.object({
      run_id: z.string().min(1),
      element_ids: z.array(z.string().min(1)).min(1).max(200),
      compact: z.boolean().default(false),
    }),
    execute: async ({
      run_id,
      element_ids,
      compact,
    }: {
      run_id: string;
      element_ids: string[];
      compact: boolean;
    }) => {
      const details = element_ids.map((elementId) => {
        const snapshot = elementStore.getSnapshot(run_id, elementId);
        if (!snapshot) {
          return {
            element_id: elementId,
            exists: false,
          };
        }
        return {
          element_id: elementId,
          exists: true,
          snapshot: compact ? compactObject(snapshot) : snapshot,
        };
      });
      return JSON.stringify({
        run_id,
        count: details.length,
        details,
      });
    },
  };

  server.addTool({
    name: "inspect_detail",
    ...inspectDetailDefinition,
  });

  const inspectActiveLayerDefinition = {
    description: "Inspect the current top-most interactive layer such as dialog, drawer, dropdown, or popover",
    parameters: z.object({
      run_id: z.string().min(1),
      max_layers: z.number().int().min(1).max(10).default(3),
      compact: z.boolean().default(true),
    }),
    execute: async ({
      run_id,
      max_layers,
      compact,
    }: {
      run_id: string;
      max_layers: number;
      compact: boolean;
    }) => {
      const page = await browserManager.getPage(run_id);
      const layers = await enrichActiveLayers({
        page,
        runId: run_id,
        layers: await collectActiveLayers({
          page,
          maxLayers: max_layers,
        }),
      });
      const top = layers[0];
      return JSON.stringify({
        run_id,
        url: page.url(),
        has_active_layer: layers.length > 0,
        top_layer:
          top && compact
            ? {
                element_id: top.element_id,
                kind: top.kind,
                role: top.role,
                has_backdrop: top.hasBackdrop,
                option_texts: top.optionTexts,
              }
            : top,
        layers:
          compact
            ? layers.map((item) => ({
                element_id: item.element_id,
                kind: item.kind,
                role: item.role,
                has_backdrop: item.hasBackdrop,
                option_texts: item.optionTexts,
              }))
            : layers,
      });
    },
  };

  server.addTool({
    name: "inspect_active_layer",
    ...inspectActiveLayerDefinition,
  });

  const inspectFormDefinition = {
    description: "Inspect the current active form scope and return field summaries with control types and required hints",
    parameters: z.object({
      run_id: z.string().min(1),
      max_fields: z.number().int().min(1).max(80).default(30),
      include_optional: z.boolean().default(true),
      compact: z.boolean().default(true),
    }),
    execute: async ({
      run_id,
      max_fields,
      include_optional,
      compact,
    }: {
      run_id: string;
      max_fields: number;
      include_optional: boolean;
      compact: boolean;
    }) => {
      const page = await browserManager.getPage(run_id);
      const layers = await enrichActiveLayers({
        page,
        runId: run_id,
        layers: await collectActiveLayers({
          page,
          maxLayers: 5,
        }),
      });
      const formScope = chooseFormScope(layers);
      const raw = await collectFormFields({
        page,
        scopeMarker: formScope.markerValue,
        maxFields: max_fields,
        includeOptional: include_optional,
      });

      const fields: FormFieldRecord[] = [];
      for (const field of raw.fields) {
        const stored = await markAndStoreElement({
          page,
          runId: run_id,
          markerAttr: "data-mcp-form-control-id",
          markerValue: field.dom_id,
          maxTextLen: 100,
        });
        fields.push({
          ...field,
          element_id: stored.element_id,
        });
      }

      const topLayer = layers[0];
      return JSON.stringify({
        run_id,
        url: page.url(),
        scope: {
          source: formScope.scopeType,
          top_active_layer:
            topLayer && compact
              ? {
                  element_id: topLayer.element_id,
                  kind: topLayer.kind,
                  role: topLayer.role,
                  option_texts: topLayer.optionTexts,
                }
              : topLayer,
          ...raw.scope_summary,
        },
        field_count: fields.length,
        fields:
          compact
            ? fields.map((field, index) => ({
                index: index + 1,
                element_id: field.element_id,
                label: field.label,
                required: field.required,
                control_type: field.control_type,
                empty: field.empty,
                disabled: field.disabled,
                value_preview: field.value_preview,
                option_preview: field.option_preview,
              }))
            : fields,
      });
    },
  };

  server.addTool({
    name: "inspect_form",
    ...inspectFormDefinition,
  });

  const compileFormPlanDefinition = {
    description:
      "Compile a form-mode execution gateway plan from active layer, form fields, validation hints, and optional user intent",
    parameters: z.object({
      run_id: z.string().min(1),
      user_intent: z.string().optional(),
      max_fields: z.number().int().min(1).max(80).default(30),
      include_optional: z.boolean().default(true),
      max_issues: z.number().int().min(1).max(20).default(8),
      compact: z.boolean().default(true),
    }),
    execute: async ({
      run_id,
      user_intent,
      max_fields,
      include_optional,
      max_issues,
      compact,
    }: {
      run_id: string;
      user_intent?: string;
      max_fields: number;
      include_optional: boolean;
      max_issues: number;
      compact: boolean;
    }) => {
      const page = await browserManager.getPage(run_id);
      const layers = await enrichActiveLayers({
        page,
        runId: run_id,
        layers: await collectActiveLayers({
          page,
          maxLayers: 5,
        }),
      });
      const formScope = chooseFormScope(layers);
      const raw = await collectFormFields({
        page,
        scopeMarker: formScope.markerValue,
        maxFields: max_fields,
        includeOptional: include_optional,
      });

      const fields: FormFieldRecord[] = [];
      for (const field of raw.fields) {
        const stored = await markAndStoreElement({
          page,
          runId: run_id,
          markerAttr: "data-mcp-form-control-id",
          markerValue: field.dom_id,
          maxTextLen: 100,
        });
        fields.push({
          ...field,
          element_id: stored.element_id,
        });
      }

      const validation = await inspectValidation({
        runId: run_id,
        page,
        maxIssues: max_issues,
      });
      const planFields = compileFormPlanFields({
        fields,
        validation,
        userIntent: user_intent,
      });
      const pendingQueue = [...planFields]
        .filter((item) => item.status === "pending" || item.status === "blocked")
        .sort((left, right) => left.priority - right.priority || left.index - right.index);
      const triggerReasons = [
        hasFormIntent(user_intent) ? "user_intent_keyword" : undefined,
        layers.some((item) => item.kind === "dialog" || item.kind === "drawer")
          ? "active_layer_dialog_or_drawer"
          : undefined,
        raw.scope_summary.has_form_container ? "form_container_present" : undefined,
        fields.length >= 2 ? "multiple_form_controls" : undefined,
        validation.missingFields.length > 0 ? "validation_missing_fields" : undefined,
      ].filter((item): item is string => Boolean(item));
      const topLayer = layers[0];
      const formDetected = triggerReasons.length > 0;

      return JSON.stringify({
        run_id,
        url: page.url(),
        form_mode: {
          detected: formDetected,
          trigger_reasons: triggerReasons,
          user_intent_matched: hasFormIntent(user_intent),
        },
        scope: {
          source: formScope.scopeType,
          top_active_layer:
            topLayer && compact
              ? {
                  element_id: topLayer.element_id,
                  kind: topLayer.kind,
                  role: topLayer.role,
                  option_texts: topLayer.optionTexts,
                }
              : topLayer,
          ...raw.scope_summary,
        },
        summary: {
          field_count: planFields.length,
          required_field_count: planFields.filter((item) => item.required).length,
          pending_field_count: pendingQueue.filter((item) => item.status === "pending").length,
          blocked_field_count: pendingQueue.filter((item) => item.status === "blocked").length,
          missing_required_fields: validation.missingFields,
        },
        pending_queue:
          compact
            ? pendingQueue.map((item) => ({
                priority: item.priority,
                field_name: item.field_name,
                control_type: item.control_type,
                required: item.required,
                element_id: item.element_id,
                current_value: item.current_value,
                planned_value: item.planned_value,
                value_source: item.value_source,
                queue_reason: item.queue_reason,
                expected_action: item.expected_action,
                status: item.status,
              }))
            : pendingQueue,
        fields:
          compact
            ? planFields.map((item) => ({
                index: item.index,
                field_name: item.field_name,
                control_type: item.control_type,
                required: item.required,
                element_id: item.element_id,
                current_value: item.current_value,
                planned_value: item.planned_value,
                value_source: item.value_source,
                queue_reason: item.queue_reason,
                expected_action: item.expected_action,
                status: item.status,
                priority: item.priority,
                option_preview: item.option_preview,
              }))
            : planFields,
      });
    },
  };

  server.addTool({
    name: "compile_form_plan",
    ...compileFormPlanDefinition,
  });

  const inspectValidationDefinition = {
    description: "Inspect current page validation errors and missing required fields",
    parameters: z.object({
      run_id: z.string().min(1),
      max_issues: z.number().int().min(1).max(20).default(8),
    }),
    execute: async ({ run_id, max_issues }: { run_id: string; max_issues: number }) => {
      const page = await browserManager.getPage(run_id);
      const report = await inspectValidation({
        runId: run_id,
        page,
        maxIssues: max_issues,
      });
      return JSON.stringify({
        run_id,
        has_errors: report.failed,
        summary: report.summary,
        missing_fields: report.missingFields,
        issues: report.issues,
      });
    },
  };

  server.addTool({
    name: "inspect_validation",
    ...inspectValidationDefinition,
  });

  const elementMemoryDefinition = {
    description: "查看最近缓存的 element_id 与其摘要信息",
    parameters: z.object({
      run_id: z.string().min(1),
      limit: z.number().int().min(1).max(200).default(30),
    }),
    execute: async ({ run_id, limit }: { run_id: string; limit: number }) => {
      const elements = elementStore.list(run_id, limit);
      return JSON.stringify({
        run_id,
        count: elements.length,
        elements,
      });
    },
  };

  server.addTool({
    name: "list_elements",
    ...elementMemoryDefinition,
  });

  const runContextDefinition = {
    description: "返回某个 run_id 的步骤上下文",
    parameters: z.object({
      run_id: z.string().min(1),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    execute: async ({ run_id, limit }: { run_id: string; limit: number }) => {
      const steps = stepRecorder.get(run_id).slice(0, limit);
      return JSON.stringify({
        run_id,
        step_count: steps.length,
        next_step: stepRecorder.getNextStep(run_id),
        steps,
      });
    },
  };

  server.addTool({
    name: "get_run_context",
    ...runContextDefinition,
  });
};
