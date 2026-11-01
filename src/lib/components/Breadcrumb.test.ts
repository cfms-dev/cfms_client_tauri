// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Breadcrumb from './Breadcrumb.svelte';
import FileAddressBar from './FileAddressBar.svelte';

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

vi.mock('$lib/motion/transitions', () => ({ menuScale: () => ({ duration: 0 }) }));
vi.mock('svelte/transition', () => ({ fade: () => ({ duration: 0 }) }));

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  observed = new Set<Element>();
  constructor(private callback: ResizeObserverCallback) { TestResizeObserver.instances.push(this); }
  observe(target: Element) { this.observed.add(target); }
  disconnect = vi.fn(() => this.observed.clear());
  notify(target: Element) {
    if (this.observed.has(target)) this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  TestResizeObserver.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const segments = [
  { label: 'Projects', path: 'projects-id' },
  { label: 'Archive', path: 'archive-id' },
  { label: 'Games', path: 'games-id' },
  { label: 'mc', path: 'mc-id' },
];

function mockLayout(container: HTMLElement, initialWidth: number) {
  const viewport = container.querySelector<HTMLElement>('.cfms-breadcrumb-container')!;
  let width = initialWidth;
  const labelWidths: Record<string, number> = { Projects: 80, Archive: 72, Games: 64, mc: 24 };
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, get: () => width });
  const originalBounds = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!this.parentElement?.classList.contains('cfms-breadcrumb-measure')) return originalBounds.call(this);
    const itemWidth = this.matches('.cfms-breadcrumb__icon') ? 32
      : this.matches('[data-breadcrumb-separator]') ? 14
      : labelWidths[this.textContent ?? ''] ?? 400;
    return { ...originalBounds.call(this), width: itemWidth };
  });
  const originalStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = originalStyle(element, pseudo);
    if (element.matches('.cfms-breadcrumb')) Object.defineProperty(style, 'columnGap', { value: '4px' });
    return style;
  });
  return {
    labelWidths,
    resize(nextWidth: number) {
      width = nextWidth;
      for (const observer of TestResizeObserver.instances) observer.notify(viewport);
    },
  };
}

describe('Breadcrumb navigation updates', () => {
  it('removes stale path segments in the same render', async () => {
    const onNavigate = vi.fn();
    const { rerender } = render(Breadcrumb, {
      segments: [
        { label: 'Projects', path: 'projects' },
        { label: 'Archive', path: 'archive' },
      ],
      onNavigate,
    });

    expect(screen.getByText('Archive')).toBeTruthy();

    await rerender({
      segments: [{ label: 'Reports', path: 'reports' }],
      onNavigate,
    });

    expect(screen.queryByText('Archive')).toBeNull();
    expect(screen.getByText('Reports')).toBeTruthy();
  });
});

