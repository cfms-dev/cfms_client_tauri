<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
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
  import HomeRecordPanel from '$lib/features/files/HomeRecordPanel.svelte';
  import SearchPreviewList from '$lib/features/files/SearchPreviewList.svelte';
  import ServerSearchView from '$lib/features/files/ServerSearchView.svelte';
  import {
    mergeSearchResponses,
    toSearchResultRows,
    type SearchResultRow,
  } from '$lib/features/files/search-grouping';
  import {
    createServerSearchController,
  } from '$lib/features/files/server-search-controller.svelte.ts';
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
  import { authStore } from '$lib/features/authentication/auth-state.svelte.ts';
  import { eventLog } from '$lib/features/diagnostics/event-log.svelte.ts';
  import { fileShortcutValidationStore } from '$lib/features/files/shortcut-state.svelte.ts';
  import { notificationStore } from '$lib/shared/notifications/notifications.svelte.ts';
  import { serverStateStore } from '$lib/features/connection/connection-state.svelte.ts';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';
  import { isReducedMotionEnabled } from '$lib/shared/appearance';
  import { shortIdentifier } from '$lib/shared/format/identifiers';
  import { formatError } from '$lib/shared/format/values';

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
  let searchBoxFocused = $state(false);
  let previewDismissed = $state(false);
  let overviewElement = $state<HTMLDivElement | null>(null);
  let stageElement = $state<HTMLDivElement | null>(null);
  let panelsElement = $state<HTMLDivElement | null>(null);
  let panelsExitTop = $state<number | null>(null);
  let panelsCollapsed = $state(false);
  let boxInput = $state<HTMLInputElement | null>(null);
  let searchViewInput = $state<HTMLInputElement | null>(null);
  let jumping = $state(false);

  let searchDeniedByServer = $state(false);
  let previousPermissionSnapshotRevision = -1;
  let searchPreviewRunId = 0;
  let searchPreviewActiveIndex = $state(-1);
  let searchPreviewDebounce: ReturnType<typeof setTimeout> | null = null;
  let panelsCollapseTimer: ReturnType<typeof setTimeout> | null = null;
  let wasPreviewActive = false;

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

  const serverTitle = $derived(serverStateStore.serverName?.trim() || 'CFMS Server');
  const hasSearchPermission = $derived(canSearchFiles(authStore.permissions));
  const canUseServerSearch = $derived(hasSearchPermission && !searchDeniedByServer);
  const activeMode = $derived<'search' | 'jump'>(canUseServerSearch ? preferredMode : 'jump');
  const hasQuery = $derived(query.trim().length > 0);
  const previewActive = $derived(
    activeMode === 'search'
      && canUseServerSearch
      && searchBoxFocused
      && hasQuery
      && !previewDismissed,
  );

  const searchView = createServerSearchController({
    canSearch: () => canUseServerSearch,
    onEmptyQuery: () => notificationStore.error($t('files.searchQueryRequired')),
    onError: (err) => notificationStore.error(formatError(err)),
    onPermissionDenied: () => {
      searchDeniedByServer = true;
      notificationStore.warning($t('files.searchPermissionRequired'), 5000);
    },
  });

  const searchPreviewRows = $derived.by<SearchResultRow[]>(() =>
    toSearchResultRows(searchPreview.results),
  );

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
      searchView.closeSearch();
      searchPreview = {
        ...searchPreview,
        loading: false,
        loadingMore: false,
        results: null,
        error: null,
      };
      searchPreviewActiveIndex = -1;
    });
  });

  $effect.pre(() => {
    const active = previewActive;
    if (active === wasPreviewActive) return;
    wasPreviewActive = active;

    if (panelsCollapseTimer !== null) {
      clearTimeout(panelsCollapseTimer);
      panelsCollapseTimer = null;
    }

    if (active) {
      if (panelsElement && stageElement) {
        panelsExitTop = panelsElement.offsetTop;
      }
      if (isReducedMotionEnabled()) {
        panelsCollapsed = true;
      } else {
        panelsCollapsed = false;
        panelsCollapseTimer = setTimeout(() => {
          panelsCollapseTimer = null;
          if (previewActive) panelsCollapsed = true;
        }, 200);
      }
    } else {
      panelsCollapsed = false;
      panelsExitTop = null;
    }
  });

  $effect(() => {
    const stage = stageElement;
    const overview = overviewElement;
    if (!stage || !overview || typeof ResizeObserver === 'undefined') return;

    const scrollContainer = overview.parentElement;
    let previousOverviewHeight = overview.clientHeight;
    let previousStageTop = stage.getBoundingClientRect().top;
    let activeAnimation: Animation | null = null;

    const handleScroll = () => {
      if (activeAnimation?.playState === 'running') return;
      previousStageTop = stage.getBoundingClientRect().top;
    };

    const syncStagePosition = () => {
      const currentOverviewHeight = overview.clientHeight;

      if (
        isReducedMotionEnabled()
        || typeof stage.animate !== 'function'
        || currentOverviewHeight !== previousOverviewHeight
      ) {
        previousOverviewHeight = currentOverviewHeight;
        activeAnimation?.cancel();
        activeAnimation = null;
        previousStageTop = stage.getBoundingClientRect().top;
        return;
      }

      const animationRunning = activeAnimation?.playState === 'running';
      const visualTop = stage.getBoundingClientRect().top;

      activeAnimation?.cancel();
      activeAnimation = null;

      const layoutTop = stage.getBoundingClientRect().top;
      const delta = (animationRunning ? visualTop : previousStageTop) - layoutTop;
      previousStageTop = layoutTop;

      if (Math.abs(delta) < 0.5) return;

      activeAnimation = stage.animate(
        [
          { transform: `translate3d(0, ${delta}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: 280,
          easing: 'cubic-bezier(0, 0, 0, 1)',
        },
      );
      activeAnimation.addEventListener(
        'finish',
        () => {
          activeAnimation = null;
        },
        { once: true },
      );
    };

    const observer = new ResizeObserver(syncStagePosition);
    observer.observe(stage);
    observer.observe(overview);
    scrollContainer?.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      scrollContainer?.removeEventListener('scroll', handleScroll);
      activeAnimation?.cancel();
    };
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
    if (panelsCollapseTimer !== null) {
      clearTimeout(panelsCollapseTimer);
      panelsCollapseTimer = null;
    }
    searchPreviewRunId += 1;
    searchView.cancel();
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

  function handleSearchBoxFocusIn() {
    const wasFocused = searchBoxFocused;
    searchBoxFocused = true;
    if (
      !wasFocused
      && activeMode === 'search'
      && canUseServerSearch
      && query.trim().length > 0
    ) {
      previewDismissed = false;
      if (!searchPreview.results || searchPreview.query !== query.trim()) {
        scheduleSearchPreview(true);
      }
    }
  }

  function handleSearchBoxFocusOut(event: FocusEvent) {
    const container = event.currentTarget as HTMLElement;
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && container.contains(nextTarget)) return;
    searchBoxFocused = false;
    searchPreviewActiveIndex = -1;
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
          : mergeSearchResponses(searchPreview.results, page);
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

  function handleSearchPermissionError(searchError: unknown): boolean {
    if (serverErrorStatus(searchError) !== 403) return false;
    searchDeniedByServer = true;
    searchView.closeSearch();
    notificationStore.warning($t('files.searchPermissionRequired'), 5000);
    return true;
  }

  function openSearchView(runImmediately = false) {
    if (!canUseServerSearch) return;
    const initialQuery = query.trim() ? query.trim() : searchPreview.query;
    searchBoxFocused = false;
    searchPreviewActiveIndex = -1;
    searchView.openSearch({
      query: initialQuery,
      filter: 'all',
      sortBy: 'name',
      sortOrder: 'asc',
      runImmediately,
    });
  }

  function closeSearchView(restoreFocus = true) {
    searchView.closeSearch();
    if (restoreFocus) {
      void tick().then(() => boxInput?.focus({ preventScroll: true }));
    }
  }

  async function navigateToSearchParentDirectory(parentId: string, parentName?: string) {
    closeSearchView(false);
    const parent = normalizeDirectoryId(parentId);
    const params = new URLSearchParams({
      folder: parent ?? ROOT_DIRECTORY_ID,
    });
    const label = parentName?.trim();
    if (parent !== null && label) {
      params.set('name', label);
    }
    await goto(`/home/files?${params.toString()}`);
  }

  async function navigateToSearchDirectory(directory: SearchDirectoryEntry) {
    closeSearchView(false);
    recent = await rememberVisit(currentFilePreferenceScope(), directoryToRecord(directory, null));
    const params = new URLSearchParams({
      folder: directory.id,
      name: directory.name,
    });
    await goto(`/home/files?${params.toString()}`);
  }

  async function navigateToSearchDocument(document: SearchDocumentEntry) {
    closeSearchView(false);
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
      openSearchView(true);
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

{#if searchView.open}
  <ServerSearchView
    bind:query={searchView.query}
    bind:inputElement={searchViewInput}
    resultQuery={searchView.resultQuery}
    filter={searchView.filter}
    sortBy={searchView.sortBy}
    sortOrder={searchView.sortOrder}
    loading={searchView.loading}
    results={searchView.results}
    parentDirectoryResolutions={searchView.parentDirectoryResolutions}
    onClose={() => closeSearchView(true)}
    onSubmit={searchView.runSearch}
    onFilterChange={searchView.setFilter}
    onSelectSort={searchView.selectSort}
    onSelectParentDirectory={navigateToSearchParentDirectory}
    onSelectDirectory={navigateToSearchDirectory}
    onSelectDocument={navigateToSearchDocument}
    onObserveParentDirectory={searchView.observeParentDirectory}
    onParentDirectoryRevealed={searchView.markParentDirectoryRevealed}
  />
{:else}
<div
  class="workspace-page home-overview"
  class:home-overview--preview={previewActive}
  bind:this={overviewElement}
>
  <div class="home-stage" bind:this={stageElement}>
    <section class="home-hero">
      <h1 class="home-server-title">{serverTitle}</h1>

      <div class="home-search-anchor">
        <div
          class="home-search-card cfms-field-surface"
          class:home-search-card--expanded={previewActive}
          data-search-box
          onfocusin={handleSearchBoxFocusIn}
          onfocusout={handleSearchBoxFocusOut}
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
            <SearchPreviewList
              id="home-search-preview-list"
              optionIdPrefix="home-search-preview-option"
              rows={searchPreviewRows}
              query={searchPreview.query}
              loading={searchPreview.loading}
              loadingMore={searchPreview.loadingMore}
              error={searchPreview.error}
              activeIndex={searchPreviewActiveIndex}
              borderTop
              animateExpand
              onActiveIndexChange={(index) => (searchPreviewActiveIndex = index)}
              onSelectDirectory={navigateToSearchDirectory}
              onSelectDocument={navigateToSearchDocument}
              onScroll={handleSearchPreviewScroll}
            />
          {/if}
        </div>
      </div>
    </section>

    <div
      class="home-panels"
      class:home-panels--hidden={previewActive}
      class:home-panels--collapsed={panelsCollapsed}
      style:--home-panels-exit-top={panelsExitTop !== null ? `${panelsExitTop}px` : undefined}
      bind:this={panelsElement}
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
{/if}

<style>
  .home-overview {
    isolation: isolate;
    position: relative;
    display: flex;
    min-height: 100%;
    width: 100%;
    flex-direction: column;
    align-items: center;
    padding: clamp(1.5rem, 5vh, 3rem) 1.5rem;
  }

  .home-stage {
    position: relative;
    display: flex;
    width: min(100%, 56rem);
    flex-direction: column;
    align-items: center;
    margin-block: auto;
  }

  .home-hero {
    position: relative;
    z-index: 20;
    display: flex;
    width: 100%;
    flex-direction: column;
    align-items: center;
    gap: 1.35rem;
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
  }

  .home-search-card {
    display: flex;
    width: 100%;
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

  .home-panels {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2.5rem;
    margin-top: 3.25rem;
    opacity: 1;
    transform: translate3d(0, 0, 0);
    transition:
      opacity var(--motion-duration-medium1) var(--motion-easing-emphasized-decelerate),
      transform var(--motion-duration-medium2) var(--motion-easing-emphasized-decelerate),
      visibility 0s linear 0s;
  }

  .home-panels--hidden {
    position: absolute;
    top: var(--home-panels-exit-top, 100%);
    right: 0;
    left: 0;
    margin-top: 0;
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
    transform: translate3d(0, 12px, 0);
    transition:
      opacity var(--motion-duration-short3) var(--motion-easing-emphasized-accelerate),
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-accelerate),
      visibility 0s linear var(--motion-duration-short4);
  }

  .home-panels--collapsed {
    display: none;
  }

  @media (max-width: 820px) {
    .home-panels {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.5rem;
    }
  }

  @media (pointer: coarse) {
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
  }
</style>
