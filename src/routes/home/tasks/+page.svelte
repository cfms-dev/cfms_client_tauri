<script lang="ts">
  import { onMount } from 'svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { _ as t } from 'svelte-i18n';
  import type { DownloadTaskDto, UploadEnqueueRequest, UploadTaskDto } from '$lib/api';
  import {
    cancelDownload, controlTransferTasks, deleteDownloadedFiles, getDownloadTasks, getUploadTasks,
    openDownloadedFile, pauseDownload, removeTransferRecords,
    resumeDownload, retryDownload, retryUploadTask, uploadDirectory, uploadDocumentFile,
  } from '$lib/api';
  import { downloadStore, uploadStore } from '$lib/stores.svelte';
  import { downloadBatchSnapshots, pauseActiveDownloadBatches, resumeActiveDownloadBatches, stopActiveDownloadBatch } from '$lib/download-batch-control';
  import {
    buildDownloadTaskSections,
    type DownloadTaskGroup, type DownloadTaskRow,
  } from '$lib/download-task-groups';
  import {
    TRANSFER_SECTION_ORDER, downloadSection, matchesTransferQuery, sortSectionTasks,
    uploadSection, type TransferSectionFilter, type TransferSectionKey,
  } from '$lib/transfer-task-view';
  import { registerKeyboardCommands } from '$lib/keyboard';
  import { pickDirectory } from '$lib/directory-picker';
  import VirtualList from '$lib/components/VirtualList.svelte';
  import DownloadTaskCard from '$lib/components/DownloadTaskCard.svelte';
  import DownloadTaskGroupHeader from '$lib/components/DownloadTaskGroupHeader.svelte';
  import UploadTaskCard from '$lib/components/UploadTaskCard.svelte';
  import Icon from '$lib/components/Icon.svelte';

  type TaskTab = 'downloads' | 'uploads';
  type DownloadPageRow =
    | { kind: 'section'; section: TransferSectionKey; count: number }
    | { kind: 'download'; section: TransferSectionKey; row: DownloadTaskRow };
  type UploadPageRow =
    | { kind: 'section'; section: TransferSectionKey; count: number }
    | { kind: 'upload'; section: TransferSectionKey; task: UploadTaskDto };

  let activeTab = $state<TaskTab>('downloads');
  let searchQuery = $state('');
  let sectionFilter = $state<TransferSectionFilter>('all');
  let loading = $state(false);
  let errorMessage = $state('');
  let batchFeedback = $state<{ message: string; failed: boolean } | null>(null);
  let expandedGroups = $state(new Set<string>());
  let collapsedSections = $state(new Set<TransferSectionKey>());
  let pendingDownloadActions = $state(new Set<string>());
  let pendingUploadActions = $state(new Set<string>());
  let pendingGroupActions = $state(new Set<string>());

  const downloadTasks = $derived([...downloadStore.tasks.values()]);
  const uploadTasks = $derived(uploadStore.allTasks);
  const visibleDownloads = $derived(downloadTasks.filter((task) => matchesTransferQuery(task, searchQuery)));
  const visibleUploads = $derived(uploadTasks.filter((task) => matchesTransferQuery(task, searchQuery)));
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
    void refresh();
    return registerKeyboardCommands({
      id: 'tasks.refresh', label: () => $t('common.refresh'), group: () => $t('tasks.title'),
      shortcuts: [{ key: 'F5' }, { key: 'r', primary: true }], scope: 'page',
      enabled: () => !loading, handler: refresh,
    });
  });

  async function refresh() {
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
    const rows: DownloadPageRow[] = [];
    for (const group of buildDownloadTaskSections(
      downloadTasks, expandedGroups, $downloadBatchSnapshots, searchQuery,
    )) {
      if (sectionFilter !== 'all' && sectionFilter !== group.section) continue;
      rows.push({ kind: 'section', section: group.section, count: group.count });
      if (collapsedSections.has(group.section)) continue;
      for (const row of group.rows) {
        rows.push({ kind: 'download', section: group.section, row });
      }
    }
    return rows;
  }

  function buildUploadPageRows(): UploadPageRow[] {
    const rows: UploadPageRow[] = [];
    for (const section of TRANSFER_SECTION_ORDER) {
      if (sectionFilter !== 'all' && sectionFilter !== section) continue;
      const tasks = sortSectionTasks(visibleUploads.filter((task) => uploadSection(task) === section), section);
      if (tasks.length === 0) continue;
      rows.push({ kind: 'section', section, count: tasks.length });
      if (collapsedSections.has(section)) continue;
      for (const task of tasks) rows.push({ kind: 'upload', section, task });
    }
    return rows;
  }

  function sectionLabel(section: TransferSectionKey) {
    return $t(`tasks.sections.${section}`);
  }

  function toggleSection(section: TransferSectionKey) {
    const next = new Set(collapsedSections);
    next.has(section) ? next.delete(section) : next.add(section);
    collapsedSections = next;
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
      const request = await retryUploadTask(id);
      uploadStore.registerRunner(id, uploadRunner(request));
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
      const request = await retryUploadTask(id, sourcePath);
      uploadStore.registerRunner(id, uploadRunner(request));
    }, false);
  }
  async function handleRemoveUpload(id: string) {
    await runUpload(id, async () => {
      const result = await removeTransferRecords('upload', [id]);
      if (result.failed.length) throw new Error(result.failed[0].error);
      uploadStore.remove(id);
    }, false);
  }

  function uploadRunner(request: UploadEnqueueRequest) {
    return (uploadId: string) => request.kind === 'directory'
      ? uploadDirectory(request.targetParentId, request.sourcePath, uploadId, request.conflictStrategy, request.uploadName ?? request.fileName, request.conflictResolutions)
      : uploadDocumentFile(request.targetParentId, request.sourcePath, uploadId, request.conflictStrategy, request.uploadName ?? request.fileName);
  }

  function groupTasks(groupId: string) { return downloadTasks.filter((task) => task.batch_id === groupId); }
  async function runGroup(groupId: string, action: () => Promise<void>) {
    pendingGroupActions = new Set(pendingGroupActions).add(groupId);
    try { await action(); await refreshDownloads(); }
    catch (error) { errorMessage = formatError(error); }
    finally { const next = new Set(pendingGroupActions); next.delete(groupId); pendingGroupActions = next; }
  }
  async function handlePauseGroup(id: string) { await runGroup(id, async () => { pauseActiveDownloadBatches(id); await Promise.all(groupTasks(id).filter((t) => t.status === 'pending' || t.status === 'scheduled' || (t.status === 'downloading' && t.supports_resume)).map((t) => pauseDownload(t.task_id))); }); }
  async function handleResumeGroup(id: string) { await runGroup(id, async () => { resumeActiveDownloadBatches(id); await Promise.all(groupTasks(id).filter((t) => t.status === 'paused').map((t) => resumeDownload(t.task_id))); }); }
  async function handleRetryGroup(id: string) { await runGroup(id, async () => { await Promise.all(groupTasks(id).filter((t) => t.status === 'failed').map((t) => retryDownload(t.task_id))); }); }
  async function handleCancelGroup(id: string) { await runGroup(id, async () => { stopActiveDownloadBatch(id); await Promise.all(groupTasks(id).filter((t) => !t.completed_at).map((t) => cancelDownload(t.task_id))); }); }
  async function handleDeleteGroupFiles(id: string) {
    if (!window.confirm($t('tasks.deleteBatchFilesConfirm'))) return;
    await runGroup(id, async () => {
      const result = await deleteDownloadedFiles(groupTasks(id).filter((t) => t.status === 'completed').map((t) => t.task_id));
      showBatchResult(result);
    });
  }

  async function handleSectionAction(section: TransferSectionKey) {
    errorMessage = '';
    try {
      const downloads = visibleDownloads.filter((task) => downloadSection(task) === section);
      const uploads = visibleUploads.filter((task) => uploadSection(task) === section);
      if (activeTab === 'downloads') {
        if (section === 'attention') await Promise.all(downloads.filter((t) => t.status === 'failed').map((t) => handleRetry(t.task_id)));
        if (section === 'active') showBatchResult(await controlTransferTasks('download', downloads.filter((t) => t.status === 'scheduled' || (t.status === 'downloading' && t.supports_resume)).map((t) => t.task_id), 'pause'));
        if (section === 'waiting') showBatchResult(await controlTransferTasks('download', downloads.filter((t) => t.status === 'paused').map((t) => t.task_id), 'resume'));
        if (section === 'history') {
          const result = await removeTransferRecords('download', downloads.map((t) => t.task_id));
          showBatchResult(result);
          await refreshDownloads();
        }
        if (section === 'active' || section === 'waiting') await refreshDownloads();
      } else {
        if (section === 'attention') await Promise.all(uploads.filter((t) => t.source_available).map((t) => handleRestartUpload(t.upload_id)));
        if (section === 'active') showBatchResult(await controlTransferTasks('upload', uploads.map((t) => t.upload_id), 'pause'));
        if (section === 'waiting') showBatchResult(await controlTransferTasks('upload', uploads.filter((t) => t.status === 'paused').map((t) => t.upload_id), 'resume'));
        if (section === 'history') {
          const result = await removeTransferRecords('upload', uploads.map((t) => t.upload_id));
          showBatchResult(result);
          await refreshUploads();
        }
        if (section === 'active' || section === 'waiting') await refreshUploads();
      }
    } catch (error) {
      errorMessage = formatError(error);
    }
  }

  function showBatchResult(result: { succeeded: string[]; failed: Array<{ id: string; error: string }> }) {
    const summary = $t('tasks.batchResult', {
      values: { succeeded: result.succeeded.length, failed: result.failed.length },
    });
    const failures = result.failed.map((item) => `${item.id}: ${item.error}`).join('; ');
    batchFeedback = {
      message: failures ? `${summary} — ${failures}` : summary,
      failed: result.failed.length > 0,
    };
  }

  function sectionActionLabel(section: TransferSectionKey) {
    if (section === 'attention') return $t('tasks.retryAvailable');
    if (section === 'active') return $t('tasks.pauseAvailable');
    if (section === 'waiting') return $t('tasks.resumePaused');
    return $t('tasks.clearHistory');
  }
  function sectionActionAvailable(section: TransferSectionKey) {
    if (activeTab === 'downloads') {
      const tasks = visibleDownloads.filter((task) => downloadSection(task) === section);
      if (section === 'attention') return tasks.some((task) => task.status === 'failed');
      if (section === 'active') return tasks.some((task) => task.status === 'scheduled' || (task.status === 'downloading' && task.supports_resume));
      if (section === 'waiting') return tasks.some((task) => task.status === 'paused');
      return tasks.length > 0;
    }
    const tasks = visibleUploads.filter((task) => uploadSection(task) === section);
    if (section === 'attention') return tasks.some((task) => task.source_available);
    if (section === 'active') return tasks.length > 0;
    if (section === 'waiting') return tasks.some((task) => task.status === 'paused');
    return tasks.length > 0;
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
    if (row.kind === 'section') return `section:${row.section}`;
    if (row.kind === 'upload') return `upload:${row.task.upload_id}`;
    const item = row.row;
    if (item.kind === 'group') return `group:${row.section}:${item.group.id}`;
    return `download:${item.task.task_id}`;
  }
  function estimateSize(index: number) { return currentRows[index]?.kind === 'section' ? 46 : 76; }
  function formatError(error: unknown) { return error instanceof Error ? error.message : String(error); }
