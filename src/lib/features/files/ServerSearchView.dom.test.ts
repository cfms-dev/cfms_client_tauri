// @vitest-environment jsdom
import '$lib/shared/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchFilesResponse } from '$lib/api';
import ServerSearchView from './ServerSearchView.svelte';

beforeEach(() => {
  locale.set('en');
  document.documentElement.dataset.reduceMotion = 'true';
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.reduceMotion;
});

function baseProps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    query: 'Project Bell',
    resultQuery: 'Project Bell',
    filter: 'all' as const,
    sortBy: 'name' as const,
    sortOrder: 'asc' as const,
    loading: false,
    results: null as SearchFilesResponse | null,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    onFilterChange: vi.fn(),
    onSelectSort: vi.fn(),
    onSelectParentDirectory: vi.fn(),
    onSelectDirectory: vi.fn(),
    onSelectDocument: vi.fn(),
    ...overrides,
  };
}

describe('ServerSearchView', () => {
  it('shows Dismiss whenever text exists, and shows Arrow Right only while focused', async () => {
    const onSubmit = vi.fn();
    const { container } = render(ServerSearchView, { props: baseProps({ query: 'alpha', onSubmit }) });

    const input = screen.getByRole('textbox') as HTMLInputElement;
    // Unfocused with text: X visible, Arrow Right hidden
    expect(container.querySelector('[data-search-clear]')).not.toBeNull();
    expect(container.querySelector('[data-search-submit]')).toBeNull();

    // Focus search box: both X and Arrow Right visible
    await fireEvent.focusIn(input);
    const submitBtn = container.querySelector<HTMLButtonElement>('[data-search-submit]')!;
    expect(submitBtn).not.toBeNull();
    expect(submitBtn.disabled).toBe(false);

    // Clicking Arrow Right submits without losing focus first
    await fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledOnce();

    // Clearing text while focused hides X and keeps Arrow Right visible but disabled
    await fireEvent.click(container.querySelector<HTMLButtonElement>('[data-search-clear]')!);
    expect(input.value).toBe('');
    expect(container.querySelector('[data-search-clear]')).toBeNull();
    const disabledSubmit = container.querySelector<HTMLButtonElement>('[data-search-submit]')!;
    expect(disabledSubmit).not.toBeNull();
    expect(disabledSubmit.disabled).toBe(true);

    // Blurring hides Arrow Right
    await fireEvent.focusOut(input, { relatedTarget: document.body });
    expect(container.querySelector('[data-search-submit]')).toBeNull();
  });

  it('switches filter tabs and renders sort arrow icon only on active sort field', async () => {
    const onFilterChange = vi.fn();
    const onSelectSort = vi.fn();
    const { container, rerender } = render(ServerSearchView, {
      props: baseProps({ onFilterChange, onSelectSort }),
    });

    const docsTab = screen.getByRole('tab', { name: 'Documents' });
    await fireEvent.click(docsTab);
    expect(onFilterChange).toHaveBeenCalledWith('documents');

    const nameSort = container.querySelector<HTMLButtonElement>('[data-search-sort="name"]')!;
    const sizeSort = container.querySelector<HTMLButtonElement>('[data-search-sort="size"]')!;
    expect(nameSort.querySelector('[data-icon="arrowSortUp"]')).not.toBeNull();
    expect(sizeSort.querySelector('[data-icon]')).toBeNull();

    await fireEvent.click(nameSort);
    expect(onSelectSort).toHaveBeenCalledWith('name');

    await rerender(baseProps({ sortBy: 'size', sortOrder: 'desc', onFilterChange, onSelectSort }));
    expect(container.querySelector('[data-search-sort="name"] [data-icon]')).toBeNull();
    expect(container.querySelector('[data-search-sort="size"] [data-icon="arrowSortDown"]')).not.toBeNull();
  });

  it('merges consecutive parent_id headings, preserves order, and opens parent directory on heading click', async () => {
    const onSelectParentDirectory = vi.fn();
    const onSelectDocument = vi.fn();
    const results: SearchFilesResponse = {
      items: [
        { type: 'document', id: 'doc-1', title: 'Hello World', parent_id: 'd44bf0d2', size: 365_803, last_modified: 1_795_586_521 },
        { type: 'document', id: 'doc-2', title: 'Who am I', parent_id: 'd44bf0d2', size: 215, last_modified: 1_796_407_219 },
        { type: 'document', id: 'doc-3', title: 'main.c', parent_id: 'bf96e54a', size: 1229, last_modified: 1_795_586_521 },
        { type: 'document', id: 'doc-4', title: 'tail.md', parent_id: 'd44bf0d2', size: 400, last_modified: 1_795_586_521 },
      ],
      total_count: 4,
      page_size: 128,
      next_cursor: null,
      has_more: false,
    };

    const { container } = render(ServerSearchView, {
      props: baseProps({ results, onSelectParentDirectory, onSelectDocument }),
    });

    const headers = [...container.querySelectorAll<HTMLButtonElement>('[data-search-group-header]')];
    expect(headers.map((el) => el.dataset.searchGroupHeader)).toEqual([
      'd44bf0d2',
      'bf96e54a',
      'd44bf0d2',
    ]);

    await fireEvent.click(headers[0]);
    expect(onSelectParentDirectory).toHaveBeenCalledWith('d44bf0d2');

    await fireEvent.click(screen.getByText('Hello World'));
    expect(onSelectDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }));
  });

  it('updates dynamic result count during batch streaming and invokes onClose on back or Escape', async () => {
    const onClose = vi.fn();
    const firstBatch: SearchFilesResponse = {
      items: [{ type: 'document', id: 'doc-1', title: 'Alpha', parent_id: null, size: 10 }],
      total_count: 128,
      page_size: 128,
      next_cursor: 'c2',
      has_more: true,
    };
    const finalBatch: SearchFilesResponse = {
      items: [
        { type: 'document', id: 'doc-1', title: 'Alpha', parent_id: null, size: 10 },
        { type: 'document', id: 'doc-2', title: 'Beta', parent_id: null, size: 20 },
      ],
      total_count: 10_572,
      page_size: 128,
      next_cursor: null,
      has_more: false,
    };

    const { container, rerender } = render(ServerSearchView, {
      props: baseProps({ loading: true, results: firstBatch, onClose }),
    });

    expect(container.querySelector('[data-search-count]')?.textContent).toContain('128 results');
    expect(container.querySelector('.search-view-streaming')).not.toBeNull();
    expect(container.querySelector('[data-search-group-header]')?.getAttribute('data-search-group-header')).toBe('/');

    await rerender(baseProps({ loading: false, results: finalBatch, onClose }));
    expect(container.querySelector('[data-search-count]')?.textContent).toContain('10,572 results');
    expect(container.querySelector('.search-view-streaming')).toBeNull();

    await fireEvent.click(container.querySelector<HTMLButtonElement>('[data-search-back]')!);
    expect(onClose).toHaveBeenCalledTimes(1);

    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
