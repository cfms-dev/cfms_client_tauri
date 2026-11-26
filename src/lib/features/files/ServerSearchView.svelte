<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { MediaQuery } from 'svelte/reactivity';
  import type { TransitionConfig } from 'svelte/transition';
  import { _ as t, locale } from 'svelte-i18n';
  import type {
    SearchDirectoryEntry,
    SearchDocumentEntry,
    SearchFilesResponse,
  } from '$lib/api';
  import {
    buildGroupedSearchDisplayRows,
    toSearchResultRows,
    type SearchDisplayRow,
  } from '$lib/features/files/search-grouping';
  import type { SearchTypeFilter } from '$lib/features/files/server-search-controller.svelte.ts';
  import type { SortDirection, SortField } from '$lib/features/files/sorting';
  import { isReducedMotionEnabled } from '$lib/shared/appearance';
  import { formatBytes, formatDate } from '$lib/shared/format/values';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import VirtualList from '$lib/shared/ui/VirtualList.svelte';
  import { focusRovingItem } from '$lib/shared/ui/keyboard';

  interface Props {
    query: string;
    resultQuery: string;
    filter: SearchTypeFilter;
    sortBy: SortField;
    sortOrder: SortDirection;
    loading: boolean;
    results: SearchFilesResponse | null;
    inputElement?: HTMLInputElement | null;
    onClose: () => void;
    onSubmit: () => void;
    onFilterChange: (filter: SearchTypeFilter) => void;
    onSelectSort: (field: SortField) => void;
    onSelectParentDirectory: (parentId: string) => void;
    onSelectDirectory: (directory: SearchDirectoryEntry) => void;
    onSelectDocument: (document: SearchDocumentEntry) => void;
  }

  let {
    query = $bindable(''),
    resultQuery,
    filter,
    sortBy,
    sortOrder,
    loading,
    results,
    inputElement = $bindable(null),
    onClose,
    onSubmit,
    onFilterChange,
    onSelectSort,
    onSelectParentDirectory,
    onSelectDirectory,
    onSelectDocument,
  }: Props = $props();

  const FILTER_TABS: readonly { id: SearchTypeFilter; labelKey: string }[] = [
    { id: 'all', labelKey: 'files.searchFilterAll' },
    { id: 'documents', labelKey: 'files.searchDocuments' },
    { id: 'directories', labelKey: 'files.searchFilterDirectories' },
  ];

  const SORT_FIELDS: readonly SortField[] = ['name', 'size', 'modified'];

  const coarsePointer = new MediaQuery('(pointer: coarse)', false);
  const itemRowHeight = $derived(coarsePointer.current ? 64 : 56);

  let searchBoxFocused = $state(false);
  let tabListElement = $state<HTMLDivElement | null>(null);
  let indicatorStyle = $state('');
  let indicatorReady = $state(false);

  const hasText = $derived(query.length > 0);
  const hasSubmitQuery = $derived(query.trim().length > 0);
  const showSubmitAction = $derived(searchBoxFocused);
  const showActionDivider = $derived(hasText && showSubmitAction);

  const resetKey = $derived(`${resultQuery}:${filter}:${sortBy}:${sortOrder}`);
  const displayRows = $derived.by<SearchDisplayRow[]>(() =>
    buildGroupedSearchDisplayRows(toSearchResultRows(results)),
  );
  const totalCount = $derived(results?.total_count ?? 0);
  const formattedTotalCount = $derived.by(() => {
    try {
      return new Intl.NumberFormat($locale || undefined).format(totalCount);
    } catch {
      return String(totalCount);
    }
  });
  const countLabel = $derived(
    totalCount === 1
      ? $t('files.searchResultCountCompactSingular', { values: { count: formattedTotalCount } })
      : $t('files.searchResultCountCompact', { values: { count: formattedTotalCount } }),
  );

  function sortFieldLabel(field: SortField): string {
    if (field === 'name') return $t('files.searchSortName');
    if (field === 'size') return $t('files.searchSortSize');
    return $t('files.searchSortModified');
  }

  function estimateDisplayRowSize(index: number): number {
    const row = displayRows[index];
    if (!row) return itemRowHeight;
    if (row.kind === 'group-header') {
      return row.firstGroup ? 34 : 46;
    }
    return itemRowHeight;
  }

  function actionSlotReveal(
    node: HTMLElement,
    params: { shiftX?: number } = {},
    options: { direction?: 'in' | 'out' | 'both' } = {},
  ): TransitionConfig {
    if (isReducedMotionEnabled()) return { duration: 0 };
    const direction = options.direction ?? 'in';
    const shiftX = params.shiftX ?? 0;
    const style = getComputedStyle(node);
    const width = node.getBoundingClientRect().width || parseFloat(style.width) || 32;
    const marginLeft = parseFloat(style.marginLeft) || 0;
    const marginRight = parseFloat(style.marginRight) || 0;

    return {
      duration: direction === 'out' ? 120 : 160,
      easing: direction === 'out' ? cubicIn : cubicOut,
      css: (t, u) =>
        `width: ${t * width}px; margin-left: ${t * marginLeft}px; margin-right: ${t * marginRight}px; opacity: ${t}; transform: translate3d(${u * shiftX}px, 0, 0) scale(${0.88 + t * 0.12}); overflow: hidden;`,
    };
  }

  function streamingFade(
    _node: HTMLElement,
    _params: Record<string, never> = {},
    options: { direction?: 'in' | 'out' | 'both' } = {},
  ): TransitionConfig {
    if (isReducedMotionEnabled()) return { duration: 0 };
    const direction = options.direction ?? 'in';
    return {
      duration: direction === 'out' ? 150 : 180,
      easing: direction === 'out' ? cubicIn : cubicOut,
      css: (t) => `opacity: ${t}; transform: scale(${0.88 + t * 0.12});`,
    };
  }

  function syncTabIndicator() {
    if (!tabListElement) return;
    const activeTab = tabListElement.querySelector<HTMLElement>(`[data-filter-tab="${filter}"]`);
    if (!activeTab) return;
    const left = activeTab.offsetLeft;
    const width = activeTab.offsetWidth;
    indicatorStyle = `transform: translate3d(${left}px, 0, 0); width: ${width}px;`;
    indicatorReady = true;
  }

  $effect(() => {
    filter;
    $locale;
    void tick().then(syncTabIndicator);
  });

  onMount(() => {
    void tick().then(syncTabIndicator);
    if (!tabListElement || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncTabIndicator);
    observer.observe(tabListElement);
    return () => observer.disconnect();
  });

  function handleSearchBoxFocusIn() {
    searchBoxFocused = true;
  }

  function handleSearchBoxFocusOut(event: FocusEvent) {
    const container = event.currentTarget as HTMLElement;
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && container.contains(nextTarget)) return;
    searchBoxFocused = false;
  }

  function handleClearQuery() {
    query = '';
    inputElement?.focus({ preventScroll: true });
  }

  function handleViewKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      onClose();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="search-view"
  aria-label={$t('files.searchTitle')}
  onkeydown={handleViewKeydown}
