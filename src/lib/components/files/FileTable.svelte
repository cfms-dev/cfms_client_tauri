<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
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
  const OVERSCAN_ROWS = 10;
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

  type RenderedFileTableRow = { row: FileTableRow; virtualItem: VirtualItem | null };
  type MarqueeSelectionPhase = 'updating' | 'complete';

  let {
    loading,
    folders,
    documents,
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
  }: {
    loading: boolean;
    folders: ServerDirectoryEntry[];
    documents: ServerDocumentEntry[];
    marqueeEnabled: boolean;
    selectMode: boolean;
    selectedFolderIds: Set<string>;
    selectedDocumentIds: Set<string>;
    sortTitle: (field: SortField) => string;
    sortIcon: (field: SortField) => IconName;
    onSort: (field: SortField) => void;
    onMarqueeSelection: (keys: Set<string>, baseKeys: Set<string>, phase: MarqueeSelectionPhase) => void;
    onFolderClick: (event: MouseEvent, folder: ServerDirectoryEntry) => void;
    onDocumentClick: (event: MouseEvent, document: ServerDocumentEntry) => void;
    onFolderActivate: (folder: ServerDirectoryEntry) => void;
    onDocumentActivate: (document: ServerDocumentEntry) => void;
    onRowKeydown: (event: KeyboardEvent, row: FileTableRow) => void;
    onBlankClick: () => void;
    onBlankContextMenu: (event: MouseEvent) => void;
    onFolderContextMenu: (event: MouseEvent, folder: ServerDirectoryEntry) => void;
    onDocumentContextMenu: (event: MouseEvent, document: ServerDocumentEntry) => void;
  } = $props();

  let scrollViewport = $state<HTMLDivElement | null>(null);
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

  const rowsIdentity = $derived([
    folders.length,
    folders[0]?.id ?? '',
    folders.at(-1)?.id ?? '',
    documents.length,
    documents[0]?.id ?? '',
    documents.at(-1)?.id ?? '',
  ].join('|'));
  const virtualItems = $derived(virtualized ? $rowVirtualizer.getVirtualItems() : []);
  const renderedRows = $derived.by<RenderedFileTableRow[]>(() => {
    if (virtualized) {
      return virtualItems.map((virtualItem) => ({ row: getRowAt(virtualItem.index), virtualItem }));
    }
    return Array.from({ length: rowCount }, (_, index) => ({ row: getRowAt(index), virtualItem: null }));
  });
  const columnGridStyle = $derived(columnWidths
    ? [
        `--file-name-width:${columnWidths.name}px`,
        `--file-modified-width:${columnWidths.modified}px`,
        `--file-type-width:${columnWidths.type}px`,
        `--file-size-width:${columnWidths.size}px`,
        `--file-table-content-width:calc(28px + ${columnWidths.name + columnWidths.modified + columnWidths.type + columnWidths.size}px + 2.2rem + 1.4rem)`,
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
    rowsIdentity;
    if (scrollViewport) scrollViewport.scrollTop = 0;
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
    if (row.kind === 'folder') onFolderClick(event, row.folder);
    else onDocumentClick(event, row.document);
  }

  function handleBlankContextMenu(event: MouseEvent) {
    if (!isBlankInteraction(event)) return;
    onBlankContextMenu(event);
  }

  function selectionSnapshot(preserveExisting: boolean) {
    if (!preserveExisting) return new Set<string>();
    return new Set([
      ...[...selectedFolderIds].map((id) => fileSelectionKey('folder', id)),
      ...[...selectedDocumentIds].map((id) => fileSelectionKey('document', id)),
    ]);
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
      onMarqueeSelection(new Set(), marquee.baseKeys, 'updating');
    }

    event.preventDefault();
    updateMarqueeSelection('updating');
    queueMarqueeAutoScroll();
  }

  function updateMarqueeSelection(phase: MarqueeSelectionPhase) {
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
    onMarqueeSelection(keys, marquee.baseKeys, phase);
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
        updateMarqueeSelection('updating');
        queueMarqueeAutoScroll();
      }
    });
  }

  function finishMarquee(event: PointerEvent) {
    if (!scrollViewport || !marquee || marquee.pointerId !== event.pointerId) return;
    if (marquee.active) {
      event.preventDefault();
      updateMarqueeSelection('complete');
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

  function handleKeyboardNavigation(event: KeyboardEvent, row: FileTableRow) {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && scrollViewport) {
      event.preventDefault();
      const rows = Array.from(scrollViewport.querySelectorAll<HTMLButtonElement>('[data-file-table-row]'));
      const current = event.currentTarget as HTMLButtonElement;
      const index = rows.indexOf(current);
      const next = event.key === 'ArrowDown' ? rows[index + 1] : rows[index - 1];
      next?.focus();
      return;
    }
    onRowKeydown(event, row);
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
        <div class="file-table-grid file-table-header" class:is-column-resizing={columnResize !== null}>
          <span aria-hidden="true"></span>
          <div class="file-table-column-header" data-file-column="name">
            <button class="file-table-sort-button" type="button" title={sortTitle('name')} onclick={() => onSort('name')}>
              <span>{$t('files.name')}</span><Icon name={sortIcon('name')} size="14px" />
            </button>
            <button
              class="file-table-resize-handle"
              type="button"
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
          <p class="file-table-empty">{$t('files.empty')}</p>
        {/if}
        {#if rowCount > 0}
          <div class="file-table-row-space" class:is-virtualized={virtualized} style={virtualized ? `height:${$rowVirtualizer.getTotalSize()}px;` : undefined}>
            {#each renderedRows as rendered (rowKey(rendered.row))}
              {@const row = rendered.row}
              {#if row.kind === 'folder'}
                <button
                  data-file-table-row
                  data-selection-key={fileSelectionKey('folder', row.folder.id)}
                  type="button"
                  class="file-table-grid file-table-row"
                  class:file-table-row--selected={isSelected(row)}
                  aria-pressed={isSelected(row)}
                  style={rowStyle(rendered.virtualItem)}
                  onclick={(event) => handleRowClick(event, row)}
                  ondblclick={() => onFolderActivate(row.folder)}
                  onkeydown={(event) => handleKeyboardNavigation(event, row)}
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
                  data-selection-key={fileSelectionKey('document', row.document.id)}
                  type="button"
                  class="file-table-grid file-table-row"
                  class:file-table-row--selected={isSelected(row)}
                  aria-pressed={isSelected(row)}
                  style={rowStyle(rendered.virtualItem)}
                  onclick={(event) => handleRowClick(event, row)}
                  ondblclick={() => onDocumentActivate(row.document)}
                  onkeydown={(event) => handleKeyboardNavigation(event, row)}
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
  .file-table-content { width: max(100%, var(--file-table-content-width, 650px)); min-width: 650px; min-height: 100%; }
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
  .file-table-folder-name, .file-table-row:has(.file-table-folder-name) .file-table-icon { color: #ffca4b; }
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
