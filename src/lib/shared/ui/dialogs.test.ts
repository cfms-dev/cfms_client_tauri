import { afterEach, describe, expect, it, vi } from 'vitest';
import { dialogStore } from '$lib/shared/ui/dialogs.svelte.ts';

afterEach(() => {
  while (dialogStore.current) dialogStore.resolve(null);
});

const choices = [{ value: 'retry', label: 'Retry' }] as const;

function choose(title: string, signal?: AbortSignal) {
  return dialogStore.choose({ title, message: title, choices: [...choices], signal });
}

describe('dialogStore choice cancellation', () => {
  it('resolves an already aborted request without opening or queueing it', async () => {
    const controller = new AbortController();
    controller.abort();
    const existing = dialogStore.confirm('Existing confirmation');
    const existingId = dialogStore.current!.id;

    await expect(choose('Cancelled choice', controller.signal)).resolves.toBeNull();
    expect(dialogStore.current!.id).toBe(existingId);
    dialogStore.resolve(true);
    await expect(existing).resolves.toBe(true);
    expect(dialogStore.current).toBeNull();
  });

  it('closes an active request and advances only to the next queued dialog', async () => {
    const controller = new AbortController();
    const choice = choose('Active choice', controller.signal);
    const confirmation = dialogStore.confirm('Next confirmation');
    controller.abort();

    await expect(choice).resolves.toBeNull();
    expect(dialogStore.current!.message).toBe('Next confirmation');
    dialogStore.resolve(true);
    await expect(confirmation).resolves.toBe(true);
  });

  it('removes the exact queued request while preserving active and other queued requests', async () => {
    const existing = dialogStore.prompt('Existing prompt');
    const existingId = dialogStore.current!.id;
    const firstChoice = choose('First queued choice');
    const controller = new AbortController();
    const cancelledChoice = choose('Cancelled queued choice', controller.signal);
    const lastChoice = choose('Last queued choice');
    controller.abort();

    await expect(cancelledChoice).resolves.toBeNull();
    expect(dialogStore.current!.id).toBe(existingId);
    dialogStore.resolve('Prompt value');
    await expect(existing).resolves.toBe('Prompt value');
    expect(dialogStore.current!.title).toBe('First queued choice');
    dialogStore.resolve({ value: 'retry', applyToAll: false });
    await expect(firstChoice).resolves.toEqual({ value: 'retry', applyToAll: false });
    expect(dialogStore.current!.title).toBe('Last queued choice');
    dialogStore.resolve({ value: 'retry', applyToAll: true });
    await expect(lastChoice).resolves.toEqual({ value: 'retry', applyToAll: true });
    expect(dialogStore.current).toBeNull();
  });

  it.each(['selection', 'dismissal', 'abort'])('cleans up its abort listener after %s', async (completion) => {
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const choice = choose('Choice', controller.signal);
    const listener = addListener.mock.calls[0][1];

    if (completion === 'abort') controller.abort();
    else dialogStore.resolve(completion === 'selection' ? { value: 'retry', applyToAll: true } : null);
    await choice;

    expect(addListener).toHaveBeenCalledWith('abort', listener, { once: true });
    expect(removeListener).toHaveBeenCalledWith('abort', listener);
    const following = dialogStore.confirm('Following confirmation');
    const followingId = dialogStore.current!.id;
    controller.abort();
    expect(dialogStore.current!.id).toBe(followingId);
    dialogStore.resolve(false);
    await expect(following).resolves.toBe(false);
  });
});
