import path from "node:path";
import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { Locator, Page } from "playwright";
import { browserManager } from "../core/browser.js";
import { SCREENSHOT_RENDER_WAIT_MS } from "../config.js";
import { elementStore } from "../core/elementStore.js";
import { preActionCaptureStore } from "../core/preActionCaptureStore.js";
import { selfHealStore } from "../core/selfHealStore.js";
import { stepRecorder } from "../core/stepRecorder.js";
import type { ElementSnapshot } from "../types.js";
import { getRunDir } from "../utils/file.js";
import { clearHighlight, renderHighlight } from "../utils/highlight.js";
import { buildValidationErrorMessage, inspectValidation, resolveIssueLocator, type ValidationReport } from "../utils/validation.js";

const CLICK_NAVIGATION_WAIT_MS = 2500;
const CLICK_URL_CHANGE_DETECT_MS = 400;
const CLICK_COMBOBOX_EXPAND_WAIT_MS = 800;
const SELF_HEAL_RETRY_WAIT_MS = 300;
const MAX_SELF_HEAL_ROUNDS = 2;
const SUBMIT_ACTION_RE =
  /(?:\u63d0\u4ea4|\u4fdd\u5b58|\u786e\u8ba4|\u53d1\u5e03|\u521b\u5efa|\u767b\u5f55|\u6ce8\u518c|submit|save|confirm|sign\s?in|log\s?in)/i;
const COMBOBOX_CLASS_RE = /(ant-select|el-select|select-selector|dropdown|combobox)/i;
const OPTION_CLASS_RE = /(ant-select-item-option|el-select-dropdown__item|option)/i;

const currentLocalDate = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const generateDefaultValue = (field: string): string => {
  const normalized = field.toLowerCase();
  if (/\u624b\u673a|phone|mobile/.test(normalized)) {
    return "13800138000";
  }
  if (/\u90ae\u7bb1|email|mail/.test(normalized)) {
    return "test@example.com";
  }
  if (/\u90ae\u7f16|zip|postal/.test(normalized)) {
    return "100000";
  }
  if (/\u65e5\u671f|date|time/.test(normalized)) {
    return currentLocalDate();
  }
  if (/\u4ef7\u683c|price|amount|\u5355\u4ef7|fee|cost/.test(normalized)) {
    return "9.9";
  }
  if (/\u5e93\u5b58|stock|quantity|number|count|qty|inventory/.test(normalized)) {
    return "100";
  }
  if (/\u5206\u7c7b|category|type|kind|group/.test(normalized)) {
    return "\u5496\u5561";
  }
  if (/\u540d\u79f0|name|title|product/.test(normalized)) {
    return "\u6d4b\u8bd5\u9879\u76ee";
  }
  if (/\u63cf\u8ff0|description|desc|remark|note|summary/.test(normalized)) {
    return "\u6d4b\u8bd5\u63cf\u8ff0";
  }
  return "\u6d4b\u8bd5\u503c";
};

const isLikelySubmitClick = (desc: string, snapshot?: ElementSnapshot): boolean => {
  if (SUBMIT_ACTION_RE.test(desc)) {
    return true;
  }
  if (!snapshot) {
    return false;
  }
  if (snapshot.tag === "button" && snapshot.typeAttr.toLowerCase() === "submit") {
    return true;
  }
  const snapshotHint = `${snapshot.text} ${snapshot.ariaLabel} ${snapshot.nameAttr} ${snapshot.idAttr}`;
  return SUBMIT_ACTION_RE.test(snapshotHint);
};

const isCombobox = (snapshot?: ElementSnapshot): boolean => {
  if (!snapshot) {
    return false;
  }
  if (snapshot.role.toLowerCase() === "combobox") {
    return true;
  }
  if (COMBOBOX_CLASS_RE.test(snapshot.className)) {
    return true;
  }
  return false;
};

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

