<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { _ as t } from 'svelte-i18n';
  import {
    listDeletedItems,
    purgeDirectory,
    purgeDocument,
    restoreDirectory,
    restoreDocument,
    type DeletedDirectoryEntry,
    type DeletedDocumentEntry,
  } from '$lib/api';
  import { dialogStore } from '$lib/dialogs.svelte';
  import { navigateUp } from '$lib/navigation';
  import { authStore, floatingProgressStore, notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  type TrashKind = 'directory' | 'document';

  let folderId = $state('/');
  let currentFolderId = $state('/');
  let folders = $state<DeletedDirectoryEntry[]>([]);
  let documents = $state<DeletedDocumentEntry[]>([]);
  let loading = $state(false);
  let busyItemId = $state<string | null>(null);
  let batchBusy = $state(false);
  let selectMode = $state(false);
  let selectedFolderIds = $state<Set<string>>(new Set());
  let selectedDocumentIds = $state<Set<string>>(new Set());
  let error = $state<string | null>(null);
  let status = $state<string | null>(null);

  const canRestore = $derived(authStore.permissions.includes('restore'));
  const canPurge = $derived(authStore.permissions.includes('purge'));
  const totalSelected = $derived(selectedFolderIds.size + selectedDocumentIds.size);
  const totalVisibleSelectable = $derived(folders.length + documents.length);
  const allVisibleSelected = $derived(
    totalVisibleSelectable > 0
      && folders.every((folder) => selectedFolderIds.has(folder.id))
      && documents.every((document) => selectedDocumentIds.has(document.id)),
  );

  const items = $derived([
    ...folders.map((item) => ({
      id: item.id,
      name: item.name,
      created_time: item.created_time ?? null,
      kind: 'directory' as const,
    })),
    ...documents.map((item) => ({
      id: item.id,
      name: item.title,
      created_time: item.created_time ?? null,
      kind: 'document' as const,
    })),
  ]);

  $effect(() => {
    if (!status) return;
    notificationStore.success(status);
    status = null;
  });

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  onMount(() => {
    loadItems(page.url.searchParams.get('folder') ?? folderId);
  });

  async function loadItems(nextFolderId = folderId) {
    const normalized = normalizeFolderId(nextFolderId);
    folderId = normalized;
    currentFolderId = normalized;
    loading = true;
    error = null;
    try {
      const data = await listDeletedItems(normalized);
      folders = data.folders;
      documents = data.documents;
      selectedFolderIds = new Set();
      selectedDocumentIds = new Set();
    } catch (err) {
      error = formatError(err);
      folders = [];
      documents = [];
    } finally {
      loading = false;
    }
  }

  async function handleRestore(kind: TrashKind, id: string, name: string) {
    const nextName = await dialogStore.prompt({
      title: $t('trash.restore'),
      message: $t('trash.restorePrompt'),
      defaultValue: name,
      confirmLabel: $t('common.save'),
      cancelLabel: $t('common.cancel'),
    });
    if (nextName === null) return;

    busyItemId = id;
    error = null;
    try {
      const trimmed = nextName.trim();
      if (kind === 'document') {
        await restoreDocument(id, trimmed && trimmed !== name ? trimmed : null);
      } else {
        await restoreDirectory(id, trimmed && trimmed !== name ? trimmed : null);
      }
      status = kind === 'document' ? $t('trash.restoreDocumentSuccess') : $t('trash.restoreDirectorySuccess');
      await loadItems(currentFolderId);
    } catch (err) {
      error = formatError(err);
    } finally {
      busyItemId = null;
    }
  }

  async function handlePurge(kind: TrashKind, id: string, name: string) {
    const confirmed = await dialogStore.confirm({
      title: $t('common.delete'),
      message: $t('trash.purgeConfirm', { values: { name } }),
      confirmLabel: $t('common.delete'),
      cancelLabel: $t('common.cancel'),
      danger: true,
    });
    if (!confirmed) return;

    busyItemId = id;
    error = null;
    try {
      if (kind === 'document') {
        await purgeDocument(id);
      } else {
        await purgeDirectory(id);
      }
      status = kind === 'document' ? $t('trash.purgeDocumentSuccess') : $t('trash.purgeDirectorySuccess');
      await loadItems(currentFolderId);
    } catch (err) {
      error = formatError(err);
    } finally {
      busyItemId = null;
    }
  }

  function normalizeFolderId(value: string) {
    const trimmed = value.trim();
    return trimmed || '/';
  }

  function formatDate(ts: number | null | undefined) {
    if (!ts) return '-';
    return new Date(ts * 1000).toLocaleString();
  }

  function formatError(err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }

  function toggleSelectFolder(id: string) {
    const next = new Set(selectedFolderIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedFolderIds = next;
  }

  function toggleSelectDocument(id: string) {
    const next = new Set(selectedDocumentIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedDocumentIds = next;
  }

  function clearSelection() {
    selectedFolderIds = new Set();
    selectedDocumentIds = new Set();
    selectMode = false;
  }

  function deselectAll() {
    selectedFolderIds = new Set();
    selectedDocumentIds = new Set();
  }

  function selectAllVisible() {
    selectedFolderIds = new Set(folders.map((folder) => folder.id));
    selectedDocumentIds = new Set(documents.map((document) => document.id));
  }

  function toggleAllVisibleSelection() {
    if (allVisibleSelected) {
      deselectAll();
    } else {
      selectAllVisible();
    }
  }

  function toggleSelectMode() {
    selectMode = !selectMode;
    if (!selectMode) clearSelection();
  }

  function isSelected(item: { kind: TrashKind; id: string }) {
    return item.kind === 'directory'
      ? selectedFolderIds.has(item.id)
      : selectedDocumentIds.has(item.id);
  }

  async function handleRestoreSelected() {
    if (totalSelected === 0 || batchBusy) return;
    const progressId = 'trash:batch-restore';
    const progressTitle = $t('trash.batchRestoring');
    const total = totalSelected;
    let completed = 0;
    batchBusy = true;
    updateBatchProgress(progressId, progressTitle, completed, total);
    error = null;
    let restored = 0;
    try {
      for (const id of selectedFolderIds) {
        await restoreDirectory(id, null);
        restored += 1;
        completed += 1;
        updateBatchProgress(progressId, progressTitle, completed, total);
      }
      for (const id of selectedDocumentIds) {
        await restoreDocument(id, null);
        restored += 1;
        completed += 1;
        updateBatchProgress(progressId, progressTitle, completed, total);
      }
      status = $t('trash.batchRestoreSuccess', { values: { count: restored } });
      clearSelection();
      await loadItems(currentFolderId);
    } catch (err) {
      error = formatError(err);
    } finally {
      batchBusy = false;
      floatingProgressStore.remove(progressId);
    }
  }

  async function handlePurgeSelected() {
    if (totalSelected === 0 || batchBusy) return;
    const confirmed = await dialogStore.confirm({
      title: $t('common.delete'),
      message: $t('trash.purgeSelectedConfirm', { values: { count: totalSelected } }),
      confirmLabel: $t('common.delete'),
      cancelLabel: $t('common.cancel'),
      danger: true,
    });
    if (!confirmed) return;

    const progressId = 'trash:batch-purge';
    const progressTitle = $t('trash.batchPurging');
    const total = totalSelected;
    let completed = 0;
    batchBusy = true;
    updateBatchProgress(progressId, progressTitle, completed, total);
    error = null;
    let purged = 0;
    try {
      for (const id of selectedFolderIds) {
        await purgeDirectory(id);
        purged += 1;
        completed += 1;
        updateBatchProgress(progressId, progressTitle, completed, total);
      }
      for (const id of selectedDocumentIds) {
        await purgeDocument(id);
        purged += 1;
        completed += 1;
        updateBatchProgress(progressId, progressTitle, completed, total);
      }
      status = $t('trash.batchPurgeSuccess', { values: { count: purged } });
      clearSelection();
      await loadItems(currentFolderId);
    } catch (err) {
      error = formatError(err);
    } finally {
      batchBusy = false;
      floatingProgressStore.remove(progressId);
    }
  }

  function updateBatchProgress(id: string, title: string, current: number, total: number) {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    floatingProgressStore.upsert(
      id,
      title,
      $t('trash.batchProgress', { values: { current, total, percent } }),
      current,
      total,
    );
  }
</script>

<div class="p-6 space-y-4">
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={() => navigateUp(page.url.pathname)}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('trash.title')}
      </h1>
      <p class="text-sm text-md3-on-surface-variant mt-1">
        {$t('trash.description')}
      </p>
    </div>

    <button
      class="p-2 rounded-full text-md3-on-surface-variant
             hover:bg-md3-surface-container-high transition-colors disabled:opacity-50"
      title={$t('common.refresh')}
      onclick={() => loadItems(currentFolderId)}
      disabled={loading}
    >
      <Icon name="refresh" size="20px" />
    </button>
  </div>

  <div class="flex flex-wrap items-center gap-1.5">
    <IconButton
      icon="checklist"
      label={$t('files.select')}
      active={selectMode}
      onclick={toggleSelectMode}
    />
    {#if selectMode}
      <div class="flex items-center gap-2 bg-md3-primary-container/30 rounded-xl
                  border border-md3-primary/20 px-3 py-2">
        <span class="text-xs text-md3-on-surface-variant">
          {$t('trash.selected', { values: { count: totalSelected } })}
        </span>
        <IconButton
          icon={allVisibleSelected ? 'clearAll' : 'selectAll'}
          label={allVisibleSelected ? $t('files.selectNone') : $t('files.selectAll')}
          active={allVisibleSelected}
          disabled={totalVisibleSelectable === 0}
          onclick={toggleAllVisibleSelection}
          class="!h-8 !w-8"
          size={17}
        />
        <IconButton
          icon="restoreFromTrash"
          label={$t('trash.restoreSelected')}
          disabled={totalSelected === 0 || batchBusy || !canRestore}
          onclick={handleRestoreSelected}
          class="!h-8 !w-8"
          size={17}
        />
        <IconButton
          icon="deleteForever"
          label={$t('trash.purgeSelected')}
          tone="danger"
          disabled={totalSelected === 0 || batchBusy || !canPurge}
          onclick={handlePurgeSelected}
          class="!h-8 !w-8"
          size={17}
        />
        <IconButton
          icon="close"
          label={$t('common.clear')}
          onclick={clearSelection}
          class="!h-8 !w-8"
          size={17}
        />
      </div>
    {/if}
  </div>

  <form
    class="flex flex-wrap items-end gap-2 bg-md3-surface-container/70 backdrop-blur-sm
           border border-md3-outline rounded-xl p-4"
    onsubmit={(e) => {
      e.preventDefault();
      loadItems(folderId);
    }}
  >
    <label class="flex-1 min-w-56 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {$t('trash.folderId')}
      <input
        class="mt-1 w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
               px-3 py-2 text-md3-on-surface disabled:opacity-60"
        bind:value={folderId}
        disabled={loading}
        placeholder="/"
      />
    </label>

    <button
      type="submit"
      class="px-4 py-2 rounded-full font-medium text-sm
             bg-md3-primary-container text-md3-on-primary-container
             hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
      style="font-family: var(--font-md3-sans);"
      disabled={loading}
    >
      <Icon name="search" size="18px" />
      {$t('trash.load')}
    </button>
  </form>

  {#if !canRestore && !canPurge}
    <div class="bg-md3-surface-container/70 border border-md3-outline
                text-md3-on-surface-variant text-sm rounded-xl p-3">
      {$t('trash.noPermission')}
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center gap-2 text-sm text-md3-on-surface-variant">
      <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
      {$t('common.loadingEllipsis')}
    </div>
  {:else}
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline overflow-x-auto">
      <div class="min-w-[720px]">
        <div class="grid grid-cols-[auto_minmax(280px,1fr)_180px_auto] gap-3 px-4 py-2.5
                    bg-md3-surface-container-high/50 text-xs font-medium
                    text-md3-on-surface-variant uppercase tracking-wider
                    border-b border-md3-outline">
          <span></span>
          <span>{$t('trash.name')}</span>
          <span class="text-right">{$t('trash.created')}</span>
          <span class="text-right">{$t('trash.actions')}</span>
        </div>

        {#if items.length === 0}
          <div class="p-12 text-center space-y-3">
            <span class="text-md3-on-surface-variant">
              <Icon name="delete" size="64px" />
            </span>
            <p class="text-md3-on-surface-variant" style="font-family: var(--font-md3-sans);">
              {$t('trash.empty')}
            </p>
          </div>
        {:else}
          {#each items as item (item.kind + item.id)}
            <div
              class="grid grid-cols-[auto_minmax(280px,1fr)_180px_auto] gap-3 px-4 py-2.5
                     border-b border-md3-outline/50 last:border-b-0 items-center text-left transition-colors
                     hover:bg-md3-surface-container-high/30"
            >
              {#if selectMode}
                <button
                  type="button"
                  class="self-center text-left {isSelected(item) ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}"
                  aria-label={isSelected(item) ? $t('files.selectNone') : $t('files.selectAll')}
                  onclick={() => item.kind === 'directory' ? toggleSelectFolder(item.id) : toggleSelectDocument(item.id)}
                >
                  <Icon name={isSelected(item) ? 'checkBox' : 'checkBoxBlank'} size="22px" />
                </button>
              {:else}
                <span class={item.kind === 'directory' ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}>
                  <Icon name={item.kind === 'directory' ? 'folder' : 'filePresent'} size="20px" />
                </span>
              {/if}
              <div class="min-w-0">
                <p class="text-sm text-md3-on-surface-variant truncate line-through decoration-md3-error/90 decoration-2">
                  {item.name}
                </p>
                <p class="text-xs text-md3-on-surface-variant truncate">ID: {item.id}</p>
              </div>
              <span class="text-xs text-md3-on-surface-variant text-right">
                {formatDate(item.created_time)}
              </span>
              <div class="flex items-center justify-end gap-1">
                <button
                  class="p-1.5 rounded-full text-md3-on-surface-variant
                         hover:bg-md3-primary-container/40 hover:text-md3-primary-emphasis
                         disabled:opacity-40 transition-colors"
                  title={$t('trash.restore')}
                  onclick={(event) => { event.stopPropagation(); handleRestore(item.kind, item.id, item.name); }}
                  disabled={!canRestore || busyItemId === item.id}
                >
                  <Icon name="restoreFromTrash" size="18px" />
                </button>
                <button
                  class="p-1.5 rounded-full text-md3-error
                         hover:bg-md3-error-container/40 disabled:opacity-40
                         transition-colors"
                  title={$t('trash.purge')}
                  onclick={(event) => { event.stopPropagation(); handlePurge(item.kind, item.id, item.name); }}
                  disabled={!canPurge || busyItemId === item.id}
                >
                  <Icon name="deleteForever" size="18px" />
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
