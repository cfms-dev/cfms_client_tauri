<script lang="ts">
  // Hierarchical breadcrumb navigation — MD3 styled.
  //
  // Replaces the old › separator with a Material Symbol chevron_right icon.
  //
  // Props:
  //   segments: array of { label: string, path: string }
  //   onNavigate: callback receiving the path when a segment is clicked

  import Icon from './Icon.svelte';

  interface Props {
    segments: Array<{ label: string; path: string }>;
    onNavigate: (path: string) => void;
  }

  let { segments, onNavigate }: Props = $props();
</script>

<nav aria-label="Breadcrumb" class="flex items-center gap-1 text-sm no-select">
  <!-- Root -->
  <button
    class="text-md3-primary hover:underline font-medium transition-colors"
    onclick={() => onNavigate("/")}
  >
    <Icon name="home" size="16px" />
  </button>

  {#each segments as seg, i}
    <span class="text-md3-on-surface-variant select-none flex items-center">
      <Icon name="breadcrumbSep" size="14px" />
    </span>
    {#if i === segments.length - 1}
      <span class="text-md3-on-surface font-semibold">
        {seg.label}
      </span>
    {:else}
      <button
        class="text-md3-primary hover:underline transition-colors"
        onclick={() => onNavigate(seg.path)}
      >
        {seg.label}
      </button>
    {/if}
  {/each}
</nav>
