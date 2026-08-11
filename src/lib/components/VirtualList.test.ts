// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/svelte';
import type { VirtualItem } from '@tanstack/svelte-virtual';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VirtualList from './VirtualList.svelte';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VirtualList large collection rendering', () => {
  it.each([634, 2_000])('keeps mounted rows bounded for a %i-item viewport', async (count) => {
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
