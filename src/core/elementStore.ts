import { randomUUID } from "node:crypto";
import type { Locator } from "playwright";
import { browserManager } from "./browser.js";
import type { ElementSnapshot } from "../types.js";

type StoredElement = {
  locator: Locator;
  snapshot?: ElementSnapshot;
  createdAt: string;
};

const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, [role='button'], [onclick]";

const normalize = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

const escapeAttributeValue = (value: string): string => value.replace(/["\\]/g, "\\$&");

const getSnapshotScore = (current: ElementSnapshot, target: ElementSnapshot): number => {
  let score = 0;
  if (current.idAttr && target.idAttr && normalize(current.idAttr) === normalize(target.idAttr)) {
    score += 220;
  }
  if (current.nameAttr && target.nameAttr && normalize(current.nameAttr) === normalize(target.nameAttr)) {
    score += 100;
  }
  if (current.tag && target.tag && normalize(current.tag) === normalize(target.tag)) {
    score += 30;
  }
  if (current.typeAttr && target.typeAttr && normalize(current.typeAttr) === normalize(target.typeAttr)) {
    score += 50;
  }
  if (current.role && target.role && normalize(current.role) === normalize(target.role)) {
    score += 50;
  }
  if (current.ariaLabel && target.ariaLabel && normalize(current.ariaLabel) === normalize(target.ariaLabel)) {
    score += 80;
  }
  if (current.placeholder && target.placeholder && normalize(current.placeholder) === normalize(target.placeholder)) {
    score += 70;
  }
  const currentText = normalize(current.text);
  const targetText = normalize(target.text);
  if (currentText.length > 0 && targetText.length > 0) {
    if (currentText === targetText) {
      score += 80;
    } else if (currentText.includes(targetText) || targetText.includes(currentText)) {
      score += 45;
    }
  }
  return score;
};

class ElementStore {
  private readonly elementsByRun = new Map<string, Map<string, StoredElement>>();

  private getRunStore(runId: string): Map<string, StoredElement> {
    const existed = this.elementsByRun.get(runId);
    if (existed) {
      return existed;
    }
    const created = new Map<string, StoredElement>();
    this.elementsByRun.set(runId, created);
    return created;
  }

  set(runId: string, locator: Locator, snapshot?: ElementSnapshot): string {
    const runStore = this.getRunStore(runId);
    const id = randomUUID();
    runStore.set(id, {
      locator,
      snapshot,
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  private async hasMatch(locator: Locator): Promise<boolean> {
    try {
      return (await locator.count()) > 0;
    } catch {
      return false;
    }
  }

  private async readSnapshot(locator: Locator): Promise<ElementSnapshot | undefined> {
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
  }

  private async relocateFromSnapshot(runId: string, snapshot: ElementSnapshot): Promise<Locator | undefined> {
    const page = await browserManager.getPage(runId);
    const candidates: Locator[] = [];
    if (snapshot.idAttr) {
      candidates.push(page.locator(`[id="${escapeAttributeValue(snapshot.idAttr)}"]`));
    }
    if (snapshot.nameAttr) {
      candidates.push(page.locator(`[name="${escapeAttributeValue(snapshot.nameAttr)}"]`));
    }
    if (snapshot.ariaLabel) {
      candidates.push(page.getByLabel(snapshot.ariaLabel));
    }
    if (snapshot.placeholder) {
      candidates.push(page.getByPlaceholder(snapshot.placeholder));
    }
    if (snapshot.text) {
      candidates.push(page.getByText(snapshot.text, { exact: false }));
    }
    for (const candidate of candidates) {
      if (await this.hasMatch(candidate)) {
        return candidate.first();
      }
    }

    const source = page.locator(INTERACTIVE_SELECTOR);
    const total = await source.count().catch(() => 0);
    let bestScore = 0;
    let bestLocator: Locator | undefined;
    const upper = Math.min(total, 120);
    for (let i = 0; i < upper; i += 1) {
      const item = source.nth(i);
      const itemSnapshot = await this.readSnapshot(item);
      if (!itemSnapshot) {
        continue;
      }
      const score = getSnapshotScore(itemSnapshot, snapshot);
      if (score > bestScore) {
        bestScore = score;
        bestLocator = item;
        if (bestScore >= 220) {
          break;
        }
      }
    }
    if (bestScore >= 90) {
      return bestLocator;
    }
    return undefined;
  }

  async get(runId: string, id: string): Promise<Locator> {
    const item = this.getRunStore(runId).get(id);
    if (!item) {
      throw new Error("Invalid element ID");
    }
    if (await this.hasMatch(item.locator)) {
      return item.locator;
    }
    if (item.snapshot) {
      const relocated = await this.relocateFromSnapshot(runId, item.snapshot);
      if (relocated) {
        item.locator = relocated;
        const refreshedSnapshot = await this.readSnapshot(relocated);
        if (refreshedSnapshot) {
          item.snapshot = refreshedSnapshot;
        }
        return relocated;
      }
    }
    throw new Error("Invalid or stale element ID");
  }

  getSnapshot(runId: string, id: string): ElementSnapshot | undefined {
    return this.getRunStore(runId).get(id)?.snapshot;
  }

  list(runId: string, limit: number): Array<{ element_id: string; snapshot?: ElementSnapshot; createdAt: string }> {
    return [...this.getRunStore(runId).entries()]
      .slice(-limit)
      .reverse()
      .map(([element_id, value]) => ({
        element_id,
        snapshot: value.snapshot,
        createdAt: value.createdAt,
      }));
  }

  clearRun(runId: string): void {
    this.elementsByRun.delete(runId);
  }
}

export const elementStore = new ElementStore();
