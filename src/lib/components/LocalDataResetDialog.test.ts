// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LocalDataResetDialog from './LocalDataResetDialog.svelte';

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
}));

Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  value: () => ({
    cancel: vi.fn(),
    currentTime: 0,
    effect: {},
    onfinish: null,
    playState: 'finished',
  }),
});

afterEach(cleanup);

describe('LocalDataResetDialog', () => {
  it('preserves downloads by default and submits only on final confirmation', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(LocalDataResetDialog, {
      props: { open: true, onConfirm, onClose },
    });

    const checkbox = screen.getByRole('checkbox', {
      name: 'settings.localData.deleteDownloads settings.localData.deleteDownloadsHint',
    });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', {
      name: 'settings.localData.confirmAction',
    }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('passes the explicit download deletion choice and supports cancellation', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(LocalDataResetDialog, {
      props: { open: true, onConfirm, onClose },
    });

    await fireEvent.click(screen.getByRole('checkbox'));
    await fireEvent.click(screen.getByRole('button', {
      name: 'settings.localData.confirmAction',
    }));
    expect(onConfirm).toHaveBeenCalledWith(true);

    await fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
