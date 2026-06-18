<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { createVirtualizer, type VirtualItem } from '@tanstack/svelte-virtual';
  import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';
  import { formatBytes, formatDate } from '$lib/files/formatting';
  import type { SortField } from '$lib/files/sorting';
  import type { IconName } from '$lib/icons';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  const ROW_HEIGHT = 42;
  const OVERSCAN_ROWS = 8;
  const DEFAULT_VIEWPORT_HEIGHT = 520;
  const VIRTUALIZATION_THRESHOLD = 160;

  type FileTableRow =
    | { kind: 'parent' }
    | { kind: 'folder'; folder: ServerDirectoryEntry }
    | { kind: 'document'; document: ServerDocumentEntry };
  type RenderedFileTableRow = {
    row: FileTableRow;
    virtualItem: VirtualItem | null;
  };

  let {
    loading,
    folders,
    documents,
    canGoToParent,
    selectMode,
    selectedFolderIds,
    selectedDocumentIds,
    sortTitle,
    sortIcon,
    onSort,
    onGoToParent,
    onFolderClick,
    onDocumentClick,
    onFolderContextMenu,
    onDocumentContextMenu,
  }: {
    loading: boolean;
    folders: ServerDirectoryEntry[];
    documents: ServerDocumentEntry[];
    canGoToParent: boolean;
    selectMode: boolean;
    selectedFolderIds: Set<string>;
    selectedDocumentIds: Set<string>;
    sortTitle: (field: SortField) => string;
    sortIcon: (field: SortField) => IconName;
    onSort: (field: SortField) => void;
    onGoToParent: () => void;
    onFolderClick: (folder: ServerDirectoryEntry) => void;
    onDocumentClick: (document: ServerDocumentEntry) => void;
    onFolderContextMenu: (event: MouseEvent, folder: ServerDirectoryEntry) => void;
    onDocumentContextMenu: (event: MouseEvent, document: ServerDocumentEntry) => void;
  } = $props();

  let scrollViewport = $state<HTMLDivElement | null>(null);

  const rowCount = $derived((canGoToParent ? 1 : 0) + folders.length + documents.length);
  const virtualized = $derived(rowCount > VIRTUALIZATION_THRESHOLD);
  const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLButtonElement>({
    count: 0,
    getScrollElement: () => scrollViewport,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
    enabled: false,
    initialRect: { width: 0, height: DEFAULT_VIEWPORT_HEIGHT },
  });
  const rowsIdentity = $derived.by(() => {
    const firstFolderId = folders[0]?.id ?? '';
    const lastFolderId = folders[folders.length - 1]?.id ?? '';
    const firstDocumentId = documents[0]?.id ?? '';
    const lastDocumentId = documents[documents.length - 1]?.id ?? '';

    return [
      canGoToParent ? 'parent' : 'root',
      folders.length,
      firstFolderId,
      lastFolderId,
      documents.length,
      firstDocumentId,
      lastDocumentId,
    ].join('|');
  });
  const virtualItems = $derived(
    virtualized ? $rowVirtualizer.getVirtualItems() : [],
  );
  const renderedRows = $derived.by<RenderedFileTableRow[]>(() => {
    if (virtualized) {
      return virtualItems.map((virtualItem) => ({
        row: getRowAt(virtualItem.index),
        virtualItem,
      }));
    }

    const rows: RenderedFileTableRow[] = [];
    for (let index = 0; index < rowCount; index += 1) {
      rows.push({ row: getRowAt(index), virtualItem: null });
    }
    return rows;
  });

  $effect(() => {
    $rowVirtualizer.setOptions({
      count: rowCount,
      getScrollElement: () => scrollViewport,
      estimateSize: () => ROW_HEIGHT,
      overscan: OVERSCAN_ROWS,
      enabled: virtualized,
      initialRect: { width: 0, height: DEFAULT_VIEWPORT_HEIGHT },
    });
  });

  $effect(() => {
    rowsIdentity;
    if (scrollViewport) {
      scrollViewport.scrollTop = 0;
    }
  });

  function getRowAt(index: number): FileTableRow {
    if (canGoToParent) {
      if (index === 0) return { kind: 'parent' };
      index -= 1;
    }

    if (index < folders.length) {
      return { kind: 'folder', folder: folders[index] };
    }

    return { kind: 'document', document: documents[index - folders.length] };
  }

  function rowKey(row: FileTableRow): string {
    if (row.kind === 'parent') return 'parent';
    return row.kind === 'folder' ? `folder:${row.folder.id}` : `document:${row.document.id}`;
  }

  function rowStyle(virtualItem: VirtualItem | null): string {
    if (!virtualItem) return '';

    return [
      'position: absolute;',
      'top: 0;',
      'left: 0;',
      'width: 100%;',
      `height: ${virtualItem.size}px;`,
      `transform: translateY(${virtualItem.start}px);`,
    ].join(' ');
  }
</script>

