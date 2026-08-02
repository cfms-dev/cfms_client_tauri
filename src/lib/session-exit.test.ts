import { describe, expect, it, vi } from 'vitest';
import { transitionOutOfSession } from './session-exit';

describe('transitionOutOfSession', () => {
  it('clears local state and starts navigation without waiting for backend cleanup', async () => {
    let finishBackend!: () => void;
    const backendCleanup = new Promise<void>((resolve) => {
      finishBackend = resolve;
    });
    const events: string[] = [];
    const navigate = vi.fn(async () => {
      events.push('navigate');
    });

    const transition = transitionOutOfSession({
      clearLocalState: () => events.push('local'),
      clearBackendState: () => {
        events.push('backend');
        return backendCleanup;
      },
      navigate,
    });

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    expect(events).toEqual(['local', 'backend', 'navigate']);

    finishBackend();
    await transition;
  });
});
