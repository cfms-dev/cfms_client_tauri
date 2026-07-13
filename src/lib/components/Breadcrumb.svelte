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
  import { ROOT_DIRECTORY_ID } from '$lib/file-browser';
  import { flyScale, staggeredList } from '$lib/motion/transitions';
  import { focusRovingItem } from '$lib/keyboard';

  interface Props {
    segments: Array<{ label: string; path: string }>;
    onNavigate: (path: string) => void;
  }

  let { segments, onNavigate }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav
  aria-label={$t('common.breadcrumb')}
  class="flex items-center gap-1 text-sm no-select"
  tabindex="-1"
  onkeydown={(event) => focusRovingItem(event, event.currentTarget as HTMLElement, {
    selector: '[data-breadcrumb-item]',
    orientation: 'horizontal',
  })}
>
  <!-- Root -->
  <button
    data-breadcrumb-item
    tabindex="0"
    class="inline-flex h-5 shrink-0 items-center justify-center leading-none text-md3-primary-emphasis hover:underline font-medium transition-colors"
    onclick={() => onNavigate(ROOT_DIRECTORY_ID)}
    transition:flyScale={staggeredList(0, { y: 4, duration: 220, step: 28 })}
  >
    <Icon name="home" size="16px" class="shrink-0" />
  </button>

  {#each segments as seg, i}
    <span
      class="flex h-5 shrink-0 items-center justify-center leading-none text-md3-on-surface-variant select-none"
      transition:flyScale={staggeredList(i * 2 + 1, { y: 4, duration: 220, step: 28 })}
    >
      <Icon name="breadcrumbSep" size="14px" class="shrink-0" />
    </span>
    {#if i === segments.length - 1}
      <span
        class="inline-flex h-5 items-center leading-5 text-md3-on-surface font-semibold"
        transition:flyScale={staggeredList(i * 2 + 2, { y: 4, duration: 220, step: 28 })}
      >
        {seg.label}
      </span>
    {:else}
      <button
        data-breadcrumb-item
        tabindex="-1"
        class="inline-flex h-5 items-center leading-5 text-md3-primary-emphasis hover:underline transition-colors"
        onclick={() => onNavigate(seg.path)}
        transition:flyScale={staggeredList(i * 2 + 2, { y: 4, duration: 220, step: 28 })}
      >
        {seg.label}
      </button>
    {/if}
  {/each}
</nav>