describe('Collapsing breadcrumbs', () => {
  it('leaves other breadcrumb consumers uncollapsed by default', async () => {
    const result = render(Breadcrumb, { segments, onNavigate: vi.fn() });
    const layout = mockLayout(result.container, 100);
    layout.resize(80);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(screen.getByRole('button', { name: 'Projects' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'files.hiddenPathSegments' })).toBeNull();
    expect(result.container.querySelector('.cfms-breadcrumb-measure')).toBeNull();
  });

  it('shows only root for an empty path', async () => {
    const onNavigate = vi.fn();
    const result = render(Breadcrumb, { segments: [], onNavigate, collapseOverflow: true });
    mockLayout(result.container, 100);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(screen.queryByRole('button', { name: 'files.hiddenPathSegments' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'files.goToRoot' }));
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('keeps the current directory and nearest ancestors, and restores the full path on widening', async () => {
    const result = render(Breadcrumb, { segments, onNavigate: vi.fn(), collapseOverflow: true });
    const layout = mockLayout(result.container, 300);
    const nav = screen.getByRole('navigation');
    await waitFor(() => expect(within(nav).queryByRole('button', { name: 'Archive' })).toBeNull());
    expect(within(nav).getByRole('button', { name: 'files.goToRoot' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Games' })).toBeTruthy();
    expect(within(nav).getByText('mc').getAttribute('aria-current')).toBe('page');
    expect(within(nav).queryByRole('button', { name: 'Projects' })).toBeNull();

    layout.resize(180);
    await waitFor(() => expect(within(nav).queryByRole('button', { name: 'Games' })).toBeNull());
    expect(within(nav).getByText('mc')).toBeTruthy();

    layout.resize(500);
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Projects' })).toBeTruthy());
    expect(within(nav).getByRole('button', { name: 'Archive' })).toBeTruthy();
    expect(within(nav).queryByRole('button', { name: 'files.hiddenPathSegments' })).toBeNull();
  });

  it('lists only hidden ancestors nearest-first and navigates with directory IDs', async () => {
    const onNavigate = vi.fn();
    const result = render(Breadcrumb, { segments, onNavigate, collapseOverflow: true });
    mockLayout(result.container, 300);
    const overflow = await screen.findByRole('button', { name: 'files.hiddenPathSegments' });
    expect(overflow.getAttribute('aria-haspopup')).toBe('menu');
    await fireEvent.click(overflow);
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent?.trim())).toEqual(['Archive', 'Projects']);
    expect(overflow.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(items[0]);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('archive-id');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('supports keyboard opening, arrow navigation, Escape and focus restoration', async () => {
    const result = render(Breadcrumb, { segments, onNavigate: vi.fn(), collapseOverflow: true });
    mockLayout(result.container, 300);
    const overflow = await screen.findByRole('button', { name: 'files.hiddenPathSegments' });
    await fireEvent.keyDown(overflow, { key: 'ArrowDown' });
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    await fireEvent.keyDown(items[1], { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(overflow);
    expect(overflow.getAttribute('aria-expanded')).toBe('false');
  });

  it('moves root into the menu only at extreme widths', async () => {
    const onNavigate = vi.fn();
    const result = render(Breadcrumb, { segments, onNavigate, collapseOverflow: true });
    mockLayout(result.container, 100);
    const nav = screen.getByRole('navigation');
    await waitFor(() => expect(within(nav).queryByRole('button', { name: 'files.goToRoot' })).toBeNull());
    expect(within(nav).getByText('mc')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'files.hiddenPathSegments' }));
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent?.trim())).toEqual(['Games', 'Archive', 'Projects', 'files.goToRoot']);
    await fireEvent.click(items[3]);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('keeps a long current name accessible without creating an empty ancestor menu', async () => {
    const label = 'A very long current directory name';
    const result = render(Breadcrumb, { segments: [{ label, path: 'long-id' }], onNavigate: vi.fn(), collapseOverflow: true });
    mockLayout(result.container, 150);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const current = within(screen.getByRole('navigation')).getByText(label);
    expect(current.getAttribute('title')).toBe(label);
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: 'files.hiddenPathSegments' })).toBeNull();
    expect(screen.getByRole('button', { name: 'files.goToRoot' })).toBeTruthy();
  });

  it('closes stale menus after navigation or resize and disconnects observers on unmount', async () => {
    const onNavigate = vi.fn();
    const result = render(Breadcrumb, { segments, onNavigate, collapseOverflow: true });
    const layout = mockLayout(result.container, 300);
    await fireEvent.click(await screen.findByRole('button', { name: 'files.hiddenPathSegments' }));
    expect(await screen.findByRole('menu')).toBeTruthy();
    layout.resize(500);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'files.goToRoot' })));

    layout.resize(300);
    await fireEvent.click(await screen.findByRole('button', { name: 'files.hiddenPathSegments' }));
    await screen.findByRole('menu');
    await result.rerender({ segments: [{ label: 'Reports', path: 'reports-id' }] });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Reports')).toBeTruthy();
    expect(within(nav).queryByText('mc')).toBeNull();
    expect(within(nav).queryByText('Archive')).toBeNull();

    const observers = [...TestResizeObserver.instances];
    result.unmount();
    for (const observer of observers) expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it.each([true, false])('uses the overflow menu without triggering editing (lookupEnabled=%s)', async (lookupEnabled) => {
    const onBeginEdit = vi.fn();
    const onNavigate = vi.fn();
    const result = render(FileAddressBar, {
      segments, lookupEnabled, knownPath: '/Projects/Archive/Games/mc', busy: false, error: null,
      onNavigate, onBeginEdit, onSubmit: vi.fn(), onCancel: vi.fn(),
    });
    mockLayout(result.container, 300);
    const overflow = await screen.findByRole('button', { name: 'files.hiddenPathSegments' });
    await fireEvent.pointerUp(overflow);
    await fireEvent.click(overflow);
    const menu = await screen.findByRole('menu');
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Archive' }));
    expect(onNavigate).toHaveBeenCalledWith('archive-id');
    expect(onBeginEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('removes an open ancestor menu when entering edit mode', async () => {
    const result = render(FileAddressBar, {
      segments, lookupEnabled: true, knownPath: '/Projects/Archive/Games/mc', busy: false, error: null,
      onNavigate: vi.fn(), onBeginEdit: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn(),
    });
    mockLayout(result.container, 300);
    await fireEvent.click(await screen.findByRole('button', { name: 'files.hiddenPathSegments' }));
    await screen.findByRole('menu');
    await result.component.beginEdit();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });
});
