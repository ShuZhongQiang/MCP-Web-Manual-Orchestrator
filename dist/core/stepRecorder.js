class StepRecorder {
    runs = new Map();
    add(runId, step) {
        const items = this.runs.get(runId) ?? [];
        items.push(step);
        this.runs.set(runId, items);
    }
    get(runId) {
        return [...(this.runs.get(runId) ?? [])];
    }
    getNextStep(runId) {
        return (this.runs.get(runId)?.length ?? 0) + 1;
    }
    clear(runId) {
        this.runs.delete(runId);
    }
}
export const stepRecorder = new StepRecorder();
