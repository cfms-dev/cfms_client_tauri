<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    getDirectoryInfo,
    getDocument,
    getDocumentInfo,
    listDirectoryPage,
    loadUserPreference,
    searchFiles,
    type SearchDirectoryEntry,
    type SearchDocumentEntry,
    type SearchFilesResponse,
  } from '$lib/api';
  import { isAccessDeniedError, serverErrorStatus } from '$lib/api/server-errors';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import HomeRecordPanel from '$lib/features/files/HomeRecordPanel.svelte';
  import ServerSearchDialog, { type SearchResultRow } from '$lib/features/files/ServerSearchDialog.svelte';
  import { normalizeDirectoryId, ROOT_DIRECTORY_ID } from '$lib/features/files/file-browser';
  import {
    clearFavoriteRecords,
    clearRecentVisits,
    directoryToRecord,
    loadFavoriteRecords,
    loadRecentVisits,
    rememberVisit,
    removeRecentVisit,
    setFavoriteRecord,
    shouldRecordRecentVisits,
    type FilePreferenceScope,
    type FileRecord,
    type RecentFileRecord,
  } from '$lib/features/files/file-preferences';
  import { canSearchFiles } from '$lib/features/files/search-permissions';
  import type { SortDirection, SortField } from '$lib/features/files/sorting';
  import { authStore } from '$lib/features/authentication/auth-state.svelte.ts';
  import { eventLog } from '$lib/features/diagnostics/event-log.svelte.ts';
  import { fileShortcutValidationStore } from '$lib/features/files/shortcut-state.svelte.ts';
  import { notificationStore } from '$lib/shared/notifications/notifications.svelte.ts';
  import { serverStateStore } from '$lib/features/connection/connection-state.svelte.ts';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';
  import { shortIdentifier } from '$lib/shared/format/identifiers';
  import { formatBytes, formatDate, formatError } from '$lib/shared/format/values';

  const SERVER_SEARCH_PAGE_SIZE = 128;
  const SEARCH_PREVIEW_PAGE_SIZE = 24;
  const SEARCH_PREVIEW_DEBOUNCE_MS = 120;
  const SEARCH_PREVIEW_SCROLL_THRESHOLD = 72;

  let recent = $state<RecentFileRecord[]>([]);
  let favorites = $state<FileRecord[]>([]);
  let loadingRecent = $state(true);
  let loadingFavorites = $state(true);
  let openingId = $state<string | null>(null);
  let recordRecentVisits = $state(true);

  let preferredMode = $state<'search' | 'jump'>('search');
  let query = $state('');
  let previewDismissed = $state(false);
  let boxInput = $state<HTMLInputElement | null>(null);
  let searchDialogInput = $state<HTMLInputElement | null>(null);
  let jumping = $state(false);

  let searchDeniedByServer = $state(false);
  let previousPermissionSnapshotRevision = -1;
  let searchRunId = 0;
  let searchPreviewRunId = 0;
  let searchPreviewActiveIndex = $state(-1);
  let searchPreviewDebounce: ReturnType<typeof setTimeout> | null = null;

  let searchPreview = $state<{
    query: string;
    loading: boolean;
    loadingMore: boolean;
    results: SearchFilesResponse | null;
    error: string | null;
  }>({
    query: '',
    loading: false,
    loadingMore: false,
    results: null,
    error: null,
  });

  let searchDialog = $state<{
    open: boolean;
    query: string;
    resultQuery: string;
    searchDocuments: boolean;
    searchDirectories: boolean;
    sortBy: SortField;
    sortOrder: SortDirection;
    loading: boolean;
    results: SearchFilesResponse | null;
  }>({
    open: false,
    query: '',
    resultQuery: '',
    searchDocuments: true,
    searchDirectories: true,
    sortBy: 'name',
    sortOrder: 'asc',
    loading: false,
    results: null,
  });

  const serverTitle = $derived(serverStateStore.serverName?.trim() || 'CFMS Server');
  const hasSearchPermission = $derived(canSearchFiles(authStore.permissions));
  const canUseServerSearch = $derived(hasSearchPermission && !searchDeniedByServer);
  const activeMode = $derived<'search' | 'jump'>(canUseServerSearch ? preferredMode : 'jump');
  const hasQuery = $derived(query.trim().length > 0);
  const previewActive = $derived(
    activeMode === 'search' && canUseServerSearch && hasQuery && !previewDismissed,
  );

  const searchPreviewRows = $derived.by<SearchResultRow[]>(() => {
    if (!searchPreview.results) return [];
    return buildSearchResultRows(searchPreview.results);
  });

  function buildSearchResultRows(results: SearchFilesResponse): SearchResultRow[] {
    return [
      ...results.directories.map((directory) => ({
        kind: 'directory' as const,
        directory,
      })),
      ...results.documents.map((document) => ({
        kind: 'document' as const,
        document,
      })),
    ];
  }

  $effect(() => {
    const allowedBySnapshot = hasSearchPermission;
    const snapshotRevision = authStore.permissionSnapshotRevision;
    const deniedByServer = searchDeniedByServer;

    untrack(() => {
      if (allowedBySnapshot && snapshotRevision !== previousPermissionSnapshotRevision) {
        searchDeniedByServer = false;
      }
      previousPermissionSnapshotRevision = snapshotRevision;

      if (allowedBySnapshot && !deniedByServer) return;
      clearSearchPreviewDebounce();
      searchPreviewRunId += 1;
      searchRunId += 1;
      searchPreview = {
        ...searchPreview,
        loading: false,
        loadingMore: false,
        results: null,
        error: null,
      };
      searchDialog = { ...searchDialog, open: false, loading: false };
      searchPreviewActiveIndex = -1;
    });
  });

  onMount(async () => {
    const scope = currentFilePreferenceScope();
    try {
      const preferences = await loadUserPreference();
      recordRecentVisits = shouldRecordRecentVisits(preferences);
      recent = await loadRecentVisits(scope);
      favorites = await loadFavoriteRecords(scope);
    } catch {
      recent = [];
      favorites = [];
      recordRecentVisits = true;
    } finally {
      loadingRecent = false;
      loadingFavorites = false;
    }
  });

  onDestroy(() => {
    clearSearchPreviewDebounce();
    searchPreviewRunId += 1;
    searchRunId += 1;
  });

  function clearSearchPreviewDebounce() {
    if (searchPreviewDebounce !== null) {
      clearTimeout(searchPreviewDebounce);
      searchPreviewDebounce = null;
    }
  }

  function resetSearchPreviewResults() {
    searchPreviewRunId += 1;
    searchPreview.query = '';
    searchPreview.results = null;
    searchPreview.error = null;
    searchPreview.loadingMore = false;
    searchPreviewActiveIndex = -1;
  }

  function toggleMode() {
    if (!canUseServerSearch) {
      notificationStore.warning($t('files.searchPermissionRequired'), 5000);
      boxInput?.focus({ preventScroll: true });
      return;
    }
    const nextMode = activeMode === 'search' ? 'jump' : 'search';
    preferredMode = nextMode;
    previewDismissed = false;
    searchPreviewActiveIndex = -1;
    if (nextMode === 'search') {
      if (query.trim().length > 0) {
        scheduleSearchPreview(true);
      }
    } else {
      clearSearchPreviewDebounce();
      searchPreview.loading = false;
      searchPreview.loadingMore = false;
    }
    boxInput?.focus({ preventScroll: true });
  }

  function handleBoxFocus() {
    if (activeMode === 'search' && canUseServerSearch && query.trim().length > 0 && previewDismissed) {
      previewDismissed = false;
      if (!searchPreview.results || searchPreview.query !== query.trim()) {
        scheduleSearchPreview(true);
      }
    }
  }

  function handleBoxInput() {
    previewDismissed = false;
    searchPreviewActiveIndex = -1;
    if (activeMode !== 'search' || !canUseServerSearch) return;
    if (!query.trim()) {
      clearSearchPreviewDebounce();
      resetSearchPreviewResults();
      searchPreview.loading = false;
      return;
    }
    scheduleSearchPreview();
  }

  function handleBoxKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (previewActive) {
        event.preventDefault();
        previewDismissed = true;
        searchPreviewActiveIndex = -1;
      }
      return;
    }

    if (activeMode === 'search' && canUseServerSearch) {
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && searchPreviewRows.length > 0) {
        event.preventDefault();
        previewDismissed = false;
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const start = searchPreviewActiveIndex < 0 ? (delta > 0 ? -1 : 0) : searchPreviewActiveIndex;
        searchPreviewActiveIndex =
          (start + delta + searchPreviewRows.length) % searchPreviewRows.length;
        document
          .getElementById(`home-search-preview-option-${searchPreviewActiveIndex}`)
          ?.scrollIntoView({ block: 'nearest' });
        return;
      }

      if ((event.key === 'Home' || event.key === 'End') && previewActive && searchPreviewRows.length > 0) {
        event.preventDefault();
        searchPreviewActiveIndex = event.key === 'Home' ? 0 : searchPreviewRows.length - 1;
        document
          .getElementById(`home-search-preview-option-${searchPreviewActiveIndex}`)
          ?.scrollIntoView({ block: 'nearest' });
        return;
      }

      if (event.key === 'Enter' && previewActive && searchPreviewActiveIndex >= 0) {
        event.preventDefault();
        const row = searchPreviewRows[searchPreviewActiveIndex];
        if (row.kind === 'directory') void navigateToSearchDirectory(row.directory);
        else void navigateToSearchDocument(row.document);
        return;
      }
    }
  }

  function scheduleSearchPreview(immediate = false) {
    if (!canUseServerSearch || activeMode !== 'search') return;
    const hadSettledResults = searchPreview.results !== null;
    const hadPendingPreview =
      searchPreview.loading || searchPreview.loadingMore || searchPreviewDebounce !== null;
    clearSearchPreviewDebounce();

    const trimmed = query.trim();
    if (!trimmed) {
      resetSearchPreviewResults();
      searchPreview.loading = false;
      return;
    }

    const runId = ++searchPreviewRunId;
    const shouldLoadImmediately = immediate || (!hadSettledResults && !hadPendingPreview);
    searchPreview.error = null;
    searchPreview.loading = shouldLoadImmediately ? true : !hadSettledResults;
    searchPreview.loadingMore = false;

    const load = () => {
      searchPreviewDebounce = null;
      void loadSearchPreviewPage({ cursor: null, reset: true, runId });
    };

    if (shouldLoadImmediately) {
      load();
    } else {
      searchPreviewDebounce = setTimeout(load, SEARCH_PREVIEW_DEBOUNCE_MS);
    }
  }

  async function loadSearchPreviewPage({
    cursor,
    reset,
    runId,
  }: {
    cursor: string | null;
    reset: boolean;
    runId: number;
  }) {
    if (!canUseServerSearch) return;
    const trimmed = query.trim();
    if (!trimmed) {
      searchPreview.loading = false;
      searchPreview.loadingMore = false;
      return;
    }

    if (reset) {
      searchPreview.loading = true;
      searchPreview.loadingMore = false;
    } else {
      searchPreview.loadingMore = true;
    }

    try {
      const page = await searchFiles(trimmed, {
        pageSize: SEARCH_PREVIEW_PAGE_SIZE,
        cursor,
        sortBy: 'name',
        sortOrder: 'asc',
        searchDocuments: true,
        searchDirectories: true,
      });
      if (runId !== searchPreviewRunId) return;

      searchPreview.query = trimmed;
      searchPreview.results =
        reset || !searchPreview.results
          ? page
          : mergeSearchResults(searchPreview.results, page);
      searchPreview.loading = false;
      searchPreview.loadingMore = false;
      searchPreview.error = null;
    } catch (e) {
      if (runId !== searchPreviewRunId) return;
      searchPreview.loading = false;
      searchPreview.loadingMore = false;
      if (handleSearchPermissionError(e)) return;
      searchPreview.error = formatError(e);
    }
  }

  function loadMoreSearchPreview() {
    if (!canUseServerSearch) return;
    const results = searchPreview.results;
    if (
      !results?.has_more
      || !results.next_cursor
      || query.trim() !== searchPreview.query
      || searchPreview.loading
      || searchPreview.loadingMore
    ) {
      return;
    }

    const runId = ++searchPreviewRunId;
    void loadSearchPreviewPage({ cursor: results.next_cursor, reset: false, runId });
  }

  function handleSearchPreviewScroll(event: Event) {
    const target = event.currentTarget as HTMLElement;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom <= SEARCH_PREVIEW_SCROLL_THRESHOLD) {
      loadMoreSearchPreview();
    }
  }

  function searchResultDate(row: SearchResultRow) {
    return row.kind === 'directory'
      ? formatDate(row.directory.created_time)
      : formatDate(row.document.last_modified ?? null);
  }

  function handleSearchPermissionError(searchError: unknown): boolean {
    if (serverErrorStatus(searchError) !== 403) return false;
    searchDeniedByServer = true;
    closeSearchDialog();
    notificationStore.warning($t('files.searchPermissionRequired'), 5000);
    return true;
  }

  function searchSortByParam(field: SortField) {
    return field === 'modified' ? 'last_modified' : field;
  }

  function emptySearchResults(): SearchFilesResponse {
    return {
      documents: [],
      directories: [],
      total_count: 0,
      page_size: SERVER_SEARCH_PAGE_SIZE,
      next_cursor: null,
      has_more: false,
    };
  }

  function mergeSearchResults(
    previous: SearchFilesResponse,
    page: SearchFilesResponse,
  ): SearchFilesResponse {
    return {
      ...page,
      documents: [...previous.documents, ...page.documents],
      directories: [...previous.directories, ...page.directories],
      total_count: previous.total_count + page.total_count,
    };
  }

  function openSearchDialog(runImmediately = false) {
    if (!canUseServerSearch) return;
    const initialQuery = query.trim() ? query.trim() : searchPreview.query;
    searchDialog.open = true;
    searchDialog.query = initialQuery;
    searchDialog.resultQuery = '';
    searchDialog.searchDocuments = true;
    searchDialog.searchDirectories = true;
    searchDialog.sortBy = 'name';
    searchDialog.sortOrder = 'asc';
    searchDialog.loading = false;
    searchDialog.results = null;

    if (runImmediately && initialQuery) {
      void runServerSearch();
    }
  }

  function closeSearchDialog() {
    searchRunId += 1;
    searchDialog = { ...searchDialog, open: false, loading: false };
  }

  function setSearchDialogSort(field: SortField) {
    if (searchDialog.sortBy === field) return;
    searchDialog.sortBy = field;
    rerunSearchDialogIfReady();
  }

  function toggleSearchDialogSortOrder() {
    searchDialog.sortOrder = searchDialog.sortOrder === 'asc' ? 'desc' : 'asc';
    rerunSearchDialogIfReady();
  }

  function rerunSearchDialogIfReady() {
    if (!searchDialog.query.trim()) return;
    if (!searchDialog.searchDocuments && !searchDialog.searchDirectories) return;
    void runServerSearch();
  }

  async function runServerSearch() {
    if (!canUseServerSearch) return;
    const trimmed = searchDialog.query.trim();
    if (!trimmed) {
      notificationStore.error($t('files.searchQueryRequired'));
      return;
    }
    if (!searchDialog.searchDocuments && !searchDialog.searchDirectories) {
      notificationStore.error($t('files.searchTypeRequired'));
      return;
    }

    const runId = ++searchRunId;
    const searchDocuments = searchDialog.searchDocuments;
    const searchDirectories = searchDialog.searchDirectories;
    const sortBy = searchSortByParam(searchDialog.sortBy);
    const sortOrder = searchDialog.sortOrder;
    let cursor: string | null = null;
    let combined = emptySearchResults();

    searchDialog = { ...searchDialog, resultQuery: trimmed, loading: true, results: null };
    try {
      while (true) {
        const results = await searchFiles(trimmed, {
          pageSize: SERVER_SEARCH_PAGE_SIZE,
          cursor,
          sortBy,
          sortOrder,
          searchDocuments,
          searchDirectories,
        });
        if (runId !== searchRunId) return;

        combined = mergeSearchResults(combined, results);
        searchDialog = { ...searchDialog, results: combined, loading: results.has_more };

        if (!results.has_more) break;
        cursor = results.next_cursor;
        if (!cursor) {
          throw new Error('Server reported more search results without a cursor.');
        }
      }

      searchDialog = { ...searchDialog, loading: false, results: combined };
    } catch (e) {
      if (runId !== searchRunId) return;
      searchDialog = { ...searchDialog, loading: false };
      if (handleSearchPermissionError(e)) return;
      notificationStore.error(formatError(e));
    }
  }

  async function navigateToSearchDirectory(directory: SearchDirectoryEntry) {
    closeSearchDialog();
    recent = await rememberVisit(currentFilePreferenceScope(), directoryToRecord(directory, null));
    const params = new URLSearchParams({
      folder: directory.id,
      name: directory.name,
    });
    await goto(`/home/files?${params.toString()}`);
  }

  async function navigateToSearchDocument(document: SearchDocumentEntry) {
    closeSearchDialog();
    const parent = normalizeDirectoryId(document.parent_id);
    const docName = document.name ?? document.title ?? '';
    const params = new URLSearchParams({
      folder: parent ?? ROOT_DIRECTORY_ID,
    });
    await goto(`/home/files?${params.toString()}`);
    notificationStore.success($t('files.searchOpenedParent', { values: { name: docName } }));
  }

  async function handleBoxSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!hasQuery) return;
    if (activeMode === 'search') {
      openSearchDialog(true);
      return;
    }
    await handleJumpSubmit();
  }

  async function handleJumpSubmit() {
    const trimmed = query.trim();
    if (!trimmed || jumping) return;
    const target = normalizeDirectoryId(trimmed);
    if (target === null) {
      const params = new URLSearchParams({ folder: ROOT_DIRECTORY_ID });
      await goto(`/home/files?${params.toString()}`);
      return;
    }

    jumping = true;
    try {
      await listDirectoryPage(target, null, 1);
      const params = new URLSearchParams({ folder: target });
      await goto(`/home/files?${params.toString()}`);
    } catch (dirError) {
      if (serverErrorStatus(dirError) === 404) {
        try {
          const docInfo = await getDocumentInfo(target);
          const parent = normalizeDirectoryId(docInfo.parent_id);
          const docLabel = docInfo.title?.trim() || shortIdentifier(target);
          const params = new URLSearchParams({
            folder: parent ?? ROOT_DIRECTORY_ID,
            document: target,
            documentName: docLabel,
          });
          await goto(`/home/files?${params.toString()}`);
        } catch (docError) {
          if (serverErrorStatus(docError) === 404) {
            notificationStore.error($t('files.jumpObjectUnavailable'));
          } else {
            notificationStore.error(formatUserFacingError(docError));
          }
        }
      } else if (isAccessDeniedError(dirError)) {
        const params = new URLSearchParams({ folder: target });
        await goto(`/home/files?${params.toString()}`);
      } else {
        notificationStore.error(formatUserFacingError(dirError));
      }
    } finally {
      jumping = false;
    }
  }

  async function openRecord(record: FileRecord) {
    openingId = `${record.type}:${record.id}`;
    try {
      const scope = currentFilePreferenceScope();

      if (record.type === 'directory') {
        await getDirectoryInfo(record.id);
        recent = await rememberVisit(scope, record);
        const params = new URLSearchParams({
          folder: record.id,
          name: record.name,
        });
        await goto(`/home/files?${params.toString()}`);
      } else {
        await getDocument(record.id, record.name);
        recent = await rememberVisit(scope, record);
        notificationStore.success($t('home.downloadQueued', { values: { name: record.name } }));
      }
    } catch (err) {
      if (isUnavailableError(err)) {
        fileShortcutValidationStore.markUnavailable(record.type, record.id);
        eventLog.push('warning', `Shortcut is no longer accessible: ${record.type}:${record.id}`);
      } else {
        notificationStore.error(formatUserFacingError(err));
      }
    } finally {
      openingId = null;
    }
  }

  async function removeRecent(record: FileRecord) {
    recent = await removeRecentVisit(currentFilePreferenceScope(), record);
  }

  async function removeFavorite(record: FileRecord) {
    await setFavoriteRecord(currentFilePreferenceScope(), record, false);
    favorites = favorites.filter((item) => item.type !== record.type || item.id !== record.id);
  }

  async function clearRecent() {
    recent = await clearRecentVisits(currentFilePreferenceScope());
  }

  async function clearFavorites() {
    await clearFavoriteRecords(currentFilePreferenceScope());
    favorites = [];
  }

  function isShortcutUnavailable(record: FileRecord) {
    return fileShortcutValidationStore.isUnavailable(record.type, record.id);
  }

  function isUnavailableError(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      /Server returned\s+(403|404|410)\b/i.test(message)
      || /not found|no longer exists|does not exist|access denied/i.test(message)
    );
  }

  function formatVisitTime(timestamp: number) {
    return new Date(timestamp).toLocaleString();
  }

  function currentFilePreferenceScope(): FilePreferenceScope {
    return {
      serverAddress: serverStateStore.remoteAddress,
      userId: authStore.userId,
    };
  }