>
  <div class="search-view-stage">
    <header class="search-view-header">
    <button
      type="button"
      class="search-view-back"
      data-search-back
      onclick={onClose}
    >
      <span class="search-view-back-icon">
        <Icon name="chevronLeft" size="16px" />
      </span>
      <span>{$t('common.back')}</span>
    </button>

    <form
      class="search-view-form"
      onsubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div
        class="search-view-box cfms-field-surface"
        class:search-view-box--focused={searchBoxFocused}
        data-search-box
        onfocusin={handleSearchBoxFocusIn}
        onfocusout={handleSearchBoxFocusOut}
      >
        <input
          type="text"
          class="search-view-input cfms-native-field"
          data-focus-ring="delegated"
          bind:value={query}
          bind:this={inputElement}
          placeholder={$t('files.searchPlaceholder')}
          aria-label={$t('files.searchPlaceholder')}
        />

        <div class="search-view-box-actions">
          {#if hasText}
            <div
              class="search-box-action-slot"
              transition:actionSlotReveal={{ shiftX: 4 }}
            >
              <button
                type="button"
                class="search-box-action"
                data-search-clear
                aria-label={$t('common.clear')}
                title={$t('common.clear')}
                onmousedown={(event) => event.preventDefault()}
                onclick={handleClearQuery}
              >
                <Icon name="close" size="18px" />
              </button>
            </div>
          {/if}

          {#if showActionDivider}
            <span
              class="search-box-divider"
              aria-hidden="true"
              transition:actionSlotReveal={{ shiftX: 0 }}
            ></span>
          {/if}

          {#if showSubmitAction}
            <div
              class="search-box-action-slot"
              transition:actionSlotReveal={{ shiftX: 6 }}
            >
              <button
                type="submit"
                class="search-box-action search-box-action--submit"
                data-search-submit
                aria-label={$t('files.serverSearch')}
                title={$t('files.serverSearch')}
                disabled={!hasSubmitQuery}
                onmousedown={(event) => event.preventDefault()}
              >
                <span class="search-box-submit-icon">
                  <Icon name="arrowForward" size="18px" />
                </span>
              </button>
            </div>
          {/if}
        </div>
      </div>
    </form>

    <div class="search-view-toolbar">
      <div
        class="search-filter-tabs"
        role="tablist"
        aria-label={$t('files.filter')}
        tabindex="-1"
        bind:this={tabListElement}
        onkeydown={(event) =>
          focusRovingItem(event, event.currentTarget as HTMLElement, {
            selector: '[data-filter-tab]',
            orientation: 'horizontal',
          })}
      >
        {#each FILTER_TABS as tab (tab.id)}
          <button
            type="button"
            role="tab"
            class="search-filter-tab"
            class:search-filter-tab--active={filter === tab.id}
            data-filter-tab={tab.id}
            aria-selected={filter === tab.id}
            tabindex={filter === tab.id ? 0 : -1}
            onclick={() => onFilterChange(tab.id)}
          >
            {$t(tab.labelKey)}
          </button>
        {/each}
        {#if indicatorReady}
          <span
            class="search-filter-indicator"
            style={indicatorStyle}
            aria-hidden="true"
          ></span>
        {/if}
      </div>

      <div class="search-sort-controls">
        <span class="search-sort-label">
          <Icon name="sort" size="16px" />
          <span>{$t('workspace.sort')}</span>
        </span>
        <span class="search-sort-divider" aria-hidden="true"></span>
        <div
          class="search-sort-fields"
          role="toolbar"
          aria-label={$t('workspace.sort')}
          tabindex="-1"
          onkeydown={(event) =>
            focusRovingItem(event, event.currentTarget as HTMLElement, {
              selector: '[data-search-sort]',
              orientation: 'horizontal',
            })}
        >
          {#each SORT_FIELDS as field (field)}
            <button
              type="button"
              class="search-sort-field"
              class:search-sort-field--active={sortBy === field}
              data-search-sort={field}
              aria-pressed={sortBy === field}
              tabindex={sortBy === field ? 0 : -1}
              onclick={() => onSelectSort(field)}
            >
              <span>{sortFieldLabel(field)}</span>
              {#if sortBy === field}
                {#key sortOrder}
                  <span
                    class="search-sort-arrow"
                    data-sort-direction={sortOrder}
                  >
                    <Icon
                      name={sortOrder === 'asc' ? 'arrowSortUp' : 'arrowSortDown'}
                      size="14px"
                    />
                  </span>
                {/key}
              {/if}
            </button>
          {/each}
        </div>
      </div>
    </div>
  </header>

  <div class="search-view-body" style:--search-item-height={`${itemRowHeight}px`}>
    {#if results !== null}
      <div class="search-view-summary" role="status" aria-live="polite" data-search-count>
        <span class="search-view-count-text">{countLabel}</span>
        {#if loading}
          <span class="search-view-streaming" transition:streamingFade>
            <ProgressRing size={13} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
          </span>
        {/if}
      </div>

      {#if displayRows.length === 0 && !loading}
        <p class="search-view-empty">
          {$t('files.searchNoResults', { values: { query: resultQuery } })}
        </p>
      {:else if displayRows.length > 0}
        {#key resetKey}
          <div class="search-view-results-shell">
            <VirtualList
              items={displayRows}
              keyOf={(row) => row.key}
              estimateSize={estimateDisplayRowSize}
              overscan={10}
              threshold={100}
              {resetKey}
              viewportClass="search-view-list-viewport"
              keyboardNavigation
              keyboardTargetSelector="button"
            >
              {#snippet children(row)}
                {#if row.kind === 'group-header'}
                  <div
                    class="search-group-header-wrap"
                    class:search-group-header-wrap--spaced={!row.firstGroup}
                  >
                    <button
                      type="button"
                      class="search-group-header"
                      data-search-group-header={row.parentId}
                      title={row.parentId}
                      aria-label={$t('files.searchOpenParentDirectory', {
                        values: { id: row.parentId },
                      })}
                      onclick={() => onSelectParentDirectory(row.parentId)}
                    >
                      <span class="search-group-chevron">
                        <Icon name="navigateNext" size="14px" />
                      </span>
                      <span class="search-group-id">{row.parentId}</span>
                    </button>
                  </div>
                {:else if row.kind === 'directory'}
                  <button
                    type="button"
                    class="search-result-row"
                    data-search-result-kind="directory"
                    onclick={() => onSelectDirectory(row.directory)}
                  >
                    <span class="search-result-icon search-result-icon--directory">
                      <Icon name="folder" size="20px" />
                    </span>
                    <span class="search-result-main">
                      <span class="search-result-name">{row.directory.name}</span>
                      <span class="search-result-meta">{$t('files.directory')}</span>
                    </span>
                    <span class="search-result-date">
                      {formatDate(row.directory.created_time)}
                    </span>
                  </button>
                {:else}
                  <button
                    type="button"
                    class="search-result-row"
                    data-search-result-kind="document"
                    onclick={() => onSelectDocument(row.document)}
                  >
                    <span class="search-result-icon">
                      <Icon name="filePresent" size="20px" />
                    </span>
                    <span class="search-result-main">
                      <span class="search-result-name">
                        {row.document.name ?? row.document.title}
                      </span>
                      <span class="search-result-meta">
                        {formatBytes(row.document.size)}
                      </span>
                    </span>
                    <span class="search-result-date">
                      {formatDate(row.document.last_modified ?? null)}
                    </span>
                  </button>
                {/if}
              {/snippet}
            </VirtualList>
          </div>
        {/key}
      {/if}
    {:else if loading}
      <div class="search-view-loading" role="status" aria-live="polite">
        <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
        <span>{$t('common.loadingEllipsis')}</span>
      </div>
    {/if}
    </div>
  </div>
</section>

<style>
  .search-view {
    display: flex;
    height: 100%;
    min-height: 0;
    width: 100%;
    flex-direction: column;
    overflow: hidden;
    padding: 16px 28px 0;
    color: var(--colorNeutralForeground1);
    background: transparent;
  }

  .search-view-stage {
    display: flex;
    min-height: 0;
    flex: 1 1 auto;
    width: 100%;
    flex-direction: column;
    animation: search-view-enter 220ms var(--motion-easing-emphasized-decelerate) both;
  }

  @keyframes search-view-enter {
    from {
      opacity: 0;
      transform: translate3d(0, 10px, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  .search-view-header {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 16px;
  }

  .search-view-back {
    display: inline-flex;
    align-self: flex-start;
    min-height: 32px;
    align-items: center;
    gap: 6px;
    border: 0;
    border-radius: var(--borderRadiusMedium);
    padding: 4px 10px 4px 4px;
    color: var(--colorNeutralForeground2);
    background: transparent;
    font: 400 13px/18px var(--fontFamilyBase);
    transition:
      color var(--durationFaster) var(--curveEasyEase),
      background-color var(--durationFaster) var(--curveEasyEase);
  }

  .search-view-back:hover {
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1Hover);
  }

  .search-view-back:active {
    background: var(--colorNeutralBackground1Pressed);
  }

  .search-view-back-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform 140ms var(--curveEasyEase);
  }

  .search-view-back:hover .search-view-back-icon {
    transform: translate3d(-2px, 0, 0);
  }

  .search-view-form {
    width: min(100%, 44rem);
  }

  .search-view-box {
    display: flex;
    height: 44px;
    min-width: 0;
    align-items: center;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: 999px;
    padding: 0 8px 0 4px;
    color: var(--colorNeutralForeground1);
    transition:
      border-color 150ms var(--curveEasyEase),
      box-shadow 180ms var(--motion-easing-emphasized-decelerate);
  }

  .search-view-box:hover {
    border-color: var(--colorNeutralStroke1Hover);
  }

  [data-search-box]:has([data-focus-ring='delegated']:focus),
  .search-view-box--focused {
    border-color: var(--colorStrokeFocus2);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--colorStrokeFocus2) 35%, transparent);
  }

  .search-view-input {
    width: 0;
    min-width: 0;
    flex: 1;
    align-self: stretch;
    border: 0;
    padding: 0 10px 0 16px;
    text-overflow: ellipsis;
    color: inherit;
    background: transparent;
    font: 400 15px/22px var(--fontFamilyBase);
  }

  .search-view-input::placeholder {
    color: var(--colorNeutralForeground3);
    opacity: 1;
  }

  .search-view-box-actions {
    display: flex;
    flex: none;
    align-items: center;
  }

  .search-box-action-slot {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
  }

  .search-box-action {
    display: inline-flex;
    width: 34px;
    height: 34px;
    flex: none;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 999px;
    padding: 0;
    color: var(--colorNeutralForeground2);
    background: transparent;
    transition:
      color var(--durationFaster) var(--curveEasyEase),
      background-color var(--durationFaster) var(--curveEasyEase);
  }

  .search-box-action:hover:not(:disabled) {
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1Hover);
  }

  .search-box-action:active:not(:disabled) {
    background: var(--colorNeutralBackground1Pressed);
  }

  .search-box-action:disabled {
    cursor: not-allowed;
    color: var(--colorNeutralForegroundDisabled);
  }

  .search-box-submit-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform 140ms var(--curveEasyEase);
  }

  .search-box-action--submit:hover:not(:disabled) .search-box-submit-icon {
    transform: translate3d(2px, 0, 0);
  }

  .search-box-divider {
    display: block;
    width: 1px;
    height: 20px;
    flex: none;
    margin-inline: 4px;
    background: var(--colorNeutralStroke2);
  }

  .search-view-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 24px;
    border-bottom: 1px solid var(--colorNeutralStroke2);
  }

  .search-filter-tabs {
    position: relative;
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 22px;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
  }

  .search-filter-tab {
    position: relative;
    flex: none;
    min-height: 36px;
    border: 0;
    border-radius: var(--borderRadiusSmall);
    padding: 8px 2px 10px;
    color: var(--colorNeutralForeground3);
    background: transparent;
    font: 400 13px/18px var(--fontFamilyBase);
    transition: color 140ms var(--curveEasyEase);
  }

  .search-filter-tab:hover {
    color: var(--colorNeutralForeground1);
  }

  .search-filter-tab--active {
    color: var(--colorNeutralForeground1);
    font-weight: 600;
  }

  .search-filter-indicator {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2px;
    border-radius: 2px;
    background: var(--colorNeutralForeground1);
    pointer-events: none;
    transition:
      transform 200ms var(--motion-easing-emphasized-decelerate),
      width 200ms var(--motion-easing-emphasized-decelerate);
  }

  .search-sort-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding-bottom: 4px;
    color: var(--colorNeutralForeground2);
    font: 400 13px/18px var(--fontFamilyBase);
  }

  .search-sort-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--colorNeutralForeground2);
    user-select: none;
  }

  .search-sort-divider {
    width: 1px;
    height: 14px;
    background: var(--colorNeutralStroke2);
  }

  .search-sort-fields {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .search-sort-field {
    display: inline-flex;
    min-height: 30px;
    align-items: center;
    gap: 4px;
    border: 0;
    border-radius: var(--borderRadiusMedium);
    padding: 4px 8px;
    color: var(--colorNeutralForeground3);
    background: transparent;
    font: 400 13px/18px var(--fontFamilyBase);
    transition:
      color var(--durationFaster) var(--curveEasyEase),
      background-color var(--durationFaster) var(--curveEasyEase);
  }

  .search-sort-field:hover {
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1Hover);
  }

  .search-sort-field:active {
    background: var(--colorNeutralBackground1Pressed);
  }

  .search-sort-field--active {
    color: var(--colorNeutralForeground1);
    font-weight: 600;
  }

  .search-sort-arrow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--colorNeutralForeground1);
    animation: search-sort-arrow-up-in 160ms var(--motion-easing-emphasized-decelerate) both;
  }

  .search-sort-arrow[data-sort-direction='desc'] {
    animation-name: search-sort-arrow-down-in;
  }

  @keyframes search-sort-arrow-up-in {
    from {
      opacity: 0;
      transform: translate3d(0, 3px, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes search-sort-arrow-down-in {
    from {
      opacity: 0;
      transform: translate3d(0, -3px, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  .search-view-body {
    container-type: inline-size;
    display: flex;
    min-height: 0;
    flex: 1 1 auto;
    flex-direction: column;
    overflow: hidden;
    padding-top: 14px;
  }

  .search-view-summary {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    padding-bottom: 10px;
    color: var(--colorNeutralForeground2);
    font: 400 13px/18px var(--fontFamilyBase);
  }

  .search-view-count-text {
    font-variant-numeric: tabular-nums;
  }

  .search-view-streaming {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .search-view-results-shell {
    display: flex;
    min-height: 0;
    flex: 1 1 auto;
    flex-direction: column;
    animation: search-results-reveal 180ms var(--motion-easing-emphasized-decelerate) both;
  }

  @keyframes search-results-reveal {
    from {
      opacity: 0;
      transform: translate3d(0, 6px, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  :global(.search-view-list-viewport) {
    min-height: 0;
    flex: 1 1 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: 24px;
  }

  .search-group-header-wrap {
    display: flex;
    align-items: center;
    padding-top: 2px;
    padding-bottom: 4px;
  }

  .search-group-header-wrap--spaced {
    padding-top: 16px;
  }

  .search-group-header {
    display: inline-flex;
    max-width: 100%;
    min-height: 28px;
    align-items: center;
    gap: 6px;
    border: 0;
    border-radius: var(--borderRadiusMedium);
    padding: 4px 8px 4px 2px;
    color: var(--colorNeutralForeground2);
    background: transparent;
    text-align: left;
    font: 400 12px/16px var(--fontFamilyBase);
    transition:
      color var(--durationFaster) var(--curveEasyEase),
      background-color var(--durationFaster) var(--curveEasyEase);
  }

  .search-group-header:hover {
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1Hover);
  }

  .search-group-header:active {
    background: var(--colorNeutralBackground1Pressed);
  }

  .search-group-chevron {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    color: var(--colorNeutralForeground3);
    transition:
      transform 140ms var(--curveEasyEase),
      color var(--durationFaster) var(--curveEasyEase);
  }

  .search-group-header:hover .search-group-chevron {
    color: var(--colorNeutralForeground1);
    transform: translate3d(2px, 0, 0);
  }

  .search-group-id {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search-result-row {
    display: grid;
    width: 100%;
    min-height: var(--search-item-height);
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    border: 0;
    border-radius: var(--borderRadiusLarge);
    padding: 8px 12px 8px 26px;
    color: var(--colorNeutralForeground1);
    background: transparent;
    text-align: left;
    transition: background-color var(--durationFaster) var(--curveEasyEase);
  }

  .search-result-row:hover {
    background: var(--colorNeutralBackground1Hover);
  }

  .search-result-row:active {
    background: var(--colorNeutralBackground1Pressed);
  }

  .search-result-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--colorNeutralForeground2);
  }

  .search-result-icon--directory {
    color: var(--explorer-folder);
  }

  .search-result-main {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .search-result-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--colorNeutralForeground1);
    font: 400 14px/20px var(--fontFamilyBase);
  }

  .search-result-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
    font-variant-numeric: tabular-nums;
  }

  .search-result-date {
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .search-view-loading {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 20px 2px;
    color: var(--colorNeutralForeground2);
    font: 400 14px/20px var(--fontFamilyBase);
  }

  .search-view-empty {
    margin: 0;
    padding: 24px 2px;
    color: var(--colorNeutralForeground3);
    font: 400 14px/20px var(--fontFamilyBase);
  }

  @container (max-width: 520px) {
    .search-result-row {
      gap: 4px 12px;
      padding-inline: 18px 8px;
    }
    .search-result-icon {
      grid-row: span 2;
    }
    .search-result-main {
      grid-column: 2 / -1;
    }
    .search-result-date {
      grid-column: 2 / -1;
    }
  }

  @media (max-width: 640px) {
    .search-view {
      padding: 12px 16px 0;
    }
  }

  @media (pointer: coarse) {
    .search-view-back,
    .search-filter-tab,
    .search-sort-field,
    .search-group-header {
      min-height: 44px;
    }
    .search-view-box {
      height: 48px;
    }
    .search-view-input {
      font-size: 16px;
    }
    .search-box-action {
      width: 40px;
      height: 40px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .search-view-stage,
    .search-view-results-shell,
    .search-sort-arrow {
      animation: none;
    }
    .search-view-back-icon,
    .search-box-submit-icon,
    .search-filter-indicator,
    .search-group-chevron {
      transition: none;
    }
  }

  :global(html[data-reduce-motion='true']) .search-view-stage,
  :global(html[data-reduce-motion='true']) .search-view-results-shell,
  :global(html[data-reduce-motion='true']) .search-sort-arrow {
    animation: none;
  }

  :global(html[data-reduce-motion='true']) .search-view-back-icon,
  :global(html[data-reduce-motion='true']) .search-box-submit-icon,
  :global(html[data-reduce-motion='true']) .search-filter-indicator,
  :global(html[data-reduce-motion='true']) .search-group-chevron {
    transition: none;
  }

  @media (forced-colors: active) {
    .search-view-box {
      color: FieldText;
      background: Field;
      border-color: ButtonText;
      box-shadow: none;
    }
    [data-search-box]:has([data-focus-ring='delegated']:focus),
    .search-view-box--focused {
      outline: 2px solid Highlight;
      outline-offset: -2px;
      box-shadow: none;
    }
    .search-filter-indicator {
      background: Highlight;
    }
    .search-sort-field--active {
      color: Highlight;
    }
    .search-result-row:hover,
    .search-group-header:hover {
      outline: 1px solid Highlight;
    }
  }
</style>
