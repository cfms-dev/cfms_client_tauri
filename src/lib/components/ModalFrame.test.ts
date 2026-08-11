// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ModalFrame from './ModalFrame.svelte';
import '$lib/i18n';

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
      finished: Promise.resolve(),
      onfinish: null as (() => void) | null,
      playState: 'finished',
    };
    queueMicrotask(() => animation.onfinish?.());
    return animation;
  },
});

beforeEach(() => {
  locale.set('en');
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.reduceMotion;
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
  resizable?: boolean;
  maximizable?: boolean;
  minWidth?: number;
  minHeight?: number;
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
  let visualRect: DOMRect | null = null;

  backdrop.style.padding = '16px';
  Object.defineProperty(backdrop, 'getBoundingClientRect', {
    configurable: true,
    value: () => makeRect(0, 0, viewportWidth, viewportHeight),
  });
  Object.defineProperty(positioner, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      if (visualRect) return visualRect;
      if (positioner.classList.contains('modal-positioner--maximized')) {
        return makeRect(0, 0, viewportWidth, viewportHeight);
      }
      const offset = readOffset(positioner);
      const styledWidth = Number.parseFloat(positioner.style.width);
      const styledHeight = Number.parseFloat(positioner.style.height);
      const width = Number.isFinite(styledWidth) ? styledWidth : panelWidth;
      const height = Number.isFinite(styledHeight) ? styledHeight : panelHeight;
      return makeRect(
        (viewportWidth - width) / 2 + offset.x,
        (viewportHeight - height) / 2 + offset.y,
        width,
        height,
      );
    },
  });
  Object.defineProperties(header, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });
  for (const handle of container.querySelectorAll<HTMLElement>('.modal-resize-handle')) {
    Object.defineProperties(handle, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
    });
  }

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
    setVisualRect(rect: DOMRect | null) {
      visualRect = rect;
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

async function resizeFrom(
  container: HTMLElement,
  edge: string,
  pointerId: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pointerType = 'mouse',
) {
  const handle = container.querySelector<HTMLElement>(`[data-resize-edge="${edge}"]`)!;
  await fireEvent.pointerDown(handle, {
    pointerId,
    pointerType,
    button: 0,
    isPrimary: true,
    clientX: from.x,
    clientY: from.y,
  });
  await fireEvent.pointerMove(handle, {
    pointerId,
    pointerType,
    isPrimary: true,
    clientX: to.x,
    clientY: to.y,
  });
  await fireEvent.pointerUp(handle, {
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

  it('keeps fixed dialogs free of resize and maximize controls', () => {
    const { container } = renderModal();

    expect(container.querySelectorAll('.modal-resize-handle')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Maximize dialog' })).toBeNull();
  });

  it('renders eight resize directions and an accessible maximize action on desktop', async () => {
    const { container } = renderModal({ resizable: true, maximizable: true });

    await waitFor(() => expect(container.querySelectorAll('.modal-resize-handle')).toHaveLength(8));
    expect(Array.from(container.querySelectorAll<HTMLElement>('.modal-resize-handle')).map((handle) => handle.dataset.resizeEdge))
      .toEqual(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
    expect(screen.getByRole('button', { name: 'Maximize dialog' }).getAttribute('aria-pressed')).toBe('false');
  });

  it.each([
    ['e', { x: 550, y: 300 }, { x: 650, y: 300 }, makeRect(250, 200, 400, 200)],
    ['w', { x: 250, y: 300 }, { x: 150, y: 300 }, makeRect(150, 200, 400, 200)],
    ['n', { x: 400, y: 200 }, { x: 400, y: 120 }, makeRect(250, 120, 300, 280)],
    ['s', { x: 400, y: 400 }, { x: 400, y: 480 }, makeRect(250, 200, 300, 280)],
    ['ne', { x: 550, y: 200 }, { x: 650, y: 120 }, makeRect(250, 120, 400, 280)],
    ['se', { x: 550, y: 400 }, { x: 650, y: 480 }, makeRect(250, 200, 400, 280)],
    ['sw', { x: 250, y: 400 }, { x: 150, y: 480 }, makeRect(150, 200, 400, 280)],
    ['nw', { x: 250, y: 200 }, { x: 150, y: 120 }, makeRect(150, 120, 400, 280)],
  ])('resizes from the %s handle while keeping the opposite edges anchored', async (edge, from, to, expected) => {
    const { container } = renderModal({ resizable: true, minWidth: 240, minHeight: 160 });
    const geometry = installDialogGeometry(container);

    await resizeFrom(container, edge as string, 30, from as { x: number; y: number }, to as { x: number; y: number });

    const rect = geometry.positioner.getBoundingClientRect();
    expect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }).toEqual({
      left: expected.left,
      top: expected.top,
      width: expected.width,
      height: expected.height,
    });
  });

  it('enforces configured minimum size and safe viewport edges while resizing', async () => {
    const { container } = renderModal({ resizable: true, minWidth: 260, minHeight: 170 });
    const geometry = installDialogGeometry(container);

    await resizeFrom(container, 'se', 31, { x: 550, y: 400 }, { x: -1000, y: -1000 });
    let rect = geometry.positioner.getBoundingClientRect();
    expect({ width: rect.width, height: rect.height }).toEqual({ width: 260, height: 170 });

    await resizeFrom(container, 'se', 32, { x: rect.right, y: rect.bottom }, { x: 2000, y: 2000 });
    rect = geometry.positioner.getBoundingClientRect();
    expect(rect.right).toBe(784);
    expect(rect.bottom).toBe(584);
  });

  it('allows pen resizing, ignores touch resizing, and only resizes the topmost dialog', async () => {
    const first = renderModal({ resizable: true, minWidth: 240, minHeight: 160 });
    const firstGeometry = installDialogGeometry(first.container);
    const second = renderModal({ resizable: true, minWidth: 240, minHeight: 160 });
    const secondGeometry = installDialogGeometry(second.container);

    await resizeFrom(first.container, 'se', 37, { x: 550, y: 400 }, { x: 650, y: 480 });
    expect(firstGeometry.positioner.getBoundingClientRect().width).toBe(300);

    await resizeFrom(second.container, 'se', 38, { x: 550, y: 400 }, { x: 650, y: 480 }, 'touch');
    expect(secondGeometry.positioner.getBoundingClientRect().width).toBe(300);

    await resizeFrom(second.container, 'se', 39, { x: 550, y: 400 }, { x: 650, y: 480 }, 'pen');
    expect(secondGeometry.positioner.getBoundingClientRect().width).toBe(400);
  });

  it('maximizes, restores, and toggles from a title-bar double click', async () => {
    const { container } = renderModal({ resizable: true, maximizable: true });
    const geometry = installDialogGeometry(container);

    await fireEvent.click(await screen.findByRole('button', { name: 'Maximize dialog' }));
    await waitFor(() => expect(geometry.positioner.classList.contains('modal-positioner--maximized')).toBe(true));
    expect(screen.getByRole('button', { name: 'Restore dialog' }).getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('.modal-resize-handle')).toHaveLength(0);

    await fireEvent.click(screen.getByRole('button', { name: 'Restore dialog' }));
    await waitFor(() => expect(geometry.positioner.classList.contains('modal-positioner--maximized')).toBe(false));
    let rect = geometry.positioner.getBoundingClientRect();
    expect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      .toEqual({ left: 250, top: 200, width: 300, height: 200 });

    await fireEvent.dblClick(geometry.header);
    await waitFor(() => expect(geometry.positioner.classList.contains('modal-positioner--maximized')).toBe(true));
    await fireEvent.dblClick(geometry.header);
    await waitFor(() => expect(geometry.positioner.classList.contains('modal-positioner--maximized')).toBe(false));
    rect = geometry.positioner.getBoundingClientRect();
    expect({ width: rect.width, height: rect.height }).toEqual({ width: 300, height: 200 });
  });

  it('restores the pre-maximize size after the viewport changes while maximized', async () => {
    const { container } = renderModal({ resizable: true, maximizable: true });
    const geometry = installDialogGeometry(container);
    await resizeFrom(container, 'se', 40, { x: 550, y: 400 }, { x: 700, y: 520 });
    expect(geometry.positioner.getBoundingClientRect()).toMatchObject({ width: 450, height: 320 });

    await fireEvent.click(await screen.findByRole('button', { name: 'Maximize dialog' }));
    geometry.setViewport(420, 320);
    window.dispatchEvent(new Event('resize'));
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    geometry.setViewport(800, 600);
    await fireEvent.click(screen.getByRole('button', { name: 'Restore dialog' }));

    await waitFor(() => expect(geometry.positioner.classList.contains('modal-positioner--maximized')).toBe(false));
    expect(geometry.positioner.getBoundingClientRect()).toMatchObject({ width: 450, height: 320 });
  });

  it('does not let resize observation overwrite button restore geometry during animation', async () => {
    const { container } = renderModal({ resizable: true, maximizable: true });
    const geometry = installDialogGeometry(container);
    const animationResolvers: Array<() => void> = [];
    Object.defineProperty(geometry.positioner, 'animate', {
      configurable: true,
      value: vi.fn(() => {
        let resolveFinished = () => {};
        const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
        animationResolvers.push(resolveFinished);
        return { cancel: vi.fn(), finished } as unknown as Animation;
      }),
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Maximize dialog' }));
    await waitFor(() => expect(animationResolvers).toHaveLength(1));
    animationResolvers.shift()?.();
    await waitFor(() => expect(geometry.positioner.classList.contains('modal-positioner--maximized')).toBe(true));

    await fireEvent.click(screen.getByRole('button', { name: 'Restore dialog' }));
    await waitFor(() => expect(animationResolvers).toHaveLength(1));
    geometry.setVisualRect(makeRect(0, 0, 800, 600));
    geometry.notifyPositionerResize();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    geometry.setVisualRect(null);
    animationResolvers.shift()?.();

    await waitFor(() => expect(geometry.positioner.getBoundingClientRect()).toMatchObject({
      left: 250,
      top: 200,
      width: 300,
      height: 200,
    }));
  });

  it('restores a maximized dialog under the pointer and continues dragging', async () => {
    const { container } = renderModal({ resizable: true, maximizable: true });
    const geometry = installDialogGeometry(container);
    await fireEvent.click(await screen.findByRole('button', { name: 'Maximize dialog' }));

    await dragHeader(geometry.header, 33, { x: 600, y: 20 }, { x: 500, y: 120 });
    await waitFor(() => expect(geometry.positioner.classList.contains('modal-positioner--maximized')).toBe(false));
    const rect = geometry.positioner.getBoundingClientRect();
    expect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      .toEqual({ left: 275, top: 100, width: 300, height: 200 });
  });

  it('disables resizing and maximize controls on mobile platforms', async () => {
    platformMocks.isMobilePlatform.mockReturnValue(true);
    const { container } = renderModal({ resizable: true, maximizable: true });
    await Promise.resolve();

    expect(container.querySelectorAll('.modal-resize-handle')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Maximize dialog' })).toBeNull();
  });

  it('cleans up resize cancellation and lost pointer capture', async () => {
    const { container } = renderModal({ resizable: true, minWidth: 240, minHeight: 160 });
    const geometry = installDialogGeometry(container);
    const handle = container.querySelector<HTMLElement>('[data-resize-edge="se"]')!;

    await fireEvent.pointerDown(handle, {
      pointerId: 34,
      pointerType: 'mouse',
      button: 0,
      isPrimary: true,
      clientX: 550,
      clientY: 400,
    });
    await fireEvent.pointerMove(handle, {
      pointerId: 34,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: 650,
      clientY: 480,
    });
    await waitFor(() => expect(geometry.positioner.getBoundingClientRect().width).toBe(400));
    await fireEvent.pointerCancel(handle, { pointerId: 34, pointerType: 'mouse' });
    expect(geometry.backdrop.classList.contains('modal-resizing')).toBe(false);

    await fireEvent.pointerDown(handle, {
      pointerId: 35,
      pointerType: 'mouse',
      button: 0,
      isPrimary: true,
      clientX: 650,
      clientY: 480,
    });
    await fireEvent.lostPointerCapture(handle, { pointerId: 35, pointerType: 'mouse' });
    expect(geometry.backdrop.classList.contains('modal-resizing')).toBe(false);
  });

  it('skips maximize geometry animation when reduced motion is enabled', async () => {
    document.documentElement.dataset.reduceMotion = 'true';
    const { container } = renderModal({ resizable: true, maximizable: true });
    const geometry = installDialogGeometry(container);
    const animate = vi.fn();
    Object.defineProperty(geometry.positioner, 'animate', { configurable: true, value: animate });

    await fireEvent.click(await screen.findByRole('button', { name: 'Maximize dialog' }));
    expect(animate).not.toHaveBeenCalled();
  });

  it('clears resized and maximized state whenever the dialog reopens', async () => {
    const { container, props, rerender } = renderModal({ resizable: true, maximizable: true });
    const geometry = installDialogGeometry(container);
    await resizeFrom(container, 'se', 36, { x: 550, y: 400 }, { x: 650, y: 480 });
    await fireEvent.click(await screen.findByRole('button', { name: 'Maximize dialog' }));

    await rerender({ ...props, resizable: true, maximizable: true, open: false });
    await rerender({ ...props, resizable: true, maximizable: true, open: true });
    const reopenedPositioner = container.querySelector<HTMLElement>('.modal-positioner')!;
    expect(reopenedPositioner.classList.contains('modal-positioner--maximized')).toBe(false);
    expect(reopenedPositioner.style.width).toBe('');
    expect(reopenedPositioner.style.height).toBe('');
    expect(readOffset(reopenedPositioner)).toEqual({ x: 0, y: 0 });
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
