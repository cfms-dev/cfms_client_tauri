<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  onMount(() => {
    void goto('/home/settings/authentication', { replaceState: true });
  });
</script>
