<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { isReducedMotionEnabled } from '$lib/appearance';
  import type { ReleaseTourPresentation } from '$lib/release-highlights/types';
  import LottieScene from '$lib/components/LottieScene.svelte';

  interface Props {
    presentation: ReleaseTourPresentation;
    onDismiss: () => void;
  }

  let { presentation, onDismiss }: Props = $props();
  let currentIndex = $state(0);
  let dialog = $state<HTMLElement | null>(null);
  let reducedMotion = $state(false);
  let pointerStart: { id: number; x: number; y: number } | null = null;
  let previouslyFocused: HTMLElement | null = null;
  let appearanceObserver: MutationObserver | null = null;

  const highlights = $derived(presentation.highlights);
  const currentHighlight = $derived(highlights[currentIndex] ?? highlights[0]);
  const isFirst = $derived(currentIndex === 0);
  const isLast = $derived(currentIndex === highlights.length - 1);

  onMount(async () => {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    reducedMotion = isReducedMotionEnabled();
    appearanceObserver = new MutationObserver(() => {
      reducedMotion = isReducedMotionEnabled();
    });
    appearanceObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-reduce-motion'],
    });
    await tick();
    dialog?.focus({ preventScroll: true });
  });

  onDestroy(() => {
    appearanceObserver?.disconnect();
    previouslyFocused?.focus({ preventScroll: true });
  });

  function previous() {
    if (!isFirst) currentIndex -= 1;
  }

  function next() {
    if (isLast) onDismiss();
    else currentIndex += 1;
  }

  function goTo(index: number) {
    currentIndex = Math.max(0, Math.min(index, highlights.length - 1));
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
      return;
    }
    if (event.key !== 'Tab' || !dialog) return;

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute('hidden'));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
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

  function handlePointerDown(event: PointerEvent) {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function handlePointerUp(event: PointerEvent) {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    const deltaX = event.clientX - pointerStart.x;
    const deltaY = event.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.abs(deltaX) < 52 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) return;
    if (deltaX > 0) previous();
    else next();
  }
</script>

