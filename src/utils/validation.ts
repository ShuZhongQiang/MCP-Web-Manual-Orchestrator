import type { Locator, Page } from "playwright";
import { elementStore } from "../core/elementStore.js";
import type { ElementSnapshot } from "../types.js";

const VALIDATION_HINT_RE = new RegExp(
  [
    "\\u5fc5\\u586b", // 必填
    "\\u5fc5\\u586b\\u9879", // 必填项
    "\\u4e0d\\u80fd\\u4e3a\\u7a7a", // 不能为空
    "\\u8bf7\\u586b\\u5199", // 请填写
    "\\u8bf7\\u8f93\\u5165", // 请输入
    "\\u8bf7\\u9009\\u62e9", // 请选择
    "\\u6821\\u9a8c\\u5931\\u8d25", // 校验失败
    "\\u9a8c\\u8bc1\\u5931\\u8d25", // 验证失败
    "required",
    "is required",
    "cannot be empty",
    "must be filled",
  ].join("|"),
  "i",
);

const CONTROL_SELECTOR =
  "input, select, textarea, [role='combobox'], [role='textbox'], [contenteditable='true'], .ant-select-selector, .el-select, .el-input__inner";

type RawValidationIssue = {
  message: string;
  source: string;
  label?: string;
  fieldHint?: string;
  control?: {
    idAttr?: string;
    nameAttr?: string;
    ariaLabel?: string;
    placeholder?: string;
    tag?: string;
    typeAttr?: string;
  };
};

export type ValidationIssue = {
  message: string;
  source: string;
  field?: string;
  label?: string;
  element_id?: string;
};

export type ValidationReport = {
  failed: boolean;
  summary: string;
  missingFields: string[];
  issues: ValidationIssue[];
};

const REQUEST_FIELD_RE = new RegExp(
  String.raw`\u8bf7(?:\u586b\u5199|\u8f93\u5165|\u9009\u62e9)\s*(.{1,20}?)(?:$|[\uFF0C\u3002,\.\!\?\uFF01\uFF1A:])`,
  "i",
);
const REQUEST_FIELD_FALLBACK_RE = new RegExp(
  String.raw`\u8bf7(?:\u586b\u5199|\u8f93\u5165|\u9009\u62e9)\s*(.{1,20})`,
  "i",
);
const REQUIRED_FIELD_RE = new RegExp(
  String.raw`(.{1,20}?)(?:\u4e0d\u80fd\u4e3a\u7a7a|\u4e3a\u5fc5\u586b\u9879|\u5fc5\u586b)` ,
  "i",
);
const EN_REQUIRED_FIELD_RE = /([A-Za-z][A-Za-z0-9 _-]{1,40})\s+(?:is required|required|cannot be empty)/i;

const normalize = (value: string): string => value.trim().replace(/\s+/g, " ");

