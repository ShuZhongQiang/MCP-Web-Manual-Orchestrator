class SelfHealStore {
  private readonly runs = new Map<string, Map<string, number>>();

  private getRunStore(runId: string): Map<string, number> {
    const existed = this.runs.get(runId);
    if (existed) {
      return existed;
    }
    const created = new Map<string, number>();
    this.runs.set(runId, created);
    return created;
  }

  get(runId: string, key: string): number {
    return this.getRunStore(runId).get(key) ?? 0;
  }

  increment(runId: string, key: string): number {
    const runStore = this.getRunStore(runId);
    const next = (runStore.get(key) ?? 0) + 1;
    runStore.set(key, next);
    return next;
  }

  reset(runId: string, key: string): void {
    this.getRunStore(runId).delete(key);
  }

  clearRun(runId: string): void {
    this.runs.delete(runId);
  }
}

export const selfHealStore = new SelfHealStore();

