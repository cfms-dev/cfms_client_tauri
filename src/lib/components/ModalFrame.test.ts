// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ModalFrame from './ModalFrame.svelte';

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

afterEach(cleanup);

const children = createRawSnippet(() => ({
  render: () => '<p>Dialog content</p>',
}));

const inputChildren = createRawSnippet(() => ({
  render: () => '<input aria-label="Search files" />',
}));

function renderModal(overrides: { dismissible?: boolean; closeOnBackdrop?: boolean } = {}) {
  const onClose = vi.fn();
  const result = render(ModalFrame, {
    props: {
      title: 'Test dialog',
      closeLabel: 'Close dialog',
      onClose,
      children,
      ...overrides,
    },
  });
  return { ...result, onClose };
}

describe('ModalFrame', () => {
  it('moves focus into the dialog and restores it after unmount', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Test dialog' });

    await waitFor(() => expect(document.activeElement).toBe(dialog));
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('prefers the first form field over the non-interactive dialog panel', async () => {
    render(ModalFrame, {
      props: {
        title: 'Search dialog',
        closeLabel: 'Close dialog',
        onClose: vi.fn(),
        children: inputChildren,
      },
    });

    const input = screen.getByRole('textbox', { name: 'Search files' });
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('closes from Escape, the close button, and the backdrop', async () => {
    const { container, onClose } = renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Test dialog' });

    await fireEvent.keyDown(dialog, { key: 'Escape' });
    await fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await fireEvent.click(container.querySelector<HTMLElement>('.modal-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('blocks all dismissal paths while non-dismissible', async () => {
    const { container, onClose } = renderModal({ dismissible: false });
    const dialog = screen.getByRole('dialog', { name: 'Test dialog' });
    const closeButton = screen.getByRole('button', { name: 'Close dialog' });

    expect(closeButton.hasAttribute('disabled')).toBe(true);
    await fireEvent.keyDown(dialog, { key: 'Escape' });
    await fireEvent.click(container.querySelector<HTMLElement>('.modal-backdrop')!);
    expect(onClose).not.toHaveBeenCalled();
  });
});