const escapeAttributeValue = (value: string): string => value.replace(/["\\]/g, "\\$&");

const readSnapshot = async (locator: Locator): Promise<ElementSnapshot | undefined> => {
  return locator
    .evaluate((el) => {
      const element = el as HTMLElement;
      return {
        tag: element.tagName.toLowerCase(),
        text: (element.textContent ?? "").trim().slice(0, 120),
        role: element.getAttribute("role") ?? "",
        ariaLabel: element.getAttribute("aria-label") ?? "",
        placeholder: (element as HTMLInputElement).placeholder ?? "",
        idAttr: element.id ?? "",
        nameAttr: element.getAttribute("name") ?? "",
        className: element.className ?? "",
        typeAttr: (element as HTMLInputElement).type ?? "",
      };
    })
    .catch(() => undefined);
};

const pickVisibleLocator = async (locator: Locator): Promise<Locator | undefined> => {
  const total = await locator.count().catch(() => 0);
  if (total === 0) {
    return undefined;
  }
  const upper = Math.min(total, 4);
  for (let i = 0; i < upper; i += 1) {
    const candidate = locator.nth(i);
    const visible = await candidate.isVisible().catch(() => false);
    if (visible) {
      return candidate;
    }
  }
  return locator.first();
};

const normalizeFieldName = (value: string): string | undefined => {
  let field = normalize(value)
    .replace(/[“”"'`]/g, "")
    .replace(new RegExp(String.raw`(?:\u5b57\u6bb5|\u9879|\u4fe1\u606f)$`, "i"), "")
    .replace(new RegExp(String.raw`^(?:\u8bf7|\u8bf7\u9009\u62e9|\u8bf7\u586b\u5199|\u8bf7\u8f93\u5165)\s*`, "i"), "")
    .replace(/[\uFF0C\u3002,.!?\uFF01\uFF1A:].*$/u, "")
    .trim();
  if (field.length === 0 || field.length > 30) {
    return undefined;
  }
  if (VALIDATION_HINT_RE.test(field)) {
    return undefined;
  }
  return field;
};

const extractFieldFromMessage = (message: string): string | undefined => {
  const normalized = normalize(message);
  const patterns = [REQUEST_FIELD_RE, REQUEST_FIELD_FALLBACK_RE, REQUIRED_FIELD_RE, EN_REQUIRED_FIELD_RE];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1];
    if (!candidate) {
      continue;
    }
    const field = normalizeFieldName(candidate);
    if (field) {
      return field;
    }
  }
  return undefined;
};

const collectRawValidationIssues = async (page: Page, maxIssues: number): Promise<RawValidationIssue[]> => {
  return page.evaluate(
    ({ maxItems, validationPattern, controlSelector }) => {
      const validationRe = new RegExp(validationPattern, "i");
      const selectors = [
        ".ant-form-item-explain-error",
        ".ant-form-item-has-error .ant-form-item-explain",
        ".ant-message-error",
        ".ant-notification-notice-message",
        ".el-form-item__error",
        ".el-message--error",
        ".alert-danger",
        ".invalid-feedback",
        "[aria-invalid='true']",
        "input:invalid",
        "select:invalid",
        "textarea:invalid",
      ];

      const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, 200);
      const isVisible = (el: Element): boolean => {
        const style = window.getComputedStyle(el as HTMLElement);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
          return false;
        }
        return (el as HTMLElement).offsetParent !== null || style.position === "fixed";
      };

      const parseFieldHint = (message: string): string | undefined => {
        const patterns = [
          /\u8bf7(?:\u586b\u5199|\u8f93\u5165|\u9009\u62e9)\s*(.{1,20}?)(?:$|[\uFF0C\u3002,\.\!\?\uFF01\uFF1A:])/i,
          /\u8bf7(?:\u586b\u5199|\u8f93\u5165|\u9009\u62e9)\s*(.{1,20})/i,
          /(.{1,20}?)(?:\u4e0d\u80fd\u4e3a\u7a7a|\u4e3a\u5fc5\u586b\u9879|\u5fc5\u586b)/i,
          /([A-Za-z][A-Za-z0-9 _-]{1,40})\s+(?:is required|required|cannot be empty)/i,
        ];
        for (const pattern of patterns) {
          const matched = message.match(pattern);
          const value = matched?.[1]?.trim();
          if (value) {
            return value.slice(0, 30);
          }
        }
        return undefined;
      };

      const isDisabledControl = (control: HTMLElement): boolean => {
        const inputLike = control as HTMLInputElement;
        return Boolean(inputLike.disabled) || control.getAttribute("aria-disabled") === "true";
      };

      const hasRequiredClassName = (className: string): boolean => {
        return /(required|is-required|ant-form-item-required)/i.test(className);
      };

      const isRequiredControl = (control: HTMLElement): boolean => {
        const inputLike = control as HTMLInputElement;
        if (inputLike.required) {
          return true;
        }
        if (control.getAttribute("aria-required") === "true") {
          return true;
        }
        if ((control.getAttribute("data-required") ?? "").toLowerCase() === "true") {
          return true;
        }
        if (hasRequiredClassName(String(control.className ?? ""))) {
          return true;
        }

        const container = control.closest(
          ".ant-form-item, .el-form-item, .form-group, [class*='form-item'], [class*='field']",
        ) as HTMLElement | null;
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
        const labelText = normalizeText(label?.textContent ?? "");
        if (labelText.length > 0 && (/[*＊]/.test(labelText) || /\u5fc5\u586b/.test(labelText))) {
          return true;
        }
        if (label && hasRequiredClassName(String(label.className ?? ""))) {
          return true;
        }
        return false;
      };

      const isControlEmpty = (control: HTMLElement): boolean => {
        const tag = control.tagName.toLowerCase();
        if (tag === "input") {
          const input = control as HTMLInputElement;
          const type = (input.type ?? "").toLowerCase();
          if (type === "hidden") {
            return false;
          }
          if (["button", "submit", "reset"].includes(type)) {
            return false;
          }
          if (["checkbox", "radio"].includes(type)) {
            return !input.checked;
          }
          if (type === "file") {
            return (input.files?.length ?? 0) === 0;
          }
          return normalizeText(input.value ?? "").length === 0;
        }
        if (tag === "textarea") {
          const textarea = control as HTMLTextAreaElement;
          return normalizeText(textarea.value ?? "").length === 0;
        }
        if (tag === "select") {
          const select = control as HTMLSelectElement;
          if (select.multiple) {
            return select.selectedOptions.length === 0;
          }
          return normalizeText(select.value ?? "").length === 0;
        }
        if (control.getAttribute("contenteditable") === "true") {
          return normalizeText(control.textContent ?? "").length === 0;
        }
        const className = String(control.className ?? "");
        if (/(ant-select|el-select|selector|dropdown)/i.test(className) || control.getAttribute("role") === "combobox") {
          const text = normalizeText(control.textContent ?? "");
          return text.length === 0 || /^(?:\u8bf7\u9009\u62e9|please select|select)$/i.test(text);
        }
        const ariaValueText = normalizeText(control.getAttribute("aria-valuetext") ?? "");
        if (ariaValueText.length > 0) {
          return false;
        }
        return normalizeText(control.textContent ?? "").length === 0;
      };

      const getControlInfo = (origin: Element): RawValidationIssue["control"] | undefined => {
        const current = origin as HTMLElement;
        let control: HTMLElement | null = null;
        if (current.matches(controlSelector)) {
          control = current;
        }
        if (!control && current.getAttribute("aria-invalid") === "true") {
          control = current;
        }
        if (!control) {
          const container = current.closest(
            ".ant-form-item, .el-form-item, .form-group, [class*='form-item'], [class*='field']",
          ) as HTMLElement | null;
          if (container) {
            control = container.querySelector(controlSelector) as HTMLElement | null;
          }
        }
        if (!control) {
          return undefined;
        }
        return {
          idAttr: normalizeText(control.getAttribute("id") ?? ""),
          nameAttr: normalizeText(control.getAttribute("name") ?? ""),
          ariaLabel: normalizeText(control.getAttribute("aria-label") ?? ""),
          placeholder: normalizeText((control as HTMLInputElement).placeholder ?? ""),
          tag: normalizeText(control.tagName.toLowerCase()),
          typeAttr: normalizeText((control as HTMLInputElement).type ?? ""),
        };
      };

      const getLabel = (origin: Element): string | undefined => {
        const container = origin.closest(
          ".ant-form-item, .el-form-item, .form-group, [class*='form-item'], [class*='field']",
        ) as HTMLElement | null;
        if (!container) {
          const html = origin as HTMLElement;
          const idAttr = html.id?.trim();
          if (!idAttr) {
            return undefined;
          }
          const label = document.querySelector(`label[for="${idAttr.replace(/["\\]/g, "\\$&")}"]`) as HTMLElement | null;
          const text = normalizeText(label?.textContent ?? "");
          return text || undefined;
        }
        const label = container.querySelector(
          "label, .ant-form-item-label label, .el-form-item__label, [data-field-label]",
        ) as HTMLElement | null;
        const text = normalizeText(label?.textContent ?? "");
        return text || undefined;
      };

      const unique = new Set<string>();
      const items: RawValidationIssue[] = [];
      const addIssue = (issue: RawValidationIssue): void => {
        if (items.length >= maxItems) {
          return;
        }
        const message = normalizeText(issue.message);
        if (!message) {
          return;
        }
        const key = `${message}|${issue.label ?? ""}|${issue.control?.idAttr ?? ""}|${issue.control?.nameAttr ?? ""}`;
        if (unique.has(key)) {
          return;
        }
        unique.add(key);
        items.push({
          ...issue,
          message,
        });
      };

      for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          if (items.length >= maxItems) {
            break;
          }
          if (!isVisible(node)) {
            continue;
          }
          const textFromNode = normalizeText((node.textContent ?? "").slice(0, 200));
          const message = textFromNode || (node.getAttribute("aria-label") ?? "").trim() || "Validation failed";
          if (!validationRe.test(message) && selector !== "[aria-invalid='true']") {
            continue;
          }
          addIssue({
            message,
            source: selector,
            label: getLabel(node),
            fieldHint: parseFieldHint(message),
            control: getControlInfo(node),
          });
        }
      }

      if (items.length < maxItems) {
        const controls = Array.from(document.querySelectorAll(controlSelector));
        for (const node of controls) {
          if (items.length >= maxItems) {
            break;
          }
          if (!(node instanceof HTMLElement)) {
            continue;
          }
          if (!isVisible(node) || isDisabledControl(node)) {
            continue;
          }
          const inputNode = node as HTMLInputElement;
          if ((inputNode.type ?? "").toLowerCase() === "hidden") {
            continue;
          }
          if (!isRequiredControl(node) || !isControlEmpty(node)) {
            continue;
          }
          const label = getLabel(node);
          const fieldHint = normalizeText(
            label ??
              node.getAttribute("aria-label") ??
              node.getAttribute("placeholder") ??
              node.getAttribute("name") ??
              node.getAttribute("id") ??
              "",
          );
          const message = fieldHint.length > 0 ? `${fieldHint} 为必填项` : "存在未填写必填项";
          addIssue({
            message,
            source: "required-empty",
            label,
            fieldHint: fieldHint || undefined,
            control: getControlInfo(node),
          });
        }
      }

      if (items.length === 0) {
        const lines = (document.body?.innerText ?? "")
          .split(/\r?\n/g)
          .map((line) => normalizeText(line))
          .filter((line) => line.length > 0 && validationRe.test(line))
          .slice(0, maxItems);
        for (const line of lines) {
          addIssue({
            message: line,
            source: "body-text",
            fieldHint: parseFieldHint(line),
          });
        }
      }

      return items;
    },
    {
      maxItems: maxIssues,
      validationPattern: VALIDATION_HINT_RE.source,
      controlSelector: CONTROL_SELECTOR,
    },
  );
};

