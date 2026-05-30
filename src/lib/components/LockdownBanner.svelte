<script lang="ts">
  // Full-width lockdown warning banner — shown at the top of every page
  // when the server has activated lockdown mode.

  interface Props {
    active: boolean;
  }

  let { active }: Props = $props();
</script>

{#if active}
  <div class="bg-red-600 dark:bg-red-800 text-white px-4 py-2 text-center text-sm font-medium animate-pulse">
    ⚠ LOCKDOWN ACTIVE — The server is in emergency lockdown mode.
    All file operations are suspended. Contact your administrator.
  </div>
{/if}
