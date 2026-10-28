<script lang="ts">
  import FluentButton from '$lib/components/FluentButton.svelte';
  import { onMount, untrack } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { _ as t } from 'svelte-i18n';
  import type { DownloadTaskDto, UploadTaskDto, TransferControlAction, BatchActionResult } from '$lib/api';
  import {
    cancelDownload, controlTransferTasks, deleteDownloadedFiles, getDownloadTasks, getUploadTasks,
    getDocument, getDocumentInfo, openDownloadedFile, pauseDownload, removeTransferRecords,
    resumeDownload, retryDownload, retryUploadTask,
  } from '$lib/api';
  import { formatUserFacingError } from '$lib/user-facing-errors';
  import { dialogStore } from '$lib/dialogs.svelte';
  import { downloadStore, notificationStore, uploadStore } from '$lib/stores.svelte';
  import { downloadBatchSnapshots, pauseActiveDownloadBatches, resumeActiveDownloadBatches, stopDownloadBatchAndWait } from '$lib/download-batch-control';
  import {
    buildDownloadTaskRows,
    type DownloadTaskRow,
  } from '$lib/download-task-groups';
  import {
    TRANSFER_SECTION_ORDER, downloadSection, matchesTransferQuery,
    uploadSection, type TransferSectionFilter, type TransferSectionKey,
  } from '$lib/transfer-task-view';
  import { registerKeyboardCommands } from '$lib/keyboard';
  import { pickDirectory } from '$lib/directory-picker';
  import { flyScale } from '$lib/motion/transitions';
  import VirtualList from '$lib/components/VirtualList.svelte';
  import DownloadTaskCard from '$lib/components/DownloadTaskCard.svelte';
  import DownloadTaskGroupHeader from '$lib/components/DownloadTaskGroupHeader.svelte';
  import DocumentIdDownloadDialog from '$lib/components/DocumentIdDownloadDialog.svelte';
  import UploadTaskCard from '$lib/components/UploadTaskCard.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MdCheckbox from '$lib/components/MdCheckbox.svelte';
  import UploadTaskGroupHeader from '$lib/components/UploadTaskGroupHeader.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import type { ContextMenuItem } from '$lib/components/context-menu';
  import { buildUploadTaskRows, canControlTransfer, matchesCleanup, transferId, type UploadTaskGroup, type CleanupKind, type TransferTask } from '$lib/transfer-batches';
  import TaskActionButton from '$lib/components/TaskActionButton.svelte';
  import { TRANSFER_ACTIONS, transferControlMenu, transferCleanupMenu } from '$lib/transfer-actions';

  type TaskTab = 'downloads' | 'uploads';
  type GroupAction = 'pause' | 'resume' | 'retry' | 'cancel' | 'delete' | 'remove';
  type DownloadPageRow = { kind: 'download'; row: DownloadTaskRow };
  type UploadPageRow =
    | { kind: 'upload'; task: UploadTaskDto; groupId?: string }
    | { kind: 'upload-group'; group: UploadTaskGroup };

  let activeTab = $state<TaskTab>('downloads');
  let searchQuery = $state('');
  let sectionFilter = $state<TransferSectionFilter>('all');
  let loading = $state(false);
  let errorMessage = $state('');
  let expandedGroups = $state(new Set<string>());
  let pendingDownloadActions = $state(new Set<string>());
  let pendingUploadActions = $state(new Set<string>());
  let pendingGroupActions = $state(new Map<string, GroupAction>());
  let directDownloadOpen = $state(false);
  let directDownloadBusy = $state(false);
  let directDownloadError = $state('');
  let selectedIds = $state(new Set<string>());
  let selectedBatches = $state(new Set<string>());
  let bulkBusy = $state(false);
  let bulkResult = $state<{ succeeded: number; failed: Array<{ name: string; error: string }> } | null>(null);
  let cleanupMenu = $state({ open: false, x: 0, y: 0, source: null as HTMLElement | null });
  $effect(() => {
    activeTab; searchQuery; sectionFilter;
    untrack(() => {
      selectedIds = new Set();
      selectedBatches = new Set();
      cleanupMenu.open = false;
    });
  });

  const downloadTasks = $derived([...downloadStore.tasks.values()]);
  const uploadTasks = $derived(uploadStore.allTasks);
  const visibleDownloads = $derived(downloadTasks.filter((task) => matchesTransferQuery(task, searchQuery) && (sectionFilter === 'all' || downloadSection(task) === sectionFilter)));
  const visibleUploads = $derived(uploadTasks.filter((task) => matchesTransferQuery(task, searchQuery) && (sectionFilter === 'all' || uploadSection(task) === sectionFilter)));
  const visibleTasks = $derived<TransferTask[]>(activeTab === 'downloads' ? visibleDownloads : visibleUploads);
  const scopeTasks = $derived(selectedIds.size ? visibleTasks.filter(task => selectedIds.has(transferId(task))) : visibleTasks);
  const allSelected = $derived(visibleTasks.length > 0 && visibleTasks.every(task => selectedIds.has(transferId(task))));
  const someSelected = $derived(visibleTasks.some(task => selectedIds.has(transferId(task))));
  $effect(() => {
    const visibleIds = new Set(visibleTasks.map(transferId));
    untrack(() => {
      if ([...selectedIds].some(id => !visibleIds.has(id))) {
        selectedIds = new Set([...selectedIds].filter(id => visibleIds.has(id)));
      }
    });
  });
  const cleanupItems = $derived<ContextMenuItem[]>([
    ...transferControlMenu({ count: controlCount, run: runBulkControl, translate: $t, busy: bulkBusy }),
    ...transferCleanupMenu({ count: kind => kind === 'active' ? controlCount('cancel_and_remove') : scopeTasks.filter(task => matchesCleanup(task, kind)).length,
      run: runCleanup, translate: $t, busy: bulkBusy }),
  ]);
  const moreScopeLabel = $derived($t(selectedIds.size ? 'tasks.moreSelectedActions' : 'tasks.moreFilteredActions', { values: { count: scopeTasks.length } }));
  const downloadRows = $derived.by(() => buildDownloadPageRows());
  const uploadRows = $derived.by(() => buildUploadPageRows());
  const currentRows = $derived(activeTab === 'downloads' ? downloadRows : uploadRows);
  const activeCount = $derived(activeTab === 'downloads'
    ? visibleDownloads.filter((task) => downloadSection(task) === 'active').length
    : visibleUploads.filter((task) => uploadSection(task) === 'active').length);
  const attentionCount = $derived(activeTab === 'downloads'
    ? visibleDownloads.filter((task) => downloadSection(task) === 'attention').length
    : visibleUploads.filter((task) => uploadSection(task) === 'attention').length);

  onMount(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'uploads') activeTab = 'uploads';
    void refresh();
    return registerKeyboardCommands({
      id: 'tasks.refresh', label: () => $t('common.refresh'), group: () => $t('tasks.title'),
      shortcuts: [{ key: 'F5' }, { key: 'r', primary: true }], scope: 'page',
      enabled: () => !loading && !bulkBusy, handler: refresh,
    });
  });

  async function refresh() {
    if (bulkBusy) return;
    loading = true;
    errorMessage = '';
    try {
      const [downloads, uploads] = await Promise.all([getDownloadTasks(), getUploadTasks()]);
      downloadStore.setAll(downloads);
      uploadStore.setAll(uploads);
    } catch (error) {
      errorMessage = formatError(error);
    } finally {
      loading = false;
    }
  }

  function buildDownloadPageRows(): DownloadPageRow[] {
    const visible = new Set(visibleDownloads.map(t => t.task_id));
    const expanded = searchQuery.trim() ? new Set(downloadTasks.map(t => t.batch_id ?? '')) : expandedGroups;
    return buildDownloadTaskRows(downloadTasks, expanded, $downloadBatchSnapshots).flatMap((row): DownloadPageRow[] => {
      if (row.kind === 'group') {
        const matching = row.group.tasks.filter(t => visible.has(t.task_id));
        const nameMatches = row.group.name.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase());
        if (!matching.length && !(row.group.preparing && nameMatches && ['all', 'active'].includes(sectionFilter))) return [];
        return [{ kind: 'download', row: { ...row, group: { ...row.group, tasks: matching } } }];
      }
      return visible.has(row.task.task_id) ? [{ kind: 'download', row }] : [];
    });
  }

  function buildUploadPageRows(): UploadPageRow[] {
    return buildUploadTaskRows(uploadTasks, expandedGroups, searchQuery, sectionFilter).map(row => row.kind === 'group'
      ? { kind: 'upload-group', group: row.group }
      : { kind: 'upload', task: row.task, groupId: row.groupId });
  }

  function selectTasks(tasks: TransferTask[], checked: boolean) {
    const next = new Set(selectedIds);
    for (const task of tasks) checked ? next.add(transferId(task)) : next.delete(transferId(task));
    selectedIds = next;
    if (!checked) selectedBatches = new Set([...selectedBatches].filter(id => !tasks.some(task => task.batch_id === id)));
  }
  function selectBatch(id: string, tasks: TransferTask[], checked: boolean) {
    selectTasks(tasks, checked);
    const next = new Set(selectedBatches);
    checked ? next.add(id) : next.delete(id);
    selectedBatches = next;
  }
  function selectMatching(checked: boolean) {
    selectTasks(visibleTasks, checked);
    selectedBatches = checked && !searchQuery.trim() && sectionFilter === 'all'
      ? new Set(visibleTasks.map(task => task.batch_id).filter((id): id is string => Boolean(id))) : new Set();
  }
  function groupSelected(tasks: TransferTask[]) { return tasks.length > 0 && tasks.every(t => selectedIds.has(transferId(t))); }
  function groupMixed(tasks: TransferTask[]) { return !groupSelected(tasks) && tasks.some(t => selectedIds.has(transferId(t))); }

  function openCleanupMenu(event: MouseEvent) {
    const source = event.currentTarget as HTMLElement;
    const rect = source.getBoundingClientRect();
    cleanupMenu = { open: true, x: rect.left, y: rect.bottom, source };
  }

  function producerBatches(tasks = scopeTasks) {
    if (activeTab !== 'downloads' || searchQuery.trim() || sectionFilter !== 'all') return [];
    if (selectedIds.size) return [...selectedBatches];
    const ids = new Set(tasks.filter((t): t is DownloadTaskDto => !('upload_id' in t)).map(t => t.batch_id).filter((id): id is string => Boolean(id)));
    if (tasks === scopeTasks) for (const batch of $downloadBatchSnapshots) ids.add(batch.batchId);
    return [...ids];
  }
  function controlCount(action: TransferControlAction) {
    const taskCount = scopeTasks.filter(t => canControlTransfer(t, action)).length;
    const live = $downloadBatchSnapshots.filter(b => action !== 'retry' && producerBatches().includes(b.batchId)
      && (action !== 'pause' || !b.paused) && (action !== 'resume' || b.paused));
    return taskCount + live.length;
  }

  async function runBulkControl(action: TransferControlAction, tasks = scopeTasks, explicitBatch?: string) {
    if (bulkBusy) return;
    const direction = activeTab === 'uploads' ? 'upload' : 'download';
    const targets = tasks.filter(task => canControlTransfer(task, action));
    const batches = explicitBatch && !searchQuery.trim() && sectionFilter === 'all'
      ? [explicitBatch] : producerBatches(tasks);
    if (!targets.length && !batches.length) return;
    bulkBusy = true;
    bulkResult = null;
    try {
      if (action === 'cancel_and_remove' && !await dialogStore.confirm({
        title: $t('tasks.stopAndClearTitle'),
        message: $t('tasks.stopAndClearConfirm', { values: { count: targets.length } }),
        confirmLabel: $t('tasks.cleanup.active'), cancelLabel: $t('common.cancel'), danger: true,
      })) return;
      for (const id of batches) {
        if (action === 'pause') pauseActiveDownloadBatches(id);
        if (action === 'resume') resumeActiveDownloadBatches(id);
      }
      const cancelling = action === 'cancel' || action === 'cancel_and_remove';
      const stopping = cancelling ? batches.map(id => stopDownloadBatchAndWait(id)) : [];
      const request = batches.length && cancelling
        ? controlTransferTasks(direction, targets.map(transferId), action, batches)
        : controlTransferTasks(direction, targets.map(transferId), action);
      const [operation, ...producers] = await Promise.allSettled([request, ...stopping]);
      if (operation.status === 'rejected') throw operation.reason;
      const result = operation.value as BatchActionResult;
      if (action === 'cancel_and_remove') removeSucceeded(result);
      const producerErrors = producers.flatMap((producer, i) => producer.status === 'rejected'
        ? [{ name: $downloadBatchSnapshots.find(b => b.batchId === batches[i])?.batchName ?? batches[i], error: formatUserFacingError(producer.reason) }] : []);
      reportBulkResult(result, tasks, producerErrors);
      await (direction === 'upload' ? refreshUploads() : refreshDownloads());
    } catch (error) { errorMessage = formatUserFacingError(error); }
    finally { bulkBusy = false; }
  }

  async function runCleanup(kind: CleanupKind, tasks = scopeTasks) {
    if (kind === 'active') return runBulkControl('cancel_and_remove', tasks);
    if (bulkBusy) return;
    const targets = tasks.filter(t => matchesCleanup(t, kind));
    if (!targets.length) return;
    bulkBusy = true;
    bulkResult = null;
    try {
      const result = await removeTransferRecords(activeTab === 'uploads' ? 'upload' : 'download', targets.map(transferId));
      removeSucceeded(result);
      reportBulkResult(result, targets);
    } catch (error) { errorMessage = formatUserFacingError(error); }
    finally { bulkBusy = false; }
  }

  function removeSucceeded(result: BatchActionResult) {
    const next = new Set(selectedIds);
    for (const id of result.succeeded) {
      if (activeTab === 'uploads') uploadStore.remove(id); else downloadStore.remove(id);
      next.delete(id);
    }
    selectedIds = next;
  }
  function reportBulkResult(result: BatchActionResult, tasks: TransferTask[], extra: Array<{ name: string; error: string }> = []) {
    bulkResult = { succeeded: result.succeeded.length, failed: result.failed.map(item => {
      const task = tasks.find(t => transferId(t) === item.id);
      return { name: task ? ('file_name' in task ? task.file_name : task.filename) : item.id, error: formatUserFacingError(item.error) };
    }).concat(extra) };
  }

  function sectionLabel(section: TransferSectionKey) {
    return $t(`tasks.sections.${section}`);
  }

  function toggleGroup(groupId: string) {
    const next = new Set(expandedGroups);
    next.has(groupId) ? next.delete(groupId) : next.add(groupId);
    expandedGroups = next;
  }

  async function runDownload(id: string, action: () => Promise<unknown>, refreshAfter = true) {
    pendingDownloadActions = new Set(pendingDownloadActions).add(id);
    errorMessage = '';
    try { await action(); if (refreshAfter) await refreshDownloads(); }
    catch (error) { errorMessage = formatError(error); }
    finally { const next = new Set(pendingDownloadActions); next.delete(id); pendingDownloadActions = next; }
  }

  async function refreshDownloads() {
    downloadStore.setAll(await getDownloadTasks());
  }

  async function refreshUploads() {
    uploadStore.setAll(await getUploadTasks());
  }

  function openDirectDownloadDialog() {
    directDownloadError = '';
    directDownloadOpen = true;
  }

  function closeDirectDownloadDialog() {
    if (directDownloadBusy) return;
    directDownloadOpen = false;
    directDownloadError = '';
  }

  async function handleDirectDownload(documentId: string) {
    if (directDownloadBusy) return;
    directDownloadBusy = true;
    directDownloadError = '';

    try {
      const info = await getDocumentInfo(documentId);
      const filename = info.title?.trim();
      if (!filename) {
        directDownloadError = $t('tasks.downloadByIdMissingTitle');
        return;
      }

      await getDocument(documentId, filename);
      directDownloadOpen = false;
      activeTab = 'downloads';
      searchQuery = '';
      sectionFilter = 'all';
      notificationStore.success($t('tasks.downloadByIdQueued', { values: { name: filename } }));

      void refreshDownloads().catch((error) => {
        errorMessage = formatUserFacingError(error);
      });
    } catch (error) {
      directDownloadError = formatUserFacingError(error);
    } finally {
      directDownloadBusy = false;
    }
  }

  async function handleOpen(id: string) { await runDownload(id, () => openDownloadedFile(id)); }
  async function handlePause(id: string) { await runDownload(id, () => pauseDownload(id)); }
  async function handleResume(id: string) { await runDownload(id, () => resumeDownload(id)); }
  async function handleRetry(id: string) { await runDownload(id, () => retryDownload(id)); }
  async function handleCancel(id: string) { await runDownload(id, () => cancelDownload(id)); }
  async function handleRemoveDownload(id: string) {
    await runDownload(id, async () => {
      const result = await removeTransferRecords('download', [id]);
      if (result.failed.length) throw new Error(result.failed[0].error);
      downloadStore.remove(id);
    }, false);
  }
  async function handleDeleteFile(id: string) {
    if (!window.confirm($t('tasks.deleteLocalFileConfirm'))) return;
    await runDownload(id, async () => {
      const result = await deleteDownloadedFiles([id]);
      if (result.failed.length) throw new Error(result.failed[0].error);
    });
  }

  async function runUpload(id: string, action: () => Promise<unknown>, refreshAfter = true) {
    pendingUploadActions = new Set(pendingUploadActions).add(id);
    errorMessage = '';
    try { await action(); if (refreshAfter) await refreshUploads(); }
    catch (error) { errorMessage = formatError(error); }
    finally { const next = new Set(pendingUploadActions); next.delete(id); pendingUploadActions = next; }
  }
  async function handlePauseUpload(id: string) { await runUpload(id, () => uploadStore.pause(id)); }
  async function handleResumeUpload(id: string) { await runUpload(id, () => uploadStore.resume(id)); }
  async function handleCancelUpload(id: string) { await runUpload(id, () => uploadStore.cancel(id)); }
  async function handleRestartUpload(id: string) {
    await runUpload(id, async () => {
      await retryUploadTask(id);
      await refreshUploads();
    }, false);
  }
  async function handleReselectUpload(id: string) {
    const task = uploadStore.tasks.get(id);
    if (!task) return;
    await runUpload(id, async () => {
      let sourcePath: string | null = null;
      if (task.kind === 'directory') {
        const selected = await pickDirectory({ title: $t('files.selectFolderToUpload') });
        sourcePath = selected?.path ?? null;
      } else {
        const selected = await open({
          multiple: false,
          directory: false,
          pickerMode: 'document',
          fileAccessMode: 'scoped',
          title: $t('files.selectFilesToUpload'),
        });
        sourcePath = typeof selected === 'string' ? selected : null;
      }
      if (!sourcePath) return;
      await retryUploadTask(id, sourcePath);
      await refreshUploads();
    }, false);
  }
  async function handleRemoveUpload(id: string) {
    await runUpload(id, async () => {
      const result = await removeTransferRecords('upload', [id]);
      if (result.failed.length) throw new Error(result.failed[0].error);
      uploadStore.remove(id);
    }, false);
  }

  function groupTasks(groupId: string) { return visibleDownloads.filter((task) => task.batch_id === groupId); }
  async function runGroup(groupId: string, actionName: GroupAction, action: () => Promise<void>) {
    pendingGroupActions = new Map(pendingGroupActions).set(groupId, actionName);
    try { await action(); await refreshDownloads(); }
    catch (error) { errorMessage = formatError(error); }
    finally { const next = new Map(pendingGroupActions); next.delete(groupId); pendingGroupActions = next; }
  }
  async function handlePauseGroup(id: string) { await runBulkControl('pause', groupTasks(id), id); }
  async function handleResumeGroup(id: string) { await runBulkControl('resume', groupTasks(id), id); }
  async function handleRetryGroup(id: string) { await runBulkControl('retry', groupTasks(id), id); }
  async function handleCancelGroup(id: string) { await runBulkControl('cancel', groupTasks(id), id); }
  async function handleStopAndClearGroup(id: string) { await runBulkControl('cancel_and_remove', groupTasks(id), id); }
  async function handleDeleteGroupFiles(id: string) {
    const completedTasks = groupTasks(id).filter((task) => task.status === 'completed');
    if (completedTasks.length === 0) return;
    const confirmed = await dialogStore.confirm({
      title: $t('tasks.deleteBatchFilesTitle'),
      message: $t('tasks.deleteBatchFilesConfirm', { values: { count: completedTasks.length } }),
      confirmLabel: $t('tasks.deleteBatchFiles'),
      cancelLabel: $t('common.cancel'),
      danger: true,
    });
    if (!confirmed) return;
    await runGroup(id, 'delete', async () => {
      const result = await deleteDownloadedFiles(completedTasks.map((task) => task.task_id));
      reportBulkResult(result, groupTasks(id));
    });
  }
  async function handleRemoveGroupRecords(id: string) {
    const tasks = groupTasks(id);
    if (tasks.length === 0) return;
    const confirmed = await dialogStore.confirm({
      title: $t('tasks.removeBatchRecordsTitle'),
      message: $t('tasks.removeBatchRecordsConfirm', { values: { count: tasks.length } }),
      confirmLabel: $t('tasks.removeBatchRecords'),
      cancelLabel: $t('common.cancel'),
    });
    if (!confirmed) return;
    await runGroup(id, 'remove', async () => {
      const result = await removeTransferRecords('download', tasks.map((task) => task.task_id));
      removeSucceeded(result);
      reportBulkResult(result, groupTasks(id));
      if (result.failed.length === 0) {
        const next = new Set(expandedGroups);
        next.delete(id);
        expandedGroups = next;
      }
    });
  }

  function handleTabKeydown(event: KeyboardEvent) {
    const tabs: Array<'downloads' | 'uploads'> = ['downloads', 'uploads'];
    const current = tabs.indexOf(activeTab);
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    activeTab = tabs[next];
    const buttons = event.currentTarget instanceof HTMLElement
      ? event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      : undefined;
    buttons?.[next]?.focus();
  }
  function rowKey(row: DownloadPageRow | UploadPageRow) {
    if (row.kind === 'upload-group') return `upload-group:${row.group.id}`;
    if (row.kind === 'upload') return `upload:${row.task.upload_id}`;
    const item = row.row;
    if (item.kind === 'group') return `group:${item.group.id}`;
    return `download:${item.task.task_id}`;
  }
  function estimateSize(index: number) { const row = currentRows[index]; return row?.kind === 'upload-group' || (row?.kind === 'download' && row.row.kind === 'group') ? 116 : 76; }
  function formatError(error: unknown) { return formatUserFacingError(error); }
