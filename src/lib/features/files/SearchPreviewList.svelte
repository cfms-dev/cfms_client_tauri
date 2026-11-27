<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import type { SearchDirectoryEntry, SearchDocumentEntry } from '#lib/api.ts';
  import type { SearchResultRow } from '#lib/features/files/search-grouping.ts';
  import { formatBytes, formatDate } from '#lib/shared/format/values.ts';
  import Icon from '#lib/shared/ui/Icon.svelte';
  import ProgressRing from '#lib/shared/ui/ProgressRing.svelte';

  interface Props {
    id: string;
    optionIdPrefix: string;
    rows: readonly SearchResultRow[];
    query: string;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
    activeIndex: number;
    borderTop?: boolean;
    animateExpand?: boolean;
    maxHeight?: string;
    onSelectDirectory: (directory: SearchDirectoryEntry) => void;
    onSelectDocument: (document: SearchDocumentEntry) => void;
    onScroll: (event: Event) => void;
  }

  let {
    id,
    optionIdPrefix,
    rows,
    query,
    loading,
    loadingMore,
    error,
    activeIndex,
    borderTop = false,
    animateExpand = false,
    maxHeight = 'min(364px, 52vh)',
    onSelectDirectory,
    onSelectDocument,
    onScroll,
  }: Props = $props();

  function searchResultDate(row: SearchResultRow) {
    return row.kind === 'directory'
      ? formatDate(row.directory.created_time)
      : formatDate(row.document.last_modified ?? null);
  }
</script>

<div
  {id}
  class="search-preview-list"
  class:search-preview-list--border-top={borderTop}
  class:search-preview-list--animated={animateExpand}
  style:--search-preview-max-height={maxHeight}
  role="listbox"
  tabindex="-1"
  aria-label={$t('files.searchPreviewResults')}
  onscroll={onScroll}
>
  {#if error}
    <p class="search-preview-status search-preview-status--error">
      {error}
    </p>
  {:else if rows.length === 0 && !loading && query.length > 0}
    <p class="search-preview-status">
      {$t('files.searchNoResults', { values: { query } })}
    </p>
  {:else if rows.length > 0}
    {#each rows as row, index (row.kind === 'directory' ? `dir:${row.directory.id}` : `doc:${row.document.id}`)}
      <button
        id={`${optionIdPrefix}-${index}`}
        type="button"
        class="search-preview-row"
        class:search-preview-row--active={activeIndex === index}
        class:search-preview-row--last={index === rows.length - 1 && !loadingMore}
        role="option"
        aria-selected={activeIndex === index}
        tabindex="-1"
        onmousedown={(event) => event.preventDefault()}
        onclick={() =>
          row.kind === 'directory'
            ? onSelectDirectory(row.directory)
            : onSelectDocument(row.document)}
      >
        <span
          class="search-preview-icon"
          class:search-preview-icon--directory={row.kind === 'directory'}
        >
          <Icon name={row.kind === 'directory' ? 'folder' : 'filePresent'} size="20px" />
        </span>
        <span class="search-preview-main">
          <span
            class="search-preview-title"
            class:search-preview-title--directory={row.kind === 'directory'}
          >
            {row.kind === 'directory'
              ? row.directory.name
              : (row.document.name ?? row.document.title)}
          </span>
          <span class="search-preview-meta">
            {row.kind === 'directory'
              ? $t('files.searchDirectories')
              : formatBytes(row.document.size)}
          </span>
        </span>
        <span class="search-preview-date">{searchResultDate(row)}</span>
      </button>
    {/each}
    {#if loadingMore}
      <div class="search-preview-loading-more">
        <ProgressRing size={15} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
        <span>{$t('common.loadingEllipsis')}</span>
      </div>
    {/if}
  {:else if loading}
    <div class="search-preview-status search-preview-loading">
      <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
      <span>{$t('common.loadingEllipsis')}</span>
    </div>
  {/if}
</div>

<style>
  .search-preview-list {
    max-height: var(--search-preview-max-height, min(364px, 52vh));
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .search-preview-list:focus {
    outline: none;
  }

  .search-preview-list--border-top {
    border-top: 1px solid var(--colorNeutralStroke2);
  }

  .search-preview-list--animated {
    animation: search-preview-expand var(--motion-duration-medium1)
      var(--motion-easing-emphasized-decelerate) both;
  }

  @keyframes search-preview-expand {
    from {
      opacity: 0;
      transform: translate3d(0, -6px, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  .search-preview-row {
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

  .search-preview-row:hover,
  .search-preview-row--active {
    background: var(--colorNeutralBackground1Hover);
  }

  .search-preview-row:active {
    background: var(--colorNeutralBackground1Pressed);
  }

  .search-preview-row--last {
    border-bottom: 0;
  }

  .search-preview-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--colorNeutralForeground3);
  }

  .search-preview-icon--directory {
    color: var(--colorBrandForeground1);
  }

  .search-preview-main {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .search-preview-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--colorNeutralForeground1);
    font: 500 14px/20px var(--fontFamilyBase);
  }

  .search-preview-title--directory {
    color: var(--colorBrandForeground1);
  }

  .search-preview-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
    font-variant-numeric: tabular-nums;
  }

  .search-preview-date {
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .search-preview-status {
    margin: 0;
    padding: 1.75rem 1rem;
    color: var(--colorNeutralForeground3);
    font: 400 14px/20px var(--fontFamilyBase);
    text-align: center;
  }

  .search-preview-status--error {
    color: var(--colorStatusDangerForeground1);
  }

  .search-preview-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .search-preview-loading-more {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  @media (prefers-reduced-motion: reduce) {
    .search-preview-list--animated {
      animation: none;
    }
  }

  @media (forced-colors: active) {
    .search-preview-row:hover,
    .search-preview-row--active {
      color: HighlightText;
      background: Highlight;
    }
  }
</style>
