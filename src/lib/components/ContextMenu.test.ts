// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContextMenu from './ContextMenu.svelte';

vi.mock('$lib/motion/transitions', () => ({
  menuScale: () => ({ duration: 0 }),
}));

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});

afterEach(cleanup);

describe('ContextMenu keyboard interaction', () => {
  it('focuses actions, navigates with arrows, and restores the trigger on Escape', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { unmount } = render(ContextMenu, {
      props: {
        open: true,
        x: 10,
        y: 10,
        sourceElement: trigger,
        onClose,
        items: [
          { id: 'open', label: 'Open', icon: 'folderOpen', onSelect: vi.fn() },
          { id: 'disabled', label: 'Disabled', icon: 'info', disabled: true, onSelect: vi.fn() },
          { id: 'delete', label: 'Delete', icon: 'delete', onSelect: vi.fn() },
        ],
      },
    });

    const open = screen.getByRole('menuitem', { name: 'Open' });
    const remove = screen.getByRole('menuitem', { name: 'Delete' });
    await waitFor(() => expect(document.activeElement).toBe(open));
    await fireEvent.keyDown(open, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(remove);
    await fireEvent.keyDown(remove, { key: 'Home' });
    expect(document.activeElement).toBe(open);
    await fireEvent.keyDown(open, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
