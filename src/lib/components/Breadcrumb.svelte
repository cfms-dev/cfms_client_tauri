<script lang="ts">
  // Directory hierarchy, independent of the file manager's visit timeline.

  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import type { ContextMenuItem } from './context-menu';
  import { _ as t } from 'svelte-i18n';
  import { ROOT_DIRECTORY_ID } from '$lib/file-browser';
  import { focusRovingItem } from '$lib/keyboard';

  interface Props {
    segments: Array<{ label: string; path: string }>;
    onNavigate: (path: string) => void;
    collapseOverflow?: boolean;
  }

  let { segments, onNavigate, collapseOverflow = false }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let nav = $state<HTMLElement | null>(null);
  let measurement = $state<HTMLDivElement | null>(null);
  let overflowButton = $state<HTMLButtonElement | null>(null);
  let firstVisible = $state(0);
  let showRoot = $state(true);
  let menuOpen = $state(false);
  let menuPosition = $state({ x: 0, y: 0 });
  let scheduledFrame: number | null = null;
  const hasOverflow = $derived(collapseOverflow && (firstVisible > 0 || !showRoot));
  const visibleSegments = $derived(segments.slice(collapseOverflow ? firstVisible : 0));
  const menuItems = $derived.by<ContextMenuItem[]>(() => {
    const items = segments.slice(0, firstVisible).map<ContextMenuItem>((segment, index) => ({
      id: `ancestor-${index}`,
      label: segment.label,
      icon: 'folder',
      onSelect: () => navigate(segment.path),
    })).reverse();
    if (!showRoot) items.push({
      id: 'root', label: $t('files.goToRoot'), icon: 'home',
      onSelect: () => navigate(ROOT_DIRECTORY_ID),
    });
    return items;
  });

  function navigate(path: string) {
    menuOpen = false;
    onNavigate(path);
  }

  function openOverflow() {
    if (!overflowButton) return;
    const bounds = overflowButton.getBoundingClientRect();
    menuPosition = { x: bounds.left, y: bounds.bottom + 4 };
    menuOpen = true;
  }

  function scheduleMeasurement() {
    if (typeof window === 'undefined' || scheduledFrame !== null) return;
    scheduledFrame = window.requestAnimationFrame(() => {
      scheduledFrame = null;
      measureLayout();
    });
  }

  function measureLayout() {
    if (!collapseOverflow || !container || !measurement || !nav) return;
    const available = container.clientWidth;
    const widths = Array.from(measurement.children, (child) => child.getBoundingClientRect().width);
    const [rootWidth, overflowWidth, separatorWidth, ...segmentWidths] = widths;
    // Hidden or not-yet-laid-out surfaces are measured again when they become visible.
    if (available <= 0 || !rootWidth || segmentWidths.length !== segments.length) return;
    const boundary = separatorWidth + 2 * (parseFloat(getComputedStyle(nav).columnGap) || 0);
    const last = segments.length - 1;
    function requiredWidth(start: number, root: boolean, currentWidth = segmentWidths[last] ?? 0) {
      const overflow = start > 0 || !root;
      const itemCount = Number(root) + Number(overflow) + segmentWidths.length - start;
      return (root ? rootWidth : 0) + (overflow ? overflowWidth : 0)
        + segmentWidths.slice(start, last).reduce((sum, width) => sum + width, 0)
        + (last >= 0 ? currentWidth : 0) + Math.max(0, itemCount - 1) * boundary;
    }
    let start = 0;
    while (start < last && requiredWidth(start, true) > available) start++;
    const root = last < 0 || requiredWidth(start, true, Math.min(segmentWidths[last], 32)) <= available;
    const wasOpen = menuOpen;
    menuOpen = false;
    firstVisible = start;
    showRoot = root;
    if (wasOpen) void tick().then(() => {
      // If widening removed the menu trigger, return focus to the remaining hierarchy.
      if (!overflowButton && document.activeElement === document.body) {
        nav?.querySelector<HTMLElement>('[data-breadcrumb-item]')?.focus({ preventScroll: true });
      }
    });
  }

  $effect(() => {
    segments;
    collapseOverflow;
    firstVisible = 0;
    showRoot = true;
    menuOpen = false;
    scheduleMeasurement();
  });

  onMount(() => {
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasurement);
    if (container) observer?.observe(container);
    // The uncollapsed copy changes size when labels, language or pointer density change.
    if (measurement) observer?.observe(measurement);
    if (measurement?.firstElementChild) observer?.observe(measurement.firstElementChild);
    document.fonts?.addEventListener('loadingdone', scheduleMeasurement);
    let disposed = false;
    void document.fonts?.ready.then(() => { if (!disposed) scheduleMeasurement(); });
    return () => {
      disposed = true;
      observer?.disconnect();
      document.fonts?.removeEventListener('loadingdone', scheduleMeasurement);
      if (scheduledFrame !== null) window.cancelAnimationFrame(scheduledFrame);
    };
  });
</script>

