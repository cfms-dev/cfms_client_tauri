<script lang="ts">
  // Full-width lockdown warning banner — shown at the top of every page
  // when the server has activated lockdown mode.
  //
  // MD3 styling: error container with on-error-container text.

  interface Props {
    active: boolean;
  }

  let { active }: Props = $props();
</script>

{#if active}
  <div
    class="bg-md3-error-container text-md3-on-error-container
           px-4 py-2.5 text-center text-sm font-medium
           border-b border-md3-error/30"
    style="font-family: var(--font-md3-sans);"
  >
    ⚠ LOCKDOWN ACTIVE — The server is in emergency lockdown mode.
    All file operations are suspended. Contact your administrator.
  </div>
{/if}
