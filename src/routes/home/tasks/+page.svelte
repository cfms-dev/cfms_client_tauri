<script lang="ts">
  // Task manager page: upload/download tabs with a shared status filter.

  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import type { DownloadTaskDto, UploadTaskDto } from '$lib/api';
  import { downloadStore, uploadStore } from '$lib/stores.svelte';
  import { getDownloadTasks, clearCompletedTasks, clearFailedTasks, pauseDownload, resumeDownload, cancelDownload } from '$lib/api';
  import DownloadTaskCard from '$lib/components/DownloadTaskCard.svelte';
  import UploadTaskCard from '$lib/components/UploadTaskCard.svelte';
  import Icon from '$lib/components/Icon.svelte';

  type TaskTab = 'downloads' | 'uploads';
  type TaskFilter = 'all' | 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';

  let activeTab = $state<TaskTab>('downloads');
  let filter = $state<TaskFilter>('all');
  let busy = $state(false);
  let menuOpen = $state(false);

  const tabs = $derived([
    {
      key: 'downloads' as const,
      label: $t('tasks.downloads'),
      icon: 'download' as const,
    },
    {
      key: 'uploads' as const,
      label: $t('tasks.uploads'),
      icon: 'upload' as const,
    },
  ]);

  const filters = $derived<Array<{ key: TaskFilter; label: string; count: number }>>([
    { key: 'all', label: $t('tasks.all'), count: currentTaskCount('all') },
    { key: 'pending', label: $t('tasks.pending'), count: currentTaskCount('pending') },
    { key: 'active', label: $t('tasks.inProgress'), count: currentTaskCount('active') },
    { key: 'paused', label: $t('tasks.paused'), count: currentTaskCount('paused') },
    { key: 'completed', label: $t('tasks.completed'), count: currentTaskCount('completed') },
    { key: 'failed', label: $t('tasks.failed'), count: currentTaskCount('failed') },
    { key: 'cancelled', label: $t('tasks.cancelled'), count: currentTaskCount('cancelled') },
  ]);

  const filteredDownloads = $derived(filterDownloadTasks([...downloadStore.tasks.values()], filter));
  const filteredUploads = $derived(filterUploadTasks(uploadStore.allTasks, filter));
  const currentFilterLabel = $derived(filters.find((f) => f.key === filter)?.label ?? filter);
  const visibleTaskCount = $derived(activeTab === 'downloads' ? filteredDownloads.length : filteredUploads.length);
  const emptyTitle = $derived(activeTab === 'downloads' ? $t('tasks.noDownloadTasks') : $t('tasks.noUploadTasks'));
  const completedOrCancelledCount = $derived(
    downloadStore.completedTasks.length
      + downloadStore.cancelledTasks.length
      + uploadStore.completedTasks.length
      + uploadStore.cancelledTasks.length,
  );
  const failedOrCancelledCount = $derived(
    downloadStore.failedTasks.length
      + downloadStore.cancelledTasks.length
      + uploadStore.failedTasks.length
      + uploadStore.cancelledTasks.length,
  );

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

  function switchTab(tab: TaskTab) {
    activeTab = tab;
  }

  function currentTaskCount(nextFilter: TaskFilter) {
    return activeTab === 'downloads'
      ? filterDownloadTasks([...downloadStore.tasks.values()], nextFilter).length
      : filterUploadTasks(uploadStore.allTasks, nextFilter).length;
  }

  function filterDownloadTasks(tasks: DownloadTaskDto[], nextFilter: TaskFilter) {
    if (nextFilter === 'all') return tasks;
    return tasks.filter((task) => downloadMatchesFilter(task, nextFilter));
  }

  function filterUploadTasks(tasks: UploadTaskDto[], nextFilter: TaskFilter) {
    if (nextFilter === 'all') return tasks;
    return tasks.filter((task) => uploadMatchesFilter(task, nextFilter));
  }

  function downloadMatchesFilter(task: DownloadTaskDto, nextFilter: TaskFilter) {
    if (nextFilter === 'pending') return task.status === 'pending' || task.status === 'scheduled';
    if (nextFilter === 'active') return ['downloading', 'decrypting', 'verifying'].includes(task.status);
    return task.status === nextFilter;
  }

  function uploadMatchesFilter(task: UploadTaskDto, nextFilter: TaskFilter) {
    if (nextFilter === 'active') return task.status === 'uploading';
    if (nextFilter === 'completed') return task.status === 'completed' || task.status === 'skipped';
    return task.status === nextFilter;
  }

  async function handleClearCompleted() {
    busy = true;
    try {
      await clearCompletedTasks();
      uploadStore.clearCompletedAndCancelled();
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
      uploadStore.clearFailedAndCancelled();
      await refresh();
    } finally {
      busy = false;
      menuOpen = false;
    }
  }

  async function handlePauseAll() {
    busy = true;
    try {
      for (const task of downloadStore.activeTasks) {
        if (['downloading', 'decrypting', 'verifying'].includes(task.status)) {
          await pauseDownload(task.task_id);
        }
      }
      for (const task of uploadStore.activeTasks) {
        await uploadStore.pause(task.upload_id);
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
      for (const task of [...downloadStore.tasks.values()]) {
        if (task.status === 'paused') {
          await resumeDownload(task.task_id);
        }
      }
      for (const task of uploadStore.pausedTasks) {
        await uploadStore.resume(task.upload_id);
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
      for (const task of downloadStore.activeTasks) {
        if (task.status === 'pending') {
          await cancelDownload(task.task_id);
        }
      }
      for (const task of uploadStore.activeTasks) {
        await uploadStore.cancel(task.upload_id);
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

  async function handlePauseUpload(uploadId: string) {
    await uploadStore.pause(uploadId);
  }

  async function handleResumeUpload(uploadId: string) {
    await uploadStore.resume(uploadId);
  }

  async function handleCancelUpload(uploadId: string) {
    await uploadStore.cancel(uploadId);
  }
</script>

<div class="min-w-0 space-y-4 p-4 sm:p-6">
  <div class="flex items-center justify-between gap-3">
    <div class="flex min-w-0 items-center gap-3">
      <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('tasks.title')}
      </h1>
      <button
        class="rounded-full p-1.5 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high"
        onclick={refresh}
        title={$t('common.refresh')}
      >
        <Icon name="refresh" size="20px" />
      </button>
    </div>

    <div class="relative">
      <button
        class="rounded-full p-1.5 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high"
        onclick={() => (menuOpen = !menuOpen)}
        title={$t('tasks.moreActions')}
      >
        <Icon name="moreVert" size="20px" />
      </button>

      {#if menuOpen}
        <div class="fixed inset-0 z-10" onclick={() => (menuOpen = false)} role="presentation"></div>
        <div class="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border border-md3-outline bg-md3-surface-container py-1 shadow-lg">
          <button class="task-menu-item text-md3-on-surface" onclick={handlePauseAll} disabled={busy}>
            <Icon name="pause" size="16px" /> {$t('tasks.pauseAll')}
          </button>
          <button class="task-menu-item text-md3-on-surface" onclick={handleResumeAll} disabled={busy}>
            <Icon name="resume" size="16px" /> {$t('tasks.resumeAllPaused')}
          </button>
          <button class="task-menu-item text-md3-on-surface" onclick={handleCancelPending} disabled={busy}>
            <Icon name="cancel" size="16px" /> {$t('tasks.cancelAllPending')}
          </button>
          <div class="my-1 border-t border-md3-outline"></div>
          <button class="task-menu-item text-md3-success" onclick={handleClearCompleted} disabled={busy || completedOrCancelledCount === 0}>
            <Icon name="clearAll" size="16px" /> {$t('tasks.clearCompleted')}
          </button>
          <button class="task-menu-item text-md3-error" onclick={handleClearFailed} disabled={busy || failedOrCancelledCount === 0}>
            <Icon name="deleteSweep" size="16px" /> {$t('tasks.clearFailed')}
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div class="task-tabs" role="tablist" aria-label={$t('tasks.title')}>
    {#each tabs as tab}
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === tab.key}
        class="task-tab"
        class:task-tab-active={activeTab === tab.key}
        onclick={() => switchTab(tab.key)}
      >
        <Icon name={tab.icon} size="18px" />
        <span>{tab.label}</span>
      </button>
    {/each}
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <span class="inline-flex items-center gap-1 text-xs font-semibold uppercase text-md3-on-surface-variant">
      <Icon name="filterList" size="16px" />
      {$t('files.filter')}
    </span>
    <div class="flex flex-wrap gap-1.5">
      {#each filters as f}
        <button
          class="rounded-full px-3.5 py-1.5 text-xs font-medium transition-all"
          class:bg-md3-primary={filter === f.key}
          class:text-md3-on-primary={filter === f.key}
          class:bg-md3-surface-container-high={filter !== f.key}
          class:text-md3-on-surface-variant={filter !== f.key}
          class:hover:bg-md3-surface-container-highest={filter !== f.key}
          style="font-family: var(--font-md3-sans);"
          onclick={() => (filter = f.key)}
        >
          {f.label}
          <span class="ml-1 opacity-60">({f.count})</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="grid gap-3">
    {#if activeTab === 'downloads'}
      {#if filteredDownloads.length > 0}
        {#each filteredDownloads as task (task.task_id)}
          <DownloadTaskCard task={task} onRemove={handleRemove} />
        {/each}
      {/if}
    {:else if filteredUploads.length > 0}
      {#each filteredUploads as task (task.upload_id)}
        <UploadTaskCard
          {task}
          onPause={handlePauseUpload}
          onResume={handleResumeUpload}
          onCancel={handleCancelUpload}
        />
      {/each}
    {/if}

    {#if visibleTaskCount === 0}
      <div class="rounded-xl border border-md3-outline bg-md3-surface-container/70 p-10 text-center backdrop-blur-sm">
        <span class="text-md3-on-surface-variant">
          <Icon name={activeTab === 'downloads' ? 'downloadDone' : 'upload'} size="64px" />
        </span>
        <p class="mt-3 text-md3-on-surface-variant" style="font-family: var(--font-md3-sans);">
          {filter === 'all' ? emptyTitle : $t('tasks.noTasksByStatus', { values: { status: currentFilterLabel } })}
        </p>
      </div>
    {/if}
  </div>
</div>

<style>
  .task-tabs {
    display: inline-flex;
    width: fit-content;
    max-width: 100%;
    gap: 0.35rem;
  }

  .task-tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border-radius: 0;
    padding: 0.35rem 0.45rem 0.5rem;
    color: var(--color-md3-on-surface-variant);
    background: transparent;
    font-family: var(--font-md3-sans);
    font-size: 0.875rem;
    font-weight: 600;
    transition:
      background-color 180ms var(--motion-easing-standard),
      color 180ms var(--motion-easing-standard),
      transform 180ms var(--motion-easing-standard);
  }

  .task-tab:hover {
    color: var(--color-md3-on-surface);
  }

  .task-tab-active {
    color: var(--color-md3-primary-emphasis);
  }

  .task-tab::after {
    content: "";
    position: absolute;
    right: 0.45rem;
    bottom: 0;
    left: 0.45rem;
    height: 2px;
    border-radius: 9999px;
    background: currentColor;
    opacity: 0;
    transform: scaleX(0.35);
    transition:
      opacity 160ms var(--motion-easing-standard),
      transform 200ms var(--motion-easing-emphasized-decelerate);
  }

  .task-tab-active::after {
    opacity: 1;
    transform: scaleX(1);
  }

  .task-menu-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    font-family: var(--font-md3-sans);
    font-size: 0.875rem;
    transition: background-color 160ms var(--motion-easing-standard);
  }

  .task-menu-item:hover:not(:disabled) {
    background: var(--color-md3-surface-container-high);
  }

  .task-menu-item:disabled {
    opacity: 0.5;
  }

  @media (max-width: 520px) {
    .task-tabs {
      width: 100%;
      justify-content: center;
    }

    .task-tab {
      flex: 0 1 auto;
    }
  }
</style>
