<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import type { PermissionEntry } from '$lib/api';
  import { dialogStore } from '$lib/dialogs.svelte';
  import {
    countPermissionEntryChanges,
    createImmediatePermissionEntry,
    permissionEntryChangeKind,
    permissionEntryState,
    permissionEntrySuggestions,
    validatePermissionEntry,
    type PermissionEntriesEditorData,
    type PermissionEntryFilter,
  } from '$lib/permission-entries';
  import { formatUserFacingError } from '$lib/user-facing-errors';
  import DialogActionButton from './DialogActionButton.svelte';
  import Icon from './Icon.svelte';
  import ModalFrame from './ModalFrame.svelte';
  import PermissionEntryEditor from './PermissionEntryEditor.svelte';
  import PermissionEntryList from './PermissionEntryList.svelte';
  import ProgressRing from './ProgressRing.svelte';

  type StartMode = 'immediate' | 'specified';
  type EndMode = 'never' | 'specified';

  interface EditableEntry {
    key: string;
    entry: PermissionEntry;
    initial: PermissionEntry | null;
    deleted: boolean;
    startMode: StartMode;
    endMode: EndMode;
  }

  let {
    title,
    description,
    entries = [],
    effectivePermissions = [],
    inheritedPermissions,
    onRefresh,
    onSave,
    onClose,
  }: {
    title: string;
    description: string;
    entries?: PermissionEntry[];
    effectivePermissions?: string[];
    inheritedPermissions?: string[];
    onRefresh?: () => Promise<PermissionEntriesEditorData>;
    onSave: (entries: PermissionEntry[]) => Promise<void>;
    onClose: () => void;
  } = $props();

  let nextKey = 0;

  function trackedEntries(source: PermissionEntry[]): EditableEntry[] {
    return source.map((entry) => {
      const snapshot = { ...entry };
      return {
        key: `permission-entry-${nextKey++}`,
        entry: { ...snapshot },
        initial: snapshot,
        deleted: false,
        startMode: 'specified',
        endMode: entry.end_time === null ? 'never' : 'specified',
      };
    });
  }

  const initialEntries = untrack(() => trackedEntries(entries));
  let localEntries = $state<EditableEntry[]>(initialEntries);
  let localEffectivePermissions = $state<string[]>(untrack(() => [...effectivePermissions]));
  let localInheritedPermissions = $state<string[] | undefined>(
    untrack(() => inheritedPermissions ? [...inheritedPermissions] : undefined),
  );
  let selectedKey = $state<string | null>(initialEntries[0]?.key ?? null);
  let query = $state('');
  let filter = $state<PermissionEntryFilter>('all');
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let nowSeconds = $state(Date.now() / 1000);
  let editorComponent: {
    focusPermissionName: () => void;
    focusUndo: () => void;
  } | undefined = $state();

  const rows = $derived(localEntries.map((row) => {
    const change = permissionEntryChangeKind(row.entry, row.initial, row.deleted);
    return {
      key: row.key,
      entry: row.entry,
      state: permissionEntryState(row.entry, nowSeconds),
      change,
      valid: validatePermissionEntry(row.entry).valid,
    };
  }));

  const selectedRow = $derived(localEntries.find((row) => row.key === selectedKey) ?? null);
  const selectedChange = $derived(selectedRow
    ? permissionEntryChangeKind(selectedRow.entry, selectedRow.initial, selectedRow.deleted)
    : 'unchanged');
  const selectedEditorRow = $derived(selectedRow ? {
    key: selectedRow.key,
    entry: selectedRow.entry,
    change: selectedChange,
    startMode: selectedRow.startMode,
    endMode: selectedRow.endMode,
  } : null);
  const selectedValidation = $derived(selectedRow && !selectedRow.deleted
    ? validatePermissionEntry(selectedRow.entry)
    : null);
  const changeCounts = $derived(countPermissionEntryChanges(rows.map((row) => row.change)));
  const dirty = $derived(changeCounts.total > 0);
  const hasInvalidEntries = $derived(rows.some((row) => row.change !== 'deleted' && !row.valid));
  const suggestions = $derived(permissionEntrySuggestions(
    localEntries.filter((row) => !row.deleted).map((row) => row.entry),
    localEffectivePermissions,
    localInheritedPermissions,
  ));
  const filterCounts = $derived<Record<PermissionEntryFilter, number>>({
    all: rows.length,
    active: rows.filter((row) => row.change !== 'deleted' && row.state === 'active').length,
    scheduled: rows.filter((row) => row.change !== 'deleted' && row.state === 'scheduled').length,
    expired: rows.filter((row) => row.change !== 'deleted' && row.state === 'expired').length,
    changed: rows.filter((row) => row.change !== 'unchanged').length,
  });

  onMount(() => {
    if (onRefresh) void refresh(false);
    const interval = window.setInterval(() => {
      nowSeconds = Date.now() / 1000;
    }, 30_000);
    return () => window.clearInterval(interval);
  });

  function replaceEditorData(data: PermissionEntriesEditorData) {
    const nextEntries = trackedEntries(data.entries);
    localEntries = nextEntries;
    localEffectivePermissions = [...data.effectivePermissions];
    localInheritedPermissions = data.inheritedPermissions
      ? [...data.inheritedPermissions]
      : undefined;
    selectedKey = nextEntries[0]?.key ?? null;
    query = '';
    filter = 'all';
  }

  async function startCreating() {
    const entry = createImmediatePermissionEntry('', Date.now() / 1000);
    const row: EditableEntry = {
      key: `permission-entry-${nextKey++}`,
      entry,
      initial: null,
      deleted: false,
      startMode: 'immediate',
      endMode: 'never',
    };
    localEntries = [...localEntries, row];
    selectedKey = row.key;
    query = '';
    filter = 'all';
    error = null;
    await tick();
    editorComponent?.focusPermissionName();
  }

  async function selectEntry(key: string, revealEditor = false) {
    selectedKey = key;
    error = null;
    if (
      !revealEditor
      || typeof window.matchMedia !== 'function'
      || !window.matchMedia('(max-width: 719px)').matches
    ) return;
    await tick();
    const editor = document.querySelector<HTMLElement>('.entry-editor-pane');
    if (typeof editor?.scrollIntoView !== 'function') return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    editor.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function reconcileVisibleSelection(visibleKeys: string[]) {
    if (selectedKey !== null && visibleKeys.includes(selectedKey)) return;
    selectedKey = visibleKeys[0] ?? null;
  }

  function patchSelected(patch: Partial<PermissionEntry>) {
    if (!selectedKey || saving) return;
    localEntries = localEntries.map((row) => row.key === selectedKey
      ? { ...row, entry: { ...row.entry, ...patch } }
      : row);
  }

  function setStartMode(mode: StartMode) {
    if (!selectedKey || saving) return;
    localEntries = localEntries.map((row) => {
      if (row.key !== selectedKey) return row;
      const startTime = mode === 'immediate'
        ? Math.floor(Date.now() / 1000)
        : Number.isFinite(row.entry.start_time)
          ? row.entry.start_time
          : Math.floor(Date.now() / 1000);
      return {
        ...row,
        startMode: mode,
        entry: { ...row.entry, start_time: startTime },
      };
    });
  }

  function setEndMode(mode: EndMode) {
    if (!selectedKey || saving) return;
    localEntries = localEntries.map((row) => {
      if (row.key !== selectedKey) return row;
      const endTime = mode === 'never'
        ? null
        : row.entry.end_time !== null && Number.isFinite(row.entry.end_time)
          ? row.entry.end_time
          : (Number.isFinite(row.entry.start_time) ? row.entry.start_time : Date.now() / 1000) + 86_400;
      return {
        ...row,
        endMode: mode,
        entry: { ...row.entry, end_time: endTime },
      };
    });
  }

  async function deleteEntry(key: string) {
    const index = localEntries.findIndex((row) => row.key === key);
    if (index < 0) return;
    const row = localEntries[index];

    if (row.initial === null) {
      const nextRows = localEntries.filter((item) => item.key !== key);
      localEntries = nextRows;
      if (selectedKey === key) {
        selectedKey = nextRows[Math.min(index, nextRows.length - 1)]?.key ?? null;
        await tick();
        if (selectedKey) document.getElementById(`permission-entry-select-${selectedKey}`)?.focus();
      }
      return;
    }

    localEntries = localEntries.map((item) => item.key === key ? { ...item, deleted: true } : item);
    selectedKey = key;
    await tick();
    editorComponent?.focusUndo();
  }

  async function undoDelete(key: string) {
    localEntries = localEntries.map((row) => row.key === key ? { ...row, deleted: false } : row);
    selectedKey = key;
    await tick();
    editorComponent?.focusPermissionName();
  }

  async function confirmDiscard(action: 'close' | 'refresh'): Promise<boolean> {
    if (!dirty) return true;
    return dialogStore.confirm({
      title: $t('manage.discardPermissionChangesTitle'),
      message: $t(action === 'refresh'
        ? 'manage.discardPermissionChangesRefreshMessage'
        : 'manage.discardPermissionChangesCloseMessage'),
      confirmLabel: $t('manage.discardPermissionChangesAction'),
      cancelLabel: $t('common.cancel'),
      danger: true,
    });
  }

  async function requestClose() {
    if (saving || !(await confirmDiscard('close'))) return;
    onClose();
  }

  async function refresh(askToDiscard = true) {
    if (!onRefresh || loading || saving) return;
    if (askToDiscard && !(await confirmDiscard('refresh'))) return;

    loading = true;
    error = null;
    try {
      replaceEditorData(await onRefresh());
    } catch (refreshError) {
      error = formatUserFacingError(refreshError);
    } finally {
      loading = false;
    }
  }

  async function save() {
    if (!dirty || hasInvalidEntries || loading || saving) return;
    saving = true;
    error = null;
    try {
      await onSave(localEntries
        .filter((row) => !row.deleted)
        .map(({ entry }) => ({
          permission: entry.permission.trim(),
          granted: entry.granted,
          start_time: entry.start_time,
          end_time: entry.end_time,
        })));
    } catch (saveError) {
      error = formatUserFacingError(saveError);
    } finally {
      saving = false;
    }
  }
</script>

<ModalFrame
  {title}
  maxWidth="max-w-5xl"
  resizable
  maximizable
  minWidth={620}
  minHeight={560}
  closeLabel={$t('common.close')}
  dismissible={!saving}
  onClose={() => { void requestClose(); }}
>
  <div class="permission-workspace">
    <header class="permission-overview">
      <span class="permission-overview-icon">
        <Icon name="adminPanelSettings" size="21px" />
      </span>
      <div class="permission-overview-copy">
        <p>{description}</p>
        <div class="replacement-notice">
          <Icon name="info" size="15px" />
          <span>{$t('manage.permissionReplacementNotice')}</span>
        </div>
      </div>
      {#if onRefresh}
        <button
          type="button"
          class="refresh-button"
          aria-label={$t('common.refresh')}
          title={$t('common.refresh')}
          disabled={loading || saving}
          onclick={() => { void refresh(); }}
        >
          <Icon name="refresh" size="18px" />
        </button>
      {/if}
    </header>

    <details class="permission-snapshot">
      <summary>
        <span class="snapshot-summary-copy">
          <Icon name="visibility" size="17px" />
          <span>
            <strong>{$t('manage.currentPermissionSnapshot')}</strong>
            <small>{$t('manage.currentPermissionSnapshotDescription')}</small>
          </span>
        </span>
        <span class="snapshot-counts">
          <span>{$t('manage.permissionSnapshotEffectiveCount', {
            values: { count: localEffectivePermissions.length },
          })}</span>
          {#if localInheritedPermissions !== undefined}
            <span>{$t('manage.permissionSnapshotInheritedCount', {
              values: { count: localInheritedPermissions.length },
            })}</span>
          {/if}
          <Icon name="expandMore" size="18px" />
        </span>
      </summary>
      <div class="snapshot-content">
        <section aria-labelledby="effective-permissions-title">
          <h3 id="effective-permissions-title">{$t('manage.effectivePermissions')}</h3>
          <div class="snapshot-values">
            {#if localEffectivePermissions.length === 0}
              <span class="snapshot-empty">{$t('manage.noEffectivePermissions')}</span>
            {:else}
              {#each localEffectivePermissions as permission (permission)}
                <span>{permission}</span>
              {/each}
            {/if}
          </div>
        </section>
        {#if localInheritedPermissions !== undefined}
          <section aria-labelledby="inherited-permissions-title">
            <h3 id="inherited-permissions-title">{$t('manage.inheritedPermissions')}</h3>
            <div class="snapshot-values snapshot-values--muted">
              {#if localInheritedPermissions.length === 0}
                <span class="snapshot-empty">{$t('manage.noInheritedPermissions')}</span>
              {:else}
                {#each localInheritedPermissions as permission (permission)}
                  <span>{permission}</span>
                {/each}
              {/if}
            </div>
          </section>
        {/if}
      </div>
    </details>

    {#if error}
      <div class="workspace-error" role="alert">
        <Icon name="errorFilled" size="17px" />
        <p>{error}</p>
      </div>
    {/if}

    <div class="permission-main" class:loading>
      <PermissionEntryList
        {rows}
        {selectedKey}
        {query}
        {filter}
        {filterCounts}
        disabled={saving || loading}
        onQueryChange={(value) => (query = value)}
        onFilterChange={(value) => (filter = value)}
        onSelect={selectEntry}
        onVisibleKeysChange={reconcileVisibleSelection}
        onAdd={() => { void startCreating(); }}
        onDelete={(key) => { void deleteEntry(key); }}
        onUndo={(key) => { void undoDelete(key); }}
      />
      <PermissionEntryEditor
        bind:this={editorComponent}
        row={selectedEditorRow}
        validation={selectedValidation}
        {suggestions}
        disabled={saving || loading}
        onPatch={patchSelected}
        onStartModeChange={setStartMode}
        onEndModeChange={setEndMode}
        onDelete={() => { if (selectedKey) void deleteEntry(selectedKey); }}
        onUndo={() => { if (selectedKey) void undoDelete(selectedKey); }}
      />
      {#if loading}
        <div class="loading-overlay" aria-live="polite">
          <ProgressRing size={20} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          <span>{$t('common.loadingEllipsis')}</span>
        </div>
      {/if}
    </div>

    <footer class="permission-footer">
      <div class="change-summary" aria-live="polite">
        {#if dirty}
          <span class="dirty-indicator"></span>
          <strong>{$t('manage.permissionUnsavedChanges')}</strong>
          <span>{$t('manage.permissionChangeSummary', {
            values: {
              added: changeCounts.added,
              modified: changeCounts.modified,
              deleted: changeCounts.deleted,
            },
          })}</span>
        {:else}
          <Icon name="verified" size="16px" />
          <span>{$t('manage.permissionNoUnsavedChanges')}</span>
        {/if}
        {#if hasInvalidEntries}
          <span class="footer-validation">
            <Icon name="errorFilled" size="14px" />
            {$t('manage.permissionResolveErrorsBeforeSave')}
          </span>
        {/if}
      </div>
      <div class="footer-actions">
        <DialogActionButton disabled={saving} onclick={() => { void requestClose(); }}>
          {$t('common.cancel')}
        </DialogActionButton>
        <DialogActionButton
          variant="primary"
          disabled={!dirty || hasInvalidEntries || loading || saving}
          onclick={save}
        >
          {#if saving}
            <ProgressRing size={16} strokeWidth={2.4} label={$t('common.saving')} />
            {$t('common.saving')}
          {:else}
            <Icon name="done" size="16px" />
            {$t('manage.saveAllPermissionChanges')}
          {/if}
        </DialogActionButton>
      </div>
    </footer>
  </div>
</ModalFrame>

<style>
  .permission-workspace {
    display: flex;
    width: 100%;
    max-width: 100%;
    height: min(82vh, 48rem);
    min-height: 34rem;
    flex-direction: column;
    color: var(--color-md3-on-surface);
  }

  .permission-overview {
    display: grid;
    flex: none;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.75rem;
    padding: 0.85rem 1.15rem 0.7rem;
  }

  .permission-overview-icon {
    display: grid;
    width: 2.25rem;
    height: 2.25rem;
    place-items: center;
    border-radius: var(--explorer-radius-medium, 8px);
    color: var(--color-md3-primary-emphasis);
    background: var(--color-md3-primary-container);
  }

  .permission-overview-copy > p {
    max-width: 72ch;
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font: 400 0.78rem/1.5 var(--font-md3-sans);
  }

  .replacement-notice {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
    margin-top: 0.2rem;
    color: var(--color-md3-on-surface-variant);
    font: 400 0.69rem/1.45 var(--font-md3-sans);
  }

  .replacement-notice :global(.material-symbols-rounded) { margin-top: 0.08rem; }

  .refresh-button {
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border-radius: var(--explorer-radius-small, 6px);
    color: var(--color-md3-on-surface-variant);
    transition: color 100ms ease, background-color 100ms ease, transform 120ms cubic-bezier(0.2, 0, 0, 1);
  }

  .refresh-button:hover:not(:disabled) { color: var(--color-md3-on-surface); background: var(--color-md3-surface-container-high); }
  .refresh-button:active:not(:disabled) { transform: rotate(20deg) scale(0.94); }

  .permission-snapshot {
    flex: none;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 58%, transparent);
    border-bottom: 1px solid var(--color-md3-outline);
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 38%, transparent);
  }

  .permission-snapshot summary {
    display: flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.55rem 1.15rem;
    cursor: pointer;
    list-style: none;
  }

  .permission-snapshot summary::-webkit-details-marker { display: none; }

  .snapshot-summary-copy,
  .snapshot-counts { display: flex; align-items: center; gap: 0.5rem; }

  .snapshot-summary-copy { min-width: 0; color: var(--color-md3-primary-emphasis); }
  .snapshot-summary-copy > span { display: grid; min-width: 0; }
  .snapshot-summary-copy strong { color: var(--color-md3-on-surface); font: 600 0.76rem/1.3 var(--font-md3-sans); }
  .snapshot-summary-copy small { color: var(--color-md3-on-surface-variant); font: 400 0.66rem/1.35 var(--font-md3-sans); }

  .snapshot-counts { flex: none; color: var(--color-md3-on-surface-variant); font: 500 0.68rem/1.3 var(--font-md3-sans); }
  .snapshot-counts > span { border-radius: 9999px; padding: 0.15rem 0.45rem; background: var(--color-md3-surface-container-highest); }
  .snapshot-counts :global(.material-symbols-rounded) { transition: transform 150ms cubic-bezier(0.2, 0, 0, 1); }
  .permission-snapshot[open] .snapshot-counts :global(.material-symbols-rounded) { transform: rotate(180deg); }

  .snapshot-content {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 58%, transparent);
    padding: 0.75rem 1.15rem 0.9rem;
  }

  .snapshot-content h3 { margin: 0 0 0.45rem; color: var(--color-md3-on-surface); font: 600 0.7rem/1.3 var(--font-md3-sans); }

  .snapshot-values { display: flex; max-height: 4.5rem; flex-wrap: wrap; gap: 0.3rem; overflow: auto; }
  .snapshot-values > span:not(.snapshot-empty) {
    max-width: 100%;
    overflow-wrap: anywhere;
    border-radius: 9999px;
    padding: 0.14rem 0.42rem;
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
    font: 500 0.66rem/1.35 var(--font-md3-sans);
  }

  .snapshot-values--muted > span:not(.snapshot-empty) { color: var(--color-md3-on-surface-variant); background: var(--color-md3-surface-container-highest); }
  .snapshot-empty { color: var(--color-md3-on-surface-variant); font: 400 0.68rem/1.4 var(--font-md3-sans); }

  .workspace-error {
    display: flex;
    flex: none;
    align-items: flex-start;
    gap: 0.45rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-md3-error) 30%, transparent);
    padding: 0.6rem 1.15rem;
    color: var(--color-md3-on-error-container);
    background: var(--color-md3-error-container);
  }

  .workspace-error p { min-width: 0; margin: 0; overflow-wrap: anywhere; font: 400 0.75rem/1.45 var(--font-md3-sans); }

  .permission-main {
    position: relative;
    display: grid;
    min-height: 0;
    flex: 1;
    grid-template-columns: minmax(18rem, 2fr) minmax(22rem, 3fr);
    overflow: hidden;
  }

  .permission-main.loading > :global(section) { opacity: 0.55; }

  .loading-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    color: var(--color-md3-on-surface-variant);
    background: color-mix(in srgb, var(--color-md3-surface-container) 72%, transparent);
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
    font: 500 0.76rem/1.4 var(--font-md3-sans);
  }

  .permission-footer {
    display: flex;
    min-height: 3.75rem;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-top: 1px solid var(--color-md3-outline);
    padding: 0.65rem 1rem;
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 45%, transparent);
  }

  .change-summary {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    color: var(--color-md3-on-surface-variant);
    font: 400 0.69rem/1.4 var(--font-md3-sans);
  }

  .change-summary strong { color: var(--color-md3-on-surface); font-weight: 600; }
  .dirty-indicator { width: 0.5rem; height: 0.5rem; flex: none; border-radius: 9999px; background: var(--color-md3-primary); box-shadow: 0 1px 4px color-mix(in srgb, var(--color-md3-primary) 42%, transparent); }

  .footer-validation { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--color-md3-error); font-weight: 500; }
  .footer-actions { display: flex; flex: none; align-items: center; gap: 0.5rem; }

  button:disabled { cursor: not-allowed; opacity: 0.45; }

  @media (max-width: 719px) {
    .permission-workspace { height: min(88vh, 54rem); min-height: 0; }
    .permission-main { display: block; width: 100%; max-width: 100%; overflow-x: hidden; overflow-y: auto; }
    .permission-overview { padding-inline: 0.9rem; }
    .permission-overview-icon { display: none; }
    .permission-overview { grid-template-columns: minmax(0, 1fr) auto; }
    .permission-snapshot summary { align-items: flex-start; padding-inline: 0.9rem; }
    .snapshot-counts { flex-wrap: wrap; justify-content: flex-end; }
    .snapshot-summary-copy small { display: none; }
    .snapshot-content { grid-template-columns: 1fr; padding-inline: 0.9rem; }
    .permission-footer { align-items: flex-end; }
    .change-summary { display: grid; gap: 0.15rem; }
  }

  @media (max-width: 480px) {
    .permission-footer { align-items: stretch; flex-direction: column; }
    .footer-actions { justify-content: flex-end; }
    .snapshot-counts > span { display: none; }
  }

  @media (pointer: coarse) {
    .refresh-button { width: 2.75rem; height: 2.75rem; }
    .permission-snapshot summary { min-height: 3rem; }
  }

  @media (prefers-reduced-motion: reduce) {
    .refresh-button,
    .snapshot-counts :global(.material-symbols-rounded) { transition: none; }
  }
</style>
