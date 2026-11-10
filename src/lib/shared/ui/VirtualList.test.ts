// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { VirtualItem } from '@tanstack/svelte-virtual';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VirtualList from '$lib/shared/ui/VirtualList.svelte';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VirtualList large collection rendering', () => {
  it('focuses the last row after an asynchronous virtualized End jump', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(960);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(8000);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('virtual-list-viewport') ? 480 : 40;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(960);
    const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        // Browsers deliver scroll events after the key handler's Svelte tick.
        setTimeout(() => {
          this.scrollTop = options.top ?? 0;
          this.dispatchEvent(new Event('scroll'));
        }, 0);
      },
    });
    try {
      const children = createRawSnippet<[unknown, number, VirtualItem | null]>((item) => ({
        render: () => '<button type="button"></button>',
        setup: (element) => { element.textContent = `Result ${item()}`; },
      }));
      const { container } = render(VirtualList, {
        items: Array.from({ length: 200 }, (_, index) => index),
        keyOf: (item: unknown) => Number(item),
        estimateSize: 40,
        keyboardNavigation: true,
        children,
      });
      await waitFor(() => expect(container.querySelector('button')).toBeTruthy());
      const first = container.querySelector('button')!;
      first.focus();
      await fireEvent.keyDown(first, { key: 'End' });
      await waitFor(() => expect(document.activeElement?.textContent).toBe('Result 199'));
      expect(document.activeElement?.getAttribute('tabindex')).toBe('0');
      await fireEvent.keyDown(document.activeElement!, { key: 'Home' });
      await waitFor(() => expect(document.activeElement?.textContent).toBe('Result 0'));
    } finally {
      if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollDescriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    }
  });

  it.each([634, 2_000])('keeps mounted rows bounded for a %i-item viewport', async (count) => {
    // TanStack measures the viewport's client box, which jsdom leaves at zero.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(960);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('virtual-list-viewport') ? 480 : 64;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(960);

    const children = createRawSnippet<[unknown, number, VirtualItem | null]>((item) => ({
      render: () => '<button type="button" data-virtual-test-row></button>',
      setup: (element) => {
        element.textContent = `Task ${item()}`;
      },
    }));
    const items = Array.from({ length: count }, (_, index) => index);
    const { container } = render(VirtualList, {
      props: {
        items,
        keyOf: (item: unknown) => Number(item),
        estimateSize: 64,
        threshold: 32,
        overscan: 8,
        initialHeight: 480,
        children,
      },
    });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-virtual-test-row]').length).toBeGreaterThan(0);
    });
    expect(container.querySelectorAll('[data-virtual-test-row]').length).toBeLessThanOrEqual(40);
    expect(container.querySelectorAll('[role="listitem"]').length).toBeLessThan(items.length);
  });
});
