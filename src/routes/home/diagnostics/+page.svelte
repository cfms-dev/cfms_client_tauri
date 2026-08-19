<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { authStore, serverStateStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ServerDiagnosticsPanel from '$lib/components/ServerDiagnosticsPanel.svelte';

  const canViewDiagnostics = $derived(
    serverStateStore.connected
      && authStore.isLoggedIn
      && authStore.permissions.includes('diagnostics'),
  );
</script>

<div class="diagnostics-page">
  <header class="page-header">
    <h1 id="diagnostics-page-title">{$t('diagnostics.title')}</h1>
    <p>{$t('diagnostics.description')}</p>
  </header>

  {#if canViewDiagnostics}
    <ServerDiagnosticsPanel />
  {:else}
    <section class="unavailable-state" aria-labelledby="diagnostics-unavailable-title">
      <Icon name="lock" size="22px" />
      <div>
        <h2 id="diagnostics-unavailable-title">{$t('diagnostics.unavailableTitle')}</h2>
        <p>{$t('diagnostics.unavailableDescription')}</p>
      </div>
    </section>
  {/if}
</div>

<style>
  .diagnostics-page {
    width: min(960px, calc(100% - 2rem));
    margin: 0 auto;
    padding: 2rem 0 3rem;
  }

  .page-header {
    display: grid;
    gap: 0.4rem;
    margin-bottom: 1.5rem;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1,
  h2 {
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
  }

  h1 {
    font-size: clamp(1.45rem, 4vw, 2.2rem);
    font-weight: 600;
    line-height: 1.15;
    letter-spacing: -0.025em;
  }

  .page-header p {
    max-width: 65ch;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .unavailable-state {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 72%, transparent);
    padding: 1.25rem 0;
    color: var(--color-md3-on-surface-variant);
  }

  .unavailable-state :global(.material-symbols-outlined) {
    flex: none;
    color: var(--color-md3-on-surface-variant);
  }

  .unavailable-state h2 {
    font-size: 0.9375rem;
    font-weight: 650;
    line-height: 1.25;
  }

  .unavailable-state p {
    max-width: 65ch;
    margin-top: 0.3rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  @media (max-width: 640px) {
    .diagnostics-page {
      padding-top: 1.5rem;
    }
  }
</style>
