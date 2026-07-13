<script lang="ts">
  // Task manager page: upload/download tabs with a shared status filter.

  import { onMount, tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import type { DownloadTaskDto, UploadTaskDto } from '$lib/api';
  import { downloadStore, uploadStore } from '$lib/stores.svelte';
  import { getDownloadTasks, clearCompletedTasks, clearFailedTasks, pauseDownload, resumeDownload, retryDownload, cancelDownload, deleteDownload } from '$lib/api';
  import {
    downloadBatchSnapshots,
    pauseActiveDownloadBatches,
    resumeActiveDownloadBatches,
    stopActiveDownloadBatch,
  } from '$lib/download-batch-control';
  import DownloadTaskCard from '$lib/components/DownloadTaskCard.svelte';
  import DownloadTaskGroupHeader from '$lib/components/DownloadTaskGroupHeader.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import UploadTaskCard from '$lib/components/UploadTaskCard.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import VirtualList from '$lib/components/VirtualList.svelte';
  import { buildDownloadTaskRows, canDeleteDownloadTaskGroupFiles, isRunningDownloadTask, type DownloadTaskGroup, type DownloadTaskRow } from '$lib/download-task-groups';
  import type { ContextMenuItem } from '$lib/components/context-menu';
  import { focusRovingItem, keyboardMenuAnchor, registerKeyboardCommands } from '$lib/keyboard';

  type TaskTab = 'downloads' | 'uploads';
  type TaskFilter = 'all' | 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
  type DownloadTaskAction = 'pause' | 'resume' | 'retry' | 'cancel';
  type DownloadGroupAction = DownloadTaskAction | 'delete';
  type BatchDeleteProgress = { current: number; total: number };

  let activeTab = $state<TaskTab>('downloads');
  let filter = $state<TaskFilter>('all');
  let busy = $state(false);
  let menuOpen = $state(false);
  let taskMenuTrigger = $state<HTMLButtonElement | null>(null);
  let expandedDownloadGroups = $state<Set<string>>(new Set());
  let pendingDownloadTaskActions = $state<Map<string, DownloadTaskAction>>(new Map());
  let pendingDownloadGroupActions = $state<Map<string, DownloadGroupAction>>(new Map());
  let deletingDownloadGroups = $state<Map<string, BatchDeleteProgress>>(new Map());
  let contextMenu = $state<{
    open: boolean;
    x: number;
    y: number;
    target: { kind: 'download-task'; task: DownloadTaskDto } | { kind: 'download-group'; group: DownloadTaskGroup } | null;
    sourceElement: HTMLElement | null;
  }>({ open: false, x: 0, y: 0, target: null, sourceElement: null });
  const deleteProgressWriteTimes = new Map<string, number>();

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

  const filteredDownloads = $derived(sortTasksForDisplay(filterDownloadTasks([...downloadStore.tasks.values()], filter), isRunningDownload));
  const visibleActiveDownloadBatches = $derived(
    ['all', 'pending', 'active'].includes(filter) ? $downloadBatchSnapshots : [],
  );
  const downloadRows = $derived(buildDownloadTaskRows(filteredDownloads, expandedDownloadGroups, visibleActiveDownloadBatches));
  const filteredUploads = $derived(sortTasksForDisplay(filterUploadTasks(uploadStore.allTasks, filter), isRunningUpload));
  const contextMenuItems = $derived.by<ContextMenuItem[]>(() => getContextMenuItems());
  const currentFilterLabel = $derived(filters.find((f) => f.key === filter)?.label ?? filter);
  const visibleTaskCount = $derived(activeTab === 'downloads' ? downloadRows.length : filteredUploads.length);
  const emptyTitle = $derived(activeTab === 'downloads' ? $t('tasks.noDownloadTasks') : $t('tasks.noUploadTasks'));
  const completedOrCancelledCount = $derived(
    downloadStore.completedTasks.length
      + [...downloadStore.tasks.values()].filter((task) => task.status === 'deleted').length
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

  onMount(() => registerKeyboardCommands({
    id: 'tasks.refresh',
    label: () => $t('common.refresh'),
    group: () => $t('tasks.title'),
    shortcuts: [{ key: 'F5' }, { key: 'r', primary: true }],
    scope: 'page',
    enabled: () => !busy,
    handler: refresh,
  }));

  async function refresh() {
    try {
      const tasks = await getDownloadTasks();
      downloadStore.setAll(tasks);
    } catch { /* ignore */ }
  }

  function switchTab(tab: TaskTab) {
    activeTab = tab;
  }

  function handleTabKeydown(event: KeyboardEvent) {
    const next = focusRovingItem(event, event.currentTarget as HTMLElement, {
      selector: '[data-tab-item]',
      orientation: 'horizontal',
    });
    next?.click();
  }

  function handleFilterKeydown(event: KeyboardEvent) {
    const next = focusRovingItem(event, event.currentTarget as HTMLElement, {
      selector: '[data-filter-item]',
      orientation: 'both',
    });
    next?.click();
  }

  function toggleTaskMenu(focusFirst = false) {
    menuOpen = !menuOpen;
    if (menuOpen && focusFirst) {
      void tick().then(() => document.querySelector<HTMLElement>('[data-task-menu] [data-menu-item]:not(:disabled)')?.focus());
    }
  }

  function handleTaskMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      menuOpen = false;
      if (event.key === 'Escape') {
        event.preventDefault();
        taskMenuTrigger?.focus({ preventScroll: true });
      }
      return;
    }
    focusRovingItem(event, event.currentTarget as HTMLElement, {
      selector: '[data-menu-item]',
      orientation: 'vertical',
    });
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
    if (nextFilter === 'completed') return task.status === 'completed' || task.status === 'deleted';
    return task.status === nextFilter;
  }

  function uploadMatchesFilter(task: UploadTaskDto, nextFilter: TaskFilter) {
    if (nextFilter === 'active') return task.status === 'uploading';
    if (nextFilter === 'completed') return task.status === 'completed' || task.status === 'skipped';
    return task.status === nextFilter;
  }

  function sortTasksForDisplay<T>(tasks: T[], isRunning: (task: T) => boolean): T[] {
    const running: T[] = [];
    const rest: T[] = [];

    for (const task of tasks) {
      if (isRunning(task)) {
        running.push(task);
      } else {
        rest.push(task);
      }
    }

    return [...running, ...rest];
  }

  function isRunningDownload(task: DownloadTaskDto) {
    return isRunningDownloadTask(task);
  }

  function isRunningUpload(task: UploadTaskDto) {
    return task.status === 'uploading';
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
      pauseActiveDownloadBatches();
      for (const task of downloadStore.activeTasks) {
        const isPending = task.status === 'pending' || task.status === 'scheduled';
        const isRunning = task.status === 'downloading';
        if (isPending || (isRunning && task.supports_resume)) {
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
      resumeActiveDownloadBatches();
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

  function hideContextMenu() {
    contextMenu = { open: false, x: 0, y: 0, target: null, sourceElement: null };
  }

  function showDownloadTaskContextMenu(event: MouseEvent | KeyboardEvent, task: DownloadTaskDto) {
    event.preventDefault();
    contextMenu = { open: true, ...keyboardMenuAnchor(event), target: { kind: 'download-task', task } };
  }

  function showDownloadGroupContextMenu(event: MouseEvent | KeyboardEvent, group: DownloadTaskGroup) {
    event.preventDefault();
    contextMenu = { open: true, ...keyboardMenuAnchor(event), target: { kind: 'download-group', group } };
  }

  function getContextMenuItems(): ContextMenuItem[] {
    if (!contextMenu.target) return [];

    if (contextMenu.target.kind === 'download-group') {
      const group = contextMenu.target.group;
      return [
        {
          id: 'pause-download-group',
          label: $t('tasks.pause'),
          icon: 'pause',
          disabled: isDownloadGroupActionPending(group.id) || isDeletingDownloadGroup(group.id) || !canPauseDownloadGroup(group),
          onSelect: () => handlePauseDownloadGroup(group.id),
        },
        {
          id: 'resume-download-group',
          label: $t('tasks.resume'),
          icon: 'resume',
          disabled: isDownloadGroupActionPending(group.id) || isDeletingDownloadGroup(group.id) || !canResumeDownloadGroup(group),
          onSelect: () => handleResumeDownloadGroup(group.id),
        },
        {
          id: 'retry-download-group',
          label: $t('tasks.retryAction'),
          icon: 'restartAlt',
          disabled: isDownloadGroupActionPending(group.id) || isDeletingDownloadGroup(group.id) || !canRetryDownloadGroup(group),
          onSelect: () => handleRetryDownloadGroup(group.id),
        },
        {
          id: 'cancel-download-group',
          label: $t('tasks.cancel'),
          icon: 'cancel',
          disabled: isDownloadGroupActionPending(group.id) || isDeletingDownloadGroup(group.id) || !canCancelDownloadGroup(group),
          danger: true,
          onSelect: () => handleCancelDownloadGroup(group.id),
        },
        ...(canDeleteDownloadTaskGroupFiles(group)
          ? [
            { type: 'divider' as const },
            {
              id: 'delete-download-group-files',
              label: $t('tasks.deleteBatchFiles'),
              icon: 'delete' as const,
              disabled: isDownloadGroupActionPending(group.id) || isDeletingDownloadGroup(group.id),
              danger: true,
              onSelect: () => handleDeleteDownloadGroupFiles(group.id),
            },
          ]
          : []),
      ];
    }

    const task = contextMenu.target.task;
    return [
      {
        id: 'pause-download-task',
        label: $t('tasks.pause'),
        icon: 'pause',
        disabled: isDownloadTaskActionPending(task.task_id) || !canPauseDownloadTask(task),
        onSelect: () => handlePauseDownloadTask(task.task_id),
      },
      {
        id: 'resume-download-task',
        label: $t('tasks.resume'),
        icon: 'resume',
        disabled: isDownloadTaskActionPending(task.task_id) || !canResumeDownloadTask(task),
        onSelect: () => handleResumeDownloadTask(task.task_id),
      },
      {
        id: 'retry-download-task',
        label: $t('tasks.retryAction'),
        icon: 'restartAlt',
        disabled: isDownloadTaskActionPending(task.task_id) || !canRetryDownloadTask(task),
        onSelect: () => handleRetryDownloadTask(task.task_id),
      },
      {
        id: 'cancel-download-task',
        label: $t('tasks.cancel'),
        icon: 'cancel',
        disabled: isDownloadTaskActionPending(task.task_id) || !canCancelDownloadTask(task),
        danger: true,
        onSelect: () => handleCancelDownloadTask(task.task_id),
      },
    ];
  }

  function handleRemove(taskId: string) {
    downloadStore.remove(taskId);
    refresh();
  }

  function toggleDownloadGroup(groupId: string) {
    const next = new Set(expandedDownloadGroups);
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    expandedDownloadGroups = next;
  }

  function getDownloadGroupTasks(groupId: string) {
    return [...downloadStore.tasks.values()].filter((task) => task.batch_id === groupId);
  }

  function isDeletingDownloadGroup(groupId: string) {
    return deletingDownloadGroups.has(groupId);
  }

  function isDownloadTaskActionPending(taskId: string) {
    return pendingDownloadTaskActions.has(taskId);
  }

  function getPendingDownloadTaskAction(taskId: string) {
    return pendingDownloadTaskActions.get(taskId) ?? null;
  }

  function isDownloadGroupActionPending(groupId: string) {
    return pendingDownloadGroupActions.has(groupId);
  }

  function getPendingDownloadGroupAction(groupId: string) {
    return pendingDownloadGroupActions.get(groupId) ?? null;
  }

  function setPendingDownloadTaskAction(taskId: string, action: DownloadTaskAction | null) {
    const next = new Map(pendingDownloadTaskActions);
    if (action) {
      next.set(taskId, action);
    } else {
      next.delete(taskId);
    }
    pendingDownloadTaskActions = next;
  }

  function setPendingDownloadGroupAction(groupId: string, action: DownloadGroupAction | null) {
    const next = new Map(pendingDownloadGroupActions);
    if (action) {
      next.set(groupId, action);
    } else {
      next.delete(groupId);
    }
    pendingDownloadGroupActions = next;
  }

  async function runDownloadTaskAction(
    taskId: string,
    action: DownloadTaskAction,
    runner: () => Promise<void>,
  ) {
    if (isDownloadTaskActionPending(taskId)) return;

    setPendingDownloadTaskAction(taskId, action);
    try {
      await runner();
    } finally {
      setPendingDownloadTaskAction(taskId, null);
    }
  }

  async function runDownloadGroupAction(
    groupId: string,
    action: DownloadGroupAction,
    runner: () => Promise<void>,
  ) {
    if (isDownloadGroupActionPending(groupId) || isDeletingDownloadGroup(groupId)) return;

    setPendingDownloadGroupAction(groupId, action);
    try {
      await runner();
    } finally {
      setPendingDownloadGroupAction(groupId, null);
    }
  }

  function getDeletingDownloadGroupProgress(groupId: string) {
    return deletingDownloadGroups.get(groupId) ?? null;
  }

  function setDeletingDownloadGroupProgress(
    groupId: string,
    current: number,
    total: number,
    force = false,
  ) {
    const now = performance.now();
    const lastWrite = deleteProgressWriteTimes.get(groupId) ?? 0;
    if (!force && current < total && now - lastWrite < 80) return;

    deleteProgressWriteTimes.set(groupId, now);
    const next = new Map(deletingDownloadGroups);
    next.set(groupId, { current, total });
    deletingDownloadGroups = next;
  }

  function clearDeletingDownloadGroupProgress(groupId: string) {
    deleteProgressWriteTimes.delete(groupId);
    const next = new Map(deletingDownloadGroups);
    next.delete(groupId);
    deletingDownloadGroups = next;
  }

  function canPauseDownloadTask(task: DownloadTaskDto) {
    return task.status === 'pending'
      || task.status === 'scheduled'
      || (task.status === 'downloading' && task.supports_resume);
  }

  function canResumeDownloadTask(task: DownloadTaskDto) {
    return task.status === 'paused';
  }

  function canRetryDownloadTask(task: DownloadTaskDto) {
    return task.status === 'failed';
  }

  function canCancelDownloadTask(task: DownloadTaskDto) {
    return ['pending', 'scheduled', 'downloading', 'decrypting', 'verifying', 'paused'].includes(task.status);
  }

  function canPauseDownloadGroup(group: DownloadTaskGroup) {
    return (group.preparing && !group.batchPaused) || group.tasks.some(canPauseDownloadTask);
  }

  function canResumeDownloadGroup(group: DownloadTaskGroup) {
    return group.batchPaused || group.paused > 0;
  }

  function canRetryDownloadGroup(group: DownloadTaskGroup) {
    return group.failed > 0;
  }

  function canCancelDownloadGroup(group: DownloadTaskGroup) {
    return group.preparing || group.tasks.some(canCancelDownloadTask);
  }

  async function handlePauseDownloadTask(taskId: string) {
    await runDownloadTaskAction(taskId, 'pause', async () => {
      await pauseDownload(taskId);
      await refresh();
    });
  }

  async function handleResumeDownloadTask(taskId: string) {
    await runDownloadTaskAction(taskId, 'resume', async () => {
      await resumeDownload(taskId);
      await refresh();
    });
  }

  async function handleRetryDownloadTask(taskId: string) {
    await runDownloadTaskAction(taskId, 'retry', async () => {
      await retryDownload(taskId);
      await refresh();
    });
  }

  async function handleCancelDownloadTask(taskId: string) {
    await runDownloadTaskAction(taskId, 'cancel', async () => {
      await cancelDownload(taskId);
      await refresh();
    });
  }

  async function handlePauseDownloadGroup(groupId: string) {
    await runDownloadGroupAction(groupId, 'pause', async () => {
      pauseActiveDownloadBatches(groupId);
      for (const task of getDownloadGroupTasks(groupId)) {
        if (canPauseDownloadTask(task)) {
          await pauseDownload(task.task_id);
        }
      }
      await refresh();
    });
  }

  async function handleResumeDownloadGroup(groupId: string) {
    await runDownloadGroupAction(groupId, 'resume', async () => {
      resumeActiveDownloadBatches(groupId);
      for (const task of getDownloadGroupTasks(groupId)) {
        if (task.status === 'paused') {
          await resumeDownload(task.task_id);
        }
      }
      await refresh();
    });
  }

  async function handleRetryDownloadGroup(groupId: string) {
    await runDownloadGroupAction(groupId, 'retry', async () => {
      for (const task of getDownloadGroupTasks(groupId)) {
        if (task.status === 'failed') {
          await retryDownload(task.task_id);
        }
      }
      await refresh();
    });
  }

  async function handleCancelDownloadGroup(groupId: string) {
    await runDownloadGroupAction(groupId, 'cancel', async () => {
      stopActiveDownloadBatch(groupId);
      for (const task of getDownloadGroupTasks(groupId)) {
        if (canCancelDownloadTask(task)) {
          await cancelDownload(task.task_id);
        }
      }
      await refresh();
    });
  }

  async function handleDeleteDownloadGroupFiles(groupId: string) {
    if (isDownloadGroupActionPending(groupId) || isDeletingDownloadGroup(groupId)) return;

    const group = downloadRows.find(
      (row): row is Extract<DownloadTaskRow, { kind: 'group' }> =>
        row.kind === 'group' && row.group.id === groupId,
    )?.group;
    if (!group || !canDeleteDownloadTaskGroupFiles(group)) return;

    setPendingDownloadGroupAction(groupId, 'delete');
    stopActiveDownloadBatch(groupId);
    const tasks = getDownloadGroupTasks(groupId);
    const total = tasks.length;
    setDeletingDownloadGroupProgress(groupId, 0, total, true);

    try {
      for (const [index, task] of tasks.entries()) {
        if (canCancelDownloadTask(task)) {
          await cancelDownload(task.task_id);
        }
        await deleteDownload(task.task_id);
        setDeletingDownloadGroupProgress(groupId, index + 1, total);
      }

      expandedDownloadGroups = withoutExpandedGroup(expandedDownloadGroups, groupId);
      await refresh();
    } finally {
      setPendingDownloadGroupAction(groupId, null);
      clearDeletingDownloadGroupProgress(groupId);
    }
  }

  function withoutExpandedGroup(groups: Set<string>, groupId: string) {
    const next = new Set(groups);
    next.delete(groupId);
    return next;
  }

  function downloadRowKey(row: DownloadTaskRow) {
    if (row.kind === 'task') return `task:${row.task.task_id}`;
    if (row.kind === 'group-task') return `group-task:${row.group.id}:${row.task.task_id}`;
    return `group:${row.group.id}`;
  }

  function estimateDownloadRowSize(index: number) {
    const row = downloadRows[index];
    if (!row) return 190;
    if (row.kind === 'group') return 150;
    return 190;
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

<div class="workspace-page min-w-0 space-y-4 p-4 sm:p-6">
  <div class="flex items-center justify-between gap-3">
    <div class="flex min-w-0 items-center gap-3">
      <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('tasks.title')}
      </h1>
      <button
        bind:this={taskMenuTrigger}
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
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onclick={() => toggleTaskMenu(true)}
        onkeydown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!menuOpen) toggleTaskMenu(true);
          }
        }}
        title={$t('tasks.moreActions')}
      >
        <Icon name="moreVert" size="20px" />
      </button>

      {#if menuOpen}
        <div class="fixed inset-0 z-10" onclick={() => (menuOpen = false)} role="presentation"></div>
        <div data-task-menu tabindex="-1" class="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border border-md3-outline bg-md3-surface-container py-1 shadow-lg" role="menu" onkeydown={handleTaskMenuKeydown}>
          <button data-menu-item tabindex="0" role="menuitem" class="task-menu-item text-md3-on-surface" onclick={handlePauseAll} disabled={busy}>
            <Icon name="pause" size="16px" /> {$t('tasks.pauseAll')}
          </button>
          <button data-menu-item tabindex="-1" role="menuitem" class="task-menu-item text-md3-on-surface" onclick={handleResumeAll} disabled={busy}>
            <Icon name="resume" size="16px" /> {$t('tasks.resumeAllPaused')}
          </button>
          <button data-menu-item tabindex="-1" role="menuitem" class="task-menu-item text-md3-on-surface" onclick={handleCancelPending} disabled={busy}>
            <Icon name="cancel" size="16px" /> {$t('tasks.cancelAllPending')}
          </button>
          <div class="my-1 border-t border-md3-outline"></div>
          <button data-menu-item tabindex="-1" role="menuitem" class="task-menu-item text-md3-success" onclick={handleClearCompleted} disabled={busy || completedOrCancelledCount === 0}>
            <Icon name="clearAll" size="16px" /> {$t('tasks.clearCompleted')}
          </button>
          <button data-menu-item tabindex="-1" role="menuitem" class="task-menu-item text-md3-error" onclick={handleClearFailed} disabled={busy || failedOrCancelledCount === 0}>
            <Icon name="deleteSweep" size="16px" /> {$t('tasks.clearFailed')}
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div class="task-tabs" role="tablist" tabindex="-1" aria-label={$t('tasks.title')} onkeydown={handleTabKeydown}>
    {#each tabs as tab}
      <button
        data-tab-item
        type="button"
        role="tab"
        aria-selected={activeTab === tab.key}
        tabindex={activeTab === tab.key ? 0 : -1}
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
    <div class="flex flex-wrap gap-1.5" role="toolbar" tabindex="-1" aria-label={$t('files.filter')} onkeydown={handleFilterKeydown}>
      {#each filters as f}
        <button
          data-filter-item
          tabindex={filter === f.key ? 0 : -1}
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

  <div>
    {#if activeTab === 'downloads'}
      {#if downloadRows.length > 0}
        <VirtualList
          items={downloadRows}
          keyOf={(row) => downloadRowKey(row)}
          estimateSize={estimateDownloadRowSize}
          gap={12}
          overscan={5}
          threshold={24}
          resetKey={`${activeTab}:${filter}`}
          viewportClass="task-list-viewport"
          contentClass="task-list-content"
          itemClass="task-list-item"
          keyboardNavigation
          keyboardTargetSelector="button"
        >
          {#snippet children(row)}
            {#if row.kind === 'group'}
              <DownloadTaskGroupHeader
                group={row.group}
                expanded={expandedDownloadGroups.has(row.group.id)}
                onToggle={toggleDownloadGroup}
                onPause={handlePauseDownloadGroup}
                onResume={handleResumeDownloadGroup}
                onRetry={handleRetryDownloadGroup}
                onCancel={handleCancelDownloadGroup}
                onDeleteFiles={handleDeleteDownloadGroupFiles}
                deleting={getDeletingDownloadGroupProgress(row.group.id)}
                pendingAction={getPendingDownloadGroupAction(row.group.id)}
                onContextMenu={showDownloadGroupContextMenu}
              />
            {:else if row.kind === 'group-task'}
              <div class="task-group-child">
                <DownloadTaskCard
                  task={row.task}
                  onRemove={handleRemove}
                  onPause={handlePauseDownloadTask}
                  onResume={handleResumeDownloadTask}
                  onRetry={handleRetryDownloadTask}
                  onCancel={handleCancelDownloadTask}
                  pendingAction={getPendingDownloadTaskAction(row.task.task_id)}
                  onContextMenu={showDownloadTaskContextMenu}
                />
              </div>
            {:else}
              <DownloadTaskCard
                task={row.task}
                onRemove={handleRemove}
                onPause={handlePauseDownloadTask}
                onResume={handleResumeDownloadTask}
                onRetry={handleRetryDownloadTask}
                onCancel={handleCancelDownloadTask}
                pendingAction={getPendingDownloadTaskAction(row.task.task_id)}
                onContextMenu={showDownloadTaskContextMenu}
              />
            {/if}
          {/snippet}
        </VirtualList>
      {/if}
    {:else if filteredUploads.length > 0}
      <VirtualList
        items={filteredUploads}
        keyOf={(task) => task.upload_id}
        estimateSize={148}
        gap={12}
        overscan={6}
        threshold={28}
        resetKey={`${activeTab}:${filter}`}
        viewportClass="task-list-viewport"
        contentClass="task-list-content"
        itemClass="task-list-item"
        keyboardNavigation
        keyboardTargetSelector="button"
      >
        {#snippet children(task)}
          <UploadTaskCard
            {task}
            onPause={handlePauseUpload}
            onResume={handleResumeUpload}
            onCancel={handleCancelUpload}
          />
        {/snippet}
      </VirtualList>
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

<ContextMenu
  open={contextMenu.open}
  x={contextMenu.x}
  y={contextMenu.y}
  items={contextMenuItems}
  sourceElement={contextMenu.sourceElement}
  onClose={hideContextMenu}
/>

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

  :global(.task-list-viewport) {
    max-height: calc(100vh - 17rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  :global(.task-list-content) {
    display: grid;
    gap: 0.75rem;
  }

  .task-group-child {
    min-width: 0;
    border-left: 2px solid color-mix(in srgb, var(--color-md3-primary) 35%, transparent);
    padding-left: 1rem;
    animation: task-group-child-in 180ms var(--motion-easing-emphasized-decelerate) both;
  }

  @keyframes task-group-child-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 520px) {
    .task-tabs {
      width: 100%;
      justify-content: center;
    }

    .task-tab {
      flex: 0 1 auto;
    }

    :global(.task-list-viewport) {
      max-height: calc(100vh - 19rem);
    }

    .task-group-child {
      padding-left: 0.65rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .task-group-child {
      animation: none;
    }
  }
</style>
