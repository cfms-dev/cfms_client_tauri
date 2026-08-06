// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ModalFrame from './ModalFrame.svelte';

const platformMocks = vi.hoisted(() => ({
  isMobilePlatform: vi.fn(() => false),
}));

vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
}));

vi.mock('$lib/platform', () => ({
  isMobilePlatform: platformMocks.isMobilePlatform,
}));

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];

  readonly observed = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe = vi.fn((target: Element) => {
    this.observed.add(target);
  });

  unobserve = vi.fn((target: Element) => {
    this.observed.delete(target);
  });

  disconnect = vi.fn(() => {
    this.observed.clear();
  });

  notify(target: Element) {
    if (!this.observed.has(target)) return;
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: TestResizeObserver,
});

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
  cleanup();
  TestResizeObserver.instances = [];
  platformMocks.isMobilePlatform.mockReset();
  platformMocks.isMobilePlatform.mockReturnValue(false);
});

const children = createRawSnippet(() => ({
  render: () => '<p>Dialog content</p>',
}));

const inputChildren = createRawSnippet(() => ({
  render: () => '<input aria-label="Search files" />',
}));

type ModalOverrides = {
  open?: boolean;
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
};

function renderModal(overrides: ModalOverrides = {}) {
  const onClose = vi.fn();
  const props = {
    title: 'Test dialog',
    closeLabel: 'Close dialog',
    onClose,
    children,
    ...overrides,
  };
  const result = render(ModalFrame, {
    props,
  });
  return { ...result, onClose, props };
}

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function readOffset(positioner: HTMLElement) {
  const value = positioner.style.getPropertyValue('translate') || positioner.style.translate || '0px 0px';
  const [x = '0', y = '0'] = value.trim().split(/\s+/u);
  return {
    x: Number.parseFloat(x) || 0,
    y: Number.parseFloat(y) || 0,
  };
}

function installDialogGeometry(
  container: HTMLElement,
  initial = { viewportWidth: 800, viewportHeight: 600, panelWidth: 300, panelHeight: 200 },
) {
  const backdrop = container.querySelector<HTMLElement>('.modal-backdrop')!;
  const positioner = container.querySelector<HTMLElement>('.modal-positioner')!;
  const header = container.querySelector<HTMLElement>('.modal-header')!;
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  let { viewportWidth, viewportHeight, panelWidth, panelHeight } = initial;

  backdrop.style.padding = '16px';
  Object.defineProperty(backdrop, 'getBoundingClientRect', {
    configurable: true,
    value: () => makeRect(0, 0, viewportWidth, viewportHeight),
  });
  Object.defineProperty(positioner, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const offset = readOffset(positioner);
      return makeRect(
        (viewportWidth - panelWidth) / 2 + offset.x,
        (viewportHeight - panelHeight) / 2 + offset.y,
        panelWidth,
        panelHeight,
      );
    },
  });
  Object.defineProperties(header, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });

  return {
    backdrop,
    positioner,
    header,
    setPointerCapture,
    releasePointerCapture,
    setViewport(width: number, height: number) {
      viewportWidth = width;
      viewportHeight = height;
    },
    setPanelSize(width: number, height: number) {
      panelWidth = width;
      panelHeight = height;
    },
    notifyPositionerResize() {
      for (const observer of TestResizeObserver.instances) observer.notify(positioner);
    },
  };
}

