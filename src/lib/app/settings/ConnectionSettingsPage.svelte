<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import ConnectionSecurity from '$lib/features/connection/ConnectionSecurity.svelte';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
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
  import { createAutoSave } from '$lib/features/settings/settings-autosave.svelte.ts';
  import { notifyGithubAuthFallback } from '$lib/features/updates/github-auth-notices';
  import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MdSwitch from '$lib/shared/ui/MdSwitch.svelte';
  import SettingsPageHeader from '$lib/shared/ui/SettingsPageHeader.svelte';
  import FluentTextInput from '$lib/shared/ui/FluentTextInput.svelte';

  const defaultConfig: ConnectionSettings = {
    crl_allowed_hosts: [],
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
  let crlHostsText = $state('');
  let caStatus = $state<CaCertificateStatus | null>(null);
  let caUpdating = $state(false);
  let caResult = $state<string | null>(null);
  let loading = $state(true);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  const autoSave = createAutoSave({
    onError: (message) => {
      error = formatUserFacingError(message);
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
      crlHostsText = connectionConfig.crl_allowed_hosts.join(', ');
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
    crlHostsText = '';
    caResult = null;
    error = null;
    applyConnection({ ...defaultConfig });
  }

  function saveCrlHosts() {
    applyConnection({ ...config, crl_allowed_hosts: crlHostsText.split(/[,\s]+/).filter(Boolean) });
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
      void notifyGithubAuthFallback();
    }
  }
</script>

<div class="workspace-page settings-page-shell">
  <SettingsPageHeader
    title={$t('settings.connection.title')}
    icon="connect"
    resetDisabled={loading}
    onReset={resetConnection}
  />

  <ConnectionSecurity details />

  <div class="settings-section-list">
    <section class="settings-section space-y-3">
      <h2 class="text-sm font-semibold">{$t('settings.connection.crlTitle')}</h2>
      <p class="text-xs text-md3-on-surface-variant">{$t('settings.connection.crlHint')}</p>
      <div role="group" aria-label={$t('settings.connection.crlAllowedHosts')} onfocusout={saveCrlHosts}>
        <FluentTextInput id="crl-allowed-hosts" label={$t('settings.connection.crlAllowedHosts')}
          value={crlHostsText} disabled={loading}
          oninput={(value) => { crlHostsText = value; }}
          onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveCrlHosts(); } }} />
      </div>
      <p class="text-xs text-md3-on-surface-variant">{$t('settings.connection.crlAllowedHostsHint')}</p>
    </section>
    <section class="settings-section space-y-3">
      <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.basic')}
      </h2>

      <div class="settings-row text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.enableProxy')}
        <MdSwitch
          checked={config.enable_proxy}
          disabled={loading}
          ariaLabel={$t('settings.connection.enableProxy')}
          onChange={(enabled) => applyConnection({ ...config, enable_proxy: enabled })}
        />
      </div>

      <div class="settings-row text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.followSystemProxy')}
        <MdSwitch
          checked={config.follow_system_proxy}
          disabled={loading || !config.enable_proxy}
          ariaLabel={$t('settings.connection.followSystemProxy')}
          onChange={(enabled) => applyConnection({ ...config, follow_system_proxy: enabled })}
        />
      </div>

      {#if showCustomProxy}
        <div class="space-y-2">
          <!-- Proxy URLs can contain credentials; keep the value in a native field. -->
          <MdOutlinedField inputId="connection-custom-proxy" label={$t('settings.connection.customProxy')} disabled={loading}>
            <input data-focus-ring="delegated"
              id="connection-custom-proxy"
              class="cfms-native-field w-full"
              type="text"
              value={config.custom_proxy}
              oninput={(event) => applyConnection({ ...config, custom_proxy: event.currentTarget.value })}
              placeholder={$t('settings.connection.customProxyHint')}
              disabled={loading}
            />
          </MdOutlinedField>
        </div>
      {/if}

      <div class="settings-row text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.forceIpv4')}
        <MdSwitch
          checked={config.force_ipv4}
          disabled={loading}
          ariaLabel={$t('settings.connection.forceIpv4')}
          onChange={(enabled) => applyConnection({ ...config, force_ipv4: enabled })}
        />
      </div>
    </section>

    <section class="settings-section space-y-3">
      <div class="settings-section-heading">
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.connection.history')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.connection.historyHint')}
        </p>
      </div>

      <div class="settings-row text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.rememberAddresses')}
        <MdSwitch
          checked={config.remember_connection_addresses}
          disabled={loading}
          ariaLabel={$t('settings.connection.rememberAddresses')}
          onChange={setRememberConnectionAddresses}
        />
      </div>
    </section>

    <section class="settings-section space-y-3">
      <div class="settings-section-heading">
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.connection.identity')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.connection.identityHint')}
        </p>
      </div>

      <FluentTextInput
          id="connection-client-cert-path"
          label={$t('settings.connection.certPath')}
          value={config.client_cert_path}
          oninput={(value) => applyConnection({ ...config, client_cert_path: value })}
          disabled={loading}
        />

      <FluentTextInput
          id="connection-client-key-path"
          label={$t('settings.connection.keyPath')}
          value={config.client_key_path}
          oninput={(value) => applyConnection({ ...config, client_key_path: value })}
          disabled={loading}
        />
    </section>

    <section class="settings-section space-y-3">
      <div class="settings-section-heading">
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.connection.caCertificates')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.connection.caHint')}
        </p>
      </div>

      <div class="rounded-lg bg-md3-surface-container-high p-3 text-xs text-md3-on-surface-variant space-y-1">
        <div class="flex justify-between gap-3">
          <span>{$t('settings.connection.caCertificateCount')}</span>
          <span class="text-md3-on-surface">{caStatus?.certificateCount ?? '-'}</span>
        </div>
        <div class="flex justify-between gap-3">
          <span>{$t('settings.connection.caLastChecked')}</span>
          <span class="text-right text-md3-on-surface">{formatLastChecked(caStatus?.lastChecked)}</span>
        </div>
      </div>

      <FluentButton data-fluent-owner="routes-home-settings-connection-page"
        style="font-family: var(--font-md3-sans);"
        onclick={updateCertificates}
        disabled={loading || caUpdating}
        type="button"
        appearance="subtle"
        class="px-4 py-2 rounded-md font-medium text-sm\r\n               bg-md3-secondary-container text-md3-on-secondary-container\r\n                disabled:opacity-50 transition-all flex items-center gap-2"
      >
        <Icon name="refresh" size="18px" />
        {caUpdating ? $t('common.checking') : $t('settings.connection.caUpdateNow')}
      </FluentButton>

      {#if caResult}
        <p class="text-xs text-md3-on-surface-variant">{caResult}</p>
      {/if}

      <div class="settings-section-heading">
        <p>{$t('settings.connection.githubApiHint')}</p>
      </div>
      <a
        href="/home/settings/github-api"
        class="inline-flex min-h-10 w-fit items-center gap-2 rounded-md px-2 text-sm font-semibold text-md3-primary-emphasis hover:bg-md3-primary-emphasis/10"
      >
        <Icon name="api" size="18px" />
        {$t('settings.connection.githubApiLink')}
        <Icon name="navigateNext" size="18px" />
      </a>
    </section>

  </div>
</div>