export const resolveIssueLocator = async (
  page: Page,
  issue: RawValidationIssue,
  fallbackField?: string,
): Promise<Locator | undefined> => {
  const strategies: Locator[] = [];
  const control = issue.control;
  if (control?.idAttr) {
    strategies.push(page.locator(`[id="${escapeAttributeValue(control.idAttr)}"]`));
  }
  if (control?.nameAttr) {
    strategies.push(page.locator(`[name="${escapeAttributeValue(control.nameAttr)}"]`));
  }
  if (control?.placeholder) {
    strategies.push(page.getByPlaceholder(control.placeholder, { exact: false }));
  }
  if (issue.label) {
    strategies.push(page.getByLabel(issue.label, { exact: false }));
  }
  if (control?.ariaLabel) {
    strategies.push(page.getByLabel(control.ariaLabel, { exact: false }));
    strategies.push(page.locator(`[aria-label="${escapeAttributeValue(control.ariaLabel)}"]`));
  }
  if (fallbackField) {
    strategies.push(page.getByLabel(fallbackField, { exact: false }));
    strategies.push(page.getByPlaceholder(fallbackField, { exact: false }));
    strategies.push(page.getByText(fallbackField, { exact: false }));
  }
  for (const strategy of strategies) {
    const hit = await pickVisibleLocator(strategy);
    if (hit) {
      return hit;
    }
  }
  return undefined;
};

