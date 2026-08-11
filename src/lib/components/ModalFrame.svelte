<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onDestroy, onMount, tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';
  import { isReducedMotionEnabled } from '$lib/appearance';
  import { flyScale } from '$lib/motion/transitions';
  import { isMobilePlatform } from '$lib/platform';
  import Icon from '$lib/components/Icon.svelte';

  const DRAG_THRESHOLD = 4;

  type DialogRect = {
    left: number;
    top: number;
    width: number;
    height: number;
  };

  type DragSession = {
    pointerId: number;
    captureElement: HTMLDivElement;
    startClientX: number;
    startClientY: number;
    startRect: DialogRect;
    safeRect: DialogRect;
    grabRatioX: number;
    grabOffsetY: number;
    startedMaximized: boolean;
    active: boolean;
  };

  type ResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

  type ResizeSession = {
    pointerId: number;
    captureElement: HTMLDivElement;
    edge: ResizeEdge;
    startClientX: number;
    startClientY: number;
    startRect: DialogRect;
    safeRect: DialogRect;
  };

  const RESIZE_EDGES: ResizeEdge[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

  let {
    title,
    open = true,
    maxWidth = 'max-w-lg',
    closeLabel = 'Close',
    dismissible = true,
    closeOnBackdrop = true,
    resizable = false,
    maximizable = false,
    minWidth = 360,
    minHeight = 240,
    onClose,
    children,
  }: {
    title: string;
    open?: boolean;
    maxWidth?: string;
    closeLabel?: string;
    dismissible?: boolean;
    closeOnBackdrop?: boolean;
    resizable?: boolean;
    maximizable?: boolean;
    minWidth?: number;
    minHeight?: number;
    onClose: () => void;
    children: Snippet;
  } = $props();

  let backdropElement = $state<HTMLDivElement | null>(null);
  let positionerElement = $state<HTMLDivElement | null>(null);
  let panelElement = $state<HTMLDivElement | null>(null);
  let dragAvailable = $state(false);
  let dragSession = $state<DragSession | null>(null);
  let resizeSession = $state<ResizeSession | null>(null);
  let offsetX = $state(0);
  let offsetY = $state(0);
  let explicitWidth = $state<number | null>(null);
  let explicitHeight = $state<number | null>(null);
  let maximized = $state(false);
  let restoreRect = $state<DialogRect | null>(null);
  let dragFrame: number | null = null;
  let resizeFrame: number | null = null;
  let clampFrame: number | null = null;
  let pendingClientX = 0;
  let pendingClientY = 0;
  let windowStateAnimation: Animation | null = null;

  onMount(() => {
    try {
      dragAvailable = !isMobilePlatform();
    } catch {
      dragAvailable = typeof window.matchMedia !== 'function'
        || window.matchMedia('(any-pointer: fine)').matches;
    }
  });

  onDestroy(() => {
    finishDrag();
    finishResize();
    cancelFrame(dragFrame);
    cancelFrame(resizeFrame);
    cancelFrame(clampFrame);
    windowStateAnimation?.cancel();
  });

  $effect(() => {
    if (open) return;
    resetDialogPosition();
  });

  $effect(() => {
    if (
      !open
      || !backdropElement
      || !positionerElement
      || typeof window === 'undefined'
    ) return;

    const handleViewportResize = () => {
      finishDrag();
      finishResize();
      scheduleClamp();
    };
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleClamp);

    observer?.observe(backdropElement);
    observer?.observe(positionerElement);
    window.addEventListener('resize', handleViewportResize);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', handleViewportResize);
    };
  });

  $effect(() => {
    if (!open || typeof document === 'undefined') return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    let cancelled = false;

    tick().then(() => {
      if (!cancelled && panelElement && !panelElement.contains(document.activeElement)) {
        const preferredTarget = panelElement.querySelector<HTMLElement>(
          '.modal-content [autofocus], .modal-content input:not(:disabled), .modal-content textarea:not(:disabled), .modal-content select:not(:disabled)',
        );
        (preferredTarget ?? panelElement).focus({ preventScroll: true });
      }
    });

    return () => {
      cancelled = true;
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  });

  function handleKeydown(event: KeyboardEvent) {
    if (!isTopmostDialog()) return;

    if (
      event.key === 'Enter'
      && (event.ctrlKey || event.metaKey)
      && !event.altKey
      && event.target instanceof HTMLTextAreaElement
    ) {
      const form = event.target.closest('form');
      if (form) {
        event.preventDefault();
        form.requestSubmit();
        return;
      }
    }

    if (event.key === 'Escape' && dismissible) {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !panelElement) return;
    const focusable = Array.from(panelElement.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => (
      !element.hidden
      && element.getAttribute('aria-hidden') !== 'true'
      && !element.closest('[hidden], [inert], [aria-hidden="true"]')
    ));

    if (focusable.length === 0) {
      event.preventDefault();
      panelElement.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function isTopmostDialog() {
    if (!panelElement) return false;
    const dialogs = document.querySelectorAll<HTMLElement>('.modal-panel[role="dialog"]');
    return dialogs[dialogs.length - 1] === panelElement;
  }

  function handleBackdropClick() {
    if (dismissible && closeOnBackdrop) onClose();
  }

  function handleHeaderPointerDown(event: PointerEvent) {
    if (
      !dragAvailable
      || !isTopmostDialog()
      || event.button !== 0
      || !event.isPrimary
      || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')
      || (event.target instanceof Element && event.target.closest('.modal-window-controls'))
    ) return;

    cancelWindowStateAnimation();
    const startRect = readPositionerRect();
    const safeRect = calculateSafeRect(true);
    if (!startRect || !safeRect) return;

    dragSession = {
      pointerId: event.pointerId,
      captureElement: event.currentTarget as HTMLDivElement,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect,
      safeRect,
      grabRatioX: clamp((event.clientX - startRect.left) / Math.max(1, startRect.width), 0, 1),
      grabOffsetY: clamp(event.clientY - startRect.top, 0, 52),
      startedMaximized: maximized,
      active: false,
    };
  }

  function handleHeaderPointerMove(event: PointerEvent) {
    const session = dragSession;
    if (!session || session.pointerId !== event.pointerId) return;

    if (!session.active) {
      const distance = Math.hypot(
        event.clientX - session.startClientX,
        event.clientY - session.startClientY,
      );
      if (distance < DRAG_THRESHOLD) return;

      try {
        session.captureElement.setPointerCapture(event.pointerId);
      } catch {
        dragSession = null;
        return;
      }
      dragSession = { ...session, active: true };
    }

    event.preventDefault();
    pendingClientX = event.clientX;
    pendingClientY = event.clientY;
    if (dragFrame !== null) return;
    dragFrame = requestFrame(() => {
      dragFrame = null;
      applyDragPosition(pendingClientX, pendingClientY);
    });
  }

  function handleHeaderPointerUp(event: PointerEvent) {
    if (!dragSession || dragSession.pointerId !== event.pointerId) return;
    if (dragSession.active) applyDragPosition(event.clientX, event.clientY);
    finishDrag();
    scheduleClamp();
  }

  function handleHeaderPointerCancel(event: PointerEvent) {
    if (!dragSession || dragSession.pointerId !== event.pointerId) return;
    finishDrag();
    scheduleClamp();
  }

  function handleLostPointerCapture(event: PointerEvent) {
    if (!dragSession || dragSession.pointerId !== event.pointerId) return;
    cancelFrame(dragFrame);
    dragFrame = null;
    dragSession = null;
    scheduleClamp();
  }

  function applyDragPosition(clientX: number, clientY: number) {
    let session = dragSession;
    if (!session?.active) return;

    if (session.startedMaximized) {
      const restored = clampRectToSafeArea(
        restoreRect ?? session.startRect,
        calculateSafeRect(true) ?? session.safeRect,
      );
      const anchored = clampRectToSafeArea({
        ...restored,
        left: clientX - restored.width * session.grabRatioX,
        top: clientY - session.grabOffsetY,
      }, calculateSafeRect(true) ?? session.safeRect);

      maximized = false;
      applyDialogRect(anchored);
      restoreRect = null;
      session = {
        ...session,
        startClientX: clientX,
        startClientY: clientY,
        startRect: anchored,
        safeRect: calculateSafeRect(true) ?? session.safeRect,
        startedMaximized: false,
      };
      dragSession = session;
      return;
    }

    const left = clamp(
      session.startRect.left + clientX - session.startClientX,
      session.safeRect.left,
      session.safeRect.left + session.safeRect.width - session.startRect.width,
    );
    const top = clamp(
      session.startRect.top + clientY - session.startClientY,
      session.safeRect.top,
      session.safeRect.top + session.safeRect.height - session.startRect.height,
    );
    applyDialogPosition({ ...session.startRect, left, top }, session.safeRect);
  }

  function finishDrag() {
    const session = dragSession;
    cancelFrame(dragFrame);
    dragFrame = null;
    dragSession = null;
    if (!session?.active) return;
    try {
      session.captureElement.releasePointerCapture(session.pointerId);
    } catch {
      // Pointer capture may already have been released by the user agent.
    }
  }

  function resetDialogPosition() {
    finishDrag();
    finishResize();
    cancelFrame(clampFrame);
    clampFrame = null;
    cancelWindowStateAnimation();
    offsetX = 0;
    offsetY = 0;
    explicitWidth = null;
    explicitHeight = null;
    maximized = false;
    restoreRect = null;
  }

  function handleResizePointerDown(event: PointerEvent, edge: ResizeEdge) {
    if (
      !dragAvailable
      || !resizable
      || maximized
      || !isTopmostDialog()
      || event.button !== 0
      || !event.isPrimary
      || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')
    ) return;

    cancelWindowStateAnimation();
    const startRect = readPositionerRect();
    const safeRect = calculateSafeRect(true);
    if (!startRect || !safeRect) return;

    event.preventDefault();
    event.stopPropagation();
    const captureElement = event.currentTarget as HTMLDivElement;
    try {
      captureElement.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    resizeSession = {
      pointerId: event.pointerId,
      captureElement,
      edge,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect,
      safeRect,
    };
  }

  function handleResizePointerMove(event: PointerEvent) {
    if (!resizeSession || resizeSession.pointerId !== event.pointerId) return;
    event.preventDefault();
    pendingClientX = event.clientX;
    pendingClientY = event.clientY;
    if (resizeFrame !== null) return;
    resizeFrame = requestFrame(() => {
      resizeFrame = null;
      applyResize(pendingClientX, pendingClientY);
    });
  }

  function handleResizePointerUp(event: PointerEvent) {
    if (!resizeSession || resizeSession.pointerId !== event.pointerId) return;
    applyResize(event.clientX, event.clientY);
    finishResize();
    scheduleClamp();
  }

  function handleResizePointerCancel(event: PointerEvent) {
    if (!resizeSession || resizeSession.pointerId !== event.pointerId) return;
    finishResize();
    scheduleClamp();
  }

  function handleResizeLostPointerCapture(event: PointerEvent) {
    if (!resizeSession || resizeSession.pointerId !== event.pointerId) return;
    cancelFrame(resizeFrame);
    resizeFrame = null;
    resizeSession = null;
    scheduleClamp();
  }

  function applyResize(clientX: number, clientY: number) {
    const session = resizeSession;
    if (!session) return;

    const deltaX = clientX - session.startClientX;
    const deltaY = clientY - session.startClientY;
    const startRight = session.startRect.left + session.startRect.width;
    const startBottom = session.startRect.top + session.startRect.height;
    const safeRight = session.safeRect.left + session.safeRect.width;
    const safeBottom = session.safeRect.top + session.safeRect.height;
    const effectiveMinWidth = Math.min(Math.max(1, minWidth), session.safeRect.width);
    const effectiveMinHeight = Math.min(Math.max(1, minHeight), session.safeRect.height);
    let left = session.startRect.left;
    let top = session.startRect.top;
    let right = startRight;
    let bottom = startBottom;

    if (session.edge.includes('e')) {
      right = clamp(startRight + deltaX, left + effectiveMinWidth, safeRight);
    }
    if (session.edge.includes('w')) {
      left = clamp(session.startRect.left + deltaX, session.safeRect.left, right - effectiveMinWidth);
    }
    if (session.edge.includes('s')) {
      bottom = clamp(startBottom + deltaY, top + effectiveMinHeight, safeBottom);
    }
    if (session.edge.includes('n')) {
      top = clamp(session.startRect.top + deltaY, session.safeRect.top, bottom - effectiveMinHeight);
    }

    applyDialogRect({
      left,
      top,
      width: right - left,
      height: bottom - top,
    }, session.safeRect);
  }

  function finishResize() {
    const session = resizeSession;
    cancelFrame(resizeFrame);
    resizeFrame = null;
    resizeSession = null;
    if (!session) return;
    try {
      session.captureElement.releasePointerCapture(session.pointerId);
    } catch {
      // Pointer capture may already have been released by the user agent.
    }
  }

  function handleHeaderDoubleClick(event: MouseEvent) {
    if (
      !dragAvailable
      || !maximizable
      || !isTopmostDialog()
      || (event.target instanceof Element && event.target.closest('.modal-window-controls'))
    ) return;
    event.preventDefault();
    void toggleMaximized();
  }

  async function toggleMaximized() {
    if (!dragAvailable || !maximizable || !positionerElement) return;
    finishDrag();
    finishResize();
    cancelWindowStateAnimation();
    const fromRect = positionerElement.getBoundingClientRect();

    if (maximized) {
      const safeRect = calculateSafeRect(true);
      if (!safeRect) return;
      const targetRect = restoreRect ?? domRectToDialogRect(fromRect);
      maximized = false;
      restoreRect = null;
      applyDialogRect(clampRectToSafeArea(targetRect, safeRect), safeRect);
    } else {
      restoreRect = domRectToDialogRect(fromRect);
      maximized = true;
    }

    await animateWindowState(fromRect);
  }

  async function animateWindowState(fromRect: DOMRect) {
    if (isReducedMotionEnabled()) return;
    await tick();
    if (!positionerElement) return;
    const toRect = positionerElement.getBoundingClientRect();
    if (toRect.width <= 0 || toRect.height <= 0) return;

    windowStateAnimation?.cancel();
    windowStateAnimation = positionerElement.animate([
      {
        transformOrigin: 'top left',
        transform: `translate(${fromRect.left - toRect.left}px, ${fromRect.top - toRect.top}px) scale(${fromRect.width / toRect.width}, ${fromRect.height / toRect.height})`,
      },
      {
        transformOrigin: 'top left',
        transform: 'translate(0, 0) scale(1)',
      },
    ], {
      duration: 180,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
    });
  }

  function scheduleClamp() {
    if (dragSession || resizeSession || clampFrame !== null) return;
    clampFrame = requestFrame(() => {
      clampFrame = null;
      clampDialogToViewport();
    });
  }

  function clampDialogToViewport() {
    const safeRect = calculateSafeRect(true);
    if (!safeRect) return;

    if (maximized) {
      return;
    }

    const currentRect = readPositionerRect();
    if (!currentRect) return;
    const clampedRect = clampRectToSafeArea(currentRect, safeRect);
    if (explicitWidth !== null || explicitHeight !== null) {
      applyDialogRect(clampedRect, safeRect);
    } else {
      applyDialogPosition(clampedRect, safeRect);
    }
  }

  function calculateSafeRect(includeWindowedPadding: boolean): DialogRect | null {
    if (!backdropElement) return null;
    const backdropRect = backdropElement.getBoundingClientRect();
    const backdropStyle = window.getComputedStyle(backdropElement);
    const paddingLeft = includeWindowedPadding ? cssPixels(backdropStyle.paddingLeft) : 0;
    const paddingTop = includeWindowedPadding ? cssPixels(backdropStyle.paddingTop) : 0;
    const paddingRight = includeWindowedPadding ? cssPixels(backdropStyle.paddingRight) : 0;
    const paddingBottom = includeWindowedPadding ? cssPixels(backdropStyle.paddingBottom) : 0;
    return {
      left: backdropRect.left + paddingLeft,
      top: backdropRect.top + paddingTop,
      width: Math.max(0, backdropRect.width - paddingLeft - paddingRight),
      height: Math.max(0, backdropRect.height - paddingTop - paddingBottom),
    };
  }

  function readPositionerRect(): DialogRect | null {
    return positionerElement
      ? domRectToDialogRect(positionerElement.getBoundingClientRect())
      : null;
  }

  function domRectToDialogRect(rect: DOMRect): DialogRect {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  function applyDialogRect(rect: DialogRect, safeRect = calculateSafeRect(true)) {
    if (!safeRect) return;
    const clampedRect = clampRectToSafeArea(rect, safeRect);
    explicitWidth = clampedRect.width;
    explicitHeight = clampedRect.height;
    applyDialogPosition(clampedRect, safeRect);
  }

  function applyDialogPosition(rect: DialogRect, safeRect: DialogRect) {
    offsetX = rect.left + rect.width / 2 - (safeRect.left + safeRect.width / 2);
    offsetY = rect.top + rect.height / 2 - (safeRect.top + safeRect.height / 2);
  }

  function clampRectToSafeArea(rect: DialogRect, safeRect: DialogRect): DialogRect {
    const width = Math.min(rect.width, safeRect.width);
    const height = Math.min(rect.height, safeRect.height);
    return {
      left: clamp(rect.left, safeRect.left, safeRect.left + safeRect.width - width),
      top: clamp(rect.top, safeRect.top, safeRect.top + safeRect.height - height),
      width,
      height,
    };
  }

  function cssPixels(value: string) {
    const pixels = Number.parseFloat(value);
    return Number.isFinite(pixels) ? pixels : 0;
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  function cancelWindowStateAnimation() {
    windowStateAnimation?.cancel();
    windowStateAnimation = null;
  }

  function requestFrame(callback: FrameRequestCallback) {
    if (typeof window.requestAnimationFrame === 'function') {
      return window.requestAnimationFrame(callback);
    }
    return window.setTimeout(() => callback(performance.now()), 16);
  }

  function cancelFrame(frame: number | null) {
    if (frame === null) return;
    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(frame);
    } else {
      window.clearTimeout(frame);
    }
  }
</script>

{#if open}
  <div
    bind:this={backdropElement}
    class="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
    class:modal-drag-enabled={dragAvailable}
    class:modal-dragging={dragSession?.active}
    class:modal-resizing={resizeSession !== null}
    class:modal-maximized={maximized}
    role="presentation"
    transition:fade|global={{ duration: 140 }}
    onclick={handleBackdropClick}
  >
    <div
      bind:this={positionerElement}
      class={`modal-positioner relative w-full ${maxWidth}`}
      class:modal-positioner--maximized={maximized}
      class:modal-positioner--sized={!maximized && explicitHeight !== null}
      style:translate={maximized ? '0px 0px' : `${offsetX}px ${offsetY}px`}
      style:width={!maximized && explicitWidth !== null ? `${explicitWidth}px` : undefined}
      style:height={!maximized && explicitHeight !== null ? `${explicitHeight}px` : undefined}
      style:max-width={!maximized && explicitWidth !== null ? 'none' : undefined}
    >
      <div
        bind:this={panelElement}
        class="modal-panel relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden"
        class:modal-panel--maximized={maximized}
        class:modal-panel--sized={!maximized && explicitHeight !== null}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabindex="-1"
        transition:flyScale|global={{ y: 12, duration: 200 }}
        onclick={(e) => e.stopPropagation()}
        onkeydown={handleKeydown}
      >
        <div
          class="modal-header relative flex shrink-0 items-center justify-between gap-3"
          role="presentation"
          onpointerdown={handleHeaderPointerDown}
          onpointermove={handleHeaderPointerMove}
          onpointerup={handleHeaderPointerUp}
          onpointercancel={handleHeaderPointerCancel}
          onlostpointercapture={handleLostPointerCapture}
          ondblclick={handleHeaderDoubleClick}
        >
          <h2 class="modal-title min-w-0 truncate text-md3-on-surface">{title}</h2>
          <div class="modal-window-controls flex shrink-0 items-center gap-1">
            {#if maximizable && dragAvailable}
              <button
                type="button"
                class="modal-window-action modal-maximize grid shrink-0 place-items-center text-md3-on-surface-variant"
                aria-label={maximized ? $t('common.restoreDialog') : $t('common.maximizeDialog')}
                aria-pressed={maximized}
                title={maximized ? $t('common.restoreDialog') : $t('common.maximizeDialog')}
                onclick={() => { void toggleMaximized(); }}
              >
                <Icon name={maximized ? 'restoreDialog' : 'maximizeDialog'} size="18px" />
              </button>
            {/if}
            <button
              type="button"
              class="modal-window-action modal-close grid shrink-0 place-items-center text-md3-on-surface-variant"
              aria-label={closeLabel}
              disabled={!dismissible}
              onclick={onClose}
            >
              <Icon name="close" size="20px" />
            </button>
          </div>
        </div>
        <div class="modal-content relative min-h-0 overflow-auto">
          {@render children()}
        </div>
      </div>
      {#if resizable && dragAvailable && !maximized}
        {#each RESIZE_EDGES as edge}
          <div
            class={`modal-resize-handle modal-resize-handle--${edge}`}
            data-resize-edge={edge}
            role="presentation"
            aria-hidden="true"
            onpointerdown={(event) => handleResizePointerDown(event, edge)}
            onpointermove={handleResizePointerMove}
            onpointerup={handleResizePointerUp}
            onpointercancel={handleResizePointerCancel}
            onlostpointercapture={handleResizeLostPointerCapture}
            onclick={(event) => event.stopPropagation()}
          ></div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-panel {
    isolation: isolate;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-large, 12px);
    color: var(--color-md3-on-surface);
    background: color-mix(in srgb, var(--color-md3-surface-container) 97%, transparent);
    box-shadow: var(--explorer-shadow, 0 24px 64px rgba(0, 0, 0, 0.38));
    font-family: var(--font-md3-sans);
    -webkit-backdrop-filter: blur(24px) saturate(1.08);
    backdrop-filter: blur(24px) saturate(1.08);
    outline: none;
  }

  .modal-panel--sized,
  .modal-panel--maximized {
    height: 100%;
    max-height: none;
  }

  .modal-panel--maximized {
    border-color: transparent;
    border-radius: 0;
    box-shadow: none;
  }

  .modal-positioner.modal-positioner--maximized {
    position: fixed;
    z-index: 1;
    top: var(--safe-area-top, 0px);
    right: var(--safe-area-right, 0px);
    bottom: var(--safe-area-bottom, 0px);
    left: var(--safe-area-left, 0px);
    width: auto !important;
    height: auto !important;
    max-width: none !important;
  }

  /* The panel is a programmatic focus boundary, not an interactive control.
     Override the workspace-wide [tabindex]:focus-visible rule while leaving
     visible focus indicators on the dialog's inputs and buttons intact. */
  .modal-panel:focus,
  .modal-panel:focus-visible {
    outline: none !important;
  }

  .modal-header {
    min-height: 52px;
    border-bottom: 1px solid var(--color-md3-outline);
    padding: 0.625rem 0.75rem 0.625rem 1.25rem;
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 46%, transparent);
  }

  .modal-drag-enabled .modal-header {
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .modal-dragging .modal-header {
    cursor: grabbing;
  }

  .modal-dragging .modal-positioner {
    will-change: translate;
  }

  .modal-resizing .modal-positioner {
    will-change: width, height, translate;
  }

  .modal-resizing {
    user-select: none;
  }

  .modal-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 650;
    letter-spacing: -0.005em;
  }

  .modal-window-action {
    width: 32px;
    height: 32px;
    border: 1px solid transparent;
    border-radius: var(--explorer-radius-small, 6px);
    background: transparent;
    transition:
      border-color var(--motion-duration-short3) var(--motion-easing-standard),
      background-color var(--motion-duration-short3) var(--motion-easing-standard),
      color var(--motion-duration-short3) var(--motion-easing-standard),
      transform var(--motion-duration-short3) var(--motion-easing-standard);
  }

  .modal-drag-enabled .modal-window-action {
    cursor: pointer;
    touch-action: manipulation;
  }

  .modal-window-action:hover {
    border-color: var(--color-md3-outline);
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-highest);
  }

  .modal-window-action:focus-visible {
    outline: 2px solid var(--color-md3-primary-emphasis, var(--color-md3-primary));
    outline-offset: 1px;
  }

  .modal-window-action:active {
    transform: scale(0.94);
  }

  .modal-window-action:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .modal-content {
    flex: 1 1 auto;
    scrollbar-gutter: stable;
  }

  :global(.modal-positioner--sized .modal-content > *),
  :global(.modal-positioner--maximized .modal-content > *) {
    height: 100% !important;
    max-height: none !important;
  }

  :global(.modal-positioner--sized .modal-flex-region),
  :global(.modal-positioner--maximized .modal-flex-region) {
    min-height: 0 !important;
  }

  .modal-resize-handle {
    position: absolute;
    z-index: 4;
    touch-action: none;
  }

  .modal-resize-handle--n,
  .modal-resize-handle--s {
    right: 10px;
    left: 10px;
    height: 8px;
    cursor: ns-resize;
  }

  .modal-resize-handle--n { top: -4px; }
  .modal-resize-handle--s { bottom: -4px; }

  .modal-resize-handle--e,
  .modal-resize-handle--w {
    top: 10px;
    bottom: 10px;
    width: 8px;
    cursor: ew-resize;
  }

  .modal-resize-handle--e { right: -4px; }
  .modal-resize-handle--w { left: -4px; }

  .modal-resize-handle--ne,
  .modal-resize-handle--se,
  .modal-resize-handle--sw,
  .modal-resize-handle--nw {
    width: 14px;
    height: 14px;
  }

  .modal-resize-handle--ne {
    top: -5px;
    right: -5px;
    cursor: nesw-resize;
  }

  .modal-resize-handle--se {
    right: -5px;
    bottom: -5px;
    cursor: nwse-resize;
  }

  .modal-resize-handle--sw {
    bottom: -5px;
    left: -5px;
    cursor: nesw-resize;
  }

  .modal-resize-handle--nw {
    top: -5px;
    left: -5px;
    cursor: nwse-resize;
  }

  .modal-backdrop {
    --color-md3-primary: #60cdff;
    --color-md3-primary-emphasis: #60cdff;
    --color-md3-primary-container: rgba(96, 205, 255, 0.16);
    --color-md3-on-primary: #0f1115;
    --color-md3-on-primary-container: #f5f5f5;
    --color-md3-surface: #0f1115;
    --color-md3-surface-container: #17191d;
    --color-md3-surface-container-high: #20232a;
    --color-md3-surface-container-highest: #292d35;
    --color-md3-outline: rgba(255, 255, 255, 0.11);
    --color-md3-outline-variant: rgba(255, 255, 255, 0.18);
    --color-md3-on-surface: #f5f5f5;
    --color-md3-on-surface-variant: #b4b8c1;
    --color-md3-field: #20232a;
    --color-md3-error: #ff99a4;
    --color-md3-error-action: #c42b1c;
    --color-md3-error-container: rgba(255, 153, 164, 0.14);
    --color-md3-on-error-action: #ffffff;
    --color-md3-on-error-container: #ff99a4;

    padding-top: max(1rem, var(--safe-area-top, 0px));
    padding-right: max(1rem, var(--safe-area-right, 0px));
    padding-bottom: max(1rem, var(--safe-area-bottom, 0px));
    padding-left: max(1rem, var(--safe-area-left, 0px));
    background: rgba(3, 6, 11, 0.62);
    -webkit-backdrop-filter: blur(10px) saturate(0.9);
    backdrop-filter: blur(10px) saturate(0.9);
  }

  :global(html[data-theme='light']) .modal-backdrop {
    --color-md3-primary: #0067c0;
    --color-md3-primary-emphasis: #0067c0;
    --color-md3-primary-container: rgba(0, 103, 192, 0.12);
    --color-md3-on-primary: #ffffff;
    --color-md3-on-primary-container: #1a1a1a;
    --color-md3-surface: #f3f3f3;
    --color-md3-surface-container: #fafafa;
    --color-md3-surface-container-high: #ffffff;
    --color-md3-surface-container-highest: #ececec;
    --color-md3-outline: rgba(0, 0, 0, 0.10);
    --color-md3-outline-variant: rgba(0, 0, 0, 0.16);
    --color-md3-on-surface: #1a1a1a;
    --color-md3-on-surface-variant: #5d5d5d;
    --color-md3-field: #ffffff;
    --color-md3-error: #c42b1c;
    --color-md3-error-action: #c42b1c;
    --color-md3-error-container: rgba(196, 43, 28, 0.10);
    --color-md3-on-error-action: #ffffff;
    --color-md3-on-error-container: #c42b1c;

    background: rgba(15, 23, 42, 0.28);
  }

  :global(html[data-theme='light']) .modal-panel {
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
  }

  .modal-backdrop {
    animation: modal-backdrop-focus 220ms var(--motion-easing-standard) both;
  }

  @keyframes modal-backdrop-focus {
    from {
      -webkit-backdrop-filter: blur(0);
      backdrop-filter: blur(0);
    }
    to {
      -webkit-backdrop-filter: blur(10px) saturate(0.9);
      backdrop-filter: blur(10px) saturate(0.9);
    }
  }
</style>
