<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    getConnectionSettings,
    setConnectionSettings,
    type ConnectionSettings,
  } from '$lib/api';
  import { notificationStore } from '$lib/stores.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import MdTextField from '$lib/components/MdTextField.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';
  import TopAppBar from '$lib/components/TopAppBar.svelte';

  const defaultConfig: ConnectionSettings = {
    enable_proxy: false,
    follow_system_proxy: false,
    custom_proxy: '',
    force_ipv4: false,
    client_cert_path: '',
    client_key_path: '',
  };

  let config = $state<ConnectionSettings>({ ...defaultConfig });
  let loading = $state(true);
  let saving = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

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
      config = await getConnectionSettings();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  async function saveConnection() {
    saving = true;
    error = null;
    try {
      const payload: ConnectionSettings = {
        ...config,
        custom_proxy: config.custom_proxy.trim(),
        client_cert_path: config.client_cert_path.trim(),
        client_key_path: config.client_key_path.trim(),
      };
      await setConnectionSettings(payload);
      config = payload;
      status = $t('settings.connection.saved');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  function resetConnection() {
    config = { ...defaultConfig };
    status = $t('settings.connection.resetStatus');
    error = null;
  }
</script>

<TopAppBar title={$t('settings.connection.title')} backLabel={$t('common.back')} onBack={() => goto('/home/settings')} maxWidth="max-w-lg">
  {#snippet actions()}
    <IconButton icon="done" label={$t('settings.connection.save')} onclick={saveConnection} disabled={loading || saving} />
  {/snippet}
</TopAppBar>

<div class="p-6 space-y-4 max-w-lg mx-auto">

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-5">
    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.basic')}
      </h2>

      <div class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.enableProxy')}
        <MdSwitch
          bind:checked={config.enable_proxy}
          disabled={loading || saving}
          ariaLabel={$t('settings.connection.enableProxy')}
        />
      </div>

      <div class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.followSystemProxy')}
        <MdSwitch
          bind:checked={config.follow_system_proxy}
          disabled={loading || saving || !config.enable_proxy}
          ariaLabel={$t('settings.connection.followSystemProxy')}
        />
      </div>

      {#if showCustomProxy}
        <MdTextField
          id="customProxy"
          label={$t('settings.connection.customProxy')}
          bind:value={config.custom_proxy}
          placeholder={$t('settings.connection.customProxyHint')}
          disabled={loading || saving}
          autocomplete="off"
          spellcheck="false"
        />
      {/if}

      <div class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.forceIpv4')}
        <MdSwitch
          bind:checked={config.force_ipv4}
          disabled={loading || saving}
          ariaLabel={$t('settings.connection.forceIpv4')}
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

      <MdTextField
        id="clientCertPath"
        label={$t('settings.connection.certPath')}
        bind:value={config.client_cert_path}
        disabled={loading || saving}
        autocomplete="off"
        spellcheck="false"
      />

      <MdTextField
        id="clientKeyPath"
        label={$t('settings.connection.keyPath')}
        bind:value={config.client_key_path}
        disabled={loading || saving}
        autocomplete="off"
        spellcheck="false"
      />
    </section>

    <div class="flex flex-wrap gap-2">
      <button
        class="px-4 py-2 rounded-full font-medium text-sm
               bg-md3-surface-container-high text-md3-on-surface
               hover:brightness-110 disabled:opacity-50 transition-all"
        style="font-family: var(--font-md3-sans);"
        onclick={resetConnection}
        disabled={loading || saving}
      >
        {$t('common.reset')}
      </button>
    </div>
  </div>
</div>
