<script lang="ts">
  // Hierarchical breadcrumb navigation — MD3 styled.
  //
  // Props:
  //   segments: array of { label: string, path: string }
  //   onNavigate: callback receiving the path when a segment is clicked

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
    /
  </button>

  {#each segments as seg, i}
    <span class="text-md3-on-surface-variant select-none">›</span>
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
