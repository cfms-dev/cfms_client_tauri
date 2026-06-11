<script lang="ts">
  // Download Manager (Tasks) page
  //
  // Shows the download task queue with progress bars and actions.
  // Data is reactive via downloadStore (updated by backend events).
  //
  // Adapted from the existing downloads page.
  // Reference: TasksView in reference/src/include/ui/views/tasks.py

  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import type { DownloadTaskStatus } from '$lib/api';
  import type { UploadTaskDto } from '$lib/api';
  import { downloadStore, uploadStore } from '$lib/stores.svelte';
  import { getDownloadTasks, clearCompletedTasks, clearFailedTasks, pauseDownload, resumeDownload, cancelDownload } from '$lib/api';
  import DownloadTaskCard from '$lib/components/DownloadTaskCard.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let filter: DownloadTaskStatus | 'all' = $state('all');
  let busy = $state(false);
  let menuOpen = $state(false);

  const filters: Array<{ key: DownloadTaskStatus | 'all'; label: string }> = [
    { key: 'all', label: $t('tasks.all') },
    { key: 'pending', label: $t('tasks.pending') },
    { key: 'downloading', label: $t('tasks.downloading') },
    { key: 'paused', label: $t('tasks.paused') },
    { key: 'completed', label: $t('tasks.completed') },
    { key: 'failed', label: $t('tasks.failed') },
    { key: 'cancelled', label: $t('tasks.cancelled') },
  ];

  const filtered = $derived(downloadStore.getTasksByStatus(filter));
  const currentFilterLabel = $derived(filters.find((f) => f.key === filter)?.label ?? filter);
  const uploadTasks = $derived(uploadStore.allTasks);

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
      menuOpen = false;
    }
  }

  async function handleClearFailed() {
    busy = true;
    try {
      await clearFailedTasks();
      await refresh();
    } finally {
      busy = false;
      menuOpen = false;
    }
  }

  async function handlePauseAll() {
    busy = true;
    try {
      for (const t of downloadStore.activeTasks) {
        if (['downloading', 'decrypting', 'verifying'].includes(t.status)) {
          await pauseDownload(t.task_id);
        }
      }
      await refresh();
    } finally {
      busy = false;
      menuOpen = false;
    }
  }

  async function handleResumeAll() {
    busy = true;
    try {
      for (const t of downloadStore.activeTasks) {
        if (t.status === 'paused') {
          await resumeDownload(t.task_id);
        }
      }
      await refresh();
    } finally {
      busy = false;
      menuOpen = false;
    }
  }

  async function handleCancelPending() {
    busy = true;
    try {
      for (const t of downloadStore.activeTasks) {
        if (t.status === 'pending') {
          await cancelDownload(t.task_id);
        }
      }
      await refresh();
    } finally {
      busy = false;
      menuOpen = false;
    }
  }

  function handleRemove(taskId: string) {
    downloadStore.remove(taskId);
    refresh();
  }

  function uploadStatusLabel(task: UploadTaskDto) {
    if (task.status === 'pending') return $t('tasks.uploadQueued');
    if (task.status === 'completed') return $t('tasks.uploadCompleted');
    if (task.status === 'failed') return task.error ?? $t('tasks.failed');
    if (task.status === 'skipped') return $t('tasks.cancelled');
    return task.message ?? $t('tasks.downloading');
  }
</script>

