import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchFilesResponse } from '$lib/api';

const mocks = vi.hoisted(() => ({
  searchFiles: vi.fn(),
  getDirectoryInfo: vi.fn(),
}));

vi.mock('$lib/api', async (original) => ({
  ...(await original<typeof import('$lib/api')>()),
  searchFiles: mocks.searchFiles,
  getDirectoryInfo: mocks.getDirectoryInfo,
}));

import {
  createServerSearchController,
  searchFlagsFromFilter,
} from './server-search-controller.svelte.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('server-search-controller', () => {
  beforeEach(() => {
    mocks.searchFiles.mockReset();
    mocks.getDirectoryInfo.mockReset();
  });

  it('maps type filter tabs to search API boolean flags', () => {
    expect(searchFlagsFromFilter('all')).toEqual({ searchDocuments: true, searchDirectories: true });
    expect(searchFlagsFromFilter('documents')).toEqual({ searchDocuments: true, searchDirectories: false });
    expect(searchFlagsFromFilter('directories')).toEqual({ searchDocuments: false, searchDirectories: true });
  });

  it('accumulates paginated batches dynamically until has_more becomes false', async () => {
    const page1 = deferred<SearchFilesResponse>();
    const page2 = deferred<SearchFilesResponse>();
    mocks.searchFiles
      .mockReturnValueOnce(page1.promise)
      .mockReturnValueOnce(page2.promise);

    const controller = createServerSearchController({ canSearch: () => true });
    controller.openSearch({ query: 'plan', runImmediately: false });

    const runPromise = controller.runSearch();
    expect(controller.loading).toBe(true);
    expect(controller.results).toBeNull();

    page1.resolve({
      items: [{ type: 'document', id: 'doc-1', title: 'A', parent_id: 'dir-a' }],
      total_count: 1,
      page_size: 128,
      next_cursor: 'cursor-2',
      has_more: true,
    });
    await vi.waitFor(() => expect(controller.results?.total_count).toBe(1));
    expect(controller.loading).toBe(true);

    page2.resolve({
      items: [{ type: 'document', id: 'doc-2', title: 'B', parent_id: 'dir-a' }],
      total_count: 1,
      page_size: 128,
      next_cursor: null,
      has_more: false,
    });
    await runPromise;

    expect(controller.loading).toBe(false);
    expect(controller.results?.total_count).toBe(2);
    expect(controller.results?.items.map((item) => item.id)).toEqual(['doc-1', 'doc-2']);
  });

  it('cancels in-flight batches when switching filter tabs or toggling sort', async () => {
    const stalePage = deferred<SearchFilesResponse>();
    const freshPage = deferred<SearchFilesResponse>();
    mocks.searchFiles
      .mockReturnValueOnce(stalePage.promise)
      .mockReturnValueOnce(freshPage.promise);

    const controller = createServerSearchController({ canSearch: () => true });
    controller.openSearch({ query: 'report', runImmediately: true });

    await vi.waitFor(() => expect(mocks.searchFiles).toHaveBeenCalledTimes(1));

    controller.setFilter('documents');
    await vi.waitFor(() => expect(mocks.searchFiles).toHaveBeenCalledTimes(2));
    expect(mocks.searchFiles).toHaveBeenLastCalledWith('report', expect.objectContaining({
      searchDocuments: true,
      searchDirectories: false,
    }));

    stalePage.resolve({
      items: [{ type: 'directory', id: 'stale-dir', name: 'Old', created_time: null }],
      total_count: 1,
      page_size: 128,
      next_cursor: null,
      has_more: false,
    });
    freshPage.resolve({
      items: [{ type: 'document', id: 'fresh-doc', title: 'Fresh' }],
      total_count: 1,
      page_size: 128,
      next_cursor: null,
      has_more: false,
    });

    await vi.waitFor(() => expect(controller.loading).toBe(false));
    expect(controller.results?.items.map((item) => item.id)).toEqual(['fresh-doc']);
  });

  it('toggles sort order when clicking active field and resets to asc on new field', async () => {
    mocks.searchFiles.mockResolvedValue({
      items: [],
      total_count: 0,
      page_size: 128,
      next_cursor: null,
      has_more: false,
    });

    const controller = createServerSearchController({ canSearch: () => true });
    controller.openSearch({ query: 'notes', runImmediately: false });

    controller.selectSort('name');
    expect(controller.sortBy).toBe('name');
    expect(controller.sortOrder).toBe('desc');

    controller.selectSort('modified');
    expect(controller.sortBy).toBe('modified');
    expect(controller.sortOrder).toBe('asc');

    await vi.waitFor(() =>
      expect(mocks.searchFiles).toHaveBeenLastCalledWith('notes', expect.objectContaining({
        sortBy: 'last_modified',
        sortOrder: 'asc',
      })),
    );
  });

  it('closes search and invokes onPermissionDenied on 403 error', async () => {
    mocks.searchFiles.mockRejectedValueOnce(new Error('Server returned 403: Forbidden'));
    const onPermissionDenied = vi.fn();

    const controller = createServerSearchController({
      canSearch: () => true,
      onPermissionDenied,
    });
    controller.openSearch({ query: 'secret', runImmediately: true });

    await vi.waitFor(() => expect(onPermissionDenied).toHaveBeenCalledOnce());
    expect(controller.open).toBe(false);
    expect(controller.loading).toBe(false);
  });

  it('retains resolved parent directory names across filter/sort changes and resets them when search closes', async () => {
    vi.useFakeTimers();
    try {
      mocks.searchFiles.mockResolvedValue({
        items: [{ type: 'document', id: 'doc-1', title: 'Spec', parent_id: 'dir-spec' }],
        total_count: 1,
        page_size: 128,
        next_cursor: null,
        has_more: false,
      });
      mocks.getDirectoryInfo.mockResolvedValue({
        directory_id: 'dir-spec',
        name: 'Specifications',
      });

      const controller = createServerSearchController({ canSearch: () => true });
      controller.openSearch({ query: 'Spec', runImmediately: true });
      await vi.waitFor(() => expect(controller.results?.total_count).toBe(1));

      const release = controller.observeParentDirectory('dir-spec');
      await vi.advanceTimersByTimeAsync(250);
      await vi.waitFor(() =>
        expect(controller.parentDirectoryResolutions['dir-spec']).toEqual({
          status: 'resolved',
          name: 'Specifications',
          revealed: false,
        }),
      );

      controller.setFilter('documents');
      await vi.waitFor(() => expect(mocks.searchFiles).toHaveBeenCalledTimes(2));
      expect(controller.parentDirectoryResolutions['dir-spec']).toEqual({
        status: 'resolved',
        name: 'Specifications',
        revealed: false,
      });

      release();
      controller.closeSearch();
      expect(controller.parentDirectoryResolutions).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });
});
