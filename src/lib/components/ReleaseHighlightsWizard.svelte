<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { isReducedMotionEnabled, type ResolvedColorScheme } from '$lib/appearance';
  import type { ReleaseTourPresentation } from '$lib/release-highlights/types';
  import Icon from '$lib/components/Icon.svelte';
  import LottieScene from '$lib/components/LottieScene.svelte';

  interface Props {
    presentation: ReleaseTourPresentation;
    onDismiss: () => void;
  }

  let { presentation, onDismiss }: Props = $props();
  let currentIndex = $state(0);
  let dialog = $state<HTMLElement | null>(null);
  let reducedMotion = $state(false);
  let colorScheme = $state<ResolvedColorScheme>('dark');
  let pointerStart: { id: number; x: number; y: number } | null = null;
  let previouslyFocused: HTMLElement | null = null;
  let appearanceObserver: MutationObserver | null = null;

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

<div class="release-highlights-overlay workspace-palette fixed inset-0 z-[85]" role="presentation">
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
        <span class="signal-rule" aria-hidden="true"></span>
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
    min-height: 100dvh;
    place-items: center;
    overflow: auto;
    padding:
      calc(var(--safe-area-top, 0px) + 1.5rem)
      max(1.5rem, var(--safe-area-right, 0px))
      calc(var(--safe-area-bottom, 0px) + 1.5rem)
      max(1.5rem, var(--safe-area-left, 0px));
    background: color-mix(in srgb, var(--explorer-background) 82%, transparent);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  .release-highlights-dialog {
    width: min(74rem, 100%);
    height: min(46rem, calc(100dvh - 3rem));
    min-height: min(36rem, calc(100dvh - 3rem));
    display: grid;
    grid-template-rows: 3.75rem minmax(0, 1fr) 4.25rem;
    overflow: hidden;
    border-radius: var(--explorer-radius-large);
    color: var(--explorer-text);
    background: var(--explorer-surface);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.38);
    outline: none;
  }

  :global(html[data-theme='light']) .release-highlights-dialog {
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
  }

  .release-highlights-dialog:focus-visible {
    outline: 2px solid var(--explorer-accent);
    outline-offset: -2px;
  }

  .tour-toolbar,
  .tour-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-inline: 1.25rem;
  }

  .tour-toolbar {
    border-bottom: 1px solid var(--explorer-border);
  }

  .tour-footer {
    border-top: 1px solid var(--explorer-border);
  }

  .release-identity {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--explorer-text-muted);
    font: 650 0.8rem/1.25 var(--font-md3-sans);
  }

  .release-identity > :last-child {
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
    transition:
      transform var(--motion-duration-short4) var(--motion-easing-standard),
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      color var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard);
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
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(20rem, 0.65fr);
    align-items: center;
    gap: clamp(2.25rem, 4vw, 4rem);
    overflow: auto;
    padding: clamp(1.75rem, 3.2vw, 2.5rem);
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

  @keyframes copy-enter {
    from { opacity: 0.68; transform: translateX(0.65rem); }
    to { opacity: 1; transform: translateX(0); }
  }

  @media (max-width: 900px) {
    .release-highlights-overlay {
      padding: 0;
    }

    .release-highlights-dialog {
      width: 100%;
      height: 100dvh;
      min-height: 100dvh;
      border-radius: 0;
      box-shadow: none;
    }

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

    .tour-toolbar,
    .tour-footer {
      padding-inline-start: max(1rem, var(--safe-area-left, 0px));
      padding-inline-end: max(1rem, var(--safe-area-right, 0px));
    }
  }

  @media (max-width: 560px) {
    .release-highlights-dialog {
      grid-template-rows: 3.5rem minmax(0, 1fr) 4rem;
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

  :global(html[data-reduce-motion='true']) .visual-stage__inner,
  :global(html[data-reduce-motion='true']) .highlight-copy {
    animation: none;
  }

  :global(html[data-reduce-motion='true']) :where(.skip-action, .back-action, .next-action, .progress-rail span) {
    transition: none;
  }
</style>