export const buildValidationErrorMessage = (report: ValidationReport): string => {
  const compactIssues = report.issues.slice(0, 3).map((item) => ({
    field: item.field,
    message: item.message,
    element_id: item.element_id,
  }));
  return `VALIDATION_ERROR ${JSON.stringify({
    summary: report.summary,
    missing_fields: report.missingFields,
    issues: compactIssues,
  })}`;
};

export const inspectValidation = async ({
  runId,
  page,
  maxIssues = 8,
}: {
  runId: string;
  page: Page;
  maxIssues?: number;
}): Promise<ValidationReport> => {
  const raw = await collectRawValidationIssues(page, maxIssues);
  const issues: ValidationIssue[] = [];
  const missingFields = new Set<string>();

  for (const issue of raw) {
    const message = normalize(issue.message);
    const field =
      normalizeFieldName(issue.fieldHint ?? "") ??
      normalizeFieldName(issue.label ?? "") ??
      extractFieldFromMessage(message) ??
      undefined;
    if (field) {
      missingFields.add(field);
    }

    let elementId: string | undefined;
    const locator = await resolveIssueLocator(page, issue, field);
    if (locator) {
      const snapshot = await readSnapshot(locator);
      elementId = elementStore.set(runId, locator, snapshot);
    }

    issues.push({
      message,
      source: issue.source,
      field,
      label: issue.label,
      element_id: elementId,
    });
  }

  const missingFieldList = [...missingFields];
  const summary =
    missingFieldList.length > 0
      ? `Missing required fields: ${missingFieldList.join(", ")}`
      : issues[0]?.message ?? "Validation failed";

  return {
    failed: issues.length > 0,
    summary,
    missingFields: missingFieldList,
    issues,
  };
};
