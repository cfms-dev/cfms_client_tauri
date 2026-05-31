<script lang="ts">
  // Home index — redirects to the default tab (overview).
  //
  // This page only exists to provide a redirect target when navigating
  // to /home without a specific tab.

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => {
    goto('/home/overview', { replaceState: true });
  });
</script>

<div class="flex items-center justify-center h-full">
  <p class="text-sm text-md3-on-surface-variant">Loading…</p>
</div>