<div class="p-6 space-y-4">
  <!-- Header row -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('tasks.title')}
      </h1>
      <button
        class="p-1.5 rounded-full text-md3-on-surface-variant
               hover:bg-md3-surface-container-high transition-colors"
        onclick={refresh}
        title={$t('common.refresh')}
      >
        <Icon name="refresh" size="20px" />
      </button>
    </div>

    <!-- More actions popup menu -->
    <div class="relative">
      <button
        class="p-1.5 rounded-full text-md3-on-surface-variant
               hover:bg-md3-surface-container-high transition-colors"
        onclick={() => (menuOpen = !menuOpen)}
        title={$t('tasks.moreActions')}
      >
        <Icon name="moreVert" size="20px" />
      </button>

      {#if menuOpen}
        <!-- Backdrop to close -->
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="fixed inset-0 z-10" onclick={() => (menuOpen = false)} role="presentation"></div>
        <!-- MD3 menu -->
        <div class="absolute right-0 top-full mt-1 z-20 w-48
                    bg-md3-surface-container rounded-xl border border-md3-outline
                    shadow-lg py-1 overflow-hidden">
          <button
            class="w-full flex items-center gap-2 px-4 py-2 text-sm
                   hover:bg-md3-surface-container-high transition-colors
                   text-md3-on-surface"
            style="font-family: var(--font-md3-sans);"
            onclick={handlePauseAll}
            disabled={busy}
          >
            <Icon name="pause" size="16px" /> {$t('tasks.pauseAll')}
          </button>
          <button
            class="w-full flex items-center gap-2 px-4 py-2 text-sm
                   hover:bg-md3-surface-container-high transition-colors
                   text-md3-on-surface"
            style="font-family: var(--font-md3-sans);"
            onclick={handleResumeAll}
            disabled={busy}
          >
            <Icon name="resume" size="16px" /> {$t('tasks.resumeAllPaused')}
          </button>
          <button
            class="w-full flex items-center gap-2 px-4 py-2 text-sm
                   hover:bg-md3-surface-container-high transition-colors
                   text-md3-on-surface"
            style="font-family: var(--font-md3-sans);"
            onclick={handleCancelPending}
            disabled={busy}
          >
            <Icon name="cancel" size="16px" /> {$t('tasks.cancelAllPending')}
          </button>
          <div class="border-t border-md3-outline my-1"></div>
          <button
            class="w-full flex items-center gap-2 px-4 py-2 text-sm
                   hover:bg-md3-surface-container-high transition-colors
                   text-md3-success"
            style="font-family: var(--font-md3-sans);"
            onclick={handleClearCompleted}
            disabled={busy || downloadStore.completedTasks.length === 0}
          >
            <Icon name="clearAll" size="16px" /> {$t('tasks.clearCompleted')}
          </button>
          <button
            class="w-full flex items-center gap-2 px-4 py-2 text-sm
                   hover:bg-md3-surface-container-high transition-colors
                   text-md3-error"
            style="font-family: var(--font-md3-sans);"
            onclick={handleClearFailed}
            disabled={busy || downloadStore.failedTasks.length === 0}
          >
            <Icon name="deleteSweep" size="16px" /> {$t('tasks.clearFailed')}
          </button>
        </div>
      {/if}
    </div>
  </div>

  {#if uploadTasks.length > 0}
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase text-md3-on-surface-variant" style="font-family: var(--font-md3-sans);">
          {$t('tasks.uploads')}
        </h2>
        <button
          class="px-3 py-1.5 text-xs rounded-full font-medium
                 bg-md3-surface-container-high text-md3-on-surface-variant
                 hover:brightness-110 transition-all"
          onclick={() => uploadStore.clearFinished()}
        >
          {$t('tasks.clearCompleted')}
        </button>
      </div>
      <div class="grid gap-3">
        {#each uploadTasks as task (task.upload_id)}
          <article class="rounded-xl border border-md3-outline bg-md3-surface-container/70 p-4 shadow-sm">
            <div class="mb-2 flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-md3-on-surface">{task.file_name}</p>
                <p class="mt-0.5 truncate text-xs text-md3-on-surface-variant">{uploadStatusLabel(task)}</p>
              </div>
              <span class="shrink-0 rounded-full bg-md3-surface-container-high px-2 py-0.5 text-xs text-md3-on-surface-variant">
                {Math.round(task.progress * 100)}%
              </span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-md3-surface-container-high">
              <span
                class="block h-full rounded-full bg-md3-primary transition-[width] duration-200"
                style={`width: ${Math.max(0, Math.min(1, task.progress)) * 100}%`}
              ></span>
            </div>
          </article>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Filter chips -->
  <h2 class="text-sm font-semibold uppercase text-md3-on-surface-variant" style="font-family: var(--font-md3-sans);">
    {$t('tasks.downloads')}
  </h2>
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
        {#if f.key !== 'all'}
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
                  border border-md3-outline p-10 text-center space-y-3">
        <span class="text-md3-on-surface-variant">
          <Icon name="downloadDone" size="64px" />
        </span>
        <p class="text-md3-on-surface-variant" style="font-family: var(--font-md3-sans);">
          {filter === 'all' ? $t('tasks.noTasks') : $t('tasks.noTasksByStatus', { values: { status: currentFilterLabel } })}
        </p>
      </div>
    {/if}
  </div>
</div>
