<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { isReducedMotionEnabled, type ResolvedColorScheme } from '$lib/appearance';
  import type { ReleaseTourPresentation } from '$lib/release-highlights/types';
  import Icon from '$lib/components/Icon.svelte';
  import LottieScene from '$lib/components/LottieScene.svelte';

  const EXIT_DURATION_MS = 180;

  interface Props {
    presentation: ReleaseTourPresentation;
    onDismiss: () => void;
  }

  let { presentation, onDismiss }: Props = $props();
  let currentIndex = $state(0);
  let dialog = $state<HTMLElement | null>(null);
  let reducedMotion = $state(false);
  let colorScheme = $state<ResolvedColorScheme>('dark');
  let closing = $state(false);
  let pointerStart: { id: number; x: number; y: number } | null = null;
  let previouslyFocused: HTMLElement | null = null;
  let appearanceObserver: MutationObserver | null = null;
  let dismissTimer: number | null = null;
  let dismissCommitted = false;

  const highlights = $derived(presentation.highlights);
  const currentHighlight = $derived(highlights[currentIndex] ?? highlights[0]);
  const currentAnimationLoader = $derived(currentHighlight.animation[colorScheme]);
  const isFirst = $derived(currentIndex === 0);
  const isLast = $derived(currentIndex === highlights.length - 1);
  const progressCount = $derived(`${String(currentIndex + 1).padStart(2, '0')} / ${String(highlights.length).padStart(2, '0')}`);

  function syncAppearance() {
    reducedMotion = isReducedMotionEnabled();
    colorScheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  }

  onMount(async () => {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    syncAppearance();
    appearanceObserver = new MutationObserver(syncAppearance);
    appearanceObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-reduce-motion', 'data-theme'],
    });
    await tick();
    dialog?.focus({ preventScroll: true });
  });

  onDestroy(() => {
    appearanceObserver?.disconnect();
    if (dismissTimer !== null) window.clearTimeout(dismissTimer);
    previouslyFocused?.focus({ preventScroll: true });
  });

  function finishDismiss() {
    if (dismissCommitted) return;
    dismissCommitted = true;
    if (dismissTimer !== null) {
      window.clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    onDismiss();
  }

  function requestDismiss() {
    if (closing || dismissCommitted) return;
    closing = true;
    if (reducedMotion) {
      finishDismiss();
      return;
    }
    dismissTimer = window.setTimeout(finishDismiss, EXIT_DURATION_MS + 60);
  }

  function handleOverlayAnimationEnd(event: AnimationEvent) {
    if (closing && event.target === event.currentTarget && event.animationName === 'overlay-exit') {
      finishDismiss();
    }
  }

  function previous() {
    if (!isFirst) currentIndex -= 1;
  }

  function next() {
    if (isLast) requestDismiss();
    else currentIndex += 1;
  }

  function goTo(index: number) {
    currentIndex = Math.max(0, Math.min(index, highlights.length - 1));
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      requestDismiss();
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

<div
  class="release-highlights-overlay workspace-palette fixed inset-0 z-[85]"
  class:closing
  role="presentation"
  onanimationend={handleOverlayAnimationEnd}
>
  <div
    bind:this={dialog}
    class="release-highlights-screen"
    role="dialog"
    aria-modal="true"
    aria-labelledby="release-highlight-title"
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <header class="tour-toolbar">
      <div class="release-identity">
        <span class="signal-rule" aria-hidden="true"></span>
        <span>{$t(presentation.tour.labelKey)}</span>
      </div>
      <button type="button" class="skip-action" onclick={requestDismiss}>
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
        {#key `${currentHighlight.id}-${colorScheme}`}
          <div class="visual-stage__inner">
            <LottieScene
              loadAnimationData={currentAnimationLoader}
              fallbackIcon={currentHighlight.fallbackIcon}
              {reducedMotion}
            />
          </div>
        {/key}
      </div>

      {#key currentHighlight.id}
        <article class="highlight-copy" aria-live="polite">
          <p class="progress-label" aria-hidden="true">{progressCount}</p>
          <span class="sr-only">
            {$t('releaseHighlights.progress', {
              values: { current: currentIndex + 1, total: highlights.length },
            })}
          </span>
          <h2 id="release-highlight-title">{$t(currentHighlight.titleKey)}</h2>
          <p class="highlight-body">{$t(currentHighlight.bodyKey)}</p>
        </article>
      {/key}
    </div>

    <footer class="tour-footer">
      <div class="progress-rail" aria-label={$t('releaseHighlights.chooseFeature')}>
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
          <Icon name="arrowBack" size="18px" />
          <span class="back-label">{$t('common.back')}</span>
        </button>
        <button type="button" class="next-action" onclick={next}>
          <span>{isLast ? $t('releaseHighlights.startUsing') : $t('common.next')}</span>
          <Icon name={isLast ? 'done' : 'navigateNext'} size="19px" />
        </button>
      </div>
    </footer>
  </div>
</div>

<style>
  .release-highlights-overlay {
    display: grid;
    width: 100%;
    height: 100dvh;
    min-height: 100dvh;
    overflow: hidden;
    padding: 0;
    background: var(--explorer-surface);
    animation: overlay-enter 240ms var(--motion-easing-emphasized-decelerate) both;
  }

  .release-highlights-overlay.closing {
    pointer-events: none;
    animation: overlay-exit 180ms var(--motion-easing-standard) both;
  }

  .release-highlights-screen {
    box-sizing: border-box;
    width: 100%;
    height: 100dvh;
    min-height: 100dvh;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
    color: var(--explorer-text);
    background: var(--explorer-surface);
    outline: none;
  }

  .release-highlights-screen:focus-visible {
    outline: 2px solid var(--explorer-accent);
    outline-offset: -2px;
  }

  .tour-toolbar,
  .tour-footer {
    box-sizing: border-box;
    min-width: 0;
    display: flex;
    min-height: 3.75rem;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-inline-start: max(clamp(1rem, 2.5vw, 2rem), var(--safe-area-left, 0px));
    padding-inline-end: max(clamp(1rem, 2.5vw, 2rem), var(--safe-area-right, 0px));
  }

  .tour-toolbar {
    border-bottom: 1px solid var(--explorer-border);
    padding-top: var(--safe-area-top, 0px);
  }

  .tour-footer {
    border-top: 1px solid var(--explorer-border);
    padding-bottom: var(--safe-area-bottom, 0px);
  }

  .release-identity {
    min-width: 0;
    display: flex;
    flex: 1 1 0;
    align-items: center;
    gap: 0.75rem;
    overflow: hidden;
    color: var(--explorer-text-muted);
    font: 700 0.875rem/1.25 var(--font-md3-serif);
    letter-spacing: 0.015em;
  }

  .release-identity > :last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .signal-rule {
    width: 1px;
    height: 1.15rem;
    flex: 0 0 1px;
    background: var(--explorer-accent);
  }

  .skip-action,
  .back-action,
  .next-action {
    display: inline-flex;
    min-height: 2.25rem;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    border-radius: var(--explorer-radius-small);
    padding: 0 0.8rem;
    font: 650 0.8rem/1 var(--font-md3-sans);
    white-space: nowrap;
    transition:
      transform var(--motion-duration-short4) var(--motion-easing-standard),
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .skip-action {
    flex: 0 0 auto;
  }

  .skip-action,
  .back-action {
    color: var(--explorer-text-muted);
    background: transparent;
  }

  .skip-action:hover,
  .back-action:hover:not(:disabled) {
    color: var(--explorer-text);
    background: var(--explorer-surface-hover);
  }

  .skip-action:active,
  .back-action:active:not(:disabled),
  .next-action:active {
    transform: scale(0.97);
  }

  .next-action {
    min-width: 8.25rem;
    color: var(--explorer-background);
    background: var(--explorer-accent);
  }

  .next-action:hover {
    background: color-mix(in srgb, var(--explorer-accent) 88%, var(--explorer-text));
  }

  .back-action:disabled {
    opacity: 0.34;
  }

  .tour-body {
    box-sizing: border-box;
    width: min(96rem, 100%);
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(20rem, 0.55fr);
    align-items: center;
    gap: clamp(2.5rem, 5vw, 5.5rem);
    overflow: auto;
    margin-inline: auto;
    padding: clamp(1.5rem, 3.5vw, 3.5rem) clamp(1.25rem, 4vw, 4rem);
    touch-action: pan-y;
  }

  .visual-stage {
    width: 100%;
    min-width: 0;
    aspect-ratio: 16 / 10;
    display: grid;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-large);
    background: var(--explorer-background);
  }

  .visual-stage__inner {
    width: 100%;
    height: 100%;
    animation: scene-enter 220ms var(--motion-easing-emphasized-decelerate) both;
  }

  .highlight-copy {
    max-width: 28rem;
    display: grid;
    align-content: center;
    gap: 0.85rem;
    animation: copy-enter 200ms var(--motion-easing-emphasized-decelerate) both;
  }

  .progress-label,
  .highlight-body,
  h2 {
    margin: 0;
  }

  .progress-label {
    color: var(--explorer-accent);
    font: 650 0.75rem/1.25 var(--font-md3-mono);
    letter-spacing: 0.02em;
  }

  h2 {
    max-width: 15ch;
    color: var(--explorer-text);
    font: 650 clamp(1.8rem, 2.8vw, 2.5rem)/1.14 var(--font-md3-sans);
    letter-spacing: -0.025em;
    text-wrap: balance;
  }

  .highlight-body {
    max-width: 62ch;
    color: var(--explorer-text-muted);
    font: 400 clamp(0.92rem, 1.2vw, 1rem)/1.65 var(--font-md3-sans);
  }

  .progress-rail {
    min-width: 10rem;
    display: flex;
    align-items: center;
    gap: 0.15rem;
  }

  .progress-rail button {
    width: 2.75rem;
    height: 2.5rem;
    display: grid;
    place-items: center;
    border-radius: var(--explorer-radius-small);
  }

  .progress-rail span {
    width: 100%;
    height: 2px;
    background: var(--explorer-border-strong);
    transition:
      height var(--motion-duration-short4) var(--motion-easing-standard),
      background-color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .progress-rail button:hover span {
    background: var(--explorer-text-muted);
  }

  .progress-rail button.active span {
    height: 3px;
    background: var(--explorer-accent);
  }

  .navigation-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  @keyframes scene-enter {
    from { opacity: 0.68; transform: translateX(0.75rem); }
    to { opacity: 1; transform: translateX(0); }
  }

  @keyframes overlay-enter {
    from {
      opacity: 0.82;
      clip-path: inset(0.75rem round var(--explorer-radius-large));
    }
    to {
      opacity: 1;
      clip-path: inset(0 round 0);
    }
  }

  @keyframes overlay-exit {
    from {
      opacity: 1;
      clip-path: inset(0 round 0);
    }
    to {
      opacity: 0;
      clip-path: inset(0.5rem round var(--explorer-radius-medium));
    }
  }

  @keyframes copy-enter {
    from { opacity: 0.68; transform: translateX(0.65rem); }
    to { opacity: 1; transform: translateX(0); }
  }

  @media (max-width: 900px) {
    .tour-body {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(15rem, 44dvh) auto;
      align-content: start;
      gap: 1.5rem;
      padding: 1.25rem max(1.25rem, var(--safe-area-right, 0px)) 1.5rem max(1.25rem, var(--safe-area-left, 0px));
    }

    .visual-stage {
      width: min(52rem, 100%);
      max-height: 44dvh;
      justify-self: center;
    }

    .highlight-copy {
      width: min(42rem, 100%);
      max-width: none;
      justify-self: center;
    }

    h2 {
      max-width: 20ch;
    }

  }

  @media (max-width: 560px) {
    .tour-toolbar,
    .tour-footer {
      min-height: 3.5rem;
    }

    .tour-body {
      grid-template-rows: minmax(12rem, 38dvh) auto;
      gap: 1.15rem;
      padding-top: 1rem;
    }

    .visual-stage {
      max-height: 38dvh;
    }

    .progress-rail {
      min-width: 0;
    }

    .progress-rail button {
      width: clamp(1.6rem, 8vw, 2.25rem);
    }

    .back-action {
      width: 2.5rem;
      padding-inline: 0;
    }

    .back-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
    }

    .next-action {
      min-width: 7.5rem;
    }
  }

  @media (min-width: 700px) and (max-height: 520px) {
    .tour-body {
      grid-template-columns: minmax(0, 1.25fr) minmax(16rem, 0.75fr);
      grid-template-rows: 1fr;
      align-content: center;
      gap: 1.25rem;
      padding: 0.75rem 1rem;
    }

    .visual-stage {
      max-height: calc(100dvh - 9rem);
    }

    .highlight-copy {
      gap: 0.55rem;
    }

    .highlight-body {
      font-size: 0.875rem;
      line-height: 1.5;
    }
  }

  @media (pointer: coarse) {
    .skip-action,
    .back-action,
    .next-action,
    .progress-rail button {
      min-width: 2.75rem;
      min-height: 2.75rem;
    }

    .tour-toolbar,
    .tour-footer {
      min-height: 4rem;
    }
  }

  @media (max-width: 360px) {
    .tour-toolbar,
    .tour-footer {
      gap: 0.25rem;
      padding-inline: max(0.5rem, var(--safe-area-left, 0px));
    }

    .tour-toolbar {
      padding-inline-end: max(0.5rem, var(--safe-area-right, 0px));
    }

    .tour-footer {
      padding-inline-end: max(0.5rem, var(--safe-area-right, 0px));
    }

    .navigation-actions {
      gap: 0.25rem;
    }

    .next-action {
      min-width: 6.5rem;
    }
  }

  :global(html[data-reduce-motion='true']) .visual-stage__inner,
  :global(html[data-reduce-motion='true']) .highlight-copy,
  :global(html[data-reduce-motion='true']) .release-highlights-overlay {
    animation: none;
  }

  :global(html[data-reduce-motion='true']) :where(.skip-action, .back-action, .next-action, .progress-rail span) {
    transition: none;
  }
</style>
