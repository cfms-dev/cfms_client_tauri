<script lang="ts">
  // CFMS Client — Download Manager page
  //
  // Shows the download task queue with progress bars and actions.
  // Data is reactive via downloadStore (updated by backend events).

  import { onMount } from "svelte";
  import type { DownloadTaskStatus } from "$lib/api";
  import { downloadStore } from "$lib/stores.svelte";
  import { getDownloadTasks, clearCompletedTasks, clearFailedTasks } from "$lib/api";
  import DownloadTaskCard from "$lib/components/DownloadTaskCard.svelte";

  let filter: DownloadTaskStatus | "all" = $state("all");
  let busy = $state(false);

  const filters: Array<{ key: DownloadTaskStatus | "all"; label: string }> = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "downloading", label: "Downloading" },
    { key: "paused", label: "Paused" },
    { key: "completed", label: "Completed" },
    { key: "failed", label: "Failed" },
    { key: "cancelled", label: "Cancelled" },
  ];

  const filtered = $derived(downloadStore.getTasksByStatus(filter));

  onMount(async () => {
    try {
      const tasks = await getDownloadTasks();
      downloadStore.setAll(tasks);
    } catch { /* ignore */ }
  });

  async function refresh() {
    try {
      const tasks = await getDownloadTasks();
      downloadStore.setAll(tasks);
    } catch { /* ignore */ }
  }

  async function handleClearCompleted() {
    busy = true;
    try {
      await clearCompletedTasks();
      await refresh();
    } finally {
      busy = false;
    }
  }

  async function handleClearFailed() {
    busy = true;
    try {
      await clearFailedTasks();
      await refresh();
    } finally {
      busy = false;
    }
  }

  function handleRemove(taskId: string) {
    downloadStore.remove(taskId);
    refresh();
  }
</script>

<div class="p-6 space-y-4">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-bold">Download Manager</h1>
    <div class="flex gap-2">
      <button
        class="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-800
               text-gray-700 dark:text-gray-300
               rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700
               transition-colors"
        onclick={refresh}
      >
        ⟳ Refresh
      </button>
      <button
        class="text-xs px-3 py-1.5 bg-green-100 text-green-700
               dark:bg-green-900 dark:text-green-200
               rounded-lg hover:bg-green-200 dark:hover:bg-green-800
               disabled:opacity-50 transition-colors"
        onclick={handleClearCompleted}
        disabled={busy || downloadStore.completedTasks.length === 0}
      >
        Clear Completed
      </button>
      <button
        class="text-xs px-3 py-1.5 bg-red-100 text-red-700
               dark:bg-red-900 dark:text-red-200
               rounded-lg hover:bg-red-200 dark:hover:bg-red-800
               disabled:opacity-50 transition-colors"
        onclick={handleClearFailed}
        disabled={busy || downloadStore.failedTasks.length === 0}
      >
        Clear Failed
      </button>
    </div>
  </div>

  <!-- Filter tabs -->
  <div class="flex gap-1 flex-wrap">
    {#each filters as f}
      <button
        class="px-3 py-1 text-xs rounded-full transition-colors"
        class:bg-blue-600={filter === f.key}
        class:text-white={filter === f.key}
        class:bg-gray-100={filter !== f.key}
        class:dark:bg-gray-800={filter !== f.key}
        class:text-gray-700={filter !== f.key}
        class:dark:text-gray-300={filter !== f.key}
        class:hover:bg-gray-200={filter !== f.key}
        class:dark:hover:bg-gray-700={filter !== f.key}
        onclick={() => (filter = f.key)}
      >
        {f.label}
        <!-- Badge showing count -->
        {#if f.key !== "all"}
          <span class="ml-1 opacity-60">
            ({downloadStore.getTasksByStatus(f.key).length})
          </span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Task list -->
  <div class="grid gap-3">
    {#if filtered.length > 0}
      {#each filtered as task (task.task_id)}
        <DownloadTaskCard task={task} onRemove={handleRemove} />
      {/each}
    {:else}
      <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700
                  p-8 text-center">
        <p class="text-gray-400 dark:text-gray-500">
          {filter === "all" ? "No download tasks yet." : `No ${filter} tasks.`}
        </p>
      </div>
    {/if}
  </div>
</div>
