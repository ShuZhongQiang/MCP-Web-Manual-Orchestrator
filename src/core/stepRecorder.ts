import type { StepRecord } from "../types.js";

const mergeStringArray = (current?: string[], incoming?: string[]): string[] | undefined => {
  const merged = [...(current ?? []), ...(incoming ?? [])]
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return merged.length > 0 ? [...new Set(merged)] : undefined;
};

const mergeEvidence = (
  current?: StepRecord["evidence"],
  incoming?: StepRecord["evidence"],
): StepRecord["evidence"] | undefined => {
  const merged = [...(current ?? []), ...(incoming ?? [])].filter(
    (item): item is NonNullable<StepRecord["evidence"]>[number] => Boolean(item?.label),
  );
  if (merged.length === 0) {
    return undefined;
  }
  const deduped = new Map<string, NonNullable<StepRecord["evidence"]>[number]>();
  for (const item of merged) {
    const key = `${item.label}|${item.image ?? ""}`;
    deduped.set(key, item);
  }
  return [...deduped.values()];
};

const chooseStatus = (
  current?: StepRecord["status"],
  incoming?: StepRecord["status"],
): StepRecord["status"] | undefined => {
  if (current === "FAILED" || incoming === "FAILED") {
    return "FAILED";
  }
  if (current === "WARNING" || incoming === "WARNING") {
    return "WARNING";
  }
  return incoming ?? current;
};

const chooseDesc = (current: StepRecord, incoming: StepRecord): string => {
  const currentDesc = current.desc.trim();
  const incomingDesc = incoming.desc.trim();
  if (incomingDesc.length === 0) {
    return current.desc;
  }
  if (currentDesc.length === 0) {
    return incoming.desc;
  }
  if (current.captureOnly && !incoming.captureOnly) {
    return incoming.desc;
  }
  if (!current.captureOnly && incoming.captureOnly) {
    return current.desc;
  }
  return incomingDesc.length >= currentDesc.length ? incoming.desc : current.desc;
};

const mergeStepRecord = (current: StepRecord, incoming: StepRecord): StepRecord => ({
  step: current.step,
  desc: chooseDesc(current, incoming),
  image: incoming.image ?? current.image,
  notes: mergeStringArray(current.notes, incoming.notes),
  evidence: mergeEvidence(current.evidence, incoming.evidence),
  missingFields: mergeStringArray(current.missingFields, incoming.missingFields),
  filledFields: mergeStringArray(current.filledFields, incoming.filledFields),
  selfHealRounds:
    typeof incoming.selfHealRounds === "number"
      ? Math.max(current.selfHealRounds ?? 0, incoming.selfHealRounds)
      : current.selfHealRounds,
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
  captureOnly: Boolean(current.captureOnly && incoming.captureOnly),
});

class StepRecorder {
  private readonly runs = new Map<string, StepRecord[]>();

  add(runId: string, step: StepRecord): void {
    const items = this.runs.get(runId) ?? [];
    const index = items.findIndex((item) => item.step === step.step);
    if (index >= 0) {
      items[index] = mergeStepRecord(items[index], step);
    } else {
      items.push(step);
    }
    this.runs.set(runId, items);
  }

  get(runId: string): StepRecord[] {
    return [...(this.runs.get(runId) ?? [])];
  }

  findLatest(
    runId: string,
    predicate: (step: StepRecord) => boolean,
  ): StepRecord | undefined {
    const items = this.runs.get(runId) ?? [];
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (predicate(item)) {
        return item;
      }
    }
    return undefined;
  }

  getNextStep(runId: string): number {
    const items = this.runs.get(runId) ?? [];
    const maxStep = items.reduce((max, item) => Math.max(max, item.step), 0);
    return maxStep + 1;
  }

  clear(runId: string): void {
    this.runs.delete(runId);
  }
}

export const stepRecorder = new StepRecorder();
