<script lang="ts">
  import type { AnimationItem } from 'lottie-web';
  import type { IconName } from '$lib/icons';
  import type {
    LottieAnimationData,
    ReleaseHighlightAnimationLoader,
  } from '$lib/release-highlights/types';
  import Icon from '$lib/components/Icon.svelte';

  interface Props {
    loadAnimationData: ReleaseHighlightAnimationLoader;
    fallbackIcon: IconName;
    reducedMotion?: boolean;
  }

  let { loadAnimationData, fallbackIcon, reducedMotion = false }: Props = $props();
  let host = $state<HTMLDivElement | null>(null);
  let status = $state<'loading' | 'ready' | 'failed'>('loading');

  function cloneAnimationData(animationData: LottieAnimationData): LottieAnimationData {
    if (typeof structuredClone === 'function') return structuredClone(animationData);
    return JSON.parse(JSON.stringify(animationData)) as LottieAnimationData;
  }

  $effect(() => {
    if (!host || !loadAnimationData) return;
    const container = host;
    const loader = loadAnimationData;
    const shouldReduceMotion = reducedMotion;
    let animation: AnimationItem | null = null;
    let disposed = false;
    let completed = false;
    let loadTimeout: number | null = null;
    let removeLoadedListener: (() => void) | null = null;
    let removeCompleteListener: (() => void) | null = null;
    let removeErrorListener: (() => void) | null = null;

    status = 'loading';
    container.replaceChildren();

    void Promise.all([
      import('lottie-web/build/player/lottie_light'),
      loader(),
    ]).then(([{ default: lottie }, { default: animationData }]) => {
      if (disposed) return;
      animation = lottie.loadAnimation({
        container,
        renderer: 'svg',
        loop: false,
        autoplay: !shouldReduceMotion,
        animationData: cloneAnimationData(animationData),
        rendererSettings: {
          preserveAspectRatio: 'xMidYMid meet',
          progressiveLoad: true,
          focusable: false,
        },
      });
      loadTimeout = window.setTimeout(() => {
        if (!disposed && status === 'loading') status = 'failed';
      }, 5000);
      removeLoadedListener = animation.addEventListener('DOMLoaded', () => {
        if (disposed || !animation) return;
        if (loadTimeout !== null) window.clearTimeout(loadTimeout);
        status = 'ready';
        if (shouldReduceMotion) {
          animation.goToAndStop(Math.max(0, animation.totalFrames - 1), true);
        }
      });
      removeCompleteListener = animation.addEventListener('complete', () => {
        completed = true;
      });
      removeErrorListener = animation.addEventListener('data_failed', () => {
        if (disposed) return;
        if (loadTimeout !== null) window.clearTimeout(loadTimeout);
        status = 'failed';
      });
    }).catch(() => {
      if (!disposed) status = 'failed';
    });

    const handleVisibilityChange = () => {
      if (!animation || shouldReduceMotion || status !== 'ready') return;
      if (document.hidden) animation.pause();
      else if (!completed) animation.play();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (loadTimeout !== null) window.clearTimeout(loadTimeout);
      removeLoadedListener?.();
      removeCompleteListener?.();
      removeErrorListener?.();
      animation?.destroy();
      container.replaceChildren();
    };
  });
</script>

<div class="lottie-scene" data-state={status} aria-hidden="true">
  <div bind:this={host} class:hidden={status !== 'ready'} class="lottie-host"></div>
  {#if status === 'loading'}
    <div class="scene-placeholder scene-placeholder--loading">
      <span class="placeholder-bar placeholder-bar--title"></span>
      <span class="placeholder-panel"></span>
      <span class="placeholder-bar placeholder-bar--meta"></span>
    </div>
  {:else if status === 'failed'}
    <div class="scene-placeholder scene-placeholder--fallback">
      <div class="fallback-window">
        <span class="fallback-window__bar"></span>
        <div class="fallback-window__content">
          <span class="fallback-glyph"><Icon name={fallbackIcon} size="100%" /></span>
          <span class="fallback-line fallback-line--strong"></span>
          <span class="fallback-line"></span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .lottie-scene,
  .lottie-host,
  .scene-placeholder {
    width: 100%;
    height: 100%;
  }

  .lottie-scene {
    min-width: 0;
    min-height: 0;
    position: relative;
  }

  .lottie-host {
    opacity: 1;
    transition: opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .lottie-host :global(svg) {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }

  .hidden {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .scene-placeholder {
    position: absolute;
    inset: 0;
  }

  .scene-placeholder--loading {
    display: grid;
    align-content: center;
    grid-template-columns: 1fr 0.68fr;
    grid-template-rows: auto 1fr auto;
    gap: 1rem 1.5rem;
    padding: 12%;
  }

  .placeholder-bar,
  .placeholder-panel {
    display: block;
    border-radius: var(--explorer-radius-small);
    background: var(--explorer-surface-hover);
  }

  .placeholder-bar--title {
    width: 42%;
    height: 0.75rem;
    grid-column: 1 / -1;
  }

  .placeholder-panel {
    min-height: 8rem;
    grid-column: 1 / -1;
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-large);
    background: var(--explorer-surface-raised);
  }

  .placeholder-bar--meta {
    width: 28%;
    height: 0.5rem;
  }

  .scene-placeholder--fallback {
    display: grid;
    place-items: center;
    padding: clamp(1rem, 7%, 3.5rem);
  }

  .fallback-window {
    width: min(78%, 28rem);
    aspect-ratio: 1.6;
    overflow: hidden;
    border: 1px solid var(--explorer-border-strong);
    border-radius: var(--explorer-radius-large);
    background: var(--explorer-surface-raised);
  }

  .fallback-window__bar {
    display: block;
    height: 2rem;
    border-bottom: 1px solid var(--explorer-border);
    background: var(--explorer-surface);
  }

  .fallback-window__content {
    height: calc(100% - 2rem);
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    align-content: center;
    align-items: center;
    gap: 0.65rem 1.25rem;
    padding: clamp(1rem, 8%, 2.5rem);
  }

  .fallback-glyph {
    width: clamp(3.5rem, 9vw, 5.25rem);
    height: clamp(3.5rem, 9vw, 5.25rem);
    display: grid;
    grid-row: 1 / 3;
    place-items: center;
    border-radius: var(--explorer-radius-medium);
    color: var(--explorer-accent);
    background: var(--explorer-accent-soft);
  }

  .fallback-line {
    width: 58%;
    height: 0.5rem;
    border-radius: var(--explorer-radius-small);
    background: var(--explorer-text-muted);
    opacity: 0.46;
  }

  .fallback-line--strong {
    width: 82%;
    height: 0.65rem;
    background: var(--explorer-text);
    opacity: 0.72;
  }

  :global(html[data-reduce-motion='true']) .lottie-host {
    transition: none;
  }
</style>
