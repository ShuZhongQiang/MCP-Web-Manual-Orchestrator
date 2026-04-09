import type { StepRecord } from "../types.js";
import { stepRecorder } from "./stepRecorder.js";

export type LogicalStepContext = {
  step: number;
  desc?: string;
  module?: string;
  moduleDescription?: string;
  createdAt: string;
};

type RunState = {
  active?: LogicalStepContext;
  lastAllocated: number;
};

class LogicalStepStore {
  private readonly runs = new Map<string, RunState>();

  private getRunState(runId: string): RunState {
    const existing = this.runs.get(runId);
    if (existing) {
      return existing;
    }
    const created: RunState = {
      lastAllocated: 0,
    };
    this.runs.set(runId, created);
    return created;
  }

  private allocateStep(runId: string): number {
    const state = this.getRunState(runId);
    const nextRecorded = stepRecorder.getNextStep(runId);
    const allocated = Math.max(state.lastAllocated + 1, nextRecorded);
    state.lastAllocated = allocated;
    this.runs.set(runId, state);
    return allocated;
  }

  begin(
    runId: string,
    params: {
      desc?: string;
      module?: string;
      moduleDescription?: string;
    },
  ): LogicalStepContext {
    const context: LogicalStepContext = {
      step: this.allocateStep(runId),
      desc: params.desc?.trim() || undefined,
      module: params.module?.trim() || undefined,
      moduleDescription: params.moduleDescription?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    const state = this.getRunState(runId);
    state.active = context;
    this.runs.set(runId, state);
    return context;
  }

  getActive(runId: string): LogicalStepContext | undefined {
    return this.getRunState(runId).active;
  }

  resolve(runId: string, explicitStep?: number): number {
    const state = this.getRunState(runId);
    if (typeof explicitStep === "number" && explicitStep > 0) {
      state.lastAllocated = Math.max(state.lastAllocated, explicitStep);
      if (!state.active || state.active.step !== explicitStep) {
        state.active = {
          step: explicitStep,
          createdAt: new Date().toISOString(),
        };
      }
      this.runs.set(runId, state);
      return explicitStep;
    }
    if (state.active) {
      return state.active.step;
    }
    return this.allocateStep(runId);
  }

  clearActive(runId: string, step?: number): void {
    const state = this.getRunState(runId);
    if (!state.active) {
      return;
    }
    if (typeof step === "number" && state.active.step !== step) {
      return;
    }
    state.active = undefined;
    this.runs.set(runId, state);
  }

  getNextStep(runId: string): number {
    const state = this.getRunState(runId);
    return Math.max(state.lastAllocated + 1, stepRecorder.getNextStep(runId));
  }

  applyContext(runId: string, step: number, record: StepRecord): StepRecord {
    const active = this.getRunState(runId).active;
    if (!active || active.step !== step) {
      return record;
    }
    return {
      ...record,
      desc: record.desc?.trim().length ? record.desc : active.desc ?? record.desc,
      module: record.module ?? active.module,
      moduleDescription: record.moduleDescription ?? active.moduleDescription,
    };
  }

  clearRun(runId: string): void {
    this.runs.delete(runId);
  }
}

export const logicalStepStore = new LogicalStepStore();
