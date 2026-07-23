<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { open } from '@tauri-apps/plugin-dialog';
  import { _ as t } from 'svelte-i18n';
  import {
    importExtensionPackage,
    installExtensionFromCatalog,
    refreshExtensionCatalog,
    rollbackExtension,
    uninstallExtension,
    type ExtensionCapability,
    type ExtensionInstallation,
  } from '$lib/api/extensions';
  import { extensionsStore } from '$lib/extensions.svelte';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import { isMobilePlatform } from '$lib/platform';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  let busy = $state<string | null>(null);
  let catalogBusy = $state(false);
  const mobile = isMobilePlatform();
  const CAPABILITY_LABEL_KEYS: Record<ExtensionCapability, string> = {
    'files.metadata.read': 'settings.extensions.capabilities.files_metadata_read',
    'files.list': 'settings.extensions.capabilities.files_list',
    'files.search': 'settings.extensions.capabilities.files_search',
    'tasks.read': 'settings.extensions.capabilities.tasks_read',
    'transfers.download.enqueue': 'settings.extensions.capabilities.transfers_download_enqueue',
    'account.summary.read': 'settings.extensions.capabilities.account_summary_read',
    'preferences.read': 'settings.extensions.capabilities.preferences_read',
    'preferences.write': 'settings.extensions.capabilities.preferences_write',
    'events.subscribe': 'settings.extensions.capabilities.events_subscribe',
    'ui.confirm': 'settings.extensions.capabilities.ui_confirm',
    'ui.notify': 'settings.extensions.capabilities.ui_notify',
  };

  onMount(() => void extensionsStore.refresh());

  async function importPackage() {
    const selected = await open({ multiple: false, directory: false, filters: [{ name: 'CFMS Extension', extensions: ['cfmsext'] }] });
    if (typeof selected !== 'string') return;
    busy = 'import';
    try {
      const installed = await importExtensionPackage(selected);
      notificationStore.success($t('settings.extensions.installed', { values: { name: installed.manifest.name } }));
      await extensionsStore.refresh();
    } catch (error) { notificationStore.error(formatError(error)); }
    finally { busy = null; }
  }

  async function refreshCatalog() {
    catalogBusy = true;
    try {
      await refreshExtensionCatalog();
      await extensionsStore.refresh();
      notificationStore.success($t('settings.extensions.catalogUpdated'));
    } catch (error) { notificationStore.error(formatError(error)); }
    finally { catalogBusy = false; }
  }

  async function installFromCatalog(id: string) {
    busy = id;
    try { await installExtensionFromCatalog(id); await extensionsStore.refresh(); notificationStore.success($t('settings.extensions.installComplete')); }
    catch (error) { notificationStore.error(formatError(error)); }
    finally { busy = null; }
  }

  async function toggle(installation: ExtensionInstallation) {
    if (!authStore.isLoggedIn) { notificationStore.warning($t('settings.extensions.signInToEnable')); return; }
    const state = extensionsStore.overview?.accountStates[installation.manifest.id];
    const enable = !state?.enabled;
    if (enable && installation.manifest.requested_capabilities.length > 0) {
      const list = installation.manifest.requested_capabilities.map(capabilityLabel).join('\n• ');
      if (!window.confirm(`${$t('settings.extensions.permissionPrompt', { values: { name: installation.manifest.name } })}\n\n• ${list}`)) return;
    }
    busy = installation.manifest.id;
    try {
      await extensionsStore.changeEnabled(
        installation.manifest.id,
        enable,
        installation.manifest.requested_capabilities,
      );
      if (!enable && location.pathname === '/home/extensions/view') await goto('/home/overview');
    } catch (error) { notificationStore.error(formatError(error)); }
    finally { busy = null; }
  }

  async function rollback(installation: ExtensionInstallation) {
    if (!window.confirm($t('settings.extensions.rollbackConfirm', { values: { name: installation.manifest.name } }))) return;
    busy = installation.manifest.id;
    try { await rollbackExtension(installation.manifest.id); await extensionsStore.refresh(); }
    catch (error) { notificationStore.error(formatError(error)); }
    finally { busy = null; }
  }

  async function uninstall(installation: ExtensionInstallation) {
    if (!window.confirm($t('settings.extensions.uninstallConfirm', { values: { name: installation.manifest.name } }))) return;
    busy = installation.manifest.id;
    try { await uninstallExtension(installation.manifest.id); await extensionsStore.refresh(); notificationStore.success($t('settings.extensions.uninstalled')); }
    catch (error) { notificationStore.error(formatError(error)); }
    finally { busy = null; }
  }

  function capabilityLabel(capability: ExtensionCapability): string {
    return $t(CAPABILITY_LABEL_KEYS[capability]);
  }

  function formatBytes(value: number): string {
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  }

  function formatError(error: unknown) { return error instanceof Error ? error.message : String(error); }
