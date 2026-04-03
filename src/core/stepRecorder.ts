import type { StepRecord } from "../types.js";

class StepRecorder {
  private readonly runs = new Map<string, StepRecord[]>();

  add(runId: string, step: StepRecord): void {
    const items = this.runs.get(runId) ?? [];
    items.push(step);
    this.runs.set(runId, items);
  }

  get(runId: string): StepRecord[] {
    return [...(this.runs.get(runId) ?? [])];
  }

  getNextStep(runId: string): number {
    return (this.runs.get(runId)?.length ?? 0) + 1;
  }

  clear(runId: string): void {
    this.runs.delete(runId);
  }
}

export const stepRecorder = new StepRecorder();
