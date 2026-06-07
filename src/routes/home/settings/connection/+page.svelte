<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { getSetting, setSetting } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';

  type ProxyMode = 'none' | 'system' | 'manual';
  type ProxyType = 'http' | 'socks5';

  interface ConnectionConfig {
    proxyMode: ProxyMode;
    manualHost: string;
    manualPort: number;
    manualType: ProxyType;
    verifyTls: boolean;
    timeoutSeconds: number;
  }

  const defaultConfig: ConnectionConfig = {
    proxyMode: 'none',
    manualHost: '',
    manualPort: 1080,
    manualType: 'http',
    verifyTls: true,
    timeoutSeconds: 30,
  };

  let config = $state<ConnectionConfig>({ ...defaultConfig });
  let loading = $state(true);
  let saving = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const isManual = $derived(config.proxyMode === 'manual');

  $effect(() => {
    if (!status) return;
    const timeout = window.setTimeout(() => (status = null), 4000);
    return () => window.clearTimeout(timeout);
  });

  function normalizeConfig(value: unknown): ConnectionConfig {
    if (!value || typeof value !== 'object') return { ...defaultConfig };
    const candidate = value as Partial<ConnectionConfig>;
    return {
      proxyMode: candidate.proxyMode === 'system' || candidate.proxyMode === 'manual'
        ? candidate.proxyMode
        : 'none',
      manualHost: typeof candidate.manualHost === 'string' ? candidate.manualHost : '',
      manualPort: Number.isFinite(candidate.manualPort) ? Number(candidate.manualPort) : 1080,
      manualType: candidate.manualType === 'socks5' ? 'socks5' : 'http',
      verifyTls: typeof candidate.verifyTls === 'boolean' ? candidate.verifyTls : true,
      timeoutSeconds: Number.isFinite(candidate.timeoutSeconds) ? Number(candidate.timeoutSeconds) : 30,
    };
  }

  onMount(async () => {
    try {
      const saved = await getSetting('connection');
      if (saved) {
        config = normalizeConfig(JSON.parse(saved));
      }
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
      const payload: ConnectionConfig = {
        ...config,
        manualPort: Math.max(1, Math.min(65535, Number(config.manualPort) || 1080)),
        timeoutSeconds: Math.max(1, Math.min(300, Number(config.timeoutSeconds) || 30)),
      };
      config = payload;
      await setSetting('connection', JSON.stringify(payload));
      status = 'Connection settings saved.';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  function resetConnection() {
    config = { ...defaultConfig };
    status = 'Connection settings reset locally. Save to apply.';
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
    Back
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    Connection
  </h1>

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-4">
    <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      Proxy Mode
      <select
        class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
               px-3 py-2 text-md3-on-surface"
        bind:value={config.proxyMode}
        disabled={loading || saving}
      >
        <option value="none">None</option>
        <option value="system">System</option>
        <option value="manual">Manual</option>
      </select>
    </label>

    {#if isManual}
      <div class="grid grid-cols-3 gap-3">
        <label class="col-span-2 block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          Host
          <input
            class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                   px-3 py-2 text-md3-on-surface"
            type="text"
            bind:value={config.manualHost}
            placeholder="proxy.example.com"
            disabled={loading || saving}
          />
        </label>
        <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          Port
          <input
            class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                   px-3 py-2 text-md3-on-surface"
            type="number"
            min="1"
            max="65535"
            bind:value={config.manualPort}
            disabled={loading || saving}
          />
        </label>
      </div>

      <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        Proxy Type
        <select
          class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                 px-3 py-2 text-md3-on-surface"
          bind:value={config.manualType}
          disabled={loading || saving}
        >
          <option value="http">HTTP</option>
          <option value="socks5">SOCKS5</option>
        </select>
      </label>
    {/if}

    <label class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      Verify TLS certificates
      <input
        class="accent-md3-primary"
        type="checkbox"
        bind:checked={config.verifyTls}
        disabled={loading || saving}
      />
    </label>

    <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      Timeout Seconds
      <input
        class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
               px-3 py-2 text-md3-on-surface"
        type="number"
        min="1"
        max="300"
        bind:value={config.timeoutSeconds}
        disabled={loading || saving}
      />
    </label>

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
        {saving ? 'Saving...' : 'Save Connection'}
      </button>
      <button
        class="px-4 py-2 rounded-full font-medium text-sm
               bg-md3-surface-container-high text-md3-on-surface
               hover:brightness-110 disabled:opacity-50 transition-all"
        style="font-family: var(--font-md3-sans);"
        onclick={resetConnection}
        disabled={loading || saving}
      >
        Reset
      </button>
    </div>
  </div>
</div>
