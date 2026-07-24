<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import ExtensionPageRenderer from '$lib/components/ExtensionPageRenderer.svelte';
  import { USER_EXTENSIONS_ENABLED } from '$lib/feature-flags';

  const extensionId = $derived(page.url.searchParams.get('extension') ?? '');
  const pageId = $derived(page.url.searchParams.get('page') ?? '');

  onMount(() => {
    // Preserve the renderer for later extension development without allowing
    // a manually entered URL to instantiate extension-provided UI today.
    if (!USER_EXTENSIONS_ENABLED) void goto('/home/overview', { replaceState: true });
  });
</script>

{#if USER_EXTENSIONS_ENABLED}
  {#if extensionId && pageId}
    <ExtensionPageRenderer {extensionId} {pageId} />
  {:else}
    <div class="invalid"><h1>Extension page unavailable</h1><p>The extension or page identifier is missing.</p></div>
  {/if}
{/if}

<style>.invalid { display: grid; min-height: 260px; place-items: center; align-content: center; gap: .5rem; padding: 2rem; text-align: center; color: var(--explorer-text); }.invalid p { color: var(--explorer-text-muted); }</style>
