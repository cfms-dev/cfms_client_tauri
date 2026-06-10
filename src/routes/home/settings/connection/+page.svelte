<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    getConnectionSettings,
    setConnectionSettings,
    type ConnectionSettings,
  } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';

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
    const timeout = window.setTimeout(() => (status = null), 4000);
    return () => window.clearTimeout(timeout);
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

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={() => goto('/home/settings')}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    {$t('settings.connection.title')}
  </h1>

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-5">
    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.basic')}
      </h2>

      <label class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.enableProxy')}
        <input
          class="accent-md3-primary"
          type="checkbox"
          bind:checked={config.enable_proxy}
          disabled={loading || saving}
        />
      </label>

      <label class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.followSystemProxy')}
        <input
          class="accent-md3-primary"
          type="checkbox"
          bind:checked={config.follow_system_proxy}
          disabled={loading || saving || !config.enable_proxy}
        />
      </label>

      {#if showCustomProxy}
        <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.connection.customProxy')}
          <input
            class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                   px-3 py-2 text-md3-on-surface"
            type="text"
            bind:value={config.custom_proxy}
            placeholder={$t('settings.connection.customProxyHint')}
            disabled={loading || saving}
          />
        </label>
      {/if}

      <label class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.forceIpv4')}
        <input
          class="accent-md3-primary"
          type="checkbox"
          bind:checked={config.force_ipv4}
          disabled={loading || saving}
        />
      </label>
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
          bind:value={config.client_cert_path}
          disabled={loading || saving}
        />
      </label>

      <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.connection.keyPath')}
        <input
          class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                 px-3 py-2 text-md3-on-surface"
          type="text"
          bind:value={config.client_key_path}
          disabled={loading || saving}
        />
      </label>
    </section>

    {#if status}
      <p class="text-sm text-md3-success flex items-center gap-1.5">
        <Icon name="checkCircle" size="16px" />
        {status}
      </p>
    {/if}
    {#if error}
      <p class="text-sm text-md3-error flex items-center gap-1.5">
        <Icon name="errorFilled" size="16px" />
        {error}
      </p>
    {/if}

    <div class="flex flex-wrap gap-2">
      <button
        class="px-4 py-2 rounded-full font-medium text-sm
               bg-md3-primary-container text-md3-on-primary-container
               hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
        style="font-family: var(--font-md3-sans);"
        onclick={saveConnection}
        disabled={loading || saving}
      >
        <Icon name="done" size="18px" />
        {saving ? $t('common.saving') : $t('settings.connection.save')}
      </button>
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
