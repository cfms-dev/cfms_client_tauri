<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    activeIndex: number;
    pageCount: number;
    bottomPadding?: number;
    ariaLabel?: string;
    onIndexChange: (index: number) => void;
    children: Snippet;
  }

  let {
    activeIndex,
    pageCount,
    bottomPadding = 0,
    ariaLabel = 'Swipe pages',
    onIndexChange,
    children,
  }: Props = $props();

  let viewport: HTMLDivElement | null = $state(null);
  let pointerId = $state<number | null>(null);
  let startX = $state(0);
  let startY = $state(0);
  let dragX = $state(0);
  let dragging = $state(false);
  let horizontalGesture = $state(false);

  const clampedIndex = $derived(Math.max(0, Math.min(activeIndex, pageCount - 1)));
  const trackTransform = $derived(
    `translate3d(calc(${-clampedIndex * 100}% + ${dragX}px), 0, 0)`,
  );

  function clampPage(index: number) {
    return Math.max(0, Math.min(index, pageCount - 1));
  }

  function beginDrag(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dragX = 0;
    dragging = true;
    horizontalGesture = false;
    viewport?.setPointerCapture(event.pointerId);
  }

  function updateDrag(event: PointerEvent) {
    if (!dragging || event.pointerId !== pointerId) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (!horizontalGesture && Math.abs(dx) > 8) {
      horizontalGesture = Math.abs(dx) > Math.abs(dy) * 1.15;
    }

    if (!horizontalGesture) return;

    event.preventDefault();
    const atFirst = clampedIndex === 0 && dx > 0;
    const atLast = clampedIndex === pageCount - 1 && dx < 0;
    dragX = atFirst || atLast ? dx * 0.28 : dx;
  }

  function endDrag(event: PointerEvent) {
    if (!dragging || event.pointerId !== pointerId) return;

    const width = viewport?.clientWidth ?? window.innerWidth;
    const commitDistance = Math.min(96, Math.max(48, width * 0.18));
    const targetIndex = dragX < -commitDistance
      ? clampedIndex + 1
      : dragX > commitDistance
        ? clampedIndex - 1
        : clampedIndex;

    viewport?.releasePointerCapture(event.pointerId);
    pointerId = null;
    dragging = false;
    horizontalGesture = false;
    dragX = 0;

    const nextIndex = clampPage(targetIndex);
    if (nextIndex !== clampedIndex) onIndexChange(nextIndex);
  }

  function cancelDrag(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;

    pointerId = null;
    dragging = false;
    horizontalGesture = false;
    dragX = 0;
  }
</script>

<div
  bind:this={viewport}
  class="swipe-pager min-h-0 flex-1 overflow-hidden"
  style={`--pager-bottom-padding: ${bottomPadding}px; --pager-page-count: ${pageCount};`}
  role="region"
  aria-roledescription="carousel"
  aria-label={ariaLabel}
  onpointerdown={beginDrag}
  onpointermove={updateDrag}
  onpointerup={endDrag}
  onpointercancel={cancelDrag}
>
  <div
    class="swipe-pager-track flex h-full min-h-0"
    class:is-dragging={dragging}
    style={`transform: ${trackTransform};`}
  >
    {@render children()}
  </div>
</div>

<style>
  .swipe-pager {
    touch-action: pan-y;
    overscroll-behavior-x: contain;
  }

  .swipe-pager-track {
    width: 100%;
    transition: transform 460ms var(--motion-easing-emphasized, cubic-bezier(0.2, 0, 0, 1));
    will-change: transform;
  }

  .swipe-pager-track.is-dragging {
    transition: none;
    cursor: grabbing;
  }

  :global(.swipe-pager-page) {
    flex: 0 0 100%;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: var(--pager-bottom-padding);
    scrollbar-gutter: stable;
    overscroll-behavior-y: contain;
  }

  @media (prefers-reduced-motion: reduce) {
    .swipe-pager-track {
      transition: none !important;
    }
  }
</style>