const escapeAttributeValue = (value: string): string => value.replace(/["\\]/g, "\\$&");

const buildSelfHealKey = (desc: string, elementId: string, snapshot?: ElementSnapshot): string => {
  const source = [
    desc,
    snapshot?.tag ?? "",
    snapshot?.typeAttr ?? "",
    snapshot?.idAttr ?? "",
    snapshot?.nameAttr ?? "",
    snapshot?.text ?? "",
    snapshot?.ariaLabel ?? "",
  ]
    .map(normalize)
    .filter((item) => item.length > 0)
    .join("|");
  return source || `submit:${elementId}`;
};

const captureBeforeClick = async ({
  runId,
  step,
  action,
  text,
  elementId,
}: {
  runId: string;
  step: number;
  action: string;
  text: string;
  elementId: string;
}): Promise<void> => {
  const page = await browserManager.getPage(runId);
  const locator = await elementStore.get(runId, elementId).catch(() => undefined);
  if (!locator) {
    return;
  }
  const safeAction = action.replaceAll(/[\\/:*?"<>|]/g, "_");
  const screenshotPath = path.join(getRunDir(runId), `${step}_${safeAction}.png`);
  try {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) {
      return;
    }
    await renderHighlight(page, box, text);
    await page.waitForTimeout(SCREENSHOT_RENDER_WAIT_MS);
    await page.screenshot({ path: screenshotPath });
    preActionCaptureStore.add(runId, {
      elementId,
      action,
      step,
      text,
      screenshotPath,
    });
  } catch {
    // Ignore pre-capture errors so click behavior stays unchanged.
  } finally {
    await clearHighlight(page).catch(() => undefined);
  }
};

const clickWithWait = async ({
  page,
  runId,
  elementId,
  combo,
}: {
  page: Page;
  runId: string;
  elementId: string;
  combo: boolean;
}): Promise<void> => {
  const locator = await elementStore.get(runId, elementId);
  const snapshot = elementStore.getSnapshot(runId, elementId);
  const optionLike = Boolean(
    snapshot &&
      (snapshot.tag.toLowerCase() === "option" ||
        snapshot.role.toLowerCase() === "option" ||
        OPTION_CLASS_RE.test(snapshot.className)),
  );

  const selectNativeOption = async (): Promise<boolean> => {
    const info = await locator
      .evaluate((el) => {
        const element = el as HTMLElement;
        if (element.tagName.toLowerCase() !== "option") {
          return null;
        }
        const option = element as HTMLOptionElement;
        const select = option.closest("select") as HTMLSelectElement | null;
        if (!select) {
          return null;
        }
        return {
          value: String(option.value ?? ""),
          label: String((option.label ?? option.textContent ?? "").trim()),
          selectId: String(select.id ?? ""),
          selectName: String(select.name ?? ""),
        };
      })
      .catch(() => null);
    if (!info) {
      return false;
    }
    let selectLocator: Locator | undefined;
    if (info.selectId) {
      selectLocator = page.locator(`[id="${escapeAttributeValue(info.selectId)}"]`).first();
    } else if (info.selectName) {
      selectLocator = page.locator(`[name="${escapeAttributeValue(info.selectName)}"]`).first();
    } else {
      selectLocator = locator.locator("xpath=ancestor::select[1]").first();
    }
    if (!selectLocator) {
      return false;
    }
    if (info.value.length > 0) {
      const byValue = await selectLocator.selectOption({ value: info.value }).catch(() => []);
      if (byValue.length > 0) {
        return true;
      }
    }
    const byLabel = await selectLocator.selectOption({ label: info.label }).catch(() => []);
    return byLabel.length > 0;
  };

  const clickWithFallback = async (): Promise<void> => {
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    await locator.waitFor({ state: "visible", timeout: 1200 }).catch(() => undefined);

    if (optionLike && (await selectNativeOption())) {
      return;
    }

    const attempts: Array<() => Promise<void>> = [];
    if (combo) {
      attempts.push(async () => {
        await locator.dispatchEvent("mousedown");
      });
    }
    attempts.push(async () => {
      await locator.click({ timeout: 1800 });
    });
    attempts.push(async () => {
      await locator.click({ timeout: 1800, force: true });
    });
    attempts.push(async () => {
      await locator.dispatchEvent("mousedown");
      await locator.dispatchEvent("mouseup");
      await locator.dispatchEvent("click");
    });
    attempts.push(async () => {
      await locator.evaluate((el) => {
        (el as HTMLElement).click();
      });
    });
    attempts.push(async () => {
      const box = await locator.boundingBox();
      if (!box) {
        throw new Error("NO_BOUNDING_BOX");
      }
      await page.mouse.click(box.x + box.width / 2, box.y + Math.max(2, box.height / 2));
    });

    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        await attempt();
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("CLICK_ATTEMPTS_EXHAUSTED");
  };

  const urlBeforeClick = page.url();
  const waitForUrlChange = page
    .waitForURL((url) => url.toString() !== urlBeforeClick, { timeout: CLICK_URL_CHANGE_DETECT_MS })
    .then(() => true)
    .catch(() => false);
  await clickWithFallback();

  if (combo) {
    await page.waitForTimeout(CLICK_COMBOBOX_EXPAND_WAIT_MS);
    return;
  }

  const urlChanged = await waitForUrlChange;
  if (urlChanged) {
    await page.waitForLoadState("domcontentloaded", { timeout: CLICK_NAVIGATION_WAIT_MS }).catch(() => undefined);
  }
  await page.waitForTimeout(120);
};

type SelectOptionMeta = {
  value: string;
  label: string;
  disabled: boolean;
};

type ControlMeta = {
  tag: string;
  role: string;
  className: string;
  typeAttr: string;
  contentEditable: boolean;
  checked: boolean;
  selectOptions: SelectOptionMeta[];
};

const readControlMeta = async (locator: Locator): Promise<ControlMeta | undefined> => {
  return locator
    .evaluate((el) => {
      const element = el as HTMLElement;
      const select = element.tagName.toLowerCase() === "select" ? (element as HTMLSelectElement) : undefined;
      const options =
        select?.options
          ? Array.from(select.options).map((item) => ({
              value: String(item.value ?? ""),
              label: String((item.label ?? item.textContent ?? "").trim()),
              disabled: item.disabled,
            }))
          : [];
      const inputLike = element as HTMLInputElement;
      return {
        tag: element.tagName.toLowerCase(),
        role: (element.getAttribute("role") ?? "").toLowerCase(),
        className: String(element.className ?? ""),
        typeAttr: String(inputLike.type ?? "").toLowerCase(),
        contentEditable: element.getAttribute("contenteditable") === "true",
        checked: Boolean(inputLike.checked),
        selectOptions: options,
      };
    })
    .catch(() => undefined);
};

const clickVisibleOption = async (locator: Locator, maxScan = 8): Promise<boolean> => {
  const total = await locator.count().catch(() => 0);
  if (total === 0) {
    return false;
  }
  const upper = Math.min(total, maxScan);
  for (let i = 0; i < upper; i += 1) {
    const candidate = locator.nth(i);
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    const clicked = await candidate
      .click()
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      return true;
    }
  }
  return false;
};

const chooseSelectOption = (options: SelectOptionMeta[], preferredText: string): SelectOptionMeta | undefined => {
  const active = options.filter((item) => !item.disabled);
  if (active.length === 0) {
    return undefined;
  }
  const preferred = normalize(preferredText);
  if (preferred.length > 0) {
    const matched = active.find((item) => {
      const label = normalize(item.label);
      const value = normalize(item.value);
      return label === preferred || value === preferred || label.includes(preferred);
    });
    if (matched) {
      return matched;
    }
  }
  return active.find((item) => normalize(item.value).length > 0 || normalize(item.label).length > 0);
};

const selectComboboxOption = async (page: Page, preferredText: string): Promise<boolean> => {
  const optionQueries: Locator[] = [];
  const normalizedPreferred = normalize(preferredText);
  
  if (normalizedPreferred.length > 0) {
    optionQueries.push(page.getByRole("option", { name: preferredText, exact: false }));
    optionQueries.push(
      page
        .locator(".ant-select-item-option-content, .el-select-dropdown__item, [role='option']")
        .filter({ hasText: preferredText }),
    );
    optionQueries.push(
      page.locator(".el-select-dropdown__item").filter({
        hasText: preferredText
      })
    );
    optionQueries.push(
      page.locator(".ant-select-dropdown-menu-item").filter({
        hasText: preferredText
      })
    );
  }
  optionQueries.push(page.locator(".ant-select-item-option:not(.ant-select-item-option-disabled) .ant-select-item-option-content"));
  optionQueries.push(page.locator(".el-select-dropdown__item:not(.is-disabled)"));
  optionQueries.push(page.locator(".ant-select-dropdown-menu-item:not(.ant-select-dropdown-menu-item-disabled)"));
  optionQueries.push(page.locator("[role='option']"));

  for (const query of optionQueries) {
    if (await clickVisibleOption(query, 12)) {
      return true;
    }
  }
  return false;
};

const controlAwareValue = (fieldName: string, meta?: ControlMeta): string => {
  const fallback = generateDefaultValue(fieldName);
  if (!meta) {
    return fallback;
  }
  if (meta.typeAttr === "date") {
    return currentLocalDate();
  }
  if (meta.typeAttr === "datetime-local") {
    return `${currentLocalDate()}T10:00`;
  }
  if (meta.typeAttr === "month") {
    return currentLocalDate().slice(0, 7);
  }
  if (meta.typeAttr === "time") {
    return "10:00";
  }
  return fallback;
};

const tryFillField = async ({
  page,
  locator,
  fieldName,
}: {
  page: Page;
  locator: Locator;
  fieldName: string;
}): Promise<boolean> => {
  await locator.scrollIntoViewIfNeeded();
  const meta = await readControlMeta(locator);
  const fillValue = controlAwareValue(fieldName, meta);
  if (!meta) {
    await locator.fill(fillValue);
    return true;
  }

  if (meta.typeAttr === "checkbox" || meta.typeAttr === "radio") {
    if (!meta.checked) {
      await locator.check();
    }
    return true;
  }

  if (meta.tag === "select") {
    const option = chooseSelectOption(meta.selectOptions, fillValue);
    if (!option) {
      return false;
    }
    const byValue = option.value.length > 0 ? await locator.selectOption({ value: option.value }).catch(() => []) : [];
    if (byValue.length > 0) {
      return true;
    }
    const byLabel = await locator.selectOption({ label: option.label }).catch(() => []);
    return byLabel.length > 0;
  }

  const looksLikeCombobox = meta.role === "combobox" || COMBOBOX_CLASS_RE.test(meta.className);
  if (looksLikeCombobox) {
    await locator.click();
    await page.waitForTimeout(CLICK_COMBOBOX_EXPAND_WAIT_MS);
    if (await selectComboboxOption(page, fillValue)) {
      return true;
    }
  }

  if (meta.contentEditable) {
    await locator.fill(fillValue).catch(async () => {
      await locator.evaluate((el, value) => {
        const node = el as HTMLElement;
        node.focus();
        node.textContent = value;
      }, fillValue);
    });
    return true;
  }

  await locator.fill(fillValue);
  return true;
};

const resolveFieldLocator = async ({
  runId,
  page,
  issue,
  fieldName,
}: {
  runId: string;
  page: Page;
  issue?: ValidationReport["issues"][number];
  fieldName: string;
}): Promise<Locator | undefined> => {
  if (issue?.element_id) {
    return elementStore.get(runId, issue.element_id).catch(() => undefined);
  }

  return resolveIssueLocator(
    page,
    {
      message: issue?.message ?? `${fieldName} \u4e3a\u5fc5\u586b\u9879`,
      source: issue?.source ?? "required-empty",
      label: issue?.label,
      fieldHint: fieldName,
      control: {
        idAttr: "",
        nameAttr: "",
        ariaLabel: "",
        placeholder: "",
        tag: "",
        typeAttr: "",
      },
    },
    fieldName,
  ).catch(() => undefined);
};

const fillRequiredFields = async ({
  runId,
  page,
  validation,
}: {
  runId: string;
  page: Page;
  validation: ValidationReport;
}): Promise<{ success: boolean; filledCount: number; attemptedCount: number; filledFields: string[] }> => {
  const queue: Array<{ fieldName: string; issue?: ValidationReport["issues"][number] }> = [];
  const dedupe = new Set<string>();
  const pushQueue = (fieldName?: string, issue?: ValidationReport["issues"][number]): void => {
    const value = fieldName?.trim() ?? "";
    const normalized = normalize(value);
    if (normalized.length === 0 || dedupe.has(normalized)) {
      return;
    }
    dedupe.add(normalized);
    queue.push({ fieldName: value, issue });
  };

  for (const issue of validation.issues) {
    pushQueue(issue.field ?? issue.label, issue);
  }
  for (const field of validation.missingFields) {
    pushQueue(field);
  }

  let filledCount = 0;
  let attemptedCount = 0;
  const filledFields: string[] = [];

  for (const item of queue) {
    const locator = await resolveFieldLocator({
      runId,
      page,
      issue: item.issue,
      fieldName: item.fieldName,
    });
    if (!locator) {
      continue;
    }
    attemptedCount += 1;
    try {
      const filled = await tryFillField({
        page,
        locator,
        fieldName: item.fieldName,
      });
      if (!filled) {
        continue;
      }
      await page.waitForTimeout(200);
      filledCount += 1;
      filledFields.push(item.fieldName);
    } catch {
      // Continue to next field
    }
  }

  return { success: filledCount > 0, filledCount, attemptedCount, filledFields };
};

const buildSelfHealLimitError = (validation: ValidationReport): Error => {
  return new Error(
    `SELF_HEAL_LIMIT_REACHED ${JSON.stringify({
      max_rounds: MAX_SELF_HEAL_ROUNDS,
      missing_fields: validation.missingFields,
      summary: validation.summary,
      message: `Validation self-heal reached max rounds: ${MAX_SELF_HEAL_ROUNDS}`,
    })}`,
  );
};

export const registerClickTool = (server: FastMCP): void => {
  const definition = {
    description: "点击元素",
    parameters: z.object({
      element_id: z.string().min(1),
      run_id: z.string().min(1),
      text: z.string().min(1).optional(),
      retry_count: z.number().int().min(0).max(2).default(1),
    }),
    execute: async ({
      element_id,
      run_id,
      text,
      retry_count,
    }: {
      element_id: string;
      run_id: string;
      text?: string;
      retry_count: number;
    }) => {
      const page = await browserManager.getPage(run_id);
      const step = stepRecorder.getNextStep(run_id);
      const desc = text ?? "点击元素";
      const pageUrlBefore = page.url();
      const startedAt = Date.now();
      const snapshot = elementStore.getSnapshot(run_id, element_id);
      const shouldInspectValidation = isLikelySubmitClick(desc, snapshot);
      const selfHealKey = shouldInspectValidation ? buildSelfHealKey(desc, element_id, snapshot) : undefined;

      await captureBeforeClick({
        runId: run_id,
        step,
        action: "click",
        text: desc,
        elementId: element_id,
      });

      // Pre-submit validation check for form submission buttons
      if (shouldInspectValidation) {
        const validation = await inspectValidation({ runId: run_id, page });
        if (validation.failed) {
          const fillResult = await fillRequiredFields({
            runId: run_id,
            page,
            validation,
          });
          if (fillResult.filledCount > 0) {
            await page.waitForTimeout(300);
          }
        }
      }

      let errorCode: string | undefined;
      let lastValidation: ValidationReport | undefined;
      let lastClickErrorMessage = "";
      const isCombo = isCombobox(snapshot);
      for (let retry = 0; retry <= retry_count; retry += 1) {
        try {
          await clickWithWait({ page, runId: run_id, elementId: element_id, combo: isCombo });

          if (shouldInspectValidation) {
            let validation = await inspectValidation({ runId: run_id, page });
            while (validation.failed) {
              lastValidation = validation;
              if (!selfHealKey) {
                throw new Error(buildValidationErrorMessage(validation));
              }
              const usedRounds = selfHealStore.get(run_id, selfHealKey);
              if (usedRounds >= MAX_SELF_HEAL_ROUNDS) {
                throw buildSelfHealLimitError(validation);
              }

              const fillResult = await fillRequiredFields({
                runId: run_id,
                page,
                validation,
              });
              if (fillResult.filledCount === 0) {
                throw new Error(buildValidationErrorMessage(validation));
              }

              selfHealStore.increment(run_id, selfHealKey);
              await page.waitForTimeout(SELF_HEAL_RETRY_WAIT_MS);
              await clickWithWait({ page, runId: run_id, elementId: element_id, combo: isCombo });
              validation = await inspectValidation({ runId: run_id, page });
            }
          }

          if (selfHealKey) {
            selfHealStore.reset(run_id, selfHealKey);
          }

          stepRecorder.add(run_id, {
            step,
            desc,
            action: "click",
            status: "SUCCESS",
            retryCount: retry,
            latencyMs: Date.now() - startedAt,
            pageUrlBefore,
            pageUrlAfter: page.url(),
            createdAt: new Date().toISOString(),
          });

          return "Clicked successfully";
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          lastClickErrorMessage = message;
          const isValidationError = message.startsWith("VALIDATION_ERROR");
          const isSelfHealLimitError = message.startsWith("SELF_HEAL_LIMIT_REACHED");
          if (isSelfHealLimitError) {
            errorCode = "SELF_HEAL_LIMIT_REACHED";
            stepRecorder.add(run_id, {
              step,
              desc,
              action: "click",
              status: "FAILED",
              errorCode,
              retryCount: retry,
              latencyMs: Date.now() - startedAt,
              pageUrlBefore,
              pageUrlAfter: page.url(),
              createdAt: new Date().toISOString(),
            });
            throw (error instanceof Error ? error : new Error(message));
          }
          if (isValidationError) {
            errorCode = "VALIDATION_ERROR";
            stepRecorder.add(run_id, {
              step,
              desc,
              action: "click",
              status: "FAILED",
              errorCode,
              retryCount: retry,
              latencyMs: Date.now() - startedAt,
              pageUrlBefore,
              pageUrlAfter: page.url(),
              createdAt: new Date().toISOString(),
            });
            throw (error instanceof Error ? error : new Error(message));
          }
          errorCode = errorCode ?? "CLICK_FAILED";
          if (retry < retry_count) {
            await page.waitForTimeout(200 * (retry + 1));
          }
        }
      }

      stepRecorder.add(run_id, {
        step,
        desc,
        action: "click",
        status: "FAILED",
        errorCode: errorCode ?? (lastValidation ? "VALIDATION_ERROR" : "CLICK_FAILED"),
        retryCount: retry_count,
        latencyMs: Date.now() - startedAt,
        pageUrlBefore,
        pageUrlAfter: page.url(),
        createdAt: new Date().toISOString(),
      });

      if (lastValidation) {
        throw new Error(buildValidationErrorMessage(lastValidation));
      }
      throw new Error(
        lastClickErrorMessage.length > 0
          ? `Click failed after retries: ${lastClickErrorMessage}`
          : "Click failed after retries",
      );
    },
  };

  server.addTool({
    name: "click",
    ...definition,
  });
};
