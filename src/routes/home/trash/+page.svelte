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
  import { authStore, floatingProgressStore, notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import TaskActionButton from '$lib/components/TaskActionButton.svelte';
  import VirtualList from '$lib/components/VirtualList.svelte';
  import { registerKeyboardCommands } from '$lib/keyboard';
  import { formatUserFacingError } from '$lib/user-facing-errors';

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

  onMount(() => registerKeyboardCommands({
    id: 'trash.refresh',
    label: () => $t('common.refresh'),
    group: () => $t('trash.title'),
    shortcuts: [{ key: 'F5' }, { key: 'r', primary: true }],
    scope: 'page',
    enabled: () => !loading && !batchBusy,
    handler: () => loadItems(currentFolderId),
  }));

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
    return formatUserFacingError(err);
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

<div class="workspace-page trash-page">
  <header class="trash-header">
    <div>
      <h1>{$t('trash.title')}</h1>
      <p>{$t('trash.description')}</p>
    </div>

    <button
      class="icon-button"
      title={$t('common.refresh')}
      aria-label={$t('common.refresh')}
      onclick={() => loadItems(currentFolderId)}
      disabled={loading}
    >
      <Icon name="refresh" size="20px" />
    </button>
  </header>

  <form
    class="trash-toolbar"
    aria-label={$t('trash.folderId')}
    onsubmit={(e) => {
      e.preventDefault();
      loadItems(folderId);
    }}
  >
    <label class="scope-field">
      <span>{$t('trash.folderId')}</span>
      <input
        data-focus-ring="delegated"
        bind:value={folderId}
        disabled={loading}
        placeholder="/"
      />
    </label>

    <button
      type="submit"
      class="load-button"
      disabled={loading}
    >
      <Icon name="search" size="18px" />
      {$t('trash.load')}
    </button>

    <span class="toolbar-divider" aria-hidden="true"></span>

    <button
      type="button"
      class="select-button"
      class:active={selectMode}
      aria-pressed={selectMode}
      onclick={toggleSelectMode}
    >
      <Icon name="checklist" size="18px" />
      {$t('files.select')}
    </button>
  </form>

  {#if selectMode}
    <div class="selection-toolbar" role="toolbar" aria-label={$t('files.select')}>
      <span class="selection-summary">
        {$t('trash.selected', { values: { count: totalSelected } })}
      </span>
      <div class="selection-actions">
        <TaskActionButton
          presentation="labelled"
          icon={allVisibleSelected ? 'clearAll' : 'selectAll'}
          label={allVisibleSelected ? $t('files.selectNone') : $t('files.selectAll')}
          tone="primary"
          disabled={totalVisibleSelectable === 0}
          onclick={toggleAllVisibleSelection}
        />
        <TaskActionButton
          presentation="labelled"
          icon="restoreFromTrash"
          label={$t('trash.restoreSelected')}
          tone="primary"
          disabled={totalSelected === 0 || batchBusy || !canRestore}
          onclick={handleRestoreSelected}
        />
        <TaskActionButton
          presentation="labelled"
          icon="deleteForever"
          label={$t('trash.purgeSelected')}
          tone="danger"
          disabled={totalSelected === 0 || batchBusy || !canPurge}
          onclick={handlePurgeSelected}
        />
        <TaskActionButton
          presentation="labelled"
          icon="close"
          label={$t('common.clear')}
          onclick={clearSelection}
        />
      </div>
    </div>
  {/if}

  {#if !canRestore && !canPurge}
    <div class="permission-note">
      <Icon name="info" size="17px" />
      {$t('trash.noPermission')}
    </div>
  {/if}

  <section class="trash-list-shell" aria-busy={loading} aria-label={$t('trash.title')}>
    <div class="trash-list-header" role="row">
      <span aria-hidden="true"></span>
      <span role="columnheader">{$t('trash.name')}</span>
      <span role="columnheader" class="created-column">{$t('trash.created')}</span>
      <span role="columnheader" class="actions-column">{$t('trash.actions')}</span>
    </div>

    {#if loading}
      <div class="loading-state">
        <ProgressRing size={20} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
        <span>{$t('common.loadingEllipsis')}</span>
      </div>
    {:else}
      <div class="trash-list-body">
        {#if items.length === 0}
          <div class="empty-state">
            <Icon name="delete" size="44px" />
            <h2>{$t('trash.empty')}</h2>
            <p>{$t('trash.description')}</p>
          </div>
        {:else}
          <VirtualList
            items={items}
            keyOf={(item) => `${item.kind}:${item.id}`}
            estimateSize={61}
            overscan={8}
            threshold={120}
            resetKey={`${currentFolderId}:${selectMode}`}
            viewportClass="trash-list-viewport"
            keyboardNavigation
            keyboardTargetSelector="button"
          >
            {#snippet children(item, index)}
              <div
                class="trash-row"
                class:selected={isSelected(item)}
                class:last-row={index === items.length - 1}
                role="row"
              >
                {#if selectMode}
                  <button
                    type="button"
                    class="row-select"
                    class:checked={isSelected(item)}
                    aria-label={`${$t('files.select')} ${item.name}`}
                    aria-pressed={isSelected(item)}
                    onclick={() => item.kind === 'directory' ? toggleSelectFolder(item.id) : toggleSelectDocument(item.id)}
                  >
                    <Icon name={isSelected(item) ? 'checkBox' : 'checkBoxBlank'} size="22px" />
                  </button>
                {:else}
                  <span class="kind-icon" class:folder={item.kind === 'directory'} aria-hidden="true">
                    <Icon name={item.kind === 'directory' ? 'folder' : 'filePresent'} size="20px" />
                  </span>
                {/if}
                <div class="item-identity" role="cell">
                  <p class="item-name">{item.name}</p>
                  <p class="item-meta">
                    <span>ID: {item.id}</span>
                    <span class="mobile-created">{formatDate(item.created_time)}</span>
                  </p>
                </div>
                <span class="item-created created-column" role="cell">
                  {formatDate(item.created_time)}
                </span>
                <div class="row-actions" role="cell">
                  <TaskActionButton
                    icon="restoreFromTrash"
                    label={$t('trash.restore')}
                    tone="primary"
                    onclick={() => handleRestore(item.kind, item.id, item.name)}
                    disabled={!canRestore || busyItemId === item.id}
                  />
                  <TaskActionButton
                    icon="deleteForever"
                    label={$t('trash.purge')}
                    tone="danger"
                    onclick={() => handlePurge(item.kind, item.id, item.name)}
                    disabled={!canPurge || busyItemId === item.id}
                  />
                </div>
              </div>
            {/snippet}
          </VirtualList>
        {/if}
      </div>
    {/if}
  </section>
</div>

<style>
  .trash-page {
    display: flex;
    height: 100%;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    gap: 0.9rem;
    overflow: hidden;
    padding: 1rem clamp(1rem, 2vw, 1.5rem) 1.5rem;
  }

  .trash-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .trash-header h1 {
    color: var(--explorer-text);
    font-size: 1.25rem;
    font-weight: 700;
  }

  .trash-header p {
    max-width: 68ch;
    margin-top: 0.2rem;
    color: var(--explorer-text-muted);
    font-size: 0.8125rem;
  }

  .icon-button {
    display: grid;
    width: 36px;
    height: 36px;
    flex: none;
    place-items: center;
    border-radius: 999px;
    color: var(--explorer-text-muted);
    transition:
      color 120ms var(--motion-easing-standard),
      background-color 120ms var(--motion-easing-standard),
      transform 120ms var(--motion-easing-standard);
  }

  .icon-button:hover:not(:disabled) {
    color: var(--explorer-text);
    background: var(--explorer-surface-hover);
  }

  .icon-button:active:not(:disabled) { transform: scale(0.94); }
  .icon-button:disabled { opacity: 0.45; }

  .trash-toolbar {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(240px, 1fr) auto 1px auto;
    align-items: center;
    gap: 0.55rem;
  }

  .scope-field {
    display: flex;
    min-width: 0;
    min-height: 40px;
    align-items: center;
    gap: 0.65rem;
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-medium);
    padding: 0 0.7rem;
    color: var(--explorer-text-muted);
    background: var(--explorer-surface-raised);
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    transition:
      border-color 140ms var(--motion-easing-standard),
      box-shadow 140ms var(--motion-easing-standard),
      background-color 140ms var(--motion-easing-standard);
  }

  .scope-field:focus-within {
    border-color: var(--explorer-accent);
    box-shadow: inset 0 0 0 1px var(--explorer-accent);
  }

  .scope-field input,
  .scope-field input:focus {
    min-width: 0;
    width: 100%;
    flex: 1;
    appearance: none;
    border: 0 !important;
    outline: 0;
    padding: 0;
    color: var(--explorer-text);
    background: transparent;
    box-shadow: none !important;
    font: 400 0.8125rem/1.4 var(--font-md3-mono, var(--font-md3-sans));
  }

  .scope-field input:disabled { opacity: 0.55; }

  .load-button,
  .select-button {
    display: inline-flex;
    min-height: 36px;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border-radius: var(--explorer-radius-small);
    padding: 0.3rem 0.7rem;
    font-size: 0.75rem;
    font-weight: 600;
    transition:
      color 120ms var(--motion-easing-standard),
      background-color 120ms var(--motion-easing-standard),
      transform 120ms var(--motion-easing-standard),
      opacity 120ms var(--motion-easing-standard);
  }

  .load-button {
    color: var(--explorer-accent);
    background: var(--explorer-accent-soft);
  }

  .select-button { color: var(--explorer-text-muted); }
  .select-button.active { color: var(--explorer-accent); background: var(--explorer-accent-soft); }
  .load-button:hover:not(:disabled) { background: var(--explorer-surface-selected); }
  .select-button:hover { color: var(--explorer-text); background: var(--explorer-surface-hover); }
  .load-button:active:not(:disabled),
  .select-button:active { transform: scale(0.96); }
  .load-button:disabled { opacity: 0.45; }

  .toolbar-divider {
    width: 1px;
    height: 24px;
    background: var(--explorer-border);
  }

  .selection-toolbar {
    display: flex;
    min-height: 40px;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    border-block: 1px solid var(--explorer-border);
    padding: 0.25rem 0.35rem 0.25rem 0.7rem;
    background: color-mix(in srgb, var(--explorer-accent) 5%, transparent);
  }

  .selection-summary {
    flex: none;
    color: var(--explorer-text);
    font-size: 0.75rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .selection-actions {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    gap: 0.15rem;
  }

  .permission-note {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.2rem 0.7rem;
    color: var(--explorer-text-muted);
    font-size: 0.75rem;
  }

  .trash-list-shell {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
    border-top: 1px solid var(--explorer-border);
  }

  .trash-list-header,
  .trash-row {
    display: grid;
    grid-template-columns: 36px minmax(220px, 1fr) minmax(140px, 180px) 84px;
    align-items: center;
    gap: 0.65rem;
    padding-inline: 0.55rem;
  }

  .trash-list-header {
    min-height: 40px;
    flex: none;
    border-bottom: 1px solid var(--explorer-border);
    color: var(--explorer-text-muted);
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .created-column,
  .actions-column { text-align: end; }

  .trash-list-body {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
  }

  :global(.trash-list-viewport) {
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .trash-row {
    min-height: 58px;
    border-bottom: 1px solid var(--explorer-border);
    color: var(--explorer-text);
    transition: background-color 120ms var(--motion-easing-standard);
  }

  .trash-row:hover { background: var(--explorer-surface-hover); }
  .trash-row.selected { background: var(--explorer-accent-soft); }
  .trash-row.last-row { border-bottom-color: transparent; }

  .kind-icon,
  .row-select {
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    border-radius: 999px;
    color: var(--explorer-text-muted);
  }

  .kind-icon.folder { color: var(--explorer-folder); }
  .row-select:hover { color: var(--explorer-text); background: var(--explorer-surface-selected); }
  .row-select.checked { color: var(--explorer-accent); }

  .item-identity { min-width: 0; }
  .item-name {
    overflow: hidden;
    color: var(--explorer-text);
    font-size: 0.8125rem;
    line-height: 1.35;
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--explorer-danger) 65%, transparent);
    text-decoration-thickness: 1px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-meta {
    display: flex;
    min-width: 0;
    gap: 0.55rem;
    overflow: hidden;
    color: var(--explorer-text-muted);
    font: 400 0.6875rem/1.4 var(--font-md3-mono, var(--font-md3-sans));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-created {
    color: var(--explorer-text-muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .mobile-created { display: none; }
  .row-actions { display: flex; justify-content: flex-end; gap: 0.1rem; }

  .loading-state,
  .empty-state {
    display: grid;
    min-height: 0;
    flex: 1;
    place-items: center;
    align-content: center;
    color: var(--explorer-text-muted);
    text-align: center;
  }

  .loading-state {
    grid-template-columns: auto auto;
    gap: 0.5rem;
    font-size: 0.8125rem;
  }

  .empty-state { gap: 0.4rem; padding: 2rem; }
  .empty-state h2 { color: var(--explorer-text); font-size: 0.9375rem; font-weight: 650; }
  .empty-state p { max-width: 52ch; font-size: 0.8125rem; }

  @media (max-width: 720px) {
    .trash-toolbar { grid-template-columns: minmax(0, 1fr) auto; }
    .toolbar-divider { display: none; }
    .select-button { grid-column: 2; }
    .selection-toolbar { align-items: flex-start; flex-direction: column; }
    .selection-actions { width: 100%; justify-content: flex-start; overflow-x: auto; }
    .trash-list-header,
    .trash-row { grid-template-columns: 36px minmax(0, 1fr) 84px; }
    .created-column { display: none; }
    .mobile-created { display: inline; }
  }

  @media (max-width: 520px) {
    .trash-page { padding: 0.85rem; }
    .trash-header { align-items: center; }
    .trash-header p { display: none; }
    .trash-toolbar { grid-template-columns: minmax(0, 1fr) auto; }
    .scope-field { grid-column: 1 / -1; }
    .load-button { grid-column: 1; }
    .select-button { grid-column: 2; }
    .trash-list-header,
    .trash-row { padding-inline: 0.25rem; }
    .empty-state p { display: none; }
  }

  @media (pointer: coarse) {
    .icon-button { width: 44px; height: 44px; }
    .load-button,
    .select-button { min-height: 44px; }
    .trash-row { min-height: 66px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .icon-button,
    .scope-field,
    .load-button,
    .select-button,
    .trash-row { transition: none; }
    .icon-button:active:not(:disabled),
    .load-button:active:not(:disabled),
    .select-button:active { transform: none; }
  }
</style>