</script>

<div class="workspace-page task-page">
  <header class="task-header">
    <div>
      <h1>{$t('tasks.title')}</h1>
      <p>{$t('tasks.subtitle')}</p>
    </div>
    <button class="icon-button" onclick={refresh} disabled={loading} title={$t('common.refresh')} aria-label={$t('common.refresh')}>
      <Icon name="refresh" size="20px" />
    </button>
  </header>

  <div class="task-tabs" role="tablist" aria-label={$t('tasks.title')}>
    <button role="tab" aria-selected={activeTab === 'downloads'} tabindex={activeTab === 'downloads' ? 0 : -1} class:active={activeTab === 'downloads'} onclick={() => (activeTab = 'downloads')} onkeydown={handleTabKeydown}><Icon name="download" size="18px" /> {$t('tasks.downloads')} <span>{downloadTasks.length}</span></button>
    <button role="tab" aria-selected={activeTab === 'uploads'} tabindex={activeTab === 'uploads' ? 0 : -1} class:active={activeTab === 'uploads'} onclick={() => (activeTab = 'uploads')} onkeydown={handleTabKeydown}><Icon name="upload" size="18px" /> {$t('tasks.uploads')} <span>{uploadTasks.length}</span></button>
  </div>

  <div class="task-toolbar" role="toolbar" aria-label={$t('tasks.filters')}>
    <label class="search-field">
      <Icon name="search" size="18px" />
      <span class="sr-only">{$t('tasks.search')}</span>
      <input bind:value={searchQuery} placeholder={$t('tasks.searchPlaceholder')} />
      {#if searchQuery}<button onclick={() => (searchQuery = '')} aria-label={$t('common.clear')}><Icon name="close" size="16px" /></button>{/if}
    </label>
    <label class="section-filter">
      <span>{$t('files.filter')}</span>
      <select bind:value={sectionFilter}>
        <option value="all">{$t('tasks.all')}</option>
        {#each TRANSFER_SECTION_ORDER as section}<option value={section}>{sectionLabel(section)}</option>{/each}
      </select>
    </label>
    <div class="task-summary" aria-live="polite">
      <span><strong>{activeCount}</strong> {$t('tasks.sections.active')}</span>
      {#if attentionCount > 0}<span class="attention"><strong>{attentionCount}</strong> {$t('tasks.needAttention')}</span>{/if}
    </div>
  </div>

  {#if errorMessage}
    <div class="error-banner" role="alert"><Icon name="errorFilled" size="18px" /><span>{errorMessage}</span><button onclick={() => (errorMessage = '')} aria-label={$t('common.close')}><Icon name="close" size="16px" /></button></div>
  {/if}
  {#if batchFeedback}
    <div class:error={batchFeedback.failed} class="batch-feedback" role="status"><Icon name={batchFeedback.failed ? 'warning' : 'checkCircle'} size="18px" /><span>{batchFeedback.message}</span><button onclick={() => (batchFeedback = null)} aria-label={$t('common.close')}><Icon name="close" size="16px" /></button></div>
  {/if}

  <section class="task-list-shell" aria-busy={loading}>
    {#if currentRows.length > 0}
      <VirtualList
        items={currentRows} keyOf={rowKey} estimateSize={estimateSize} gap={0} overscan={8}
        threshold={32} resetKey={`${activeTab}:${sectionFilter}:${searchQuery}`}
        viewportClass="task-list-viewport" contentClass="task-list-content" itemClass="task-list-item"
        keyboardNavigation keyboardTargetSelector="button"
      >
        {#snippet children(row)}
          {#if row.kind === 'section'}
            <div class="section-header">
              <button class="section-toggle" onclick={() => toggleSection(row.section)} aria-expanded={!collapsedSections.has(row.section)}>
                <Icon name={collapsedSections.has(row.section) ? 'expandMore' : 'expandLess'} size="18px" />
                <strong>{sectionLabel(row.section)}</strong><span>{row.count}</span>
              </button>
              {#if sectionActionAvailable(row.section)}<button class="section-action" onclick={() => handleSectionAction(row.section)}>{sectionActionLabel(row.section)}</button>{/if}
            </div>
          {:else if row.kind === 'upload'}
            <UploadTaskCard task={row.task} onPause={handlePauseUpload} onResume={handleResumeUpload} onRestart={handleRestartUpload} onReselect={handleReselectUpload} onCancel={handleCancelUpload} onRemove={handleRemoveUpload} pending={pendingUploadActions.has(row.task.upload_id)} />
          {:else if row.row.kind === 'group'}
            <DownloadTaskGroupHeader group={row.row.group} expanded={expandedGroups.has(row.row.group.id)} onToggle={toggleGroup} onPause={handlePauseGroup} onResume={handleResumeGroup} onRetry={handleRetryGroup} onCancel={handleCancelGroup} onDeleteFiles={handleDeleteGroupFiles} pendingAction={pendingGroupActions.has(row.row.group.id) ? 'cancel' : null} />
          {:else}
            <div class:group-child={row.row.kind === 'group-task'}>
              <DownloadTaskCard task={row.row.task} onPause={handlePause} onResume={handleResume} onRetry={handleRetry} onCancel={handleCancel} onOpen={handleOpen} onRemove={handleRemoveDownload} onDeleteFile={handleDeleteFile} pendingAction={pendingDownloadActions.has(row.row.task.task_id) ? 'cancel' : null} />
            </div>
          {/if}
        {/snippet}
      </VirtualList>
    {:else if !loading}
      <div class="empty-state"><Icon name={activeTab === 'downloads' ? 'downloadDone' : 'upload'} size="44px" /><h2>{activeTab === 'downloads' ? $t('tasks.noDownloadTasks') : $t('tasks.noUploadTasks')}</h2><p>{searchQuery ? $t('tasks.noSearchResults') : $t('tasks.emptyHint')}</p></div>
    {/if}
  </section>
</div>

<style>
  .task-page { display: flex; min-width: 0; flex-direction: column; gap: 1rem; padding: 1rem 1.25rem; }
  .task-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  .task-header h1 { font-size: 1.25rem; font-weight: 700; color: var(--color-md3-on-surface); }
  .task-header p { margin-top: .2rem; font-size: .8125rem; color: var(--color-md3-on-surface-variant); }
  .icon-button { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 999px; color: var(--color-md3-on-surface-variant); }
  .icon-button:hover { background: var(--color-md3-surface-container-high); }.icon-button:disabled { opacity: .45; }
  .task-tabs { display: flex; width: fit-content; gap: .2rem; border-bottom: 1px solid var(--color-md3-outline); }
  .task-tabs button { display: flex; align-items: center; gap: .4rem; min-height: 38px; padding: .35rem .65rem; border-bottom: 2px solid transparent; font-size: .8125rem; font-weight: 600; color: var(--color-md3-on-surface-variant); }
  .task-tabs button.active { border-color: var(--color-md3-primary); color: var(--color-md3-on-surface); }.task-tabs span { font-size: .6875rem; opacity: .7; }
  .task-toolbar { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: .65rem; padding: .55rem; border: 1px solid var(--color-md3-outline); border-radius: 8px; background: var(--color-md3-surface-container); }
  .search-field { display: flex; min-width: min(280px, 100%); flex: 1; align-items: center; gap: .45rem; min-height: 38px; padding: 0 .65rem; border: 1px solid var(--color-md3-outline); border-radius: 8px; background: var(--color-md3-surface-container-high); color: var(--color-md3-on-surface-variant); }
  .search-field:focus-within { border-color: var(--color-md3-primary); box-shadow: inset 0 0 0 1px var(--color-md3-primary); }.search-field input { min-width: 0; flex: 1; background: transparent; font-size: .8125rem; color: var(--color-md3-on-surface); outline: none; }
  .section-filter { display: flex; align-items: center; gap: .4rem; font-size: .75rem; color: var(--color-md3-on-surface-variant); }.section-filter select { min-height: 36px; border-radius: 5px; background: var(--color-md3-surface-container-high); padding: 0 .55rem; color: var(--color-md3-on-surface); }
  .task-summary { display: flex; gap: .75rem; font-size: .75rem; color: var(--color-md3-on-surface-variant); }.task-summary .attention { color: var(--color-md3-error); }
  .error-banner { display: flex; align-items: center; gap: .5rem; border: 1px solid color-mix(in srgb, var(--color-md3-error) 45%, transparent); border-radius: 8px; background: var(--color-md3-error-container); padding: .55rem .7rem; font-size: .8125rem; color: var(--color-md3-on-error-container); }.error-banner span { flex: 1; }
  .batch-feedback { display: flex; align-items: center; gap: .5rem; border: 1px solid color-mix(in srgb, var(--color-md3-success) 38%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--color-md3-success) 10%, var(--color-md3-surface-container)); padding: .55rem .7rem; font-size: .8125rem; color: var(--color-md3-on-surface); }.batch-feedback.error { border-color: color-mix(in srgb, var(--color-md3-error) 45%, transparent); background: var(--color-md3-error-container); color: var(--color-md3-on-error-container); }.batch-feedback span { flex: 1; overflow-wrap: anywhere; }
  .task-list-shell { min-width: 0; overflow: hidden; border: 1px solid var(--color-md3-outline); border-radius: 8px; background: var(--color-md3-surface-container); }
  .section-header { display: flex; min-height: 44px; align-items: center; justify-content: space-between; gap: .75rem; border-bottom: 1px solid var(--color-md3-outline); background: var(--color-md3-surface-container-high); padding: .35rem .55rem; }
  .section-toggle { display: flex; align-items: center; gap: .4rem; min-width: 0; color: var(--color-md3-on-surface); }.section-toggle strong { font-size: .8125rem; }.section-toggle span { font-size: .6875rem; color: var(--color-md3-on-surface-variant); }
  .section-action { min-height: 30px; border-radius: 5px; padding: .2rem .55rem; font-size: .6875rem; font-weight: 600; color: var(--color-md3-primary-emphasis); }.section-action:hover { background: var(--color-md3-primary-container); }
  .group-child { position: relative; padding-left: 1.5rem; background: color-mix(in srgb, var(--color-md3-surface-container-high) 45%, transparent); }
  .group-child::before { position: absolute; top: 0; bottom: 0; left: .72rem; width: 1px; background: color-mix(in srgb, var(--color-md3-primary) 45%, var(--color-md3-outline)); content: ''; }
  .empty-state { display: grid; min-height: 260px; place-items: center; align-content: center; gap: .45rem; padding: 2rem; text-align: center; color: var(--color-md3-on-surface-variant); }.empty-state h2 { font-size: .9375rem; font-weight: 650; color: var(--color-md3-on-surface); }.empty-state p { max-width: 52ch; font-size: .8125rem; }
  @media (max-width: 640px) { .task-page { padding: .85rem; }.task-toolbar { align-items: stretch; }.search-field { flex-basis: 100%; }.task-summary { width: 100%; }.section-filter { flex: 1; }.group-child { padding-left: .65rem; } }
  @media (pointer: coarse) { .icon-button { width: 44px; height: 44px; }.task-tabs button { min-height: 44px; }.section-action { min-height: 40px; } }
</style>
