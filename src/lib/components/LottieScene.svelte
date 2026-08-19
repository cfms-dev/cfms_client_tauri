<script lang="ts">
  import type { AnimationItem } from 'lottie-web';
  import type { IconName } from '$lib/icons';
  import Icon from '$lib/components/Icon.svelte';

  interface Props {
    src: string;
    fallbackIcon: IconName;
    reducedMotion?: boolean;
  }

  let { src, fallbackIcon, reducedMotion = false }: Props = $props();
  let host = $state<HTMLDivElement | null>(null);
  let failed = $state(false);

  $effect(() => {
    if (!host || !src) return;
    const container = host;
    const source = src;
    const shouldReduceMotion = reducedMotion;
    let animation: AnimationItem | null = null;
    let disposed = false;
    let removeLoadedListener: (() => void) | null = null;
    let removeErrorListener: (() => void) | null = null;

    failed = false;
    void import('lottie-web/build/player/lottie_light').then(({ default: lottie }) => {
      if (disposed) return;
      animation = lottie.loadAnimation({
        container,
        renderer: 'svg',
        loop: !shouldReduceMotion,
        autoplay: !shouldReduceMotion,
        path: source,
        rendererSettings: {
          preserveAspectRatio: 'xMidYMid meet',
          progressiveLoad: true,
          focusable: false,
        },
      });
      removeLoadedListener = animation.addEventListener('DOMLoaded', () => {
        if (shouldReduceMotion && animation) {
          animation.goToAndStop(Math.max(0, animation.totalFrames - 1), true);
        }
      });
      removeErrorListener = animation.addEventListener('data_failed', () => {
        failed = true;
      });
    }).catch(() => {
      if (!disposed) failed = true;
    });

    const handleVisibilityChange = () => {
      if (!animation || shouldReduceMotion) return;
      if (document.hidden) animation.pause();
      else animation.play();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      removeLoadedListener?.();
      removeErrorListener?.();
      animation?.destroy();
      container.replaceChildren();
    };
  });
</script>

<div class="lottie-scene" aria-hidden="true">
  <div bind:this={host} class:hidden={failed} class="lottie-host"></div>
  {#if failed}
    <div class="fallback-symbol">
      <Icon name={fallbackIcon} size="clamp(5rem, 20vw, 8.5rem)" />
    </div>
  {/if}
</div>

<style>
  .lottie-scene,
  .lottie-host,
  .fallback-symbol {
    width: 100%;
    height: 100%;
  }

  .lottie-scene {
    min-width: 0;
    min-height: 0;
  }

  .lottie-host :global(svg) {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }

  .hidden {
    display: none;
  }

  .fallback-symbol {
    display: grid;
    place-items: center;
    color: var(--color-md3-primary-emphasis);
  }
</style>
