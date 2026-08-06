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
    expect(screen.getByRole('button', { name: 'Cancel' }).parentElement?.classList.contains('choice-footer-actions')).toBe(true);
  });

  it('maps choice intents to their visual treatment and focuses the safe primary action', async () => {
    void dialogStore.choose({
      title: 'Name conflict',
      message: 'Choose how to handle the conflict.',
      choices: [
        { value: 'overwrite', label: 'Replace existing items', intent: 'danger' },
        { value: 'keep_both', label: 'Keep both', intent: 'primary' },
        { value: 'skip', label: 'Skip conflicting items' },
      ],
      cancelLabel: 'Cancel',
    });

    render(DialogHost);

    expect(screen.getByRole('button', { name: 'Replace existing items' }).dataset.intent).toBe('danger');
    expect(screen.getByRole('button', { name: 'Keep both' }).dataset.intent).toBe('primary');
    expect(screen.getByRole('button', { name: 'Skip conflicting items' }).dataset.intent).toBe('neutral');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep both' })));
  });

  it('resets apply-to-all before showing the next queued conflict', async () => {
    const firstResolution = dialogStore.choose({
      title: 'First conflict',
      message: 'Choose how to handle the first conflict.',
      choices: [{ value: 'keep_both', label: 'Keep the first pair' }],
      applyToAllLabel: 'Apply to following conflicts',
      cancelLabel: 'Cancel',
    });
    const secondResolution = dialogStore.choose({
      title: 'Second conflict',
      message: 'Choose how to handle the second conflict.',
      choices: [{ value: 'skip', label: 'Skip the second item' }],
      applyToAllLabel: 'Apply to following conflicts',
      cancelLabel: 'Cancel',
    });

    render(DialogHost);

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Apply to following conflicts' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Keep the first pair' }));
    await expect(firstResolution).resolves.toEqual({ value: 'keep_both', applyToAll: true });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Skip the second item' })).toBeTruthy());
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Apply to following conflicts' }).checked).toBe(false);

    await fireEvent.click(screen.getByRole('button', { name: 'Skip the second item' }));
    await expect(secondResolution).resolves.toEqual({ value: 'skip', applyToAll: false });
  });

  it('cancels a choice without returning a partial resolution', async () => {
    const resolution = dialogStore.choose({
      title: 'Name conflict',
      message: 'Choose how to handle the conflict.',
      choices: [{ value: 'skip', label: 'Skip conflicting item' }],
      cancelLabel: 'Cancel',
    });

    render(DialogHost);
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(resolution).resolves.toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
