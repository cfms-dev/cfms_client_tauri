export interface RequestTimingEntry {
  id: number;
  command: string;
  durationMs: number;
  ok: boolean;
  completedAt: number;
}

class DebugLatencyStoreImpl {
  visible = $state(false);
  latest = $state<RequestTimingEntry | null>(null);
  history = $state<RequestTimingEntry[]>([]);
  private nextId = 1;

  toggle() {
    this.visible = !this.visible;
  }

  setVisible(visible: boolean) {
    this.visible = visible;
  }

  record(command: string, durationMs: number, ok: boolean) {
    const entry: RequestTimingEntry = {
      id: this.nextId++,
      command,
      durationMs,
      ok,
      completedAt: Date.now(),
    };
    this.latest = entry;
    this.history = [entry, ...this.history].slice(0, 12);
  }
}

export const debugLatencyStore = new DebugLatencyStoreImpl();

export function recordRequestTiming(command: string, startedAt: number, ok: boolean) {
  const now = performance.now();
  debugLatencyStore.record(command, Math.max(0, now - startedAt), ok);
}
