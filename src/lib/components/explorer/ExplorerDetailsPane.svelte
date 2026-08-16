<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import type { FileDetailModel } from '$lib/explorer/types';
  import type { TransitionConfig } from 'svelte/transition';
  import { isReducedMotionEnabled } from '$lib/appearance';

  let {
    open,
    model = null,
    emptyTitle,
    emptyLabel,
    closeLabel,
    resizeLabel,
    onClose,
  }: {
    open: boolean;
    model?: FileDetailModel | null;
    emptyTitle: string;
    emptyLabel: string;
    closeLabel: string;
    resizeLabel: string;
    onClose: () => void;
  } = $props();

  const DETAILS_PANE_MIN_WIDTH = 240;
  const DETAILS_PANE_DEFAULT_WIDTH = 320;
  const DETAILS_PANE_MAX_WIDTH = 480;
  const FILE_LIST_MIN_WIDTH = 320;
  const KEYBOARD_RESIZE_STEP = 16;

  let paneElement = $state<HTMLElement | null>(null);
  let requestedPaneWidth = $state(DETAILS_PANE_DEFAULT_WIDTH);
  let availablePaneMaxWidth = $state(DETAILS_PANE_MAX_WIDTH);
  let resizeSession = $state<{
    pointerId: number;
    startClientX: number;
    startWidth: number;
  } | null>(null);

  const paneWidth = $derived(clampPaneWidth(requestedPaneWidth));

  function clampPaneWidth(width: number) {
    return Math.min(Math.max(width, DETAILS_PANE_MIN_WIDTH), availablePaneMaxWidth);
  }

  function updateAvailablePaneWidth(containerWidth: number) {
    if (containerWidth <= 0) return;
    availablePaneMaxWidth = Math.max(
      DETAILS_PANE_MIN_WIDTH,
      Math.min(DETAILS_PANE_MAX_WIDTH, containerWidth - FILE_LIST_MIN_WIDTH),
    );
  }

  $effect(() => {
    const pane = paneElement;
    const container = pane?.parentElement;
    if (!container) return;

    updateAvailablePaneWidth(container.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => updateAvailablePaneWidth(container.clientWidth));
    observer.observe(container);
    return () => observer.disconnect();
  });

  function handleResizePointerDown(event: PointerEvent) {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    event.preventDefault();
    resizeSession = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: paneWidth,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handleResizePointerMove(event: PointerEvent) {
    if (!resizeSession || resizeSession.pointerId !== event.pointerId) return;
    event.preventDefault();
    requestedPaneWidth = clampPaneWidth(
      resizeSession.startWidth - (event.clientX - resizeSession.startClientX),
    );
  }

  function finishResize(event: PointerEvent) {
    if (!resizeSession || resizeSession.pointerId !== event.pointerId) return;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    resizeSession = null;
  }

  function cancelResize(event: PointerEvent) {
    if (resizeSession?.pointerId === event.pointerId) resizeSession = null;
  }

  function handleResizeKeydown(event: KeyboardEvent) {
    let nextWidth: number | null = null;
    if (event.key === 'ArrowLeft') nextWidth = paneWidth + KEYBOARD_RESIZE_STEP;
    if (event.key === 'ArrowRight') nextWidth = paneWidth - KEYBOARD_RESIZE_STEP;
    if (event.key === 'Home') nextWidth = DETAILS_PANE_MIN_WIDTH;
    if (event.key === 'End') nextWidth = availablePaneMaxWidth;
    if (nextWidth === null) return;

    event.preventDefault();
    event.stopPropagation();
    requestedPaneWidth = clampPaneWidth(nextWidth);
  }

  function detailsPaneTransition(node: HTMLElement): TransitionConfig {
    if (isReducedMotionEnabled()) {
      return { duration: 0 };
    }

    const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches;
    const width = node.getBoundingClientRect().width;
    return {
      duration: 180,
      easing: (value) => 1 - Math.pow(1 - value, 3),
      css: (progress, inverse) => mobile
        ? `opacity: ${progress}; transform: translate3d(0, ${inverse * 18}px, 0);`
        : `opacity: ${progress}; width: ${progress * width}px; min-width: ${progress * Math.min(width, 240)}px; transform: translate3d(${inverse * 12}px, 0, 0); overflow: hidden;`,
    };
  }
</script>

{#if open}
  <aside
    bind:this={paneElement}
    class="explorer-details-pane"
    class:is-resizing={resizeSession !== null}
    aria-label={model?.title ?? emptyTitle}
    data-keyboard-region="details"
    tabindex="-1"
    style={`--explorer-details-width: ${paneWidth}px;`}
    in:detailsPaneTransition
  >
    <!-- The ARIA separator pattern is intentionally keyboard-adjustable. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="explorer-details-resize-handle"
      role="separator"
      tabindex="0"
      aria-label={resizeLabel}
      aria-orientation="vertical"
      aria-valuemin={DETAILS_PANE_MIN_WIDTH}
      aria-valuemax={availablePaneMaxWidth}
      aria-valuenow={paneWidth}
      title={resizeLabel}
      onpointerdown={handleResizePointerDown}
      onpointermove={handleResizePointerMove}
      onpointerup={finishResize}
      onpointercancel={finishResize}
      onlostpointercapture={cancelResize}
      onkeydown={handleResizeKeydown}
    ></div>
    <header class="explorer-details-header">
      <div class="explorer-details-heading">
        <span class="explorer-details-icon"><Icon name={model?.icon ?? 'info'} size="22px" /></span>
        <div class="min-w-0">
          <h2>{model?.title ?? emptyTitle}</h2>
          {#if model?.subtitle}<p>{model.subtitle}</p>{/if}
        </div>
      </div>
      <button class="explorer-command-button explorer-details-close" aria-label={closeLabel} title={closeLabel} onclick={onClose}>
        <Icon name="close" size="17px" />
      </button>
    </header>

    <div class="explorer-details-body">
      {#if model?.loading}
        <div class="explorer-details-empty"><ProgressRing size={20} strokeWidth={2.5} label={emptyLabel} /></div>
      {:else if model?.error}
        <p class="explorer-details-error">{model.error}</p>
      {:else if model}
        <dl>
          {#each model.rows as row}
            <div class="explorer-detail-row">
              <dt>{row.label}</dt>
              <dd title={row.value}>{row.value}</dd>
            </div>
          {/each}
        </dl>
      {:else}
        <p class="explorer-details-empty">{emptyLabel}</p>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .explorer-details-pane {
    position: relative;
    display: flex;
    width: var(--explorer-details-width, 320px);
    height: 100%;
    min-width: 240px;
    max-width: 480px;
    min-height: 0;
    flex: 0 0 auto;
    flex-direction: column;
    border-left: 1px solid var(--explorer-border);
    background: var(--explorer-surface-raised);
  }

  .explorer-details-resize-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -5px;
    z-index: 3;
    width: 10px;
    cursor: col-resize;
    touch-action: none;
  }

  .explorer-details-resize-handle::after {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 2px;
    background: transparent;
    content: '';
    transform: translateX(-50%);
    transition: background-color 120ms ease;
  }

  .explorer-details-resize-handle:hover::after,
  .explorer-details-resize-handle:focus-visible::after,
  .explorer-details-pane.is-resizing .explorer-details-resize-handle::after {
    background: var(--explorer-accent);
  }

  .explorer-details-header {
    display: flex;
    min-height: 54px;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    border-bottom: 1px solid var(--explorer-border);
    padding: 0.55rem 0.65rem 0.55rem 0.8rem;
  }

  .explorer-details-heading {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.65rem;
  }

  .explorer-details-icon {
    display: inline-flex;
    width: 22px;
    height: 22px;
    flex: none;
    align-items: center;
    justify-content: center;
    color: var(--explorer-accent);
    line-height: 1;
  }
  .explorer-details-heading h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9rem; font-weight: 600; line-height: 22px; }
  .explorer-details-heading p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--explorer-text-muted); font-size: 0.72rem; }
  .explorer-details-close { width: 30px; min-height: 30px; padding: 0; }
  .explorer-details-body { min-height: 0; flex: 1; overflow: auto; padding: 0.7rem 0.8rem; }
  .explorer-detail-row { display: grid; grid-template-columns: minmax(76px, 0.42fr) minmax(0, 1fr); gap: 0.65rem; border-bottom: 1px solid var(--explorer-border); padding: 0.55rem 0; font-size: 0.76rem; }
  .explorer-detail-row dt { color: var(--explorer-text-muted); }
  .explorer-detail-row dd { overflow-wrap: anywhere; color: var(--explorer-text); }
  .explorer-details-empty { padding: 2rem 0.5rem; text-align: center; color: var(--explorer-text-muted); font-size: 0.78rem; }
  .explorer-details-error { color: var(--explorer-danger); font-size: 0.78rem; }

  @media (max-width: 720px) {
    .explorer-details-pane {
      position: fixed;
      right: max(0px, var(--safe-area-right));
      bottom: max(0px, var(--safe-area-bottom));
      left: max(0px, var(--safe-area-left));
      z-index: 70;
      width: auto;
      min-width: 0;
      max-height: 58vh;
      overflow: auto;
      border: 1px solid var(--explorer-border-strong);
      border-radius: var(--explorer-radius-large) var(--explorer-radius-large) 0 0;
      box-shadow: var(--explorer-shadow);
    }

    .explorer-details-resize-handle {
      display: none;
    }
  }

  @media (pointer: coarse) {
    .explorer-details-resize-handle {
      display: none;
    }
  }
</style>
