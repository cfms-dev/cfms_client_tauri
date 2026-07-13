// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExplorerCommandBar from './ExplorerCommandBar.svelte';

afterEach(cleanup);

describe('ExplorerCommandBar', () => {
  it('renders only visible actions and invokes enabled commands', async () => {
    const run = vi.fn();
    render(ExplorerCommandBar, {
      props: {
        ariaLabel: 'File commands',
        actions: [
          { id: 'open', label: 'Open', icon: 'folderOpen', run },
          { id: 'hidden', label: 'Hidden', icon: 'info', visible: false, run: vi.fn() },
        ],
      },
    });

    expect(screen.queryByRole('button', { name: 'Hidden' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(run).toHaveBeenCalledOnce();
  });

  it('exposes active state and prevents disabled commands', async () => {
    const run = vi.fn();
    render(ExplorerCommandBar, {
      props: {
        ariaLabel: 'File commands',
        actions: [
          { id: 'details', label: 'Details', icon: 'info', active: true, disabled: true, run },
        ],
      },
    });

    const button = screen.getByRole('button', { name: 'Details' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps explicitly compact commands icon-only while preserving their accessible label', () => {
    render(ExplorerCommandBar, {
      props: {
        ariaLabel: 'File commands',
        actions: [
          { id: 'create', label: 'Create folder', icon: 'createNewFolder', run: vi.fn() },
          { id: 'details', label: 'Details', icon: 'info', compact: true, dividerBefore: true, run: vi.fn() },
        ],
      },
    });

    const create = screen.getByRole('button', { name: 'Create folder' });
    const details = screen.getByRole('button', { name: 'Details' });
    expect(create.classList.contains('explorer-command-button--compact')).toBe(false);
    expect(details.classList.contains('explorer-command-button--compact')).toBe(true);
    expect(details.querySelector('.sr-only')?.textContent).toBe('Details');
  });

  it('translates a desktop mouse wheel into horizontal scrolling when commands overflow', async () => {
    render(ExplorerCommandBar, {
      props: {
        ariaLabel: 'File commands',
        actions: [
          { id: 'create', label: 'Create folder', icon: 'createNewFolder', run: vi.fn() },
          { id: 'upload', label: 'Upload file', icon: 'uploadFile', run: vi.fn() },
        ],
      },
    });

    const toolbar = screen.getByRole('toolbar', { name: 'File commands' });
    Object.defineProperty(toolbar, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(toolbar, 'scrollWidth', { configurable: true, value: 320 });
    Object.defineProperty(toolbar, 'scrollLeft', { configurable: true, value: 0, writable: true });

    await fireEvent.wheel(toolbar, { deltaY: 64 });
    expect(toolbar.scrollLeft).toBe(64);
  });
});
