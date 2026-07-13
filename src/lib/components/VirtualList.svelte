<script lang="ts" generics="Item">
  import { tick, untrack, type Snippet } from 'svelte';
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
    keyboardNavigation = false,
    keyboardTargetSelector = 'button, [tabindex]',
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
    keyboardNavigation?: boolean;
    keyboardTargetSelector?: string;
    children: Snippet<[Item, number, VirtualItem | null]>;
  } = $props();

  let scrollViewport = $state<HTMLDivElement | null>(null);
  let activeKeyboardIndex = $state(0);

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
    activeKeyboardIndex = 0;
    if (scrollViewport) {
      scrollViewport.scrollTop = 0;
    }
  });

  $effect(() => {
    renderedRows;
    if (!keyboardNavigation) return;
    void tick().then(syncKeyboardTabStops);
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

  function syncKeyboardTabStops() {
    if (!scrollViewport || !keyboardNavigation) return;
    for (const row of scrollViewport.querySelectorAll<HTMLElement>('.virtual-list-row[data-index]')) {
      const target = row.querySelector<HTMLElement>(keyboardTargetSelector);
      if (target) target.tabIndex = Number(row.dataset.index) === activeKeyboardIndex ? 0 : -1;
    }
  }

  async function handleKeyboardNavigation(event: KeyboardEvent) {
    if (!keyboardNavigation || !scrollViewport) return;
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.virtual-list-row[data-index]') : null;
    if (!row || row.querySelector<HTMLElement>(keyboardTargetSelector) !== event.target) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) return;
    event.preventDefault();
    const current = Number(row.dataset.index);
    const estimatedSize = Math.max(1, getEstimatedSize(current));
    const pageSize = Math.max(1, Math.floor(scrollViewport.clientHeight / estimatedSize) - 1);
    let next = current;
    if (event.key === 'ArrowDown') next += 1;
    else if (event.key === 'ArrowUp') next -= 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rowCount - 1;
    else if (event.key === 'PageDown') next += pageSize;
    else if (event.key === 'PageUp') next -= pageSize;
    activeKeyboardIndex = Math.max(0, Math.min(rowCount - 1, next));
    if (virtualized) $rowVirtualizer.scrollToIndex(activeKeyboardIndex, { align: 'auto' });
    await tick();
    syncKeyboardTabStops();
    scrollViewport
      .querySelector<HTMLElement>(`.virtual-list-row[data-index="${activeKeyboardIndex}"]`)
      ?.querySelector<HTMLElement>(keyboardTargetSelector)
      ?.focus({ preventScroll: true });
  }

  function handleFocusIn(event: FocusEvent) {
    if (!keyboardNavigation || !(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>('.virtual-list-row[data-index]');
    if (!row || row.querySelector<HTMLElement>(keyboardTargetSelector) !== event.target) return;
    activeKeyboardIndex = Number(row.dataset.index);
    syncKeyboardTabStops();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={scrollViewport}
  class={`virtual-list-viewport ${viewportClass}`}
  role="list"
  onscroll={onScroll}
  onkeydown={handleKeyboardNavigation}
  onfocusin={handleFocusIn}
>
  <div class={`virtual-list-content ${contentClass}`} style={contentStyle()}>
    {#each renderedRows as row (rowKey(row.item, row.index))}
      <div
        class={`virtual-list-row ${itemClass}`}
        role="listitem"
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
