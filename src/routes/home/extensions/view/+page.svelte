<script lang="ts">
  import { page } from '$app/state';
  import ExtensionPageRenderer from '$lib/components/ExtensionPageRenderer.svelte';

  const extensionId = $derived(page.url.searchParams.get('extension') ?? '');
  const pageId = $derived(page.url.searchParams.get('page') ?? '');
</script>

{#if extensionId && pageId}
  <ExtensionPageRenderer {extensionId} {pageId} />
{:else}
  <div class="invalid"><h1>Extension page unavailable</h1><p>The extension or page identifier is missing.</p></div>
{/if}

<style>.invalid { display: grid; min-height: 260px; place-items: center; align-content: center; gap: .5rem; padding: 2rem; text-align: center; color: var(--explorer-text); }.invalid p { color: var(--explorer-text-muted); }</style>
