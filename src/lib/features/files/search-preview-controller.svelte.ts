import { searchFiles, type SearchFilesResponse } from '#lib/api.ts';
import { serverErrorStatus } from '#lib/api/server-errors.ts';
import { mergeSearchResponses } from '#lib/features/files/search-grouping.ts';
import { formatUserFacingError } from '#lib/shared/errors/user-facing-errors.ts';

export interface SearchPreviewState {
  query: string;
  loading: boolean;
  loadingMore: boolean;
  results: SearchFilesResponse | null;
  error: string | null;
}

export interface SearchPreviewControllerOptions {
  isEnabled: () => boolean;
  getQuery: () => string;
  onDisabled?: () => void;
  onPermissionDenied?: () => void;
  pageSize?: number;
  debounceMs?: number;
  scrollThreshold?: number;
}

export function createSearchPreviewController({
  isEnabled,
  getQuery,
  onDisabled,
  onPermissionDenied,
  pageSize = 24,
  debounceMs = 120,
  scrollThreshold = 72,
}: SearchPreviewControllerOptions) {
  let runId = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let state = $state<SearchPreviewState>({
    query: '',
    loading: false,
    loadingMore: false,
    results: null,
    error: null,
  });

  function clearDebounce() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function stopLoading() {
    clearDebounce();
    runId += 1;
    state.loading = false;
    state.loadingMore = false;
  }

  function resetResults(clearLoading = false) {
    runId += 1;
    state.query = '';
    state.results = null;
    state.error = null;
    state.loadingMore = false;
    if (clearLoading) {
      state.loading = false;
    }
  }

  function resetAll() {
    clearDebounce();
    runId += 1;
    state = {
      ...state,
      loading: false,
      loadingMore: false,
      results: null,
      error: null,
    };
  }

  async function loadPage({
    cursor,
    reset,
    activeRunId,
  }: {
    cursor: string | null;
    reset: boolean;
    activeRunId: number;
  }) {
    if (!isEnabled()) return;
    const trimmed = getQuery().trim();
    if (!trimmed) {
      state.loading = false;
      state.loadingMore = false;
      return;
    }

    if (reset) {
      state.loading = true;
      state.loadingMore = false;
    } else {
      state.loadingMore = true;
    }

    try {
      const page = await searchFiles(trimmed, {
        pageSize,
        cursor,
        sortBy: 'name',
        sortOrder: 'asc',
        searchDocuments: true,
        searchDirectories: true,
      });
      if (activeRunId !== runId) return;

      state.query = trimmed;
      state.results = reset || !state.results
        ? page
        : mergeSearchResponses(state.results, page);
      state.loading = false;
      state.loadingMore = false;
      state.error = null;
    } catch (error) {
      if (activeRunId !== runId) return;
      state.loading = false;
      state.loadingMore = false;
      if (serverErrorStatus(error) === 403) {
        onPermissionDenied?.();
        return;
      }
      state.error = formatUserFacingError(error);
    }
  }

  function schedule(immediate = false) {
    if (!isEnabled()) {
      onDisabled?.();
      return;
    }
    const hadSettledResults = state.results !== null;
    const hadPendingPreview =
      state.loading || state.loadingMore || debounceTimer !== null;
    clearDebounce();

    const trimmed = getQuery().trim();
    if (!trimmed) {
      resetResults(true);
      return;
    }

    const activeRunId = ++runId;
    const shouldLoadImmediately = immediate || (!hadSettledResults && !hadPendingPreview);
    state.error = null;
    state.loading = shouldLoadImmediately ? true : !hadSettledResults;
    state.loadingMore = false;

    const load = () => {
      debounceTimer = null;
      void loadPage({ cursor: null, reset: true, activeRunId });
    };

    if (shouldLoadImmediately) {
      load();
    } else {
      debounceTimer = setTimeout(load, debounceMs);
    }
  }

  function loadMore() {
    if (!isEnabled()) return;
    const results = state.results;
    if (
      !results?.has_more
      || !results.next_cursor
      || getQuery().trim() !== state.query
      || state.loading
      || state.loadingMore
    ) {
      return;
    }

    const activeRunId = ++runId;
    void loadPage({ cursor: results.next_cursor, reset: false, activeRunId });
  }

  function handleScroll(event: Event) {
    const target = event.currentTarget as HTMLElement;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom <= scrollThreshold) {
      loadMore();
    }
  }

  function dispose() {
    clearDebounce();
    runId += 1;
  }

  return {
    get state() { return state; },
    set state(value: SearchPreviewState) { state = value; },
    clearDebounce,
    stopLoading,
    resetResults,
    resetAll,
    schedule,
    loadMore,
    handleScroll,
    dispose,
  };
}
