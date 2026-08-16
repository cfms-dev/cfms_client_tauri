// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExplorerDetailsPane from './ExplorerDetailsPane.svelte';

vi.mock('$lib/appearance', () => ({
  isReducedMotionEnabled: () => true,
}));

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];

  readonly observed = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe = vi.fn((target: Element) => this.observed.add(target));
  disconnect = vi.fn(() => this.observed.clear());

  notify(target: Element) {
    if (!this.observed.has(target)) return;
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: TestResizeObserver,
});

afterEach(() => {
  cleanup();
  TestResizeObserver.instances = [];
  vi.restoreAllMocks();
});

function renderPane() {
  const props = {
    open: true,
    model: null,
    emptyTitle: 'Properties',
    emptyLabel: 'Select an item',
    closeLabel: 'Close details',
    resizeLabel: 'Resize details pane',
    onClose: vi.fn(),
  };
  const result = render(ExplorerDetailsPane, { props });
  const pane = result.container.querySelector<HTMLElement>('.explorer-details-pane')!;
  const container = pane.parentElement!;
  let containerWidth = 900;
  Object.defineProperty(container, 'clientWidth', {
    configurable: true,
    get: () => containerWidth,
  });
  const handle = screen.getByRole('separator', { name: props.resizeLabel });
  Object.defineProperties(handle, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });

  const notifyContainerResize = () => {
    for (const observer of TestResizeObserver.instances) observer.notify(container);
  };

  return {
    ...result,
    props,
    pane,
    handle,
    setContainerWidth(width: number) {
      containerWidth = width;
      notifyContainerResize();
    },
    notifyContainerResize,
  };
}

function paneWidth(pane: HTMLElement) {
  return pane.style.getPropertyValue('--explorer-details-width');
}

describe('ExplorerDetailsPane resizing', () => {
  it('resizes from the left edge and clamps the width between 240px and 480px', async () => {
    const { pane, handle, notifyContainerResize } = renderPane();
    notifyContainerResize();
    await waitFor(() => expect(handle.getAttribute('aria-valuemax')).toBe('480'));

    await fireEvent.pointerDown(handle, {
      pointerId: 12,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: 320,
    });
    await fireEvent.pointerMove(handle, {
      pointerId: 12,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: 180,
    });
    expect(paneWidth(pane)).toBe('460px');

    await fireEvent.pointerMove(handle, {
      pointerId: 12,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: -1000,
    });
    expect(paneWidth(pane)).toBe('480px');

    await fireEvent.pointerMove(handle, {
      pointerId: 12,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: 1000,
    });
    expect(paneWidth(pane)).toBe('240px');
  });

  it('supports keyboard resizing and exposes the current range', async () => {
    const { pane, handle, notifyContainerResize } = renderPane();
    notifyContainerResize();

    await fireEvent.keyDown(handle, { key: 'Home' });
    expect(paneWidth(pane)).toBe('240px');
    await fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(paneWidth(pane)).toBe('256px');
    await fireEvent.keyDown(handle, { key: 'End' });
    expect(paneWidth(pane)).toBe('480px');
    expect(handle.getAttribute('aria-valuemin')).toBe('240');
    expect(handle.getAttribute('aria-valuemax')).toBe('480');
    expect(handle.getAttribute('aria-valuenow')).toBe('480');
  });

  it('preserves room for the file list when its container narrows', async () => {
    const { pane, handle, notifyContainerResize, setContainerWidth } = renderPane();
    notifyContainerResize();
    await fireEvent.keyDown(handle, { key: 'End' });
    expect(paneWidth(pane)).toBe('480px');

    setContainerWidth(700);

    await waitFor(() => expect(paneWidth(pane)).toBe('380px'));
    expect(handle.getAttribute('aria-valuemax')).toBe('380');
    expect(handle.getAttribute('aria-valuenow')).toBe('380');
  });

  it('keeps the chosen width while the detail model changes', async () => {
    const { pane, handle, props, notifyContainerResize, rerender } = renderPane();
    notifyContainerResize();
    await fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(paneWidth(pane)).toBe('336px');

    await rerender({
      ...props,
      model: { title: 'Report', icon: 'filePresent', loading: true, rows: [] },
    });

    expect(paneWidth(pane)).toBe('336px');
  });
});