</script>

<div class="extensions-page">
  <header>
    <div><h1>{$t('settings.extensions.title')}</h1><p>{$t('settings.extensions.description')}</p></div>
    {#if !mobile}<button type="button" class="secondary" disabled={busy !== null} onclick={importPackage}><Icon name="uploadFile" size="18px" />{$t('settings.extensions.import')}</button>{/if}
  </header>

  {#if !extensionsStore.overview?.trustedKeysConfigured}
    <section class="notice warning"><Icon name="warning" size="22px" /><div><strong>{$t('settings.extensions.noTrustKey')}</strong><p>{$t('settings.extensions.noTrustKeyHint')}</p></div></section>
  {/if}
  {#if mobile}
    <section class="notice"><Icon name="info" size="22px" /><p>{$t('settings.extensions.mobileUnavailable')}</p></section>
  {/if}

  <section class="section">
    <div class="section-title"><div><h2>{$t('settings.extensions.installedTitle')}</h2><p>{$t('settings.extensions.installedHint')}</p></div></div>
    {#if extensionsStore.loading && !extensionsStore.overview}
      <div class="loading"><ProgressRing size={26} label={$t('common.loading')} /></div>
    {:else if (extensionsStore.overview?.installed.length ?? 0) === 0}
      <div class="empty"><Icon name="extensions" size="34px" /><strong>{$t('settings.extensions.noneInstalled')}</strong><p>{$t('settings.extensions.noneInstalledHint')}</p></div>
    {:else}
      <div class="cards">
        {#each extensionsStore.overview?.installed ?? [] as installation (installation.manifest.id)}
          {@const accountState = extensionsStore.overview?.accountStates[installation.manifest.id]}
          <article class="extension-card">
            <div class="extension-icon"><Icon name="extensions" size="24px" /></div>
            <div class="extension-copy"><h3>{installation.manifest.name}</h3><p>{installation.manifest.description}</p><small>{installation.manifest.publisher} · v{installation.manifest.version} · {formatBytes(installation.disk_bytes)}</small></div>
            <label class="switch"><input type="checkbox" checked={accountState?.enabled ?? false} disabled={!authStore.isLoggedIn || busy !== null} onchange={() => toggle(installation)} /><span></span></label>
            {#if installation.manifest.requested_capabilities.length > 0}
              <details><summary>{$t('settings.extensions.permissions')}</summary><ul>{#each installation.manifest.requested_capabilities as capability}<li>{capabilityLabel(capability)}</li>{/each}</ul></details>
            {/if}
            <div class="card-actions">
              {#if accountState?.enabled && installation.manifest.entrypoints.navigation[0]}
                <button type="button" onclick={() => goto(`/home/extensions/view?extension=${encodeURIComponent(installation.manifest.id)}&page=${encodeURIComponent(installation.manifest.entrypoints.navigation[0].page)}`)}>{$t('settings.extensions.open')}</button>
              {/if}
              {#if installation.state !== 'bundled'}
                {#if installation.previous_version}<button type="button" disabled={busy !== null} onclick={() => rollback(installation)}>{$t('settings.extensions.rollback')}</button>{/if}
                <button type="button" class="danger" disabled={busy !== null} onclick={() => uninstall(installation)}>{$t('settings.extensions.uninstall')}</button>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </section>

  {#if !mobile}
    <section class="section">
      <div class="section-title"><div><h2>{$t('settings.extensions.catalogTitle')}</h2><p>{$t('settings.extensions.catalogHint')}</p></div><button type="button" class="icon-button" disabled={catalogBusy || !extensionsStore.overview?.trustedKeysConfigured} onclick={refreshCatalog}><Icon name="refresh" size="19px" />{catalogBusy ? $t('common.loading') : $t('common.refresh')}</button></div>
      <div class="cards">
        {#each extensionsStore.overview?.catalog?.extensions ?? [] as entry (entry.manifest.id)}
          {@const isInstalled = extensionsStore.overview?.installed.some((item) => item.manifest.id === entry.manifest.id && item.manifest.version === entry.manifest.version)}
          <article class="extension-card catalog-card" class:revoked={entry.revoked}>
            <div class="extension-icon"><Icon name={entry.revoked ? 'block' : 'extensions'} size="24px" /></div>
            <div class="extension-copy"><h3>{entry.manifest.name}</h3><p>{entry.manifest.description}</p><small>{entry.manifest.publisher} · v{entry.manifest.version}</small>{#if entry.revoked}<b>{entry.revocation_reason ?? $t('settings.extensions.revoked')}</b>{/if}</div>
            <button type="button" disabled={entry.revoked || isInstalled || busy !== null} onclick={() => installFromCatalog(entry.manifest.id)}>{isInstalled ? $t('settings.extensions.installedLabel') : $t('settings.extensions.install')}</button>
          </article>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .extensions-page { max-width: 980px; margin: 0 auto; padding: 1.5rem; color: var(--explorer-text); }
  header, .section-title { display: flex; align-items: center; justify-content: space-between; gap: 1rem; } header { margin-bottom: 1rem; } h1 { font-size: 1.35rem; font-weight: 700; } h2 { font-size: 1rem; font-weight: 650; } header p, .section-title p, .extension-copy p, .empty p, .notice p { color: var(--explorer-text-muted); font-size: .78rem; }
  button { display: inline-flex; align-items: center; gap: .4rem; min-height: 36px; border: 1px solid var(--explorer-border); border-radius: 999px; padding: .4rem .8rem; background: var(--explorer-surface-raised); font-size: .76rem; } button:hover:not(:disabled) { background: var(--explorer-surface-hover); } button:disabled { opacity: .5; } button.danger { color: var(--explorer-danger); }
  .notice { display: flex; gap: .7rem; align-items: flex-start; margin-bottom: 1rem; border: 1px solid var(--explorer-border); border-left: 4px solid var(--explorer-accent); border-radius: 10px; padding: .8rem; background: var(--explorer-surface-raised); } .notice.warning { border-left-color: var(--explorer-warning, #c77d00); }
  .section { margin-top: 1.25rem; } .section-title { margin-bottom: .65rem; } .cards { display: grid; gap: .65rem; }
  .extension-card { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center; gap: .8rem; border: 1px solid var(--explorer-border); border-radius: var(--explorer-radius-medium); padding: .85rem; background: var(--explorer-surface-raised); }
  .extension-icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 12px; color: var(--explorer-accent); background: var(--explorer-accent-soft); } .extension-copy { min-width: 0; } .extension-copy h3 { font-size: .88rem; font-weight: 650; } .extension-copy p { margin: .1rem 0 .25rem; } .extension-copy small { color: var(--explorer-text-muted); font-size: .68rem; } .extension-copy b { display: block; margin-top: .3rem; color: var(--explorer-danger); font-size: .7rem; }
  details, .card-actions { grid-column: 2 / -1; } details { font-size: .72rem; color: var(--explorer-text-muted); } details ul { padding: .4rem 1rem; list-style: disc; } .card-actions { display: flex; flex-wrap: wrap; gap: .4rem; }
  .switch input { position: absolute; opacity: 0; } .switch span { display: block; width: 38px; height: 22px; border-radius: 999px; background: var(--explorer-border-strong); padding: 3px; transition: background 140ms ease; } .switch span::after { display: block; width: 16px; height: 16px; border-radius: 50%; background: white; content: ''; transition: transform 140ms ease; } .switch input:checked + span { background: var(--explorer-accent); } .switch input:checked + span::after { transform: translateX(16px); }
  .empty, .loading { display: grid; min-height: 150px; place-items: center; align-content: center; gap: .35rem; border: 1px dashed var(--explorer-border); border-radius: var(--explorer-radius-medium); text-align: center; } .empty :global(.material-symbols-rounded) { color: var(--explorer-text-muted); }
  .catalog-card.revoked { opacity: .72; }
  @media (max-width: 650px) { .extensions-page { padding: 1rem; } header { align-items: flex-start; } .extension-card { grid-template-columns: 40px minmax(0, 1fr) auto; } details, .card-actions { grid-column: 1 / -1; } }
</style>
