<script lang="ts">
  // Full-width lockdown warning banner — shown at the top of every page
  // when the server has activated lockdown mode.
  //
  // MD3 styling: error container with on-error-container text.

  import Icon from './Icon.svelte';
  import { _ as t } from 'svelte-i18n';
  import type { TransitionConfig } from 'svelte/transition';
  import { isReducedMotionEnabled } from '$lib/appearance';

  interface Props {
    active: boolean;
  }

  let { active }: Props = $props();

  function dropFromTop(node: HTMLElement): TransitionConfig {
    if (isReducedMotionEnabled()) {
      return { duration: 0 };
    }

    return {
      duration: 300,
      easing: (value) => 1 - Math.pow(1 - value, 3),
      css: (progress, inverse) => `
        opacity: ${progress};
        transform: translate3d(0, ${inverse * -100}%, 0);
      `,
    };
  }

  function liftToTop(node: HTMLElement): TransitionConfig {
    if (isReducedMotionEnabled()) {
      return { duration: 0 };
    }

    return {
      duration: 250,
      easing: (value) => value * value,
      css: (progress, inverse) => `
        position: absolute;
        inset: 0 0 auto;
        opacity: ${progress};
        transform: translate3d(0, ${inverse * -100}%, 0);
      `,
    };
  }
</script>

{#if active}
  <div
    class="lockdown-banner z-50 text-white
           px-4 py-2.5 text-center text-sm font-semibold
           flex items-center justify-center gap-2"
    style="font-family: var(--font-md3-sans);"
    in:dropFromTop
    out:liftToTop
  >
    <Icon name="warning" size="18px" />
    <span style="font-family: var(--font-md3-serif);">
      {$t('lockdown.banner')}
    </span>
  </div>
{/if}

<style>
  .lockdown-banner {
    --lockdown-banner-resting-text: rgb(255 255 255);

    position: relative;
    isolation: isolate;
    width: 100%;
    height: calc(var(--lockdown-banner-content-height) + var(--safe-area-top, 0px));
    flex: none;
    padding-top: calc(0.625rem + var(--safe-area-top, 0px));
    color: var(--lockdown-banner-resting-text);
    background-color: transparent;
    animation: lockdown-banner-pulse 3s ease-in-out infinite;
    will-change: opacity, transform, color, background-color;
  }

  :global(html[data-theme='light']) .lockdown-banner {
    --lockdown-banner-resting-text: rgb(0 0 0);
  }

  @keyframes lockdown-banner-pulse {
    0%,
    46.67% {
      color: var(--lockdown-banner-resting-text);
      background-color: rgb(220 38 38 / 0%);
    }

    50%,
    96.67% {
      color: rgb(255 255 255);
      background-color: rgb(220 38 38);
    }

    100% {
      color: var(--lockdown-banner-resting-text);
      background-color: rgb(220 38 38 / 0%);
    }
  }

</style>
