import { tick } from 'svelte';

export interface DebugTimingSnapshot {
  command: string | null;
  requestMs: number | null;
  uiMs: number | null;
}

class DebugTimingStore {
  visible = $state(true);
  command = $state<string | null>(null);
  requestMs = $state<number | null>(null);
  uiMs = $state<number | null>(null);
  private sequence = 0;
  private priorityUntil = 0;

  toggle() {
    this.visible = !this.visible;
  }

  recordResponse(
    command: string,
    requestMs: number,
    options: { priorityMs?: number } = {},
  ) {
    if (!options.priorityMs && Date.now() < this.priorityUntil) {
      return null;
    }

    this.sequence += 1;
    this.command = command;
    this.requestMs = requestMs;
    this.uiMs = null;
    if (options.priorityMs) {
      this.priorityUntil = Date.now() + options.priorityMs;
    }
    return this.sequence;
  }

  recordUiComplete(sequence: number | null, uiMs: number) {
    if (sequence === null) return;
    if (sequence !== this.sequence) return;
    this.uiMs = uiMs;
  }

  get snapshot(): DebugTimingSnapshot {
    return {
      command: this.command,
      requestMs: this.requestMs,
      uiMs: this.uiMs,
    };
  }
}

export const debugTimingStore = new DebugTimingStore();

export function scheduleDebugUiCompletion(sequence: number | null, responseAt: number) {
  if (sequence === null || typeof window === 'undefined') return;

  window.requestAnimationFrame(() => {
    void tick().then(() => {
      window.requestAnimationFrame(() => {
        debugTimingStore.recordUiComplete(sequence, performance.now() - responseAt);
      });
    });
  });
}
