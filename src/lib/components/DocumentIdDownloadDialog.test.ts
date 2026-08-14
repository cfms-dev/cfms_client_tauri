// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import DocumentIdDownloadDialog from './DocumentIdDownloadDialog.svelte';

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

const originalAnimate = Element.prototype.animate;

beforeAll(() => {
  Element.prototype.animate = vi.fn(() => {
    const animation = {
      cancel: vi.fn(), commitStyles: vi.fn(), currentTime: 0, effect: null,
      finished: Promise.resolve(), finish: vi.fn(), id: '', oncancel: null,
      onfinish: null, onremove: null, pending: false, persist: vi.fn(),
      play: vi.fn(), playbackRate: 1, playState: 'finished', ready: Promise.resolve(),
      remove: vi.fn(), replaceState: 'active', reverse: vi.fn(), startTime: 0,
      timeline: null, updatePlaybackRate: vi.fn(),
    } as unknown as Animation;
    queueMicrotask(() => animation.onfinish?.(new Event('finish') as AnimationPlaybackEvent));
    return animation;
  });
});

afterAll(() => {
  Element.prototype.animate = originalAnimate;
});

afterEach(() => cleanup());

describe('DocumentIdDownloadDialog', () => {
  it('trims a non-empty document ID before submitting', async () => {
    const onSubmit = vi.fn();
    render(DocumentIdDownloadDialog, {
      open: true,
      onClose: vi.fn(),
      onSubmit,
    });

    const input = screen.getByRole('textbox', { name: 'files.documentId' });
    await fireEvent.input(input, { target: { value: '  document-42  ' } });
    await fireEvent.submit(input.closest('form')!);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith('document-42');
  });

  it('does not submit an empty ID', async () => {
    const onSubmit = vi.fn();
    render(DocumentIdDownloadDialog, {
      open: true,
      onClose: vi.fn(),
      onSubmit,
    });

    const submit = screen.getByRole('button', { name: 'tasks.downloadByIdAction' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.submit(submit.closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks close and duplicate submit actions while busy', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const view = render(DocumentIdDownloadDialog, {
      open: true,
      onClose,
      onSubmit,
    });

    const input = screen.getByRole('textbox', { name: 'files.documentId' });
    await fireEvent.input(input, { target: { value: 'document-42' } });
    await view.rerender({
      open: true,
      busy: true,
      onClose,
      onSubmit,
    });

    await fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    await fireEvent.submit(screen.getByRole('textbox').closest('form')!);

    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('status', { name: 'tasks.downloadByIdSubmitting' })).toBeTruthy();
  });

  it('keeps the entered ID when displaying an error', async () => {
    const view = render(DocumentIdDownloadDialog, {
      open: true,
      onClose: vi.fn(),
      onSubmit: vi.fn(),
    });

    const input = screen.getByRole('textbox', { name: 'files.documentId' }) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'document-42' } });
    await view.rerender({
      open: true,
      error: 'Document not found',
      onClose: vi.fn(),
      onSubmit: vi.fn(),
    });

    expect(input.value).toBe('document-42');
    expect(screen.getByRole('alert').textContent).toContain('Document not found');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('resets its input after closing and reopening', async () => {
    const props = { onClose: vi.fn(), onSubmit: vi.fn() };
    const view = render(DocumentIdDownloadDialog, { open: true, ...props });
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'document-42' } });

    await view.rerender({ open: false, ...props });
    await view.rerender({ open: true, ...props });

    await waitFor(() => {
      expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
      expect(document.activeElement).toBe(screen.getByRole('textbox'));
    });
  });
});
