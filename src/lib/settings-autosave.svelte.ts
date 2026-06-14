export interface AutoSaveOptions {
  onError?: (message: string) => void;
  onSuccess?: () => void;
}

export function createAutoSave(options: AutoSaveOptions = {}) {
  let saving = $state(false);
  let running = false;
  let queuedAction: (() => Promise<void>) | null = null;

  async function run(action: () => Promise<void>) {
    queuedAction = action;
    if (running) return;

    running = true;
    saving = true;

    while (queuedAction) {
      const nextAction = queuedAction;
      queuedAction = null;

      try {
        await nextAction();
        if (!queuedAction) options.onSuccess?.();
      } catch (err) {
        options.onError?.(err instanceof Error ? err.message : String(err));
      }
    }

    saving = false;
    running = false;
  }

  return {
    get saving() {
      return saving;
    },
    run,
  };
}
