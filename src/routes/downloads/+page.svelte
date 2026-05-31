<script lang="ts">
  // CFMS Client — Download Manager page
  //
  // Shows the download task queue with progress bars and actions.
  // Data is reactive via downloadStore (updated by backend events).
  //
  // MD3: filter chips (rounded-full), task cards from DownloadTaskCard,
  // tonal icon buttons for clear/refresh actions.

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
    <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      Download Manager
    </h1>
    <div class="flex gap-2">
      <!-- MD3 tonal icon buttons -->
      <button
        class="text-xs px-4 py-1.5 rounded-full font-medium
               bg-md3-surface-container-high text-md3-on-surface-variant
               hover:brightness-110 transition-all"
        style="font-family: var(--font-md3-sans);"
        onclick={refresh}
      >
        ⟳ Refresh
      </button>
      <button
        class="text-xs px-4 py-1.5 rounded-full font-medium
               bg-md3-success-container text-md3-on-success-container
               hover:brightness-110
               disabled:opacity-50 transition-all"
        style="font-family: var(--font-md3-sans);"
        onclick={handleClearCompleted}
        disabled={busy || downloadStore.completedTasks.length === 0}
      >
        Clear Completed
      </button>
      <button
        class="text-xs px-4 py-1.5 rounded-full font-medium
               bg-md3-error-container text-md3-on-error-container
               hover:brightness-110
               disabled:opacity-50 transition-all"
        style="font-family: var(--font-md3-sans);"
        onclick={handleClearFailed}
        disabled={busy || downloadStore.failedTasks.length === 0}
      >
        Clear Failed
      </button>
    </div>
  </div>

  <!-- MD3 filter chips -->
  <div class="flex gap-1.5 flex-wrap">
    {#each filters as f}
      <button
        class="px-3.5 py-1.5 text-xs rounded-full font-medium transition-all"
        class:bg-md3-primary={filter === f.key}
        class:text-md3-on-primary={filter === f.key}
        class:bg-md3-surface-container-high={filter !== f.key}
        class:text-md3-on-surface-variant={filter !== f.key}
        class:hover:bg-md3-surface-container-highest={filter !== f.key}
        style="font-family: var(--font-md3-sans);"
        onclick={() => (filter = f.key)}
      >
        {f.label}
        <!-- Count badge -->
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
      <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                  border border-md3-outline p-10 text-center">
        <p class="text-md3-on-surface-variant">
          {filter === "all" ? "No download tasks yet." : `No ${filter} tasks.`}
        </p>
      </div>
    {/if}
  </div>
</div>
