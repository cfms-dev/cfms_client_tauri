<script lang="ts">
  // Hierarchical breadcrumb navigation.
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
    class="text-blue-600 dark:text-blue-400 hover:underline font-medium"
    onclick={() => onNavigate("/")}
  >
    /
  </button>

  {#each segments as seg, i}
    <span class="text-gray-400 dark:text-gray-500">›</span>
    {#if i === segments.length - 1}
      <span class="text-gray-900 dark:text-gray-100 font-semibold">
        {seg.label}
      </span>
    {:else}
      <button
        class="text-blue-600 dark:text-blue-400 hover:underline"
        onclick={() => onNavigate(seg.path)}
      >
        {seg.label}
      </button>
    {/if}
  {/each}
</nav>
