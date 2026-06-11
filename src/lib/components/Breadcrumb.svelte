<script lang="ts">
  // Hierarchical breadcrumb navigation — MD3 styled.
  //
  // Replaces the old › separator with a Material Symbol chevron_right icon.
  //
  // Props:
  //   segments: array of { label: string, path: string }
  //   onNavigate: callback receiving the path when a segment is clicked

  import Icon from './Icon.svelte';
  import { _ as t } from 'svelte-i18n';
  import { flyScale, staggeredList } from '$lib/motion/transitions';

  interface Props {
    segments: Array<{ label: string; path: string }>;
    onNavigate: (path: string) => void;
  }

  let { segments, onNavigate }: Props = $props();
</script>

<nav aria-label={$t('common.breadcrumb')} class="flex items-center gap-1 text-sm no-select">
  <!-- Root -->
  <button
    class="text-md3-primary-emphasis hover:underline font-medium transition-colors"
    onclick={() => onNavigate("/")}
    transition:flyScale={staggeredList(0, { y: 4, duration: 220, step: 28 })}
  >
    <Icon name="home" size="16px" />
  </button>

  {#each segments as seg, i}
    <span
      class="text-md3-on-surface-variant select-none flex items-center"
      transition:flyScale={staggeredList(i * 2 + 1, { y: 4, duration: 220, step: 28 })}
    >
      <Icon name="breadcrumbSep" size="14px" />
    </span>
    {#if i === segments.length - 1}
      <span
        class="text-md3-on-surface font-semibold"
        transition:flyScale={staggeredList(i * 2 + 2, { y: 4, duration: 220, step: 28 })}
      >
        {seg.label}
      </span>
    {:else}
      <button
        class="text-md3-primary-emphasis hover:underline transition-colors"
        onclick={() => onNavigate(seg.path)}
        transition:flyScale={staggeredList(i * 2 + 2, { y: 4, duration: 220, step: 28 })}
      >
        {seg.label}
      </button>
    {/if}
  {/each}
</nav>
