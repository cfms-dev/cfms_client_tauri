<script lang="ts" generics="Item">
  import { untrack, type Snippet } from 'svelte';
  import { createVirtualizer, type VirtualItem } from '@tanstack/svelte-virtual';

  type ItemKey = string | number;

  const DEFAULT_OVERSCAN = 6;
  const DEFAULT_THRESHOLD = 80;
  const DEFAULT_INITIAL_HEIGHT = 480;

  let {
    items,
    keyOf,
    estimateSize,
    overscan = DEFAULT_OVERSCAN,
    gap = 0,
    threshold = DEFAULT_THRESHOLD,
    resetKey = '',
    viewportClass = '',
    contentClass = '',
    itemClass = '',
    initialHeight = DEFAULT_INITIAL_HEIGHT,
    onScroll,
    children,
  }: {
    items: Item[];
    keyOf: (item: Item, index: number) => ItemKey;
    estimateSize: number | ((index: number) => number);
    overscan?: number;
    gap?: number;
    threshold?: number;
    resetKey?: string;
    viewportClass?: string;
    contentClass?: string;
    itemClass?: string;
    initialHeight?: number;
    onScroll?: (event: Event) => void;
    children: Snippet<[Item, number, VirtualItem | null]>;
  } = $props();

  let scrollViewport = $state<HTMLDivElement | null>(null);

  const rowCount = $derived(items.length);
  const virtualized = $derived(rowCount > threshold);
  const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => scrollViewport,
    estimateSize: (index) => getEstimatedSize(index),
    overscan: DEFAULT_OVERSCAN,
    gap: 0,
    enabled: false,
    initialRect: { width: 0, height: DEFAULT_INITIAL_HEIGHT },
  });
  const virtualItems = $derived(virtualized ? $rowVirtualizer.getVirtualItems() : []);
  const renderedRows = $derived.by(() => {
    if (virtualized) {
      return virtualItems.map((virtualItem) => ({
        item: items[virtualItem.index],
        index: virtualItem.index,
        virtualItem,
      }));
    }

    return items.map((item, index) => ({
      item,
      index,
      virtualItem: null,
    }));
  });
  const listHeight = $derived(virtualized ? $rowVirtualizer.getTotalSize() : 0);

  $effect(() => {
    const count = rowCount;
    const enabled = virtualized;
    const scrollElement = scrollViewport;
    const nextOverscan = overscan;
    const nextGap = gap;
    const nextInitialHeight = initialHeight;

    untrack(() => {
      $rowVirtualizer.setOptions({
        count,
        getScrollElement: () => scrollElement,
        estimateSize: (index) => getEstimatedSize(index),
        getItemKey: (index) => keyOf(items[index], index),
        overscan: nextOverscan,
        gap: nextGap,
        enabled,
        initialRect: { width: 0, height: nextInitialHeight },
      });
    });
  });

  $effect(() => {
    resetKey;
    if (scrollViewport) {
      scrollViewport.scrollTop = 0;
    }
  });

  function getEstimatedSize(index: number) {
    return typeof estimateSize === 'function' ? estimateSize(index) : estimateSize;
  }

  function rowKey(item: Item, index: number) {
    return keyOf(item, index);
  }

  function contentStyle() {
    if (!virtualized) return undefined;
    return `height: ${listHeight}px; position: relative;`;
  }

  function rowStyle(virtualItem: VirtualItem | null) {
    if (!virtualItem) return undefined;

    return [
      'position: absolute;',
      'top: 0;',
      'left: 0;',
      'width: 100%;',
      `transform: translateY(${virtualItem.start}px);`,
    ].join(' ');
  }

  function measureVirtualRow(node: HTMLDivElement) {
    if (virtualized) {
      $rowVirtualizer.measureElement(node);
    }

    return {
      update() {
        if (virtualized) {
          $rowVirtualizer.measureElement(node);
        }
      },
    };
  }
</script>

<div bind:this={scrollViewport} class={`virtual-list-viewport ${viewportClass}`} onscroll={onScroll}>
  <div class={`virtual-list-content ${contentClass}`} style={contentStyle()}>
    {#each renderedRows as row (rowKey(row.item, row.index))}
      <div
        class={`virtual-list-row ${itemClass}`}
        data-index={row.index}
        style={rowStyle(row.virtualItem)}
        use:measureVirtualRow
      >
        {@render children(row.item, row.index, row.virtualItem)}
      </div>
    {/each}
  </div>
</div>

<style>
  .virtual-list-viewport {
    min-width: 0;
  }

  .virtual-list-content {
    min-width: 0;
  }

  .virtual-list-row {
    min-width: 0;
  }
</style>