</script>

<div class="workspace-page home-overview" class:home-overview--preview={previewActive}>
  <div class="home-stage">
    <section class="home-hero">
      <h1 class="home-server-title">{serverTitle}</h1>

      <div class="home-search-anchor">
        <div
          class="home-search-card cfms-field-surface"
          class:home-search-card--expanded={previewActive}
          data-search-box
        >
          <form class="home-search-row" onsubmit={handleBoxSubmit}>
            <button
              type="button"
              class="home-box-icon-btn"
              data-home-mode-toggle
              aria-label={activeMode === 'search' ? $t('home.searchMode') : $t('home.jumpMode')}
              title={activeMode === 'search' ? $t('home.searchMode') : $t('home.jumpMode')}
              onclick={toggleMode}
            >
              <Icon name={activeMode === 'search' ? 'search' : 'arrowStepIn'} size="18px" />
            </button>

            <input
              type="text"
              class="home-box-input cfms-native-field"
              data-focus-ring="delegated"
              bind:value={query}
              bind:this={boxInput}
              placeholder={activeMode === 'search' ? $t('files.searchPlaceholder') : $t('home.jumpPlaceholder')}
              aria-label={activeMode === 'search' ? $t('files.searchPlaceholder') : $t('home.jumpPlaceholder')}
              onfocus={handleBoxFocus}
              oninput={handleBoxInput}
              onkeydown={handleBoxKeydown}
              role={activeMode === 'search' ? 'combobox' : undefined}
              aria-expanded={activeMode === 'search' ? previewActive : undefined}
              aria-controls={activeMode === 'search' ? 'home-search-preview-list' : undefined}
              aria-autocomplete={activeMode === 'search' ? 'list' : undefined}
              aria-activedescendant={previewActive && searchPreviewActiveIndex >= 0
                ? `home-search-preview-option-${searchPreviewActiveIndex}`
                : undefined}
            />

            {#if hasQuery}
              <button
                type="submit"
                class="home-box-icon-btn home-box-submit-btn"
                data-home-submit
                aria-label={activeMode === 'search' ? $t('files.serverSearch') : $t('home.submitJump')}
                title={activeMode === 'search' ? $t('files.serverSearch') : $t('home.submitJump')}
                disabled={jumping}
              >
                <Icon name="arrowForward" size="18px" />
              </button>
            {/if}
          </form>

          {#if previewActive}
            <div
              id="home-search-preview-list"
              class="home-search-preview-list"
              role="listbox"
              aria-label={$t('files.searchPreviewResults')}
              onscroll={handleSearchPreviewScroll}
            >
              {#if searchPreview.error}
                <p class="home-search-preview-status home-search-preview-status--error">
                  {searchPreview.error}
                </p>
              {:else if searchPreview.results && searchPreviewRows.length === 0 && !searchPreview.loading}
                <p class="home-search-preview-status">
                  {$t('files.searchNoResults', { values: { query: searchPreview.query } })}
                </p>
              {:else if searchPreviewRows.length > 0}
                {#each searchPreviewRows as row, index (row.kind === 'directory' ? `dir:${row.directory.id}` : `doc:${row.document.id}`)}
                  <button
                    id={`home-search-preview-option-${index}`}
                    type="button"
                    class="home-search-preview-row"
                    class:home-search-preview-row--active={searchPreviewActiveIndex === index}
                    class:home-search-preview-row--last={index === searchPreviewRows.length - 1 && !searchPreview.loadingMore}
                    role="option"
                    aria-selected={searchPreviewActiveIndex === index}
                    tabindex="-1"
                    onmouseenter={() => (searchPreviewActiveIndex = index)}
                    onclick={() =>
                      row.kind === 'directory'
                        ? navigateToSearchDirectory(row.directory)
                        : navigateToSearchDocument(row.document)}
                  >
                    <span
                      class="home-search-preview-icon"
                      class:home-search-preview-icon--directory={row.kind === 'directory'}
                    >
                      <Icon name={row.kind === 'directory' ? 'folder' : 'filePresent'} size="20px" />
                    </span>
                    <span class="home-search-preview-main">
                      <span
                        class="home-search-preview-title"
                        class:home-search-preview-title--directory={row.kind === 'directory'}
                      >
                        {row.kind === 'directory'
                          ? row.directory.name
                          : (row.document.name ?? row.document.title)}
                      </span>
                      <span class="home-search-preview-meta">
                        {row.kind === 'directory'
                          ? $t('files.searchDirectories')
                          : formatBytes(row.document.size)}
                      </span>
                    </span>
                    <span class="home-search-preview-date">{searchResultDate(row)}</span>
                  </button>
                {/each}
                {#if searchPreview.loadingMore}
                  <div class="home-search-preview-loading-more">
                    <ProgressRing size={15} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
                    <span>{$t('common.loadingEllipsis')}</span>
                  </div>
                {/if}
              {:else if searchPreview.loading}
                <div class="home-search-preview-status home-search-preview-loading">
                  <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
                  <span>{$t('common.loadingEllipsis')}</span>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </section>

    <div
      class="home-panels"
      class:home-panels--hidden={previewActive}
      aria-hidden={previewActive ? 'true' : undefined}
      inert={previewActive ? true : undefined}
    >
      <HomeRecordPanel
        title={$t('home.recent')}
        icon="history"
        records={recent}
        loading={loadingRecent}
        emptyLabel={recordRecentVisits ? $t('home.noRecent') : $t('home.recentRecordingDisabled')}
        loadingLabel={$t('common.loadingEllipsis')}
        clearLabel={$t('home.clearRecent')}
        removeLabel={$t('home.removeShortcut')}
        unavailableLabel={$t('home.unavailable')}
        {openingId}
        meta={(item) => (item.visitedAt ? formatVisitTime(item.visitedAt) : '')}
        isUnavailable={isShortcutUnavailable}
        onOpen={openRecord}
        onRemove={removeRecent}
        onClear={clearRecent}
      />

      <HomeRecordPanel
        title={$t('home.favorites')}
        icon="star"
        iconClass="text-md3-warning"
        records={favorites}
        loading={loadingFavorites}
        emptyLabel={$t('home.noFavorites')}
        loadingLabel={$t('common.loadingEllipsis')}
        clearLabel={$t('home.clearFavorites')}
        removeLabel={$t('home.removeShortcut')}
        showOpenIndicator={false}
        unavailableLabel={$t('home.unavailable')}
        {openingId}
        meta={(item) => (item.type === 'directory' ? $t('files.directory') : $t('files.document'))}
        isUnavailable={isShortcutUnavailable}
        onOpen={openRecord}
        onRemove={removeFavorite}
        onClear={clearFavorites}
      />
    </div>
  </div>
</div>

<ServerSearchDialog
  open={searchDialog.open}
  bind:query={searchDialog.query}
  bind:inputElement={searchDialogInput}
  resultQuery={searchDialog.resultQuery}
  bind:searchDocuments={searchDialog.searchDocuments}
  bind:searchDirectories={searchDialog.searchDirectories}
  sortBy={searchDialog.sortBy}
  sortOrder={searchDialog.sortOrder}
  loading={searchDialog.loading}
  results={searchDialog.results}
  onClose={closeSearchDialog}
  onSubmit={runServerSearch}
  onSortField={setSearchDialogSort}
  onToggleSortOrder={toggleSearchDialogSortOrder}
  onSelectDirectory={navigateToSearchDirectory}
  onSelectDocument={navigateToSearchDocument}
/>

<style>
  .home-overview {
    --home-hero-rest-offset: clamp(2.75rem, 9vh, 5.25rem);
    isolation: isolate;
    position: relative;
    display: flex;
    min-height: 100%;
    width: 100%;
    flex-direction: column;
    align-items: center;
    padding: clamp(2.5rem, 8vh, 4.75rem) 1.5rem 2.5rem;
  }

  .home-stage {
    display: flex;
    width: min(100%, 56rem);
    flex-direction: column;
    align-items: center;
  }

  .home-hero {
    position: relative;
    z-index: 20;
    display: flex;
    width: 100%;
    flex-direction: column;
    align-items: center;
    gap: 1.35rem;
    transform: translate3d(0, var(--home-hero-rest-offset), 0);
    transition: transform var(--motion-duration-medium2) var(--motion-easing-emphasized-decelerate);
    will-change: transform;
  }

  .home-overview--preview .home-hero {
    transform: translate3d(0, 0, 0);
  }

  .home-server-title {
    margin: 0;
    max-width: 100%;
    color: var(--colorNeutralForeground1);
    font-family: 'Google Sans Flex', var(--font-md3-sans);
    font-size: clamp(1.85rem, 3.6vw, 2.45rem);
    font-weight: 400;
    line-height: 1.25;
    letter-spacing: -0.015em;
    text-align: center;
    overflow-wrap: anywhere;
  }

  .home-search-anchor {
    position: relative;
    width: min(100%, 35rem);
    height: 44px;
  }

  .home-search-card {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: 22px;
    color: var(--colorNeutralForeground1);
    transition:
      border-color var(--durationFaster) var(--curveEasyEase),
      box-shadow var(--motion-duration-medium1) var(--motion-easing-emphasized-decelerate);
  }

  .home-search-card:hover {
    border-color: var(--colorNeutralStroke1Hover);
  }

  .home-search-card--expanded {
    box-shadow: var(--shadow16);
  }

  [data-search-box]:has([data-focus-ring='delegated']:focus) {
    border-color: var(--colorStrokeFocus2);
  }

  .home-search-row {
    display: flex;
    height: 42px;
    min-width: 0;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
  }

  .home-box-icon-btn {
    display: inline-flex;
    width: 32px;
    height: 32px;
    flex: none;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 999px;
    padding: 0;
    color: var(--colorNeutralForeground2);
    background: transparent;
    transition:
      background-color var(--durationFaster) var(--curveEasyEase),
      color var(--durationFaster) var(--curveEasyEase);
  }

  .home-box-icon-btn:hover:not(:disabled) {
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1Hover);
  }

  .home-box-icon-btn:active:not(:disabled) {
    background: var(--colorNeutralBackground1Pressed);
  }

  .home-box-icon-btn:disabled {
    cursor: not-allowed;
    color: var(--colorNeutralForegroundDisabled);
  }

  .home-box-input {
    width: 0;
    min-width: 0;
    flex: 1;
    align-self: stretch;
    border: 0;
    padding: 0 6px;
    text-overflow: ellipsis;
    color: inherit;
    background: transparent;
    font: 400 14px/20px var(--fontFamilyBase);
  }

  .home-box-input::placeholder {
    color: var(--colorNeutralForeground3);
    opacity: 1;
  }

  .home-search-preview-list {
    max-height: 364px;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-top: 1px solid var(--colorNeutralStroke2);
    animation: home-preview-expand var(--motion-duration-medium1)
      var(--motion-easing-emphasized-decelerate) both;
  }

  @keyframes home-preview-expand {
    from {
      opacity: 0;
      transform: translate3d(0, -6px, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  .home-search-preview-row {
    display: grid;
    width: 100%;
    min-height: 52px;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    border: 0;
    border-bottom: 1px solid var(--colorNeutralStroke2);
    padding: 8px 16px;
    color: var(--colorNeutralForeground1);
    background: transparent;
    text-align: left;
    transition: background-color var(--durationFaster) var(--curveEasyEase);
  }

  .home-search-preview-row:hover,
  .home-search-preview-row--active {
    background: var(--colorNeutralBackground1Hover);
  }

  .home-search-preview-row:active {
    background: var(--colorNeutralBackground1Pressed);
  }

  .home-search-preview-row--last {
    border-bottom: 0;
  }

  .home-search-preview-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--colorNeutralForeground3);
  }

  .home-search-preview-icon--directory {
    color: var(--colorBrandForeground1);
  }

  .home-search-preview-main {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .home-search-preview-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--colorNeutralForeground1);
    font: 500 14px/20px var(--fontFamilyBase);
  }

  .home-search-preview-title--directory {
    color: var(--colorBrandForeground1);
  }

  .home-search-preview-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .home-search-preview-date {
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
    white-space: nowrap;
  }

  .home-search-preview-status {
    margin: 0;
    padding: 1.75rem 1rem;
    color: var(--colorNeutralForeground3);
    font: 400 14px/20px var(--fontFamilyBase);
    text-align: center;
  }

  .home-search-preview-status--error {
    color: var(--colorStatusDangerForeground1);
  }

  .home-search-preview-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .home-search-preview-loading-more {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .home-panels {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2.5rem;
    margin-top: calc(var(--home-hero-rest-offset) + 3.25rem);
    opacity: 1;
    transform: translate3d(0, 0, 0);
    transition:
      opacity var(--motion-duration-medium1) var(--motion-easing-emphasized-decelerate),
      transform var(--motion-duration-medium2) var(--motion-easing-emphasized-decelerate),
      visibility 0s linear 0s;
  }

  .home-panels--hidden {
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
    transform: translate3d(0, 12px, 0);
    transition:
      opacity var(--motion-duration-short4) var(--motion-easing-emphasized-accelerate),
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-accelerate),
      visibility 0s linear var(--motion-duration-short4);
  }

  @media (max-width: 820px) {
    .home-panels {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.5rem;
    }
  }

  @media (pointer: coarse) {
    .home-search-anchor {
      height: 46px;
    }
    .home-search-row {
      height: 44px;
    }
    .home-box-icon-btn {
      width: 40px;
      height: 40px;
    }
    .home-box-input {
      font-size: 16px;
    }
  }

  @media (forced-colors: active) {
    .home-search-card {
      color: FieldText;
      background: Field;
      border-color: ButtonText;
      box-shadow: none;
    }
    [data-search-box]:has([data-focus-ring='delegated']:focus) {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
    .home-search-preview-row:hover,
    .home-search-preview-row--active {
      color: HighlightText;
      background: Highlight;
    }
  }
</style>
