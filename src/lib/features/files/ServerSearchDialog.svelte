<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { _ as t } from 'svelte-i18n';
  import type { SearchDirectoryEntry, SearchDocumentEntry, SearchFilesResponse } from '$lib/api';
  import type { SortDirection, SortField } from '$lib/features/files/sorting';
  import { formatBytes, formatDate } from '$lib/shared/format/values';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MdCheckbox from '$lib/shared/ui/MdCheckbox.svelte';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import VirtualList from '$lib/shared/ui/VirtualList.svelte';
  import { focusRovingItem } from '$lib/shared/ui/keyboard';

  export type SearchResultRow =
    | { kind: 'directory'; directory: SearchDirectoryEntry }
    | { kind: 'document'; document: SearchDocumentEntry };

  interface Props {
    open: boolean;
    query: string;
    resultQuery: string;
    searchDocuments: boolean;
    searchDirectories: boolean;
    sortBy: SortField;
    sortOrder: SortDirection;
    loading: boolean;
    results: SearchFilesResponse | null;
    inputElement?: HTMLInputElement | null;
    onClose: () => void;
    onSubmit: () => void;
    onSortField: (field: SortField) => void;
    onToggleSortOrder: () => void;
    onSelectDirectory: (directory: SearchDirectoryEntry) => void;
    onSelectDocument: (document: SearchDocumentEntry) => void;
  }

  let {
    open,
    query = $bindable(''),
    resultQuery,
    searchDocuments = $bindable(true),
    searchDirectories = $bindable(true),
    sortBy,
    sortOrder,
    loading,
    results,
    inputElement = $bindable(null),
    onClose,
    onSubmit,
    onSortField,
    onToggleSortOrder,
    onSelectDirectory,
    onSelectDocument,
  }: Props = $props();

  const coarsePointer = new MediaQuery('(pointer: coarse)', false);
  const searchRowHeight = $derived(coarsePointer.current ? 48 : 40);
  const resetKey = $derived(
    `${resultQuery}:${sortBy}:${sortOrder}:${searchDocuments}:${searchDirectories}`,
  );
  const searchResultRows = $derived.by<SearchResultRow[]>(() => {
    if (!results) return [];
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
  });

  function searchSortLabel(field: SortField) {
    return field === 'name'
      ? $t('files.searchSortName')
      : field === 'size'
        ? $t('files.searchSortSize')
        : $t('files.searchSortModified');
  }
</script>

