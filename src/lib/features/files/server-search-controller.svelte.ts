import { searchFiles, type SearchFilesResponse } from '$lib/api';
import { serverErrorStatus } from '$lib/api/server-errors';
import { mergeSearchResponses } from './search-grouping';
import {
  createSearchParentDirectoryResolver,
  type ParentDirectoryResolution,
} from './search-parent-directory-resolver.svelte.ts';
import type { SortDirection, SortField } from './sorting';

export type SearchTypeFilter = 'all' | 'documents' | 'directories';

export const SERVER_SEARCH_PAGE_SIZE = 128;

export function searchFlagsFromFilter(filter: SearchTypeFilter): {
  searchDocuments: boolean;
  searchDirectories: boolean;
} {
  return {
    searchDocuments: filter !== 'directories',
    searchDirectories: filter !== 'documents',
  };
}

function searchSortByParam(field: SortField): string {
  return field === 'modified' ? 'last_modified' : field;
}

export interface OpenServerSearchOptions {
  query?: string;
  filter?: SearchTypeFilter;
  sortBy?: SortField;
  sortOrder?: SortDirection;
  runImmediately?: boolean;
}

export interface ServerSearchControllerOptions {
  canSearch: () => boolean;
  pageSize?: number;
  onEmptyQuery?: () => void;
  onError?: (error: unknown) => void;
  onPermissionDenied?: () => void;
}

export function createServerSearchController(options: ServerSearchControllerOptions) {
  const pageSize = options.pageSize ?? SERVER_SEARCH_PAGE_SIZE;
  const parentDirectoryResolver = createSearchParentDirectoryResolver();

  let open = $state(false);
  let query = $state('');
  let resultQuery = $state('');
  let filter = $state<SearchTypeFilter>('all');
  let sortBy = $state<SortField>('name');
  let sortOrder = $state<SortDirection>('asc');
  let loading = $state(false);
  let results = $state<SearchFilesResponse | null>(null);
  let runId = 0;

  function emptyResults(): SearchFilesResponse {
    return {
      items: [],
      total_count: 0,
      page_size: pageSize,
      next_cursor: null,
      has_more: false,
    };
  }

  function openSearch(openOptions: OpenServerSearchOptions = {}) {
    if (!options.canSearch()) return;
    const nextQuery = openOptions.query ?? '';
    runId += 1;
    parentDirectoryResolver.reset();
    open = true;
    query = nextQuery;
    resultQuery = '';
    filter = openOptions.filter ?? 'all';
    sortBy = openOptions.sortBy ?? 'name';
    sortOrder = openOptions.sortOrder ?? 'asc';
    loading = false;
    results = null;

    if (openOptions.runImmediately && nextQuery.trim()) {
      void runSearch();
    }
  }

  function closeSearch() {
    runId += 1;
    parentDirectoryResolver.reset();
    open = false;
    loading = false;
  }

  function cancel() {
    runId += 1;
    parentDirectoryResolver.cancelPending();
    loading = false;
  }

  function setFilter(nextFilter: SearchTypeFilter) {
    if (filter === nextFilter) return;
    filter = nextFilter;
    if (query.trim()) {
      void runSearch();
    }
  }

  function selectSort(field: SortField) {
    if (sortBy === field) {
      sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = field;
      sortOrder = 'asc';
    }
    if (query.trim()) {
      void runSearch();
    }
  }

  async function runSearch() {
    if (!options.canSearch()) return;
    const trimmed = query.trim();
    if (!trimmed) {
      options.onEmptyQuery?.();
      return;
    }

    const activeRunId = ++runId;
    parentDirectoryResolver.cancelPending();
    const { searchDocuments, searchDirectories } = searchFlagsFromFilter(filter);
    const sortParam = searchSortByParam(sortBy);
    const activeSortOrder = sortOrder;
    let cursor: string | null = null;
    let combined = emptyResults();

    resultQuery = trimmed;
    loading = true;
    results = null;

    try {
      while (true) {
        const page = await searchFiles(trimmed, {
          pageSize,
          cursor,
          sortBy: sortParam,
          sortOrder: activeSortOrder,
          searchDocuments,
          searchDirectories,
        });
        if (activeRunId !== runId) return;

        combined = mergeSearchResponses(combined, page);
        results = combined;
        loading = page.has_more;

        if (!page.has_more) break;
        cursor = page.next_cursor;
        if (!cursor) {
          throw new Error('Server reported more search results without a cursor.');
        }
      }

      if (activeRunId !== runId) return;
      loading = false;
      results = combined;
    } catch (error) {
      if (activeRunId !== runId) return;
      loading = false;
      if (serverErrorStatus(error) === 403) {
        closeSearch();
        options.onPermissionDenied?.();
        return;
      }
      options.onError?.(error);
    }
  }

  return {
    get open() { return open; },
    set open(value: boolean) { open = value; },
    get query() { return query; },
    set query(value: string) { query = value; },
    get resultQuery() { return resultQuery; },
    get filter() { return filter; },
    get sortBy() { return sortBy; },
    get sortOrder() { return sortOrder; },
    get loading() { return loading; },
    get results() { return results; },
    get parentDirectoryResolutions(): Readonly<Record<string, ParentDirectoryResolution>> {
      return parentDirectoryResolver.resolutions;
    },
    observeParentDirectory: parentDirectoryResolver.observe,
    markParentDirectoryRevealed: parentDirectoryResolver.markRevealed,
    openSearch,
    closeSearch,
    cancel,
    setFilter,
    selectSort,
    runSearch,
  };
}
