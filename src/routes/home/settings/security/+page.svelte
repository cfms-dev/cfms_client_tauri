<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { cryptoInfo, getServerState, type ServerState } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';

  interface CryptoInfo {
    kdf_iterations: number;
    salt_len: number;
    key_len: number;
    nonce_len: number;
    tag_len: number;
  }

  let crypto = $state<CryptoInfo | null>(null);
  let server = $state<ServerState | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const protocolLabel = $derived(
    server?.protocol_version === null || server?.protocol_version === undefined
      ? $t('common.notConnected')
      : `v${server.protocol_version}`,
  );

  onMount(async () => {
    try {
      const [cryptoData, serverData] = await Promise.all([cryptoInfo(), getServerState()]);
      crypto = cryptoData;
      server = serverData;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });
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
    {$t('settings.security.title')}
  </h1>

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-4">
    <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {$t('settings.security.cryptography')}
    </h2>

    {#if loading}
      <p class="text-sm text-md3-on-surface-variant">{$t('settings.security.loadingParameters')}</p>
    {:else if crypto}
      <div class="text-sm divide-y divide-md3-outline/50">
        <div class="flex justify-between gap-3 py-2">
          <span class="text-md3-on-surface-variant">{$t('settings.security.kdfIterations')}</span>
          <span class="text-md3-on-surface">{crypto.kdf_iterations.toLocaleString()}</span>
        </div>
        <div class="flex justify-between gap-3 py-2">
          <span class="text-md3-on-surface-variant">{$t('settings.security.saltLength')}</span>
          <span class="text-md3-on-surface">{crypto.salt_len} {$t('common.bytes')}</span>
        </div>
        <div class="flex justify-between gap-3 py-2">
          <span class="text-md3-on-surface-variant">{$t('settings.security.keyLength')}</span>
          <span class="text-md3-on-surface">{crypto.key_len} {$t('common.bytes')}</span>
        </div>
        <div class="flex justify-between gap-3 py-2">
          <span class="text-md3-on-surface-variant">{$t('settings.security.nonceLength')}</span>
          <span class="text-md3-on-surface">{crypto.nonce_len} {$t('common.bytes')}</span>
        </div>
        <div class="flex justify-between gap-3 py-2">
          <span class="text-md3-on-surface-variant">{$t('settings.security.tagLength')}</span>
          <span class="text-md3-on-surface">{crypto.tag_len} {$t('common.bytes')}</span>
        </div>
        <div class="flex justify-between gap-3 py-2">
          <span class="text-md3-on-surface-variant">{$t('settings.security.protocolVersion')}</span>
          <span class="text-md3-on-surface">{protocolLabel}</span>
        </div>
      </div>
    {/if}

    <p class="text-xs text-md3-on-surface-variant">
      {$t('settings.security.caDescription')}
    </p>

    {#if error}
      <p class="text-sm text-md3-error flex items-center gap-1.5">
        <Icon name="errorFilled" size="16px" />
        {error}
      </p>
    {/if}
  </div>
</div>