{#if loading}
  <div class="flex items-center gap-2 text-sm text-md3-on-surface-variant">
    <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
    {$t('common.loadingEllipsis')}
  </div>
{/if}

{#if !loading}
  <div class="overflow-x-auto rounded-xl border border-md3-outline bg-md3-surface-container/70 backdrop-blur-sm">
    <div
      bind:this={scrollViewport}
      class="file-table-scroll-viewport min-w-[620px]"
      class:is-virtualized={virtualized}
    >
      <div
        class="sticky top-0 z-10 grid grid-cols-[auto_minmax(260px,1fr)_100px_160px] gap-3 border-b border-md3-outline bg-md3-surface-container-high/95 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-md3-on-surface-variant backdrop-blur-sm"
        style="font-family: var(--font-md3-sans);"
      >
        <span aria-hidden="true"></span>
        <button
          type="button"
          class="flex min-w-0 items-center gap-1 text-left uppercase transition-colors hover:text-md3-on-surface"
          title={sortTitle('name')}
          onclick={() => onSort('name')}
        >
          <span class="select-none">{$t('files.name')}</span>
          <Icon name={sortIcon('name')} size="15px" />
        </button>
        <button
          type="button"
          class="flex items-center justify-end gap-1 text-right uppercase transition-colors hover:text-md3-on-surface"
          title={sortTitle('size')}
          onclick={() => onSort('size')}
        >
          <span class="select-none">{$t('files.size')}</span>
          <Icon name={sortIcon('size')} size="15px" />
        </button>
        <button
          type="button"
          class="flex items-center justify-end gap-1 text-right uppercase transition-colors hover:text-md3-on-surface"
          title={sortTitle('modified')}
          onclick={() => onSort('modified')}
        >
          <span class="select-none">{$t('files.modified')}</span>
          <Icon name={sortIcon('modified')} size="15px" />
        </button>
      </div>

      {#if folders.length === 0 && documents.length === 0 && !canGoToParent}
        <p class="px-4 py-12 text-center text-sm text-md3-on-surface-variant">
          {$t('files.empty')}
        </p>
      {/if}

      {#if rowCount > 0}
        <div
          class="file-table-row-space"
          class:is-virtualized={virtualized}
          style={virtualized ? `height: ${$rowVirtualizer.getTotalSize()}px;` : undefined}
        >
        {#each renderedRows as rendered (rowKey(rendered.row))}
          {@const row = rendered.row}
          {#if row.kind === 'parent'}
            <button
              class="grid h-[42px] w-full grid-cols-[auto_minmax(260px,1fr)_100px_160px] gap-3 border-md3-outline/50 px-4 text-left text-md3-primary-emphasis transition-colors hover:bg-md3-primary-container/20"
              class:border-b={folders.length > 0 || documents.length > 0}
              style={rowStyle(rendered.virtualItem)}
              onclick={onGoToParent}
            >
              <span class="self-center text-md3-primary-emphasis" aria-hidden="true">
                <Icon name="arrowUpward" size="20px" />
              </span>
              <span class="self-center truncate text-sm font-medium">
                {$t('files.parentDirectory')}
              </span>
              <span class="self-center text-right text-xs text-md3-on-surface-variant">—</span>
              <span class="self-center text-right text-xs text-md3-on-surface-variant">—</span>
            </button>
          {:else if row.kind === 'folder'}
            <button
              class="grid h-[42px] w-full grid-cols-[auto_minmax(260px,1fr)_100px_160px] gap-3 border-b border-md3-outline/50 px-4 text-left transition-colors hover:bg-md3-primary-container/20"
              style={rowStyle(rendered.virtualItem)}
              onclick={() => onFolderClick(row.folder)}
              oncontextmenu={(event) => onFolderContextMenu(event, row.folder)}
            >
              {#if selectMode}
                <span
                  class="self-center {selectedFolderIds.has(row.folder.id) ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}"
                  aria-hidden="true"
                >
                  <Icon name={selectedFolderIds.has(row.folder.id) ? 'checkBox' : 'checkBoxBlank'} size="22px" />
                </span>
              {:else}
                <span class="self-center text-md3-primary-emphasis">
                  <Icon name="folder" size="20px" />
                </span>
              {/if}
              <span class="self-center truncate text-sm font-medium text-md3-primary-emphasis">
                {row.folder.name}
              </span>
              <span class="self-center text-right text-xs text-md3-on-surface-variant">—</span>
              <span class="self-center text-right text-xs text-md3-on-surface-variant">
                {formatDate(row.folder.created_time)}
              </span>
            </button>
          {:else}
            <button
              class="grid h-[42px] w-full grid-cols-[auto_minmax(260px,1fr)_100px_160px] gap-3 border-b border-md3-outline/50 px-4 text-left transition-colors last:border-b-0 hover:bg-md3-surface-container-high/30"
              style={rowStyle(rendered.virtualItem)}
              onclick={() => onDocumentClick(row.document)}
              oncontextmenu={(event) => onDocumentContextMenu(event, row.document)}
            >
              {#if selectMode}
                <span
                  class="self-center {selectedDocumentIds.has(row.document.id) ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}"
                  aria-hidden="true"
                >
                  <Icon name={selectedDocumentIds.has(row.document.id) ? 'checkBox' : 'checkBoxBlank'} size="22px" />
                </span>
              {:else}
                <span class="self-center text-md3-on-surface-variant">
                  <Icon name="filePresent" size="20px" />
                </span>
              {/if}
              <span class="self-center truncate text-sm text-md3-on-surface">
                {row.document.title}
              </span>
              <span class="self-center text-right text-xs text-md3-on-surface-variant">
                {formatBytes(row.document.size)}
              </span>
              <span class="self-center text-right text-xs text-md3-on-surface-variant">
                {formatDate(row.document.last_modified)}
              </span>
            </button>
          {/if}
        {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .file-table-scroll-viewport {
    overflow: hidden;
  }

  .file-table-scroll-viewport.is-virtualized {
    max-height: calc(100vh - 15rem);
    overflow-y: auto;
  }

  .file-table-row-space.is-virtualized {
    position: relative;
  }
</style>