{#snippet separator()}
  <span class="cfms-breadcrumb__separator" data-breadcrumb-separator aria-hidden="true">
    <Icon name="breadcrumbSep" size="14px" />
  </span>
{/snippet}

<div bind:this={container} class="cfms-breadcrumb-container" class:cfms-breadcrumb-container--collapse={collapseOverflow}>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav
  bind:this={nav}
  aria-label={$t('common.breadcrumb')}
  class="cfms-breadcrumb flex flex-nowrap items-center gap-1 whitespace-nowrap text-sm no-select"
  tabindex="-1"
  onkeydown={(event) => focusRovingItem(event, event.currentTarget as HTMLElement, {
    selector: '[data-breadcrumb-item]',
    orientation: 'horizontal',
  })}
>
  {#if !collapseOverflow || showRoot}
    <button
      data-breadcrumb-item
      tabindex="0"
      class="cfms-breadcrumb__target cfms-breadcrumb__icon"
      title={$t('files.goToRoot')}
      aria-label={$t('files.goToRoot')}
      onclick={() => navigate(ROOT_DIRECTORY_ID)}
    >
      <Icon name="home" size="16px" class="shrink-0" />
    </button>
  {/if}

  {#if hasOverflow}
    {#if showRoot}{@render separator()}{/if}
    <button
      bind:this={overflowButton}
      data-breadcrumb-item
      tabindex={showRoot ? -1 : 0}
      class="cfms-breadcrumb__target cfms-breadcrumb__icon"
      title={$t('files.hiddenPathSegments')}
      aria-label={$t('files.hiddenPathSegments')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onclick={openOverflow}
      onkeydown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); openOverflow(); }
      }}
    >
      <Icon name="more" size="16px" />
    </button>
  {/if}

  {#each visibleSegments as seg, i}
    {@render separator()}
    {#if i === visibleSegments.length - 1}
      <span
        class="cfms-breadcrumb__current"
        data-breadcrumb-segment
        title={seg.label}
        aria-current="page"
      >
        {seg.label}
      </span>
    {:else}
      <button
        data-breadcrumb-item
        tabindex="-1"
        class="cfms-breadcrumb__target"
        title={seg.label}
        onclick={() => navigate(seg.path)}
      >
        {seg.label}
      </button>
    {/if}
  {/each}
</nav>

{#if collapseOverflow}
  <div bind:this={measurement} class="cfms-breadcrumb-measure text-sm" aria-hidden="true" inert>
    <span class="cfms-breadcrumb__target cfms-breadcrumb__icon"><Icon name="home" size="16px" /></span>
    <span class="cfms-breadcrumb__target cfms-breadcrumb__icon"><Icon name="more" size="16px" /></span>
    {@render separator()}
    {#each segments as seg, i}
      <span class={i === segments.length - 1 ? 'cfms-breadcrumb__current' : 'cfms-breadcrumb__target'}>{seg.label}</span>
    {/each}
  </div>
{/if}
</div>

<ContextMenu open={menuOpen && hasOverflow} x={menuPosition.x} y={menuPosition.y} items={menuItems} sourceElement={overflowButton} onClose={() => { menuOpen = false; }} />

<style>
  .cfms-breadcrumb-container { min-inline-size: 0; }
  .cfms-breadcrumb-container--collapse { position: relative; }
  .cfms-breadcrumb { color: var(--colorNeutralForeground1); font-weight: 400; }
  .cfms-breadcrumb-container--collapse .cfms-breadcrumb { inline-size: max-content; max-inline-size: 100%; }
  .cfms-breadcrumb__target {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-block-size: var(--breadcrumb-target-height, 32px);
    border-radius: var(--borderRadiusMedium);
    padding-inline: 4px;
    line-height: 20px;
    white-space: nowrap;
    cursor: default;
  }
  .cfms-breadcrumb-container--collapse .cfms-breadcrumb__icon { inline-size: 32px; box-sizing: border-box; }
  .cfms-breadcrumb__separator { display: inline-flex; flex: none; align-items: center; color: var(--colorNeutralForeground2); cursor: default; }
  .cfms-breadcrumb__current { flex: none; line-height: 20px; color: var(--colorNeutralForeground1); white-space: nowrap; cursor: default; }
  .cfms-breadcrumb-container--collapse .cfms-breadcrumb__current { flex: 0 1 auto; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; }
  .cfms-breadcrumb-measure {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    display: flex;
    align-items: center;
    inline-size: max-content;
    max-inline-size: 100%;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
    font-weight: 400;
  }
  .cfms-breadcrumb-measure .cfms-breadcrumb__current { flex: none; }
  .cfms-breadcrumb [data-breadcrumb-item]:hover { background: color-mix(in srgb, var(--colorNeutralForeground1) 8%, transparent); }
  @media (pointer: coarse) {
    .cfms-breadcrumb__target { min-inline-size: 44px; min-block-size: var(--breadcrumb-target-height, 44px); }
  }
  @media (forced-colors: active) {
    .cfms-breadcrumb { color: ButtonText; }
    .cfms-breadcrumb__current, .cfms-breadcrumb__separator { color: CanvasText; }
    .cfms-breadcrumb [data-breadcrumb-item]:hover { color: HighlightText; background: Highlight; }
  }
</style>
