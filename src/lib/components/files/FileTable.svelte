<script lang="ts">
  import { onDestroy, onMount, tick, untrack, type Snippet } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { createVirtualizer, type VirtualItem } from '@tanstack/svelte-virtual';
  import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';
  import { formatBytes, formatDate } from '$lib/files/formatting';
  import { classifyDocumentType } from '$lib/files/document-types';
  import type { SortField } from '$lib/files/sorting';
  import { fileSelectionKey } from '$lib/explorer/file-selection';
  import { createMarqueeRect, marqueeAutoScrollDelta, marqueeRowRange } from '$lib/explorer/marquee-selection';
  import type { IconName } from '$lib/icons';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  const ROW_HEIGHT = 40;
  const OVERSCAN_ROWS = 6;
  const DEFAULT_VIEWPORT_HEIGHT = 520;
  const VIRTUALIZATION_THRESHOLD = 160;
  const MARQUEE_DRAG_THRESHOLD = 4;
  const COLUMN_RESIZE_STEP = 8;

  const FILE_COLUMNS = ['name', 'modified', 'type', 'size'] as const;
  type FileColumn = (typeof FILE_COLUMNS)[number];
  type FileColumnWidths = Record<FileColumn, number>;

  const MIN_COLUMN_WIDTHS: FileColumnWidths = {
    name: 120,
    modified: 112,
    type: 80,
    size: 72,
  };

  export type FileTableRow =
    | { kind: 'folder'; folder: ServerDirectoryEntry }
    | { kind: 'document'; document: ServerDocumentEntry };

  export type FileTableViewportAnchor = {
    key: string;
    offset: number;
  };

  type RenderedFileTableRow = { row: FileTableRow; index: number; virtualItem: VirtualItem | null };

  let {
    loading,
    folders,
    documents,
    resetKey,
    marqueeEnabled,
    selectMode,
    selectedFolderIds,
    selectedDocumentIds,
    sortTitle,
    sortIcon,
    onSort,
    onMarqueeSelection,
    onFolderClick,
    onDocumentClick,
    onFolderActivate,
    onDocumentActivate,
    onRowKeydown,
    onBlankClick,
    onBlankContextMenu,
    onFolderContextMenu,
    onDocumentContextMenu,
    emptyContent,
  }: {
    loading: boolean;
    folders: ServerDirectoryEntry[];
    documents: ServerDocumentEntry[];
    resetKey: number;
    marqueeEnabled: boolean;
    selectMode: boolean;
    selectedFolderIds: Set<string>;
    selectedDocumentIds: Set<string>;
    sortTitle: (field: SortField) => string;
    sortIcon: (field: SortField) => IconName;
    onSort: (field: SortField) => void;
    onMarqueeSelection: (keys: Set<string>, baseKeys: Set<string>) => void;
    onFolderClick: (event: MouseEvent, folder: ServerDirectoryEntry) => void;
    onDocumentClick: (event: MouseEvent, document: ServerDocumentEntry) => void;
    onFolderActivate: (folder: ServerDirectoryEntry) => void;
    onDocumentActivate: (document: ServerDocumentEntry) => void;
    onRowKeydown: (event: KeyboardEvent, row: FileTableRow) => void;
    onBlankClick: () => void;
    onBlankContextMenu: (event: MouseEvent) => void;
    onFolderContextMenu: (event: MouseEvent | KeyboardEvent, folder: ServerDirectoryEntry) => void;
    onDocumentContextMenu: (event: MouseEvent | KeyboardEvent, document: ServerDocumentEntry) => void;
    emptyContent?: Snippet;
  } = $props();

  let scrollViewport = $state<HTMLDivElement | null>(null);
  let tableHeader = $state<HTMLDivElement | null>(null);
  let listSpace = $state<HTMLDivElement | null>(null);
  let marquee = $state<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    currentClientX: number;
    currentClientY: number;
    startContentX: number;
    startContentY: number;
    active: boolean;
    baseKeys: Set<string>;
    previewKeys: Set<string>;
  } | null>(null);
  let marqueeStyle = $state('');
  let columnWidths = $state<FileColumnWidths | null>(null);
  let columnResize = $state<{
    pointerId: number;
    boundaryIndex: number;
    startClientX: number;
    startWidths: FileColumnWidths;
  } | null>(null);
  let suppressClick = false;
  let autoScrollFrame: number | null = null;
  let activeRowKey = $state<string | null>(null);
  const rowCount = $derived(folders.length + documents.length);
  const virtualized = $derived(rowCount > VIRTUALIZATION_THRESHOLD);
  const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLButtonElement>({
    count: 0,
    getScrollElement: () => scrollViewport,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
    enabled: false,
    initialRect: { width: 0, height: DEFAULT_VIEWPORT_HEIGHT },
  });

  const virtualItems = $derived.by<VirtualItem[]>(() => {
    if (!virtualized) return [];
    const measuredItems = $rowVirtualizer.getVirtualItems();
    if (measuredItems.length > 0) return measuredItems;

    // Keep the first batch visible while the browser's first ResizeObserver
    // measurement is pending (and in non-layout test environments).
    const fallbackCount = Math.min(
      rowCount,
      Math.ceil(DEFAULT_VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN_ROWS * 2,
    );
    return Array.from({ length: fallbackCount }, (_, index) => ({
      key: index,
      index,
      start: index * ROW_HEIGHT,
      end: (index + 1) * ROW_HEIGHT,
      size: ROW_HEIGHT,
      lane: 0,
    }));
  });
  const renderedRows = $derived.by<RenderedFileTableRow[]>(() => {
    if (virtualized) {
      return virtualItems.map((virtualItem) => ({ row: getRowAt(virtualItem.index), index: virtualItem.index, virtualItem }));
    }
    return Array.from({ length: rowCount }, (_, index) => ({ row: getRowAt(index), index, virtualItem: null }));
  });
  const columnGridStyle = $derived(columnWidths
    ? [
        `--file-name-width:${columnWidths.name}px`,
        `--file-name-min-width:${columnWidths.name}px`,
        `--file-modified-width:${columnWidths.modified}px`,
        `--file-type-width:${columnWidths.type}px`,
        `--file-size-width:${columnWidths.size}px`,
      ].join(';')
    : '');

  $effect(() => {
    const count = rowCount;
    const enabled = virtualized;
    const element = scrollViewport;
    untrack(() => {
      $rowVirtualizer.setOptions({
        count,
        getScrollElement: () => element,
        estimateSize: () => ROW_HEIGHT,
        overscan: OVERSCAN_ROWS,
        enabled,
        initialRect: { width: 0, height: DEFAULT_VIEWPORT_HEIGHT },
      });
    });
  });

  $effect(() => {
    resetKey;
    const element = scrollViewport;
    untrack(() => {
      if (element) element.scrollTop = 0;
      activeRowKey = rowCount > 0 ? rowKey(getRowAt(0)) : null;
    });
  });

  function getRowAt(index: number): FileTableRow {
    if (index < folders.length) return { kind: 'folder', folder: folders[index] };
    return { kind: 'document', document: documents[index - folders.length] };
  }

  function rowKey(row: FileTableRow) {
    return row.kind === 'folder' ? `folder:${row.folder.id}` : `document:${row.document.id}`;
  }

  function rowSelectionKey(row: FileTableRow) {
    return row.kind === 'folder'
      ? fileSelectionKey('folder', row.folder.id)
      : fileSelectionKey('document', row.document.id);
  }

  function isSelected(row: FileTableRow) {
    if (marquee?.active) {
      const key = rowSelectionKey(row);
      return marquee.previewKeys.has(key) || marquee.baseKeys.has(key);
    }
    if (row.kind === 'folder') return selectedFolderIds.has(row.folder.id);
    if (row.kind === 'document') return selectedDocumentIds.has(row.document.id);
    return false;
  }

  function rowStyle(virtualItem: VirtualItem | null) {
    if (!virtualItem) return '';
    return `position:absolute;top:0;left:0;width:100%;height:${virtualItem.size}px;transform:translateY(${virtualItem.start}px);`;
  }

  function isBlankInteraction(event: MouseEvent) {
    const target = event.target;
    return !(target instanceof Element && target.closest('[data-file-table-row], .file-table-header'));
  }

  function canStartMarquee(event: PointerEvent) {
    const target = event.target;
    if (isBlankInteraction(event)) return true;
    if (!(target instanceof Element)) return false;

    const row = target.closest<HTMLElement>('[data-file-table-row]');
    const marqueeStart = row?.querySelector<HTMLElement>('[data-marquee-start]');
    if (!marqueeStart || marqueeStart.getClientRects().length === 0) return false;
    return event.clientX >= marqueeStart.getBoundingClientRect().left;
  }

  function documentTypeLabel(filename: string) {
    const type = classifyDocumentType(filename);
    if (type.kind === 'mapped') return $t(`files.documentTypes.${type.key}`);
    if (type.kind === 'extension') {
      return $t('files.extensionFile', { values: { extension: type.extension } });
    }
    return $t('files.document');
  }

  function handleBlankClick(event: MouseEvent) {
    if (!isBlankInteraction(event)) return;
    if (suppressClick) return;
    onBlankClick();
  }

  function handleRowClick(event: MouseEvent, row: FileTableRow) {
    if (suppressClick) return;
    activeRowKey = rowKey(row);
    if (row.kind === 'folder') onFolderClick(event, row.folder);
    else onDocumentClick(event, row.document);
  }

  function handleBlankContextMenu(event: MouseEvent) {
    if (!isBlankInteraction(event)) return;
    onBlankContextMenu(event);
  }

  function selectionSnapshot(preserveExisting: boolean) {
    const keys = new Set<string>();
    if (!preserveExisting) return keys;
    for (const id of selectedFolderIds) keys.add(fileSelectionKey('folder', id));
    for (const id of selectedDocumentIds) keys.add(fileSelectionKey('document', id));
    return keys;
  }

  function viewportContentPoint(clientX: number, clientY: number) {
    if (!scrollViewport) return { x: 0, y: 0 };
    const bounds = scrollViewport.getBoundingClientRect();
    return {
      x: clientX - bounds.left + scrollViewport.scrollLeft,
      y: clientY - bounds.top + scrollViewport.scrollTop,
    };
  }

  function handleMarqueePointerDown(event: PointerEvent) {
    if (!marqueeEnabled || event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') return;
    if (!scrollViewport || !canStartMarquee(event)) return;

    const start = viewportContentPoint(event.clientX, event.clientY);
    marquee = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      startContentX: start.x,
      startContentY: start.y,
      active: false,
      baseKeys: selectionSnapshot(event.ctrlKey || event.metaKey),
      previewKeys: new Set(),
    };
  }

  function handleMarqueePointerMove(event: PointerEvent) {
    if (!marquee || marquee.pointerId !== event.pointerId) return;
    marquee.currentClientX = event.clientX;
    marquee.currentClientY = event.clientY;

    if (!marquee.active) {
      const distance = Math.hypot(
        event.clientX - marquee.startClientX,
        event.clientY - marquee.startClientY,
      );
      if (distance < MARQUEE_DRAG_THRESHOLD) return;
      marquee.active = true;
      // Capturing on pointerdown retargets a normal click to the viewport.
      // Wait until the gesture is unquestionably a marquee drag.
      scrollViewport?.setPointerCapture(event.pointerId);
      suppressClick = true;
    }

    event.preventDefault();
    updateMarqueeSelection();
    queueMarqueeAutoScroll();
  }

  function updateMarqueeSelection() {
    if (!scrollViewport || !listSpace || !marquee?.active) return;
    const bounds = scrollViewport.getBoundingClientRect();
    const current = viewportContentPoint(marquee.currentClientX, marquee.currentClientY);
    const contentRect = createMarqueeRect(
      { x: marquee.startContentX, y: marquee.startContentY },
      current,
    );
    const clientRect = createMarqueeRect(
      {
        x: bounds.left + marquee.startContentX - scrollViewport.scrollLeft,
        y: bounds.top + marquee.startContentY - scrollViewport.scrollTop,
      },
      { x: marquee.currentClientX, y: marquee.currentClientY },
    );
    marqueeStyle = `left:${clientRect.left - bounds.left}px;top:${clientRect.top - bounds.top}px;width:${clientRect.width}px;height:${clientRect.height}px;`;

    const keys = new Set<string>();
    const range = marqueeRowRange(contentRect, listSpace.offsetTop, ROW_HEIGHT, rowCount);
    if (range) {
      for (let index = range.start; index <= range.end; index += 1) {
        keys.add(rowSelectionKey(getRowAt(index)));
      }
    }
    marquee.previewKeys = keys;
  }

  function queueMarqueeAutoScroll() {
    if (autoScrollFrame !== null || !scrollViewport || !marquee?.active) return;
    const bounds = scrollViewport.getBoundingClientRect();
    const horizontalDelta = marqueeAutoScrollDelta(marquee.currentClientX, bounds.left, bounds.right);
    const verticalDelta = marqueeAutoScrollDelta(marquee.currentClientY, bounds.top, bounds.bottom);
    if (horizontalDelta === 0 && verticalDelta === 0) return;

    autoScrollFrame = window.requestAnimationFrame(() => {
      autoScrollFrame = null;
      if (!scrollViewport || !marquee?.active) return;
      const previousLeft = scrollViewport.scrollLeft;
      const previousTop = scrollViewport.scrollTop;
      scrollViewport.scrollBy(horizontalDelta, verticalDelta);
      if (scrollViewport.scrollLeft !== previousLeft || scrollViewport.scrollTop !== previousTop) {
        updateMarqueeSelection();
        queueMarqueeAutoScroll();
      }
    });
  }

  function finishMarquee(event: PointerEvent) {
    if (!scrollViewport || !marquee || marquee.pointerId !== event.pointerId) return;
    if (marquee.active) {
      event.preventDefault();
      updateMarqueeSelection();
      onMarqueeSelection(marquee.previewKeys, marquee.baseKeys);
      suppressClick = true;
      window.setTimeout(() => { suppressClick = false; }, 0);
    }
    if (scrollViewport.hasPointerCapture(event.pointerId)) {
      scrollViewport.releasePointerCapture(event.pointerId);
    }
    marquee = null;
    marqueeStyle = '';
    cancelMarqueeAutoScroll();
  }

  function cancelMarqueeAutoScroll() {
    if (autoScrollFrame === null) return;
    window.cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
  }

  onDestroy(cancelMarqueeAutoScroll);

  onMount(() => {
    document.addEventListener('keydown', handleUnfocusedTableEntry);
    return () => document.removeEventListener('keydown', handleUnfocusedTableEntry);
  });

  async function focusRow(event: KeyboardEvent, row: FileTableRow, index: number) {
    activeRowKey = rowKey(row);
    onRowKeydown(event, row);
    if (virtualized) $rowVirtualizer.scrollToIndex(index, { align: 'auto' });
    await tick();
    scrollViewport?.querySelector<HTMLButtonElement>(`[data-file-row-index="${index}"]`)
      ?.focus({ preventScroll: true });
  }

  function handleUnfocusedTableEntry(event: KeyboardEvent) {
    if (
      event.defaultPrevented
      || loading
      || rowCount === 0
      || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')
      || event.ctrlKey
      || event.metaKey
      || event.altKey
      || event.shiftKey
    ) return;

    const activeElement = document.activeElement;
    if (activeElement !== document.body && activeElement !== document.documentElement) return;

    event.preventDefault();
    void focusRow(event, getRowAt(0), 0);
  }

  async function handleKeyboardNavigation(event: KeyboardEvent, row: FileTableRow, currentIndex: number) {
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      if (row.kind === 'folder') onFolderContextMenu(event, row.folder);
      else onDocumentContextMenu(event, row.document);
      return;
    }

    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key) && scrollViewport) {
      event.preventDefault();
      const pageSize = Math.max(1, Math.floor(scrollViewport.clientHeight / ROW_HEIGHT) - 1);
      let targetIndex = currentIndex;
      if (event.key === 'ArrowDown') targetIndex += 1;
      else if (event.key === 'ArrowUp') targetIndex -= 1;
      else if (event.key === 'Home') targetIndex = 0;
      else if (event.key === 'End') targetIndex = rowCount - 1;
      else if (event.key === 'PageDown') targetIndex += pageSize;
      else if (event.key === 'PageUp') targetIndex -= pageSize;
      targetIndex = Math.max(0, Math.min(rowCount - 1, targetIndex));
      const targetRow = getRowAt(targetIndex);
      await focusRow(event, targetRow, targetIndex);
      return;
    }
    onRowKeydown(event, row);
  }

  export function captureViewportAnchor(): FileTableViewportAnchor | null {
    if (!scrollViewport || rowCount === 0) return null;
    const listTop = listSpace?.offsetTop ?? 0;
    const stickyHeaderHeight = tableHeader?.offsetHeight ?? 0;
    const visibleListTop = Math.max(listTop, scrollViewport.scrollTop + stickyHeaderHeight);
    const index = Math.max(0, Math.min(rowCount - 1, Math.floor((visibleListTop - listTop) / ROW_HEIGHT)));
    return {
      key: rowKey(getRowAt(index)),
      offset: visibleListTop - (listTop + index * ROW_HEIGHT),
    };
  }

  export async function restoreViewportAnchor(index: number, offset: number) {
    if (!scrollViewport || rowCount === 0) return;
    const boundedIndex = Math.max(0, Math.min(rowCount - 1, index));
    const listTop = listSpace?.offsetTop ?? 0;
    const stickyHeaderHeight = tableHeader?.offsetHeight ?? 0;
    scrollViewport.scrollTop = Math.max(
      0,
      listTop + boundedIndex * ROW_HEIGHT + offset - stickyHeaderHeight,
    );
    await tick();
  }

  function readColumnWidths(target: HTMLElement): FileColumnWidths | null {
    const header = target.closest<HTMLElement>('.file-table-header');
    if (!header) return null;
    const cells = Array.from(header.querySelectorAll<HTMLElement>('[data-file-column]'));
    if (cells.length !== FILE_COLUMNS.length) return null;

    return Object.fromEntries(
      FILE_COLUMNS.map((column, index) => [column, cells[index].getBoundingClientRect().width]),
    ) as FileColumnWidths;
  }

  function resizeColumnsAtBoundary(
    widths: FileColumnWidths,
    boundaryIndex: number,
    requestedDelta: number,
  ): FileColumnWidths {
    const leftColumn = FILE_COLUMNS[boundaryIndex];
    const rightColumn = FILE_COLUMNS[boundaryIndex + 1];
    const minimumDelta = MIN_COLUMN_WIDTHS[leftColumn] - widths[leftColumn];
    const maximumDelta = widths[rightColumn] - MIN_COLUMN_WIDTHS[rightColumn];
    const delta = Math.min(maximumDelta, Math.max(minimumDelta, requestedDelta));

    return {
      ...widths,
      [leftColumn]: widths[leftColumn] + delta,
      [rightColumn]: widths[rightColumn] - delta,
    };
  }

  function handleColumnResizePointerDown(event: PointerEvent, boundaryIndex: number) {
    if (event.button !== 0 || !event.isPrimary) return;
    if (window.matchMedia('(max-width: 820px), (pointer: coarse)').matches) return;
    const handle = event.currentTarget as HTMLButtonElement;
    const widths = readColumnWidths(handle);
    if (!widths) return;

    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    columnResize = {
      pointerId: event.pointerId,
      boundaryIndex,
      startClientX: event.clientX,
      startWidths: widths,
    };
  }

  function handleColumnResizePointerMove(event: PointerEvent) {
    if (!columnResize || columnResize.pointerId !== event.pointerId) return;
    event.preventDefault();
    columnWidths = resizeColumnsAtBoundary(
      columnResize.startWidths,
      columnResize.boundaryIndex,
      event.clientX - columnResize.startClientX,
    );
  }

  function finishColumnResize(event: PointerEvent) {
    if (!columnResize || columnResize.pointerId !== event.pointerId) return;
    const handle = event.currentTarget as HTMLButtonElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    columnResize = null;
  }

  function handleColumnResizeKeydown(event: KeyboardEvent, boundaryIndex: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const widths = readColumnWidths(event.currentTarget as HTMLElement);
    if (!widths) return;
    event.preventDefault();
    event.stopPropagation();
    columnWidths = resizeColumnsAtBoundary(
      widths,
      boundaryIndex,
      event.key === 'ArrowLeft' ? -COLUMN_RESIZE_STEP : COLUMN_RESIZE_STEP,
    );
  }
