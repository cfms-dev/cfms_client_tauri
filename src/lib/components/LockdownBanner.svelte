<script lang="ts">
  // Full-width lockdown warning banner — shown at the top of every page
  // when the server has activated lockdown mode.
  //
  // MD3 styling: error container with on-error-container text.

  import Icon from './Icon.svelte';
  import { _ as t } from 'svelte-i18n';
  import { flyScale } from '$lib/motion/transitions';

  interface Props {
    active: boolean;
  }

  let { active }: Props = $props();
</script>

{#if active}
  <div
    class="lockdown-banner fixed inset-x-0 top-0 z-50 text-white
           px-4 py-2.5 text-center text-sm font-semibold
           flex items-center justify-center gap-2"
    style="font-family: var(--font-md3-sans);"
    transition:flyScale={{ y: -20, duration: 300 }}
  >
    <Icon name="warning" size="18px" />
    <span style="font-family: var(--font-md3-serif);">
      {$t('lockdown.banner')}
    </span>
  </div>
{/if}

<style>
  .lockdown-banner {
    padding-top: calc(0.625rem + var(--safe-area-top, 0px));
    background-color: rgb(220 38 38 / 0);
    animation: lockdown-banner-pulse 3s linear infinite;
  }

  @keyframes lockdown-banner-pulse {
    0% {
      background-color: rgb(220 38 38 / 0);
    }

    46.67% {
      background-color: rgb(220 38 38 / 0);
    }

    50% {
      background-color: rgb(220 38 38 / 1);
    }

    96.67% {
      background-color: rgb(220 38 38 / 1);
    }

    100% {
      background-color: rgb(220 38 38 / 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .lockdown-banner {
      animation: none;
      background-color: rgb(220 38 38 / 1);
    }
  }
</style>