<div class="release-highlights-overlay fixed inset-0 z-[85]" role="presentation">
  <div
    bind:this={dialog}
    class="release-highlights-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="release-highlight-title"
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <header class="tour-toolbar">
      <div class="release-identity">
        <span class="signal-mark" aria-hidden="true"></span>
        <span>{$t(presentation.tour.labelKey)}</span>
      </div>
      <button type="button" class="skip-action" onclick={onDismiss}>
        {$t('releaseHighlights.skip')}
      </button>
    </header>

    <div
      class="tour-body"
      role="group"
      aria-label={$t('releaseHighlights.chooseFeature')}
      onpointerdown={handlePointerDown}
      onpointerup={handlePointerUp}
      onpointercancel={() => (pointerStart = null)}
    >
      <div class="visual-stage">
        {#key currentHighlight.id}
          <div class="visual-stage__inner">
            <LottieScene
              src={currentHighlight.animationSrc}
              fallbackIcon={currentHighlight.fallbackIcon}
              {reducedMotion}
            />
          </div>
        {/key}
      </div>

      {#key currentHighlight.id}
        <article class="highlight-copy" aria-live="polite">
          <p class="progress-label">
            {$t('releaseHighlights.progress', {
              values: { current: currentIndex + 1, total: highlights.length },
            })}
          </p>
          <h2 id="release-highlight-title">{$t(currentHighlight.titleKey)}</h2>
          <p class="highlight-body">{$t(currentHighlight.bodyKey)}</p>
        </article>
      {/key}
    </div>

    <footer class="tour-footer">
      <div class="progress-dots" aria-label={$t('releaseHighlights.chooseFeature')}>
        {#each highlights as highlight, index (highlight.id)}
          <button
            type="button"
            class:active={index === currentIndex}
            aria-label={$t('releaseHighlights.goToFeature', { values: { number: index + 1 } })}
            aria-current={index === currentIndex ? 'step' : undefined}
            onclick={() => goTo(index)}
          ><span></span></button>
        {/each}
      </div>

      <div class="navigation-actions">
        <button type="button" class="back-action" onclick={previous} disabled={isFirst}>
          <span class="navigation-glyph" aria-hidden="true">←</span>
          {$t('common.back')}
        </button>
        <button type="button" class="next-action" onclick={next}>
          {isLast ? $t('releaseHighlights.startUsing') : $t('common.next')}
          <span class="navigation-glyph" aria-hidden="true">{isLast ? '✓' : '→'}</span>
        </button>
      </div>
    </footer>
  </div>
</div>

<style>
  .release-highlights-overlay {
    display: grid;
    min-height: 100dvh;
    place-items: center;
    overflow: auto;
    padding:
      calc(var(--safe-area-top, 0px) + 1.25rem)
      max(1.25rem, var(--safe-area-right, 0px))
      calc(var(--safe-area-bottom, 0px) + 1.25rem)
      max(1.25rem, var(--safe-area-left, 0px));
    background: color-mix(in srgb, var(--color-md3-surface) 91%, transparent);
    backdrop-filter: blur(22px);
    -webkit-backdrop-filter: blur(22px);
  }

  .release-highlights-dialog {
    width: min(68rem, 100%);
    min-height: min(44rem, calc(100dvh - 2.5rem));
    max-height: calc(100dvh - 2.5rem);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-md3-outline) 72%, transparent);
    border-radius: 16px;
    color: var(--color-md3-on-surface);
    background: color-mix(in srgb, var(--color-md3-surface-container) 96%, transparent);
    box-shadow: 0 28px 72px rgba(0, 0, 0, 0.28);
    outline: none;
  }

  .release-highlights-dialog:focus-visible {
    box-shadow:
      0 0 0 2px var(--color-md3-primary-emphasis),
      0 28px 72px rgba(0, 0, 0, 0.28);
  }

  .tour-toolbar,
  .tour-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem;
  }

  .tour-toolbar {
    border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 56%, transparent);
  }

  .tour-footer {
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 56%, transparent);
  }

  .release-identity {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    color: var(--color-md3-on-surface-variant);
    font: 700 0.78rem/1.2 var(--font-md3-sans);
  }

  .signal-mark {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    background: var(--color-md3-primary-emphasis);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--color-md3-primary-emphasis) 32%, transparent);
  }

  .skip-action,
  .back-action,
  .next-action {
    display: inline-flex;
    min-height: 2.5rem;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    border-radius: 7px;
    padding: 0 0.9rem;
    font: 700 0.82rem/1 var(--font-md3-sans);
    transition:
      transform var(--motion-duration-short4) var(--motion-easing-standard),
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .skip-action,
  .back-action {
    color: var(--color-md3-on-surface-variant);
    background: transparent;
  }

  .skip-action:hover,
  .back-action:hover:not(:disabled) {
    color: var(--color-md3-on-surface);
    background: color-mix(in srgb, var(--color-md3-on-surface) 8%, transparent);
  }

  .next-action {
    min-width: 8.5rem;
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
  }

  .next-action:hover {
    transform: translateY(-1px);
  }

  .back-action:disabled {
    opacity: 0.35;
  }

  .tour-body {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(22rem, 1.08fr) minmax(20rem, 0.92fr);
    align-items: center;
    gap: clamp(2rem, 5vw, 4.5rem);
    overflow: auto;
    padding: clamp(1.5rem, 4vw, 3.25rem);
    touch-action: pan-y;
  }

  .visual-stage {
    width: 100%;
    min-width: 0;
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 14px;
    background: color-mix(in srgb, var(--color-md3-primary-container) 28%, var(--color-md3-surface));
  }

  .visual-stage__inner {
    width: min(92%, 31rem);
    height: min(92%, 31rem);
    animation: visual-arrive var(--motion-duration-long2) var(--motion-easing-emphasized-decelerate) both;
  }

  .highlight-copy {
    max-width: 34rem;
    display: grid;
    align-content: center;
    gap: 0.9rem;
    animation: copy-arrive var(--motion-duration-medium4) var(--motion-easing-emphasized-decelerate) both;
  }

  .progress-label,
  .highlight-body,
  h2 {
    margin: 0;
  }

  .progress-label {
    color: var(--color-md3-primary-emphasis);
    font: 750 0.78rem/1.3 var(--font-md3-sans);
  }

  h2 {
    max-width: 14ch;
    color: var(--color-md3-on-surface);
    font: 760 clamp(2rem, 4vw, 3.35rem)/1.08 var(--font-md3-sans);
    letter-spacing: -0.025em;
    text-wrap: balance;
  }

  .highlight-body {
    max-width: 58ch;
    color: var(--color-md3-on-surface-variant);
    font: 450 clamp(0.95rem, 1.5vw, 1.08rem)/1.7 var(--font-md3-sans);
  }

  .progress-dots {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .progress-dots button {
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    border-radius: 50%;
  }

  .progress-dots span {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: color-mix(in srgb, var(--color-md3-on-surface-variant) 42%, transparent);
    transition:
      width var(--motion-duration-medium2) var(--motion-easing-emphasized-decelerate),
      background-color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .progress-dots button.active span {
    width: 1.2rem;
    border-radius: 999px;
    background: var(--color-md3-primary-emphasis);
  }

  .navigation-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .navigation-glyph {
    width: 1.15rem;
    display: inline-grid;
    flex: 0 0 1.15rem;
    place-items: center;
    font: 700 1.15rem/1 var(--font-md3-sans);
  }

  @keyframes visual-arrive {
    from { opacity: 0.62; transform: scale(0.94); filter: blur(4px); }
    to { opacity: 1; transform: scale(1); filter: blur(0); }
  }

  @keyframes copy-arrive {
    from { opacity: 0; transform: translateX(1.25rem); }
    to { opacity: 1; transform: translateX(0); }
  }

  @media (max-width: 820px) {
    .release-highlights-overlay {
      padding: 0;
    }

    .release-highlights-dialog {
      width: 100%;
      min-height: 100dvh;
      max-height: 100dvh;
      border: 0;
      border-radius: 0;
      box-shadow: none;
    }

    .tour-body {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(15rem, 1fr) auto;
      align-content: center;
      gap: 1.25rem;
      padding: 1.1rem max(1.25rem, var(--safe-area-right, 0px)) 1.5rem max(1.25rem, var(--safe-area-left, 0px));
    }

    .visual-stage {
      width: min(25rem, 100%);
      max-height: 42dvh;
      justify-self: center;
    }

    .highlight-copy {
      max-width: 36rem;
      justify-self: center;
      text-align: center;
    }

    h2 {
      max-width: none;
      font-size: clamp(1.75rem, 8vw, 2.65rem);
    }

    .tour-toolbar,
    .tour-footer {
      padding-inline-start: max(1rem, var(--safe-area-left, 0px));
      padding-inline-end: max(1rem, var(--safe-area-right, 0px));
    }
  }

  @media (max-width: 520px) {
    .tour-footer {
      align-items: flex-end;
    }

    .back-action {
      min-width: 2.5rem;
      padding-inline: 0.65rem;
      font-size: 0;
    }

    .next-action {
      min-width: 7.6rem;
    }

    .progress-dots button {
      width: 1.5rem;
    }
  }

  :global(html[data-reduce-motion='true']) .visual-stage__inner,
  :global(html[data-reduce-motion='true']) .highlight-copy {
    animation: none;
  }
</style>