</script>

<div class="workspace-page task-page">
  <header class="task-header">
    <div>
      <h1>{$t('tasks.title')}</h1>
      <p>{$t('tasks.subtitle')}</p>
    </div>
    <div class="task-header-actions">
      <TaskActionButton
        presentation="labelled"
        icon="download"
        label={$t('tasks.downloadByIdAction')}
        tone="primary"
        onclick={openDirectDownloadDialog}
      />
      <FluentButton data-fluent-owner="routes-home-tasks-page"
        onclick={refresh}
        disabled={loading || bulkBusy}
        title={$t('common.refresh')}
        aria-label={$t('common.refresh')}
        type="button"
        appearance="subtle"
        class="icon-button"
        iconOnly
      >
        <Icon name="refresh" size="20px" />
      </FluentButton>
    </div>
  </header>

  <div class="task-tabs" role="tablist" aria-label={$t('tasks.title')}>
    <button data-fluent-owner="routes-home-tasks-page" role="tab" disabled={bulkBusy} aria-selected={activeTab === 'downloads'} tabindex={activeTab === 'downloads' ? 0 : -1} class:active={activeTab === 'downloads'} onclick={() => (activeTab = 'downloads')} onkeydown={handleTabKeydown}><Icon name="download" size="18px" /> {$t('tasks.downloads')} <span>{downloadTasks.length}</span></button>
    <button data-fluent-owner="routes-home-tasks-page" role="tab" disabled={bulkBusy} aria-selected={activeTab === 'uploads'} tabindex={activeTab === 'uploads' ? 0 : -1} class:active={activeTab === 'uploads'} onclick={() => (activeTab = 'uploads')} onkeydown={handleTabKeydown}><Icon name="upload" size="18px" /> {$t('tasks.uploads')} <span>{uploadTasks.length}</span></button>
  </div>

  <div class="task-toolbar" role="toolbar" aria-label={$t('tasks.filters')}>
    <label class="search-field cfms-input-composite cfms-field-surface">
      <Icon name="search" size="18px" />
      <span class="sr-only">{$t('tasks.search')}</span>
      <input class="cfms-native-field" data-focus-ring="delegated" bind:value={searchQuery} disabled={bulkBusy} placeholder={$t('tasks.searchPlaceholder')} />
      {#if searchQuery}
        <span class="cfms-input-composite__end">
          <FluentButton data-fluent-owner="routes-home-tasks-page"
            onclick={() => (searchQuery = '')}
            aria-label={$t('common.clear')}
            type="button"
            appearance="subtle"
            class="cfms-control-action"
            iconOnly
          ><Icon name="close" size="16px" /></FluentButton>
        </span>
      {/if}
    </label>
    <label class="section-filter">
      <span>{$t('files.filter')}</span>
      <select class="cfms-native-field" bind:value={sectionFilter} disabled={bulkBusy}>
        <option value="all">{$t('tasks.all')}</option>
        {#each TRANSFER_SECTION_ORDER as section}<option value={section}>{sectionLabel(section)}</option>{/each}
      </select>
    </label>
    <div class="task-summary" aria-live="polite">
      <span><strong>{activeCount}</strong> {$t('tasks.sections.active')}</span>
      {#if attentionCount > 0}<span class="attention"><strong>{attentionCount}</strong> {$t('tasks.needAttention')}</span>{/if}
    </div>
  </div>

  <div class="bulk-toolbar" role="toolbar" aria-label={$t('tasks.bulkActions')} aria-busy={bulkBusy}>
    <MdCheckbox checked={allSelected} indeterminate={someSelected && !allSelected} disabled={bulkBusy || !visibleTasks.length}
      ariaLabel={$t('tasks.selectAllMatching')} onChange={selectMatching} />
    <span class="bulk-scope">{$t(selectedIds.size ? 'tasks.selectedScope' : 'tasks.filteredScope', { values: { count: scopeTasks.length } })}</span>
    <div class="bulk-actions">
      {#each (['pause', 'resume'] as const) as action}
        {@const count = controlCount(action)}
        <TaskActionButton icon={TRANSFER_ACTIONS[action].icon}
          label={$t(selectedIds.size ? 'tasks.actionOnSelected' : 'tasks.actionOnFiltered', { values: { action: $t(TRANSFER_ACTIONS[action].label), count } })}
          disabled={bulkBusy || !count} onclick={() => runBulkControl(action)} />
      {/each}
      <FluentButton appearance="subtle" iconOnly class="bulk-menu-trigger" title={moreScopeLabel} aria-label={moreScopeLabel} onclick={openCleanupMenu}
        disabled={bulkBusy || !cleanupItems.some(item => !('type' in item) && !item.hidden)} aria-haspopup="menu" aria-expanded={cleanupMenu.open}>
        <Icon name="more" size="20px" />
      </FluentButton>
    </div>
  </div>
  {#if bulkResult}
    <div class="bulk-result" role="status">
      <span>{$t('tasks.bulkResult', { values: { succeeded: bulkResult.succeeded, failed: bulkResult.failed.length } })}</span>
      {#if bulkResult.failed.length}
        <details><summary>{$t('tasks.showFailureDetails')}</summary>
          <ul>{#each bulkResult.failed as item}<li><strong>{item.name}</strong>: {item.error}</li>{/each}</ul>
        </details>
      {/if}
    </div>
  {/if}

  {#if errorMessage}
    <div class="error-banner" role="alert" in:flyScale={{ y: -4, duration: 180 }}><Icon name="errorFilled" size="18px" /><span>{errorMessage}</span><FluentButton data-fluent-owner="routes-home-tasks-page"
  onclick={() => (errorMessage = '')}
  aria-label={$t('common.close')}
  type="button"
  appearance="subtle"
  iconOnly
><Icon name="close" size="16px" /></FluentButton></div>
  {/if}
  <section class="task-list-shell" aria-busy={loading}>
    {#if currentRows.length > 0}
      <VirtualList
        items={currentRows} keyOf={rowKey} estimateSize={estimateSize} gap={0} overscan={8}
        threshold={32} resetKey={`${activeTab}:${sectionFilter}:${searchQuery}`}
        viewportClass="task-list-viewport" contentClass="task-list-content" itemClass="task-list-item"
        keyboardNavigation keyboardTargetSelector="button, fluent-button, fluent-checkbox"
      >
        {#snippet children(row)}
          {#if row.kind === 'upload-group'}
            <div class="selectable-row">
              <MdCheckbox checked={groupSelected(row.group.matching)} indeterminate={groupMixed(row.group.matching)} disabled={bulkBusy}
                ariaLabel={$t('tasks.selectBatch', { values: { name: row.group.name } })} onChange={checked => selectBatch(row.group.id, row.group.matching, checked)} />
              <div class="transfer-row-content">
                <UploadTaskGroupHeader group={row.group} expanded={expandedGroups.has(row.group.id) || Boolean(searchQuery.trim())} pending={bulkBusy}
                  onToggle={() => toggleGroup(row.group.id)} onControl={action => runBulkControl(action, row.group.matching)} onRemove={kind => runCleanup(kind, row.group.matching)} />
              </div>
            </div>          {:else if row.kind === 'upload'}
            <div class="selectable-row" class:group-child={Boolean(row.groupId)}>
              <MdCheckbox checked={selectedIds.has(row.task.upload_id)} disabled={bulkBusy} ariaLabel={$t('tasks.selectTask', { values: { name: row.task.file_name } })} onChange={checked => selectTasks([row.task], checked)} />
              <div class="transfer-row-content"><UploadTaskCard task={row.task} onPause={handlePauseUpload} onResume={handleResumeUpload} onRestart={handleRestartUpload} onReselect={handleReselectUpload} onCancel={handleCancelUpload} onRemove={handleRemoveUpload} pending={bulkBusy || pendingUploadActions.has(row.task.upload_id)} /></div>
            </div>
          {:else if row.row.kind === 'group'}
            {@const group = row.row.group}
            <div class="selectable-row">
              <MdCheckbox checked={groupSelected(row.row.group.tasks)} indeterminate={groupMixed(row.row.group.tasks)} disabled={bulkBusy || !row.row.group.tasks.length}
                ariaLabel={$t('tasks.selectBatch', { values: { name: row.row.group.name } })} onChange={checked => selectBatch(group.id, group.tasks, checked)} />
              <div class="transfer-row-content">
                <DownloadTaskGroupHeader group={row.row.group} expanded={expandedGroups.has(row.row.group.id) || Boolean(searchQuery.trim())} onToggle={toggleGroup} onPause={handlePauseGroup} onResume={handleResumeGroup} onRetry={handleRetryGroup} onCancel={handleCancelGroup} onStopAndClear={handleStopAndClearGroup} onDeleteFiles={handleDeleteGroupFiles} onRemoveRecords={handleRemoveGroupRecords} bytesPerSecond={row.row.group.tasks.reduce((sum, task) => sum + (downloadStore.speeds.get(task.task_id) ?? 0), 0)} pendingAction={bulkBusy ? 'cancel' : pendingGroupActions.get(row.row.group.id) ?? null} />
              </div>
            </div>
          {:else}
            {@const task = row.row.task}
            <div class="selectable-row" class:group-child={row.row.kind === 'group-task'}>
              <MdCheckbox checked={selectedIds.has(row.row.task.task_id)} disabled={bulkBusy} ariaLabel={$t('tasks.selectTask', { values: { name: row.row.task.filename } })} onChange={checked => selectTasks([task], checked)} />
              <div class="transfer-row-content"><DownloadTaskCard task={row.row.task} onPause={handlePause} onResume={handleResume} onRetry={handleRetry} onCancel={handleCancel} onOpen={handleOpen} onRemove={handleRemoveDownload} onDeleteFile={handleDeleteFile} bytesPerSecond={downloadStore.speeds.get(row.row.task.task_id) ?? 0} pendingAction={bulkBusy || pendingDownloadActions.has(row.row.task.task_id) ? 'cancel' : null} /></div>
            </div>
          {/if}
        {/snippet}
      </VirtualList>
    {:else if !loading}
      <div class="empty-state" in:flyScale={{ y: 8, duration: 220 }}><Icon name={activeTab === 'downloads' ? 'downloadDone' : 'upload'} size="44px" /><h2>{activeTab === 'downloads' ? $t('tasks.noDownloadTasks') : $t('tasks.noUploadTasks')}</h2><p>{searchQuery ? $t('tasks.noSearchResults') : $t('tasks.emptyHint')}</p></div>
    {/if}
  </section>
</div>

<ContextMenu open={cleanupMenu.open} x={cleanupMenu.x} y={cleanupMenu.y} sourceElement={cleanupMenu.source} items={cleanupItems} onClose={() => (cleanupMenu.open = false)} />

<DocumentIdDownloadDialog
  open={directDownloadOpen}
  busy={directDownloadBusy}
  error={directDownloadError}
  onClose={closeDirectDownloadDialog}
  onSubmit={handleDirectDownload}
/>

<style>
  .bulk-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
  .bulk-scope { margin-inline-end: auto; font-size: 12px; color: var(--explorer-text-muted); }
  .bulk-actions { display: flex; flex: none; align-items: center; gap: 4px; margin-inline-start: auto; }
  .bulk-actions :global(.bulk-menu-trigger[icon-only]) { inline-size: 36px; block-size: 36px; }
  .bulk-result { padding: 10px 12px; font-size: 13px; border: 1px solid var(--explorer-border); border-radius: var(--borderRadiusMedium); }
  .bulk-result details { margin-top: 6px; }
  .bulk-result ul { margin: 8px 0 0; padding-inline-start: 20px; max-height: 160px; overflow: auto; }
  .selectable-row { display: flex; align-items: flex-start; min-width: 0; }
  .selectable-row > :global(.cfms-choice-target) { margin-block-start: 18px; flex: none; }
  .transfer-row-content { flex: 1; min-width: 0; }

  .task-page {
    display: flex;
    height: 100%;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
    padding: 24px clamp(1rem, 2vw, 1.5rem);
  }

  .task-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .task-header h1 { margin: 0; color: var(--explorer-text); font: 600 28px/36px var(--fontFamilyBase); }
  .task-header p { max-width: 68ch; margin: 4px 0 0; color: var(--explorer-text-muted); font: 400 14px/20px var(--fontFamilyBase); }
  .task-header-actions { display: flex; flex: none; align-items: center; gap: 4px; }

  :global(.icon-button[data-fluent-owner="routes-home-tasks-page"]) { display: grid; width: 36px; height: 36px; flex: none; place-items: center; border-radius: var(--borderRadiusMedium); color: var(--explorer-text-muted); transition: color 120ms var(--motion-easing-standard), background-color 120ms var(--motion-easing-standard), transform 120ms var(--motion-easing-standard); }
  :global(.icon-button[data-fluent-owner="routes-home-tasks-page"]:hover:not(:is(:disabled, [disabled]))) { background: var(--explorer-surface-hover); color: var(--explorer-text); }
  :global(.icon-button[data-fluent-owner="routes-home-tasks-page"]:active:not(:is(:disabled, [disabled]))) { transform: none; }
  :global(.icon-button[data-fluent-owner="routes-home-tasks-page"]:is(:disabled, [disabled])) { opacity: 0.45; }

  .task-tabs { display: flex; width: fit-content; gap: 4px; border-bottom: 1px solid var(--explorer-border); }
  .task-tabs :global(:is(button[data-fluent-owner="routes-home-tasks-page"], .cfms-button[data-fluent-owner="routes-home-tasks-page"])) { display: flex; min-height: 38px; align-items: center; gap: 8px; border-bottom: 2px solid transparent; padding: 0.35rem 0.65rem; color: var(--explorer-text-muted); font-size: 12px; font-weight: 600; transition: color 140ms var(--motion-easing-standard), border-color 180ms var(--motion-easing-standard), background-color 140ms var(--motion-easing-standard); }
  .task-tabs :global(:is(button[data-fluent-owner="routes-home-tasks-page"], .cfms-button[data-fluent-owner="routes-home-tasks-page"]):hover) { color: var(--explorer-text); background: var(--explorer-surface-hover); }
  .task-tabs :global(:is(button[data-fluent-owner="routes-home-tasks-page"], .cfms-button[data-fluent-owner="routes-home-tasks-page"]).active) { border-color: var(--explorer-accent); color: var(--explorer-text); }
  .task-tabs span { color: var(--explorer-text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }

  .task-toolbar { display: grid; min-width: 0; grid-template-columns: minmax(240px, 1fr) auto auto; align-items: center; gap: 12px; }
  .search-field { display: flex; min-width: 0; align-items: center; gap: 8px; border: 1px solid var(--explorer-border); border-radius: var(--borderRadiusMedium); color: var(--explorer-text-muted); background: var(--explorer-surface-raised); transition: border-color 140ms var(--motion-easing-standard), box-shadow 140ms var(--motion-easing-standard), background-color 140ms var(--motion-easing-standard); }
  .search-field:focus-within { border-color: var(--explorer-accent); box-shadow: inset 0 0 0 1px var(--explorer-accent); }
  .search-field input { min-width: 0; width: 100%; flex: 1; appearance: none; border: 0 !important; outline: 0; padding: 0; color: var(--explorer-text); background: transparent; box-shadow: none !important; font: 400 12px/16px var(--font-md3-sans); }
  .search-field input::placeholder { color: var(--explorer-text-muted); opacity: 1; }
  .search-field :global(:is(button[data-fluent-owner="routes-home-tasks-page"], .cfms-button[data-fluent-owner="routes-home-tasks-page"])) { flex: none; border-radius: var(--borderRadiusMedium); color: var(--explorer-text-muted); transition: color 120ms var(--motion-easing-standard), background-color 120ms var(--motion-easing-standard), transform 120ms var(--motion-easing-standard); }
  .search-field :global(:is(button[data-fluent-owner="routes-home-tasks-page"], .cfms-button[data-fluent-owner="routes-home-tasks-page"]):hover) { color: var(--explorer-text); background: var(--explorer-surface-hover); }
  .search-field :global(:is(button[data-fluent-owner="routes-home-tasks-page"], .cfms-button[data-fluent-owner="routes-home-tasks-page"]):active) { transform: none; }

  .section-filter { display: flex; align-items: center; gap: 8px; color: var(--explorer-text-muted); font-size: 12px; white-space: nowrap; }
  .section-filter select { min-width: 112px; border: 1px solid var(--explorer-border); border-radius: var(--borderRadiusMedium); padding-inline: 0.55rem 1.8rem; color: var(--explorer-text); background-color: var(--explorer-surface-raised); }
  .task-summary { display: flex; justify-self: end; gap: 12px; color: var(--explorer-text-muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .task-summary :global(.attention) { color: var(--explorer-danger); }

  .error-banner { display: flex; align-items: center; gap: 8px; border: 1px solid color-mix(in srgb, var(--explorer-danger) 45%, transparent); border-radius: var(--explorer-radius-medium); padding: 0.55rem 0.7rem; color: var(--explorer-danger); background: color-mix(in srgb, var(--explorer-danger) 12%, var(--explorer-surface)); font-size: 12px; }
  .error-banner span { min-width: 0; flex: 1; overflow-wrap: anywhere; }

  .task-list-shell { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; overflow: hidden; background: transparent; }
  :global(.task-list-viewport) { height: 100%; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }

  .group-child { position: relative; padding-left: 1.5rem; background: transparent; }
  .group-child::before { position: absolute; top: 0; bottom: 0; left: 0.72rem; width: 1px; background: color-mix(in srgb, var(--explorer-accent) 45%, var(--explorer-border)); content: ''; }
  .empty-state { display: grid; min-height: 0; flex: 1; place-items: center; align-content: center; gap: 8px; padding: 2rem; color: var(--explorer-text-muted); text-align: center; }
  .empty-state h2 { color: var(--explorer-text); font-size: 14px; font-weight: 600; }
  .empty-state p { max-width: 52ch; font-size: 12px; }

  @media (max-width: 780px) {
    .task-toolbar { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
    .search-field { grid-column: 1 / -1; }
    .task-summary { grid-column: 2; }
  }

  @media (max-width: 520px) {
    .bulk-scope { flex: 1; min-width: 0; }
    .bulk-actions { flex-basis: 100%; justify-content: flex-end; }
    .task-page { padding: 16px; }
    .task-header { align-items: flex-start; }
    .task-toolbar { grid-template-columns: minmax(0, 1fr); align-items: stretch; }
    .section-filter,
    .task-summary { grid-column: 1; justify-self: stretch; }
    .section-filter select { flex: 1; }
    .task-summary { justify-content: space-between; }
    .group-child { padding-left: 0.8rem; }
    .group-child::before { left: 0.38rem; }
  }

  @media (pointer: coarse) {
    .bulk-actions :global(.bulk-menu-trigger[icon-only]) { inline-size: 44px; block-size: 44px; }
    :global(.icon-button[data-fluent-owner="routes-home-tasks-page"]) { width: 44px; height: 44px; }
    .task-tabs :global(:is(button[data-fluent-owner="routes-home-tasks-page"], .cfms-button[data-fluent-owner="routes-home-tasks-page"])) { min-height: 44px; }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.icon-button[data-fluent-owner="routes-home-tasks-page"]),
    .task-tabs :global(:is(button[data-fluent-owner="routes-home-tasks-page"], .cfms-button[data-fluent-owner="routes-home-tasks-page"])),
    .search-field,
    .search-field :global(:is(button[data-fluent-owner="routes-home-tasks-page"], .cfms-button[data-fluent-owner="routes-home-tasks-page"])) { transition: none; }
    :global(.icon-button[data-fluent-owner="routes-home-tasks-page"]:active:not(:is(:disabled, [disabled]))),
    .search-field :global(:is(button[data-fluent-owner="routes-home-tasks-page"], .cfms-button[data-fluent-owner="routes-home-tasks-page"]):active) { transform: none; }
  }
</style>