async function dragHeader(
  header: HTMLElement,
  pointerId: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pointerType = 'mouse',
) {
  await fireEvent.pointerDown(header, {
    pointerId,
    pointerType,
    button: 0,
    isPrimary: true,
    clientX: from.x,
    clientY: from.y,
  });
  await fireEvent.pointerMove(header, {
    pointerId,
    pointerType,
    isPrimary: true,
    clientX: to.x,
    clientY: to.y,
  });
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

  it('starts dragging after the movement threshold and captures the pointer', async () => {
    const { container } = renderModal();
    const geometry = installDialogGeometry(container);

    await fireEvent.pointerDown(geometry.header, {
      pointerId: 7,
      pointerType: 'mouse',
      button: 0,
      isPrimary: true,
      clientX: 400,
      clientY: 220,
    });
    await fireEvent.pointerMove(geometry.header, {
      pointerId: 7,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: 402,
      clientY: 222,
    });

    expect(readOffset(geometry.positioner)).toEqual({ x: 0, y: 0 });
    expect(geometry.setPointerCapture).not.toHaveBeenCalled();

    await fireEvent.pointerMove(geometry.header, {
      pointerId: 7,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: 500,
      clientY: 300,
    });

    await waitFor(() => expect(readOffset(geometry.positioner)).toEqual({ x: 100, y: 80 }));
    expect(geometry.setPointerCapture).toHaveBeenCalledWith(7);
    expect(geometry.backdrop.classList.contains('modal-dragging')).toBe(true);

    await fireEvent.pointerUp(geometry.header, {
      pointerId: 7,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: 500,
      clientY: 300,
    });

    expect(geometry.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(geometry.backdrop.classList.contains('modal-dragging')).toBe(false);
  });

  it('keeps the complete dialog inside all four safe viewport edges', async () => {
    const { container } = renderModal();
    const geometry = installDialogGeometry(container);

    await dragHeader(geometry.header, 8, { x: 400, y: 220 }, { x: 2000, y: 2000 });
    await fireEvent.pointerUp(geometry.header, {
      pointerId: 8,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: 2000,
      clientY: 2000,
    });
    expect(readOffset(geometry.positioner)).toEqual({ x: 234, y: 184 });

    await dragHeader(geometry.header, 9, { x: 400, y: 220 }, { x: -2000, y: -2000 });
    await fireEvent.pointerUp(geometry.header, {
      pointerId: 9,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: -2000,
      clientY: -2000,
    });
    expect(readOffset(geometry.positioner)).toEqual({ x: -234, y: -184 });
  });

  it('does not drag from controls, content, non-primary input, or touch', async () => {
    const { container } = renderModal();
    const geometry = installDialogGeometry(container);
    const closeButton = screen.getByRole('button', { name: 'Close dialog' });
    const content = container.querySelector<HTMLElement>('.modal-content')!;

    await dragHeader(closeButton, 10, { x: 400, y: 220 }, { x: 500, y: 300 });
    await dragHeader(content, 11, { x: 400, y: 220 }, { x: 500, y: 300 });
    await fireEvent.pointerDown(geometry.header, {
      pointerId: 12,
      pointerType: 'mouse',
      button: 2,
      isPrimary: true,
      clientX: 400,
      clientY: 220,
    });
    await fireEvent.pointerMove(geometry.header, {
      pointerId: 12,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: 500,
      clientY: 300,
    });
    await dragHeader(geometry.header, 13, { x: 400, y: 220 }, { x: 500, y: 300 }, 'touch');

    expect(readOffset(geometry.positioner)).toEqual({ x: 0, y: 0 });
    expect(geometry.setPointerCapture).not.toHaveBeenCalled();
  });

  it('allows pen dragging but disables dragging on mobile platforms', async () => {
    const desktop = renderModal();
    const desktopGeometry = installDialogGeometry(desktop.container);

    await dragHeader(desktopGeometry.header, 14, { x: 400, y: 220 }, { x: 470, y: 260 }, 'pen');
    await waitFor(() => expect(readOffset(desktopGeometry.positioner)).toEqual({ x: 70, y: 40 }));
    desktop.unmount();

    platformMocks.isMobilePlatform.mockReturnValue(true);
    const mobile = renderModal();
    const mobileGeometry = installDialogGeometry(mobile.container);
    await dragHeader(mobileGeometry.header, 15, { x: 400, y: 220 }, { x: 470, y: 260 });

    expect(readOffset(mobileGeometry.positioner)).toEqual({ x: 0, y: 0 });
    expect(mobileGeometry.setPointerCapture).not.toHaveBeenCalled();
  });

  it('only lets the topmost dialog begin dragging', async () => {
    const first = renderModal();
    const firstGeometry = installDialogGeometry(first.container);
    const second = renderModal();
    installDialogGeometry(second.container);

    await dragHeader(firstGeometry.header, 16, { x: 400, y: 220 }, { x: 470, y: 260 });

    expect(readOffset(firstGeometry.positioner)).toEqual({ x: 0, y: 0 });
    expect(firstGeometry.setPointerCapture).not.toHaveBeenCalled();
  });

  it('cleans up pointer cancellation and lost capture without moving again', async () => {
    const { container } = renderModal();
    const geometry = installDialogGeometry(container);

    await dragHeader(geometry.header, 17, { x: 400, y: 220 }, { x: 470, y: 260 });
    await waitFor(() => expect(readOffset(geometry.positioner)).toEqual({ x: 70, y: 40 }));
    await fireEvent.pointerCancel(geometry.header, { pointerId: 17, pointerType: 'mouse' });
    expect(geometry.backdrop.classList.contains('modal-dragging')).toBe(false);

    await fireEvent.pointerMove(geometry.header, {
      pointerId: 17,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: 600,
      clientY: 400,
    });
    expect(readOffset(geometry.positioner)).toEqual({ x: 70, y: 40 });

    await dragHeader(geometry.header, 18, { x: 400, y: 220 }, { x: 450, y: 250 });
    await fireEvent.lostPointerCapture(geometry.header, { pointerId: 18, pointerType: 'mouse' });
    expect(geometry.backdrop.classList.contains('modal-dragging')).toBe(false);
  });

  it('reclamps after viewport and dialog size changes', async () => {
    const { container } = renderModal();
    const geometry = installDialogGeometry(container);

    await dragHeader(geometry.header, 19, { x: 400, y: 220 }, { x: 500, y: 300 });
    await fireEvent.pointerUp(geometry.header, {
      pointerId: 19,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: 500,
      clientY: 300,
    });
    geometry.setViewport(420, 320);
    window.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(readOffset(geometry.positioner)).toEqual({ x: 44, y: 44 }));

    geometry.setViewport(800, 600);
    geometry.setPanelSize(760, 560);
    geometry.notifyPositionerResize();
    await waitFor(() => expect(readOffset(geometry.positioner)).toEqual({ x: 4, y: 4 }));
  });

  it('returns to the centered position every time it reopens', async () => {
    const { container, props, rerender } = renderModal();
    const geometry = installDialogGeometry(container);

    await dragHeader(geometry.header, 20, { x: 400, y: 220 }, { x: 500, y: 300 });
    await waitFor(() => expect(readOffset(geometry.positioner)).toEqual({ x: 100, y: 80 }));

    await rerender({ ...props, open: false });
    await rerender({ ...props, open: true });
    const reopenedPositioner = container.querySelector<HTMLElement>('.modal-positioner')!;
    expect(readOffset(reopenedPositioner)).toEqual({ x: 0, y: 0 });
  });
});
