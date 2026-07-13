// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DialogHost from './DialogHost.svelte';
import { dialogStore } from '$lib/dialogs.svelte';
import '$lib/i18n';

vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
}));

Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  value: () => {
    const animation = {
      cancel: vi.fn(),
      currentTime: 0,
      effect: {},
      onfinish: null as (() => void) | null,
      playState: 'finished',
    };
    queueMicrotask(() => animation.onfinish?.());
    return animation;
  },
});

afterEach(() => {
  if (dialogStore.current) dialogStore.resolve(null);
  cleanup();
});

describe('DialogHost choice dialog', () => {
  it('executes a choice for all remaining conflicts when the checkbox is selected', async () => {
    const resolution = dialogStore.choose({
      title: 'Name conflicts',
      message: 'Choose how to handle the conflict.',
      choices: [
        { value: 'overwrite', label: 'Replace existing items' },
        { value: 'keep_both', label: 'Keep both' },
        { value: 'skip', label: 'Skip conflicting items' },
      ],
      applyToAllLabel: 'Apply to the remaining 2 conflicts',
      cancelLabel: 'Cancel',
    });

    render(DialogHost);

    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Apply to the remaining 2 conflicts' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Keep both' }));
    await expect(resolution).resolves.toEqual({ value: 'keep_both', applyToAll: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('limits a choice to the current conflict by default', async () => {
    const resolution = dialogStore.choose({
      title: 'Name conflicts',
      message: 'Choose how to handle the conflict.',
      choices: [{ value: 'skip', label: 'Skip conflicting item' }],
      applyToAllLabel: 'Apply to the remaining conflict',
      cancelLabel: 'Cancel',
    });

    render(DialogHost);
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);

    await fireEvent.click(screen.getByRole('button', { name: 'Skip conflicting item' }));
    await expect(resolution).resolves.toEqual({ value: 'skip', applyToAll: false });
  });

  it('keeps Cancel right-aligned when there is no apply-to-all checkbox', () => {
    void dialogStore.choose({
      title: 'Name conflict',
      message: 'Choose how to handle the only conflict.',
      choices: [{ value: 'skip', label: 'Skip conflicting item' }],
      cancelLabel: 'Cancel',
    });

    render(DialogHost);

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' }).parentElement?.classList.contains('ml-auto')).toBe(true);
  });
});