</script>

{#if loading}
  <div class="file-table-loading">
    <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
    {$t('common.loadingEllipsis')}
  </div>
{:else}
  <div class="file-table-shell">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      bind:this={scrollViewport}
      class="file-table-scroll-viewport"
      class:is-virtualized={virtualized}
      class:is-marquee-selecting={marquee?.active}
      onclick={handleBlankClick}
      oncontextmenu={handleBlankContextMenu}
      onpointerdown={handleMarqueePointerDown}
      onpointermove={handleMarqueePointerMove}
      onpointerup={finishMarquee}
      onpointercancel={finishMarquee}
    >
      <div class="file-table-content" style={columnGridStyle}>
        <div bind:this={tableHeader} class="file-table-grid file-table-header" class:is-column-resizing={columnResize !== null}>
          <span aria-hidden="true"></span>
          <div class="file-table-column-header" data-file-column="name">
            <button class="file-table-sort-button" type="button" title={sortTitle('name')} onclick={() => onSort('name')}>
              <span>{$t('files.name')}</span><Icon name={sortIcon('name')} size="14px" />
            </button>
            <button
              class="file-table-resize-handle"
              type="button"
              data-focus-ring="delegated"
              aria-label={$t('files.resizeColumn', { values: { column: $t('files.name') } })}
              title={$t('files.resizeColumn', { values: { column: $t('files.name') } })}
              onpointerdown={(event) => handleColumnResizePointerDown(event, 0)}
              onpointermove={handleColumnResizePointerMove}
              onpointerup={finishColumnResize}
              onpointercancel={finishColumnResize}
              onkeydown={(event) => handleColumnResizeKeydown(event, 0)}
            ></button>
          </div>
          <div class="file-table-column-header" data-file-column="modified">
            <button class="file-table-sort-button" type="button" title={sortTitle('modified')} onclick={() => onSort('modified')}>
              <span>{$t('files.modified')}</span><Icon name={sortIcon('modified')} size="14px" />
            </button>
            <button
              class="file-table-resize-handle"
              type="button"
              data-focus-ring="delegated"
              aria-label={$t('files.resizeColumn', { values: { column: $t('files.modified') } })}
              title={$t('files.resizeColumn', { values: { column: $t('files.modified') } })}
              onpointerdown={(event) => handleColumnResizePointerDown(event, 1)}
              onpointermove={handleColumnResizePointerMove}
              onpointerup={finishColumnResize}
              onpointercancel={finishColumnResize}
              onkeydown={(event) => handleColumnResizeKeydown(event, 1)}
            ></button>
          </div>
          <div class="file-table-column-header" data-file-column="type">
            <span>{$t('workspace.type')}</span>
            <button
              class="file-table-resize-handle"
              type="button"
              data-focus-ring="delegated"
              aria-label={$t('files.resizeColumn', { values: { column: $t('workspace.type') } })}
              title={$t('files.resizeColumn', { values: { column: $t('workspace.type') } })}
              onpointerdown={(event) => handleColumnResizePointerDown(event, 2)}
              onpointermove={handleColumnResizePointerMove}
              onpointerup={finishColumnResize}
              onpointercancel={finishColumnResize}
              onkeydown={(event) => handleColumnResizeKeydown(event, 2)}
            ></button>
          </div>
          <div class="file-table-column-header" data-file-column="size">
            <button class="file-table-sort-button" type="button" title={sortTitle('size')} onclick={() => onSort('size')}>
              <span>{$t('files.size')}</span><Icon name={sortIcon('size')} size="14px" />
            </button>
          </div>
        </div>

        <div bind:this={listSpace} class="file-table-list-space">
        {#if folders.length === 0 && documents.length === 0}
          {#if !emptyContent}
            <p class="file-table-empty">{$t('files.empty')}</p>
          {/if}
        {/if}
        {#if rowCount > 0}
          <div class="file-table-row-space" class:is-virtualized={virtualized} style={virtualized ? `height:${$rowVirtualizer.getTotalSize()}px;` : undefined}>
            {#each renderedRows as rendered (rowKey(rendered.row))}
              {@const row = rendered.row}
              {#if row.kind === 'folder'}
                <button
                  data-file-table-row
                  data-file-row-index={rendered.index}
                  data-selection-key={fileSelectionKey('folder', row.folder.id)}
                  type="button"
                  class="file-table-grid file-table-row file-table-row--folder"
                  class:file-table-row--selected={isSelected(row)}
                  aria-pressed={isSelected(row)}
                  tabindex={activeRowKey === rowKey(row) ? 0 : -1}
                  style={rowStyle(rendered.virtualItem)}
                  onclick={(event) => handleRowClick(event, row)}
                  ondblclick={() => onFolderActivate(row.folder)}
                  onkeydown={(event) => handleKeyboardNavigation(event, row, rendered.index)}
                  onfocus={() => (activeRowKey = rowKey(row))}
                  oncontextmenu={(event) => onFolderContextMenu(event, row.folder)}
                >
                  <span class="file-table-icon" class:file-table-icon--selected={isSelected(row)}>
                    <Icon name={selectMode ? (isSelected(row) ? 'checkBox' : 'checkBoxBlank') : 'folder'} size="20px" />
                  </span>
                  <span class="file-table-name file-table-folder-name">{row.folder.name}</span>
                  <span class="file-table-modified">{formatDate(row.folder.created_time)}</span>
                  <span class="file-table-type" data-marquee-start>{$t('files.directory')}</span>
                  <span class="file-table-size">—</span>
                </button>
              {:else}
                <button
                  data-file-table-row
                  data-file-row-index={rendered.index}
                  data-selection-key={fileSelectionKey('document', row.document.id)}
                  type="button"
                  class="file-table-grid file-table-row"
                  class:file-table-row--selected={isSelected(row)}
                  aria-pressed={isSelected(row)}
                  tabindex={activeRowKey === rowKey(row) ? 0 : -1}
                  style={rowStyle(rendered.virtualItem)}
                  onclick={(event) => handleRowClick(event, row)}
                  ondblclick={() => onDocumentActivate(row.document)}
                  onkeydown={(event) => handleKeyboardNavigation(event, row, rendered.index)}
                  onfocus={() => (activeRowKey = rowKey(row))}
                  oncontextmenu={(event) => onDocumentContextMenu(event, row.document)}
                >
                  <span class="file-table-icon" class:file-table-icon--selected={isSelected(row)}>
                    <Icon name={selectMode ? (isSelected(row) ? 'checkBox' : 'checkBoxBlank') : 'filePresent'} size="20px" />
                  </span>
                  <span class="file-table-name">{row.document.title}</span>
                  <span class="file-table-modified">{formatDate(row.document.last_modified)}</span>
                  <span class="file-table-type" data-marquee-start>{documentTypeLabel(row.document.title)}</span>
                  <span class="file-table-size">{formatBytes(row.document.size)}</span>
                </button>
              {/if}
            {/each}
          </div>
        {/if}
        </div>
      </div>
    </div>
    {#if emptyContent && folders.length === 0 && documents.length === 0}
      <div class="file-table-empty-overlay">
        {@render emptyContent()}
      </div>
    {/if}
    {#if marquee?.active}
      <div class="file-table-marquee" style={marqueeStyle} aria-hidden="true"></div>
    {/if}
  </div>
{/if}

<style>
  .file-table-loading { display: flex; align-items: center; gap: 0.5rem; padding: 1rem; color: var(--explorer-text-muted); font-size: 0.8rem; }
  .file-table-shell { position: relative; min-width: 0; flex: 1; overflow: hidden; background: var(--explorer-background); }
  .file-table-scroll-viewport { position: relative; width: 100%; height: 100%; min-width: 0; overflow: auto; overscroll-behavior: contain; }
  .file-table-scroll-viewport.is-marquee-selecting { cursor: crosshair; user-select: none; }
  .file-table-content {
    --file-name-min-width: 240px;
    --file-modified-width: 168px;
    --file-type-width: 112px;
    --file-size-width: 100px;
    --file-table-content-width: calc(
      28px + var(--file-name-min-width) + var(--file-modified-width) +
      var(--file-type-width) + var(--file-size-width) + 2.2rem + 1.4rem
    );
    width: max(100%, var(--file-table-content-width));
    min-width: var(--file-table-content-width);
    min-height: 100%;
  }
  .file-table-empty-overlay { position: absolute; z-index: 6; inset: 36px 0 0; display: flex; min-height: 0; align-items: stretch; justify-content: stretch; overflow: hidden; background: var(--explorer-background); }
  .file-table-grid { display: grid; grid-template-columns: 28px var(--file-name-width, minmax(240px, 1fr)) var(--file-modified-width, 168px) var(--file-type-width, 112px) var(--file-size-width, 100px); align-items: center; gap: 0.55rem; }
  .file-table-header { position: sticky; top: 0; z-index: 10; min-height: 36px; border-bottom: 1px solid var(--explorer-border-strong); padding: 0 0.7rem; color: var(--explorer-text); background: var(--explorer-surface-raised); font-size: 0.75rem; }
  .file-table-column-header { position: relative; display: flex; min-width: 0; height: 100%; align-items: center; border-right: 1px solid var(--explorer-border); }
  .file-table-column-header:last-child { justify-content: flex-end; border-right: 0; text-align: right; }
  .file-table-sort-button { display: flex; min-width: 0; width: 100%; height: 100%; align-items: center; gap: 0.2rem; color: inherit; text-align: left; }
  .file-table-column-header:last-child .file-table-sort-button { justify-content: flex-end; text-align: right; }
  .file-table-resize-handle { position: absolute; top: 0; right: -0.36rem; z-index: 2; width: 0.7rem; height: 100%; padding: 0; cursor: col-resize; touch-action: none; }
  .file-table-resize-handle::after { position: absolute; top: 20%; bottom: 20%; left: 50%; width: 2px; border-radius: 999px; background: transparent; content: ''; transform: translateX(-50%); transition: background-color 120ms ease, top 120ms ease, bottom 120ms ease; }
  .file-table-resize-handle:hover::after, .file-table-resize-handle:focus-visible::after, .is-column-resizing .file-table-resize-handle::after { top: 10%; bottom: 10%; background: var(--explorer-accent); }
  .file-table-row-space.is-virtualized { position: relative; }
  .file-table-row { width: 100%; min-height: 40px; border-bottom: 1px solid color-mix(in srgb, var(--explorer-border) 66%, transparent); padding: 0 0.7rem; color: var(--explorer-text); text-align: left; transition: background-color 90ms ease, color 90ms ease; }
  .file-table-row:hover { background: var(--explorer-surface-hover); }
  .file-table-row--selected { background: var(--explorer-surface-selected); box-shadow: inset 2px 0 0 var(--explorer-accent); }
  .file-table-row--selected:hover { background: color-mix(in srgb, var(--explorer-surface-selected) 80%, var(--explorer-surface-hover)); }
  .file-table-icon { display: inline-flex; color: var(--explorer-text-muted); }
  .file-table-folder-name, .file-table-row--folder .file-table-icon { color: #ffca4b; }
  .file-table-icon--selected { color: var(--explorer-accent) !important; }
  .file-table-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.81rem; }
  .file-table-modified, .file-table-type, .file-table-size { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--explorer-text-muted); font-size: 0.74rem; }
  .file-table-size { text-align: right; }
  .file-table-empty { padding: 3.5rem 1rem; text-align: center; color: var(--explorer-text-muted); font-size: 0.8rem; }
  .file-table-marquee { position: absolute; z-index: 8; border: 1px solid var(--explorer-accent); border-radius: 2px; background: color-mix(in srgb, var(--explorer-accent) 16%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--explorer-accent) 12%, transparent) inset; pointer-events: none; }

  @media (max-width: 820px), (pointer: coarse) {
    .file-table-resize-handle { display: none; }
  }
</style>