{#if open}
  <ModalFrame
    title={$t('files.searchTitle')}
    maxWidth="max-w-3xl"
    resizable
    maximizable
    minWidth={520}
    minHeight={360}
    closeLabel={$t('common.close')}
    {onClose}
  >
    <form
      class="server-search-form"
      style:--search-row-height={`${searchRowHeight}px`}
      onsubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div class="server-search-query">
        <div class="files-search-field cfms-field-surface" data-search-box>
          <input
            class="files-search-input cfms-native-field"
            data-focus-ring="delegated"
            bind:value={query}
            bind:this={inputElement}
            placeholder={$t('files.searchPlaceholder')}
            aria-label={$t('files.searchPlaceholder')}
            disabled={loading}
          />
          {#if query}
            <FluentButton
              data-fluent-owner="routes-home-files-page"
              type="button"
              appearance="subtle"
              class="files-search-clear"
              iconOnly
              aria-label={$t('common.clear')}
              disabled={loading}
              onclick={() => {
                query = '';
                inputElement?.focus({ preventScroll: true });
              }}
            >
              <Icon name="close" size="16px" />
            </FluentButton>
          {/if}
        </div>
        <FluentButton
          data-fluent-owner="routes-home-files-page"
          type="submit"
          disabled={loading}
          appearance="primary"
          class="server-search-action"
        >
          <Icon name="search" size="16px" />
          {$t('files.serverSearch')}
        </FluentButton>
      </div>

      <div class="server-search-controls">
        <label class="flex items-center gap-2">
          <MdCheckbox
            bind:checked={searchDocuments}
            ariaLabel={$t('files.searchDocuments')}
            disabled={loading}
          />
          {$t('files.searchDocuments')}
        </label>
        <label class="flex items-center gap-2">
          <MdCheckbox
            bind:checked={searchDirectories}
            ariaLabel={$t('files.searchDirectories')}
            disabled={loading}
          />
          {$t('files.searchDirectories')}
        </label>

        <div
          class="search-sort"
          role="toolbar"
          tabindex="-1"
          aria-label={$t('workspace.sort')}
          onkeydown={(event) =>
            focusRovingItem(event, event.currentTarget as HTMLElement, {
              selector: '[data-search-sort]',
              orientation: 'horizontal',
            })}
        >
          {#each ['name', 'size', 'modified'] as field}
            <button
              data-fluent-owner="routes-home-files-page"
              data-search-sort
              tabindex={sortBy === field ? 0 : -1}
              type="button"
              class="search-sort-option"
              aria-pressed={sortBy === field}
              disabled={loading}
              onclick={() => onSortField(field as SortField)}
            >
              {searchSortLabel(field as SortField)}
            </button>
          {/each}
        </div>
        <FluentButton
          data-fluent-owner="routes-home-files-page"
          type="button"
          disabled={loading}
          title={sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
          onclick={onToggleSortOrder}
          appearance="outline"
          class="server-search-action"
        >
          <Icon name={sortOrder === 'asc' ? 'arrowUpward' : 'arrowDownward'} size="16px" />
          {sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
        </FluentButton>
      </div>

      {#if results}
        <div class="server-search-results">
          <div class="server-search-summary" role="status">
            <span>
              {results.total_count === 0 && !loading
                ? $t('files.searchNoResults', { values: { query: resultQuery } })
                : $t('files.searchResultCount', {
                    values: { count: results.total_count, query: resultQuery },
                  })}
            </span>
            {#if loading}
              <span class="inline-flex shrink-0 items-center gap-2">
                <ProgressRing size={14} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
                {$t('common.loadingEllipsis')}
              </span>
            {/if}
          </div>
          <VirtualList
            items={searchResultRows}
            keyOf={(row) =>
              row.kind === 'directory'
                ? `directory:${row.directory.id}`
                : `document:${row.document.id}`}
            estimateSize={searchRowHeight}
            overscan={10}
            threshold={120}
            {resetKey}
            viewportClass="server-search-list-viewport"
            keyboardNavigation
            keyboardTargetSelector="button"
          >
            {#snippet children(row, index)}
              {#if row.kind === 'directory'}
                <button
                  type="button"
                  onclick={() => onSelectDirectory(row.directory)}
                  class="server-search-result"
                  class:server-search-result--last={index === searchResultRows.length - 1}
                >
                  <span class="text-md3-primary-emphasis"><Icon name="folder" size="20px" /></span>
                  <span class="server-search-result-name">{row.directory.name}</span>
                  <span class="server-search-result-detail">{formatDate(row.directory.created_time)}</span>
                </button>
              {:else}
                <button
                  type="button"
                  onclick={() => onSelectDocument(row.document)}
                  class="server-search-result"
                  class:server-search-result--last={index === searchResultRows.length - 1}
                >
                  <span class="text-md3-on-surface-variant"><Icon name="filePresent" size="20px" /></span>
                  <span class="server-search-result-name">{row.document.name ?? row.document.title}</span>
                  <span class="server-search-result-detail">{formatBytes(row.document.size)}</span>
                </button>
              {/if}
            {/snippet}
          </VirtualList>
        </div>
      {:else if loading}
        <div class="flex items-center gap-2 py-6 text-sm text-md3-on-surface-variant">
          <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {$t('common.loadingEllipsis')}
        </div>
      {/if}
    </form>
  </ModalFrame>
{/if}

<style>
  .files-search-field {
    display: flex;
    min-width: 0;
    box-sizing: border-box;
    height: var(--files-field-height);
    align-items: center;
    gap: 2px;
    border: 1px solid var(--colorNeutralStroke1);
    border-bottom-color: var(--colorNeutralStrokeAccessible);
    border-radius: var(--borderRadiusMedium);
    padding: 0;
    color: var(--colorNeutralForeground1);
    background: transparent;
  }
  .files-search-field:hover {
    border-color: var(--colorNeutralStroke1Hover);
  }
  [data-search-box]:has([data-focus-ring='delegated']:focus) {
    border-color: var(--colorStrokeFocus2);
    box-shadow: inset 0 -1px var(--colorStrokeFocus2);
  }
  .files-search-input {
    width: 0;
    min-width: 0;
    flex: 1;
    align-self: stretch;
    border: 0;
    padding: 5px 10px;
    text-overflow: ellipsis;
    color: inherit;
    background: transparent;
    font: 400 14px/20px var(--fontFamilyBase);
  }
  .files-search-input::placeholder {
    color: var(--colorNeutralForeground3);
    opacity: 1;
  }
  :global(.files-search-clear[data-fluent-owner='routes-home-files-page']) {
    flex: none;
    inline-size: calc(var(--files-field-height) - 2px);
    block-size: calc(var(--files-field-height) - 2px);
    min-block-size: 0;
    min-inline-size: 0;
    padding: 0;
    color: var(--colorNeutralForeground2);
  }

  :global(.server-search-list-viewport) {
    min-height: 0;
    flex: 1 1 auto;
    max-height: calc(52vh - 2.25rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .server-search-form {
    --files-field-height: 32px;
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    color: var(--colorNeutralForeground1);
  }
  .server-search-query {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    flex: none;
  }
  .server-search-controls {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
    color: var(--colorNeutralForeground2);
    font: 400 14px/20px var(--fontFamilyBase);
  }
  :global(.server-search-action[data-fluent-owner='routes-home-files-page']) {
    font-weight: 400;
  }
  .server-search-results {
    container-type: inline-size;
    display: flex;
    min-height: 0;
    flex: 1 1 auto;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: var(--borderRadiusLarge);
  }
  .server-search-summary {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    border-bottom: 1px solid var(--colorNeutralStroke2);
    padding: 8px 12px;
    color: var(--colorNeutralForeground2);
    font: 400 12px/16px var(--fontFamilyBase);
  }
  .server-search-result {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: var(--search-row-height);
    border: 0;
    border-bottom: 1px solid var(--colorNeutralStroke2);
    border-radius: 0;
    padding: 8px 12px;
    background: transparent;
    color: var(--colorNeutralForeground1);
    text-align: left;
    font: 400 14px/20px var(--fontFamilyBase);
    transition: background-color var(--durationFaster) var(--curveEasyEase);
  }
  .server-search-result:hover {
    background: var(--colorNeutralBackground1Hover);
  }
  .server-search-result:active {
    background: var(--colorNeutralBackground1Pressed);
  }
  .server-search-result:focus-visible {
    outline-offset: -2px;
  }
  .server-search-result--last {
    border-bottom: 0;
  }
  .server-search-result-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .server-search-result-detail {
    color: var(--colorNeutralForeground2);
    text-align: right;
    font: 400 12px/16px var(--fontFamilyBase);
  }

  @container (max-width: 480px) {
    .server-search-result {
      gap: 4px 12px;
    }
    .server-search-result > :first-child {
      grid-row: span 2;
    }
    .server-search-result-name {
      grid-column: 2 / -1;
    }
    .server-search-result-detail {
      grid-column: 2 / -1;
      text-align: left;
    }
  }

  :global(.modal-positioner--sized .server-search-list-viewport),
  :global(.modal-positioner--maximized .server-search-list-viewport) {
    max-height: none;
  }

  .search-sort {
    display: flex;
    max-width: 100%;
    flex-wrap: wrap;
    gap: 2px;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium);
    padding: 2px;
  }
  .search-sort-option {
    min-height: 32px;
    border-radius: var(--borderRadiusMedium);
    padding: 4px 12px;
    color: var(--colorNeutralForeground2);
    font: 400 14px/20px var(--fontFamilyBase);
    transition: background-color var(--durationFaster) var(--curveEasyEase);
  }
  .search-sort-option:hover:not(:disabled) {
    background: var(--colorNeutralBackground1Hover);
  }
  .search-sort-option[aria-pressed='true'] {
    color: var(--colorBrandForeground1);
    background: var(--colorBrandBackground2);
    box-shadow: inset 0 -2px var(--colorBrandStroke1);
  }
  .search-sort-option:disabled {
    color: var(--colorNeutralForegroundDisabled);
  }

  @media (pointer: coarse) {
    .files-search-input {
      font-size: 16px;
    }
    .server-search-form {
      --files-field-height: 44px;
    }
    .search-sort-option {
      min-height: 44px;
    }
  }
  @media (forced-colors: active) {
    .files-search-field {
      color: FieldText;
      background: Field;
      border-color: ButtonText;
    }
    [data-search-box]:has([data-focus-ring='delegated']:focus) {
      outline: 2px solid Highlight;
      outline-offset: -2px;
      box-shadow: none;
    }
    .search-sort-option[aria-pressed='true'] {
      color: HighlightText;
      background: Highlight;
      box-shadow: none;
      outline: 1px solid Highlight;
    }
  }
</style>
