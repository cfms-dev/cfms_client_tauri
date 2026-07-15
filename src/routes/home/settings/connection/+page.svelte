<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    getCaCertificateStatus,
    getConnectionSettings,
    setConnectionSettings,
    updateCaCertificates,
    type CaCertificateStatus,
    type CaCertificateUpdateResult,
    type ConnectionSettings,
  } from '$lib/api';
  import { createAutoSave } from '$lib/settings-autosave.svelte';
  import { notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';

  const defaultConfig: ConnectionSettings = {
    enable_proxy: false,
    follow_system_proxy: false,
    custom_proxy: '',
    force_ipv4: false,
    client_cert_path: '',
    client_key_path: '',
    remember_connection_addresses: false,
    recent_connection_addresses: [],
  };

  let config = $state<ConnectionSettings>({ ...defaultConfig });
  let caStatus = $state<CaCertificateStatus | null>(null);
  let caUpdating = $state(false);
  let caResult = $state<string | null>(null);
  let loading = $state(true);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  const autoSave = createAutoSave({
    onError: (message) => {
      error = message;
    },
  });

  const showCustomProxy = $derived(config.enable_proxy && !config.follow_system_proxy);

  $effect(() => {
    if (!status) return;
    notificationStore.success(status);
    status = null;
  });

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  onMount(async () => {
    try {
      const [connectionConfig, certificateStatus] = await Promise.all([
        getConnectionSettings(),
        getCaCertificateStatus(),
      ]);
      config = connectionConfig;
      caStatus = certificateStatus;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  function normalizeConnectionSettings(settings: ConnectionSettings): ConnectionSettings {
    return {
      ...settings,
      custom_proxy: settings.custom_proxy.trim(),
      client_cert_path: settings.client_cert_path.trim(),
      client_key_path: settings.client_key_path.trim(),
      recent_connection_addresses: settings.remember_connection_addresses
        ? settings.recent_connection_addresses
        : [],
    };
  }

  function applyConnection(nextConfig: ConnectionSettings) {
    config = nextConfig;
    error = null;
    void autoSave.run(async () => {
      const payload = normalizeConnectionSettings(nextConfig);
      await setConnectionSettings(payload);
      config = payload;
    });
  }

  function resetConnection() {
    caResult = null;
    error = null;
    applyConnection({ ...defaultConfig });
  }

  function setRememberConnectionAddresses(enabled: boolean) {
    applyConnection({
      ...config,
      remember_connection_addresses: enabled,
      recent_connection_addresses: enabled ? config.recent_connection_addresses : [],
    });
  }

  function formatLastChecked(timestamp: number | null | undefined) {
    if (!timestamp) {
      return $t('settings.connection.caLastCheckedNever');
    }
    return new Date(timestamp * 1000).toLocaleString();
  }

  function summarizeCaUpdate(result: CaCertificateUpdateResult) {
    const parts: string[] = [];
    if (result.added.length) parts.push($t('settings.connection.caAdded', { values: { count: result.added.length } }));
    if (result.updated.length) parts.push($t('settings.connection.caUpdated', { values: { count: result.updated.length } }));
    if (result.removed.length) parts.push($t('settings.connection.caRemoved', { values: { count: result.removed.length } }));
    if (result.unchanged.length) parts.push($t('settings.connection.caUnchanged', { values: { count: result.unchanged.length } }));
    return parts.join(' · ') || $t('settings.connection.caAlreadyCurrent');
  }

  async function updateCertificates() {
    caUpdating = true;
    caResult = null;
    error = null;
    try {
      const result = await updateCaCertificates();
      caStatus = await getCaCertificateStatus();
      caResult = summarizeCaUpdate(result);
      if (result.errors.length > 0) {
        error = $t('settings.connection.caUpdateErrors', { values: { errors: result.errors.slice(0, 3).join('; ') } });
      } else {
        status = $t('settings.connection.caUpdateComplete');
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      caUpdating = false;
    }
  }
</script>

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <SettingsPageHeader
    title={$t('settings.connection.title')}
    icon="connect"
    resetDisabled={loading}
    onReset={resetConnection}
  />

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-5">
    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.basic')}
      </h2>

      <div class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.enableProxy')}
        <MdSwitch
          checked={config.enable_proxy}
          disabled={loading}
          ariaLabel={$t('settings.connection.enableProxy')}
          onChange={(enabled) => applyConnection({ ...config, enable_proxy: enabled })}
        />
      </div>

      <div class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.followSystemProxy')}
        <MdSwitch
          checked={config.follow_system_proxy}
          disabled={loading || !config.enable_proxy}
          ariaLabel={$t('settings.connection.followSystemProxy')}
          onChange={(enabled) => applyConnection({ ...config, follow_system_proxy: enabled })}
        />
      </div>

      {#if showCustomProxy}
        <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.connection.customProxy')}
          <input
            class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                   px-3 py-2 text-md3-on-surface"
            type="text"
            value={config.custom_proxy}
            oninput={(event) => applyConnection({ ...config, custom_proxy: event.currentTarget.value })}
            placeholder={$t('settings.connection.customProxyHint')}
            disabled={loading}
          />
        </label>
      {/if}

      <div class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.forceIpv4')}
        <MdSwitch
          checked={config.force_ipv4}
          disabled={loading}
          ariaLabel={$t('settings.connection.forceIpv4')}
          onChange={(enabled) => applyConnection({ ...config, force_ipv4: enabled })}
        />
      </div>
    </section>

    <section class="space-y-3">
      <div>
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.connection.history')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.connection.historyHint')}
        </p>
      </div>

      <div class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.rememberAddresses')}
        <MdSwitch
          checked={config.remember_connection_addresses}
          disabled={loading}
          ariaLabel={$t('settings.connection.rememberAddresses')}
          onChange={setRememberConnectionAddresses}
        />
      </div>
    </section>

    <section class="space-y-3">
      <div>
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.connection.identity')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.connection.identityHint')}
        </p>
      </div>

      <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.certPath')}
        <input
          class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                 px-3 py-2 text-md3-on-surface"
          type="text"
          value={config.client_cert_path}
          oninput={(event) => applyConnection({ ...config, client_cert_path: event.currentTarget.value })}
          disabled={loading}
        />
      </label>

      <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.keyPath')}
        <input
          class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                 px-3 py-2 text-md3-on-surface"
          type="text"
          value={config.client_key_path}
          oninput={(event) => applyConnection({ ...config, client_key_path: event.currentTarget.value })}
          disabled={loading}
        />
      </label>
    </section>

    <section class="space-y-3">
      <div>
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.connection.caCertificates')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.connection.caHint')}
        </p>
      </div>

      <div class="rounded-lg bg-md3-surface-container-high/70 p-3 text-xs text-md3-on-surface-variant space-y-1">
        <div class="flex justify-between gap-3">
          <span>{$t('settings.connection.caCertificateCount')}</span>
          <span class="text-md3-on-surface">{caStatus?.certificateCount ?? '-'}</span>
        </div>
        <div class="flex justify-between gap-3">
          <span>{$t('settings.connection.caLastChecked')}</span>
          <span class="text-right text-md3-on-surface">{formatLastChecked(caStatus?.lastChecked)}</span>
        </div>
      </div>

      <button
        class="px-4 py-2 rounded-full font-medium text-sm
               bg-md3-secondary-container text-md3-on-secondary-container
               hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
        style="font-family: var(--font-md3-sans);"
        onclick={updateCertificates}
        disabled={loading || caUpdating}
      >
        <Icon name="refresh" size="18px" />
        {caUpdating ? $t('common.checking') : $t('settings.connection.caUpdateNow')}
      </button>

      {#if caResult}
        <p class="text-xs text-md3-on-surface-variant">{caResult}</p>
      {/if}
    </section>

  </div>
</div>
