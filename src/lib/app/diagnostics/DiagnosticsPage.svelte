<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ServerDiagnosticsPanel from '$lib/features/diagnostics/ServerDiagnosticsPanel.svelte';

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
      <span class="cfms-icon-text__icon" style="--cfms-icon-line-height: calc(14px * 1.25)"><Icon name="lock" size="22px" /></span>
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
    gap: 4px;
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
    font-size: 28px;
    line-height: 36px;
    font-weight: 600;
    line-height: 1.15;
    letter-spacing: -0.025em;
  }

  .page-header p {
    max-width: 65ch;
    color: var(--color-md3-on-surface-variant);
    font-size: 14px;
    line-height: 1.5;
  }

  .unavailable-state {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 72%, transparent);
    padding: 1.25rem 0;
    color: var(--color-md3-on-surface-variant);
  }

  .unavailable-state :global(.cfms-icon) {
    flex: none;
    color: var(--color-md3-on-surface-variant);
  }

  .unavailable-state h2 {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.25;
  }

  .unavailable-state p {
    max-width: 65ch;
    margin-top: 0.3rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 14px;
    line-height: 1.5;
  }

  @media (max-width: 640px) {
    .diagnostics-page {
      padding-top: 1.5rem;
    }
  }
</style>
