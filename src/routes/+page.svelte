<script lang="ts">
  // CFMS Client — Dashboard / Home page
  //
  // Shows service health cards, quick stats, lockdown status,
  // and a live activity feed from backend events.

  import { onMount } from "svelte";
  import { authStore, downloadStore, serviceStatusStore, eventLog } from "$lib/stores.svelte";
  import {
    getServiceStatus,
    getDownloadTasks,
    getAuthStatus,
    cryptoInfo,
    protocolVersion,
  } from "$lib/api";
  import ServiceStatus from "$lib/components/ServiceStatus.svelte";

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
      const [status, tasks, auth, info, ver] = await Promise.all([
        getServiceStatus(),
        getDownloadTasks(),
        getAuthStatus(),
        cryptoInfo(),
        protocolVersion(),
      ]);
      serviceStatusStore.setAll(status);
      downloadStore.setAll(tasks);
      authStore.apply(auth);
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
  <!-- Page title -->
  <div>
    <h1 class="text-2xl font-bold">Dashboard</h1>
    <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
      CFMS Client · Protocol v{protoVer}
    </p>
  </div>

  <!-- Stats cards -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
    <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">Active Downloads</p>
      <p class="text-2xl font-bold text-blue-600 dark:text-blue-400">{activeCount}</p>
    </div>
    <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">Completed</p>
      <p class="text-2xl font-bold text-green-600 dark:text-green-400">{completedCount}</p>
    </div>
    <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">Failed</p>
      <p class="text-2xl font-bold text-red-600 dark:text-red-400">{failedCount}</p>
    </div>
    <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">Total Tasks</p>
      <p class="text-2xl font-bold text-gray-700 dark:text-gray-300">{totalCount}</p>
    </div>
  </div>

  <!-- Two-column: Service status + Activity feed -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Service status -->
    <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h2 class="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">
        Background Services
      </h2>
      <div class="space-y-2">
        {#if serviceStatusStore.services.length > 0}
          {#each serviceStatusStore.services as svc}
            <ServiceStatus name={svc.name} running={svc.running} />
          {/each}
        {:else}
          <p class="text-sm text-gray-400">No services registered.</p>
        {/if}
      </div>
    </div>

    <!-- Crypto info -->
    <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h2 class="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">
        Cryptographic Parameters
      </h2>
      {#if cryptoInfoData}
        <div class="grid grid-cols-2 gap-2 text-sm">
          <span class="text-gray-500">KDF Iterations:</span>
          <span class="font-mono">{cryptoInfoData.kdf_iterations.toLocaleString()}</span>
          <span class="text-gray-500">Salt Length:</span>
          <span class="font-mono">{cryptoInfoData.salt_len} bytes</span>
          <span class="text-gray-500">Key Length:</span>
          <span class="font-mono">{cryptoInfoData.key_len} bytes (AES-256)</span>
          <span class="text-gray-500">Nonce Length:</span>
          <span class="font-mono">{cryptoInfoData.nonce_len} bytes</span>
          <span class="text-gray-500">Tag Length:</span>
          <span class="font-mono">{cryptoInfoData.tag_len} bytes</span>
        </div>
      {:else}
        <p class="text-sm text-gray-400">Loading…</p>
      {/if}
    </div>
  </div>

  <!-- Activity feed -->
  <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
    <h2 class="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">
      Activity
    </h2>
    {#if eventLog.entries.length > 0}
      <div class="space-y-1 max-h-48 overflow-y-auto">
        {#each eventLog.entries as entry}
          <div class="flex items-center gap-2 text-xs">
            <span class="text-gray-400 shrink-0 w-14 text-right">
              {entry.time.toLocaleTimeString()}
            </span>
            <span
              class="truncate"
              class:text-green-600={entry.type === "success"}
              class:text-red-600={entry.type === "error"}
              class:text-yellow-600={entry.type === "warning"}
              class:text-gray-600={entry.type === "info"}
              class:dark:text-green-400={entry.type === "success"}
              class:dark:text-red-400={entry.type === "error"}
              class:dark:text-yellow-400={entry.type === "warning"}
              class:dark:text-gray-400={entry.type === "info"}
            >
              {entry.text}
            </span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="text-sm text-gray-400">No activity yet.</p>
    {/if}
  </div>
</div>
