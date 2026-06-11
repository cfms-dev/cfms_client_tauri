<script lang="ts">
  // Home overview page — Dashboard with welcome card, stats, and activity feed.
  //
  // Adapted from the existing +page.svelte dashboard.
  // Reference: HomeView in reference/src/include/ui/components/homepage.py

  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { authStore, serverStateStore, downloadStore, serviceStatusStore, eventLog } from '$lib/stores.svelte';
  import {
    getServiceStatus,
    getDownloadTasks,
    getAuthStatus,
    getServerState,
    cryptoInfo,
    protocolVersion,
  } from '$lib/api';
  import ServiceStatus from '$lib/components/ServiceStatus.svelte';
  import WelcomeCard from '$lib/components/WelcomeCard.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let cryptoInfoData = $state<{
    kdf_iterations: number;
    salt_len: number;
    key_len: number;
    nonce_len: number;
    tag_len: number;
  } | null>(null);

  let protoVer = $state<number>(0);

  onMount(async () => {
    try {
      const [status, tasks, auth, serverState, info, ver] = await Promise.all([
        getServiceStatus(),
        getDownloadTasks(),
        getAuthStatus(),
        getServerState(),
        cryptoInfo(),
        protocolVersion(),
      ]);
      serviceStatusStore.setAll(status);
      downloadStore.setAll(tasks);
      authStore.apply(auth);
      serverStateStore.apply(serverState);
      serverStateStore.protocolVersion = ver;
      cryptoInfoData = info;
      protoVer = ver;
    } catch {
      // Backend might still be initializing.
    }
  });

  // Derived stats
  const activeCount = $derived(downloadStore.activeTasks.length);
  const completedCount = $derived(downloadStore.completedTasks.length);
  const failedCount = $derived(downloadStore.failedTasks.length);
  const totalCount = $derived(downloadStore.tasks.size);
</script>

<div class="p-6 space-y-6">
  <!-- Welcome card -->
  <WelcomeCard />

  <!-- Stats cards — MD3 surface containers, 4-column grid -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline p-4">
      <p class="text-sm text-md3-on-surface-variant" style="font-family: var(--font-md3-sans);">
        {$t('home.activeDownloads')}
      </p>
      <p class="text-2xl font-bold text-md3-primary-emphasis mt-1" style="font-family: var(--font-md3-sans);">
        {activeCount}
      </p>
    </div>
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline p-4">
      <p class="text-sm text-md3-on-surface-variant" style="font-family: var(--font-md3-sans);">
        {$t('home.completed')}
      </p>
      <p class="text-2xl font-bold text-md3-success mt-1" style="font-family: var(--font-md3-sans);">
        {completedCount}
      </p>
    </div>
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline p-4">
      <p class="text-sm text-md3-on-surface-variant" style="font-family: var(--font-md3-sans);">
        {$t('home.failed')}
      </p>
      <p class="text-2xl font-bold text-md3-error mt-1" style="font-family: var(--font-md3-sans);">
        {failedCount}
      </p>
    </div>
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline p-4">
      <p class="text-sm text-md3-on-surface-variant" style="font-family: var(--font-md3-sans);">
        {$t('home.totalTasks')}
      </p>
      <p class="text-2xl font-bold text-md3-on-surface mt-1" style="font-family: var(--font-md3-sans);">
        {totalCount}
      </p>
    </div>
  </div>

  <!-- Two-column: Service status + Crypto info -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Service status -->
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline p-4">
      <h2 class="text-sm font-semibold mb-3 text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('home.backgroundServices')}
      </h2>
      <div class="space-y-2">
        {#if serviceStatusStore.services.length > 0}
          {#each serviceStatusStore.services as svc}
            <ServiceStatus name={svc.name} running={svc.running} />
          {/each}
        {:else}
          <p class="text-sm text-md3-on-surface-variant">{$t('home.noServices')}</p>
        {/if}
      </div>
    </div>

    <!-- Crypto info -->
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline p-4">
      <h2 class="text-sm font-semibold mb-3 text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('home.cryptographicParameters')}
      </h2>
      {#if cryptoInfoData}
        <div class="grid grid-cols-2 gap-2 text-sm">
          <span class="text-md3-on-surface-variant">{$t('home.kdfIterations')}:</span>
          <span class="text-md3-on-surface" style="font-family: var(--font-md3-mono);">
            {cryptoInfoData.kdf_iterations.toLocaleString()}
          </span>
          <span class="text-md3-on-surface-variant">{$t('home.saltLength')}:</span>
          <span class="text-md3-on-surface" style="font-family: var(--font-md3-mono);">
            {cryptoInfoData.salt_len} {$t('common.bytes')}
          </span>
          <span class="text-md3-on-surface-variant">{$t('home.keyLength')}:</span>
          <span class="text-md3-on-surface" style="font-family: var(--font-md3-mono);">
            {cryptoInfoData.key_len} {$t('common.bytes')} (AES-256)
          </span>
          <span class="text-md3-on-surface-variant">{$t('home.nonceLength')}:</span>
          <span class="text-md3-on-surface" style="font-family: var(--font-md3-mono);">
            {cryptoInfoData.nonce_len} {$t('common.bytes')}
          </span>
          <span class="text-md3-on-surface-variant">{$t('home.tagLength')}:</span>
          <span class="text-md3-on-surface" style="font-family: var(--font-md3-mono);">
            {cryptoInfoData.tag_len} {$t('common.bytes')}
          </span>
        </div>
      {:else}
        <p class="text-sm text-md3-on-surface-variant">{$t('common.loadingEllipsis')}</p>
      {/if}
    </div>
  </div>

  <!-- Activity feed -->
  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-4">
    <h2 class="text-sm font-semibold mb-3 text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {$t('home.activity')}
    </h2>
    {#if eventLog.entries.length > 0}
      <div class="space-y-1 max-h-48 overflow-y-auto">
        {#each eventLog.entries as entry}
          <div class="flex items-center gap-2 text-xs">
            <span class="text-md3-on-surface-variant shrink-0 w-14 text-right font-mono">
              {entry.time.toLocaleTimeString()}
            </span>
            <span
              class="truncate"
              class:text-md3-success={entry.type === "success"}
              class:text-md3-error={entry.type === "error"}
              class:text-md3-warning={entry.type === "warning"}
              class:text-md3-on-surface-variant={entry.type === "info"}
            >
              {entry.text}
            </span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="text-sm text-md3-on-surface-variant">{$t('home.noActivity')}</p>
    {/if}
  </div>
</div>
