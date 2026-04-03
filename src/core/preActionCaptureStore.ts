type PreActionCaptureRecord = {
  elementId: string;
  action: string;
  step: number;
  text: string;
  screenshotPath: string;
  createdAt: string;
};

class PreActionCaptureStore {
  private readonly runs = new Map<string, PreActionCaptureRecord[]>();

  add(runId: string, record: Omit<PreActionCaptureRecord, "createdAt">): void {
    const items = this.runs.get(runId) ?? [];
    items.push({
      ...record,
      createdAt: new Date().toISOString(),
    });
    this.runs.set(runId, items);
  }

  get(
    runId: string,
    params: {
      elementId: string;
      action?: string;
      step?: number;
    },
  ): PreActionCaptureRecord | undefined {
    const items = this.runs.get(runId) ?? [];
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item.elementId !== params.elementId) {
        continue;
      }
      if (params.action && item.action !== params.action) {
        continue;
      }
      if (typeof params.step === "number" && item.step !== params.step) {
        continue;
      }
      return item;
    }

    if (typeof params.step === "number") {
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const item = items[i];
        if (item.elementId !== params.elementId) {
          continue;
        }
        if (params.action && item.action !== params.action) {
          continue;
        }
        return item;
      }
    }

    return undefined;
  }

  clearRun(runId: string): void {
    this.runs.delete(runId);
  }
}

export const preActionCaptureStore = new PreActionCaptureStore();
