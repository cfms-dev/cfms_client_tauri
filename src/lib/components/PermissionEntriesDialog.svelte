<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import type { PermissionEntry } from '$lib/api';
  import {
    createImmediatePermissionEntry,
    parseLocalDateTimeInput,
    permissionEntryState,
    toLocalDateTimeInput,
    type PermissionEntriesEditorData,
    type PermissionEntryState,
  } from '$lib/permission-entries';
  import { formatUserFacingError } from '$lib/user-facing-errors';
  import DialogActionButton from './DialogActionButton.svelte';
  import Icon from './Icon.svelte';
  import MdSwitch from './MdSwitch.svelte';
  import ModalFrame from './ModalFrame.svelte';
  import ProgressRing from './ProgressRing.svelte';

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

  interface EditableEntry {
    key: string;
    entry: PermissionEntry;
  }

  interface EntryDraft {
    sourceKey: string | null;
    permission: string;
    granted: boolean;
    startTime: string;
    expiryEnabled: boolean;
    endTime: string;
  }

  let nextKey = 0;
  const editable = (entry: PermissionEntry): EditableEntry => ({
    key: `permission-entry-${nextKey++}`,
    entry: { ...entry },
  });

  let localEntries = $state<EditableEntry[]>(untrack(() => entries.map(editable)));
  let localEffectivePermissions = $state<string[]>(untrack(() => [...effectivePermissions]));
  let localInheritedPermissions = $state<string[] | undefined>(
    untrack(() => inheritedPermissions ? [...inheritedPermissions] : undefined),
  );
  let draft = $state<EntryDraft | null>(null);
  let query = $state('');
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let editorError = $state<string | null>(null);
  let nowSeconds = $state(Date.now() / 1000);

  const visibleEntries = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return localEntries;

    return localEntries.filter(({ entry }) => [
      entry.permission,
      entry.granted ? $t('manage.permissionGrant') : $t('manage.permissionRevoke'),
      stateLabel(permissionEntryState(entry, nowSeconds)),
    ].some((value) => value.toLocaleLowerCase().includes(needle)));
  });

  onMount(() => {
    if (onRefresh) void refresh();
    const interval = window.setInterval(() => {
      nowSeconds = Date.now() / 1000;
    }, 30_000);
    return () => window.clearInterval(interval);
  });

  function stateLabel(state: PermissionEntryState): string {
    return $t(`manage.permissionState.${state}`);
  }

  function stateClass(state: PermissionEntryState): string {
    if (state === 'active') return 'bg-md3-primary-container text-md3-on-primary-container';
    if (state === 'scheduled') return 'bg-md3-tertiary-container text-md3-on-tertiary-container';
    return 'bg-md3-surface-container-highest text-md3-on-surface-variant';
  }

  function formatTimestamp(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(new Date(timestamp * 1000));
  }

  function startCreating() {
    const entry = createImmediatePermissionEntry('', Date.now() / 1000);
    draft = {
      sourceKey: null,
      permission: '',
      granted: true,
      startTime: toLocalDateTimeInput(entry.start_time),
      expiryEnabled: false,
      endTime: toLocalDateTimeInput(entry.start_time + 86_400),
    };
    editorError = null;
  }

  function startEditing(row: EditableEntry) {
    draft = {
      sourceKey: row.key,
      permission: row.entry.permission,
      granted: row.entry.granted,
      startTime: toLocalDateTimeInput(row.entry.start_time),
      expiryEnabled: row.entry.end_time !== null,
      endTime: toLocalDateTimeInput(row.entry.end_time ?? row.entry.start_time + 86_400),
    };
    editorError = null;
  }

  function cancelEditing() {
    draft = null;
    editorError = null;
  }

  function applyDraft() {
    if (!draft) return;

    const permission = draft.permission.trim();
    const startTime = parseLocalDateTimeInput(draft.startTime);
    const endTime = draft.expiryEnabled ? parseLocalDateTimeInput(draft.endTime) : null;
    if (!permission) {
      editorError = $t('manage.permissionNameRequired');
      return;
    }
    if (startTime === null) {
      editorError = $t('manage.permissionStartInvalid');
      return;
    }
    if (draft.expiryEnabled && endTime === null) {
      editorError = $t('manage.permissionEndInvalid');
      return;
    }
    if (endTime !== null && endTime < startTime) {
      editorError = $t('manage.permissionIntervalInvalid');
      return;
    }

    const entry: PermissionEntry = {
      permission,
      granted: draft.granted,
      start_time: startTime,
      end_time: endTime,
    };
    if (draft.sourceKey === null) {
      localEntries = [...localEntries, editable(entry)];
    } else {
      localEntries = localEntries.map((row) => row.key === draft?.sourceKey
        ? { ...row, entry }
        : row);
    }
    cancelEditing();
  }

  function deleteEntry(key: string) {
    localEntries = localEntries.filter((row) => row.key !== key);
    if (draft?.sourceKey === key) cancelEditing();
  }

  async function refresh() {
    if (!onRefresh) return;

    loading = true;
    error = null;
    try {
      const data = await onRefresh();
      localEntries = data.entries.map(editable);
      localEffectivePermissions = [...data.effectivePermissions];
      localInheritedPermissions = data.inheritedPermissions
        ? [...data.inheritedPermissions]
        : undefined;
      cancelEditing();
    } catch (refreshError) {
      error = formatUserFacingError(refreshError);
    } finally {
      loading = false;
    }
  }

  async function save() {
    saving = true;
    error = null;
    try {
      await onSave(localEntries.map(({ entry }) => ({ ...entry })));
    } catch (saveError) {
      error = formatUserFacingError(saveError);
    } finally {
      saving = false;
    }
  }
</script>

<ModalFrame
  {title}
  maxWidth="max-w-3xl"
  resizable
  maximizable
  minWidth={520}
  minHeight={520}
  closeLabel={$t('common.close')}
  onClose={() => {
    if (!saving) onClose();
  }}
>
  <div class="flex h-full min-h-0 max-h-[82vh] flex-col">
    <div class="space-y-4 border-b border-md3-outline/60 p-5">
      <div class="flex items-start gap-3">
        <span class="rounded-lg bg-md3-primary-container/70 p-2 text-md3-primary-emphasis">
          <Icon name="adminPanelSettings" size="22px" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm leading-5 text-md3-on-surface-variant">{description}</p>
          <p class="mt-1 text-xs leading-5 text-md3-on-surface-variant">
            {$t('manage.permissionReplacementNotice')}
          </p>
        </div>
        {#if onRefresh}
          <button
            type="button"
            class="rounded-full p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high hover:text-md3-on-surface disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={$t('common.refresh')}
            title={$t('common.refresh')}
            disabled={loading || saving}
            onclick={refresh}
          >
            <Icon name="refresh" size="18px" />
          </button>
        {/if}
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <section class="min-w-0" aria-labelledby="effective-permissions-title">
          <h3 id="effective-permissions-title" class="text-xs font-semibold text-md3-on-surface">
            {$t('manage.effectivePermissions')}
          </h3>
          <div class="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-auto">
            {#if localEffectivePermissions.length === 0}
              <span class="text-xs text-md3-on-surface-variant">{$t('manage.noEffectivePermissions')}</span>
            {:else}
              {#each localEffectivePermissions as permission (permission)}
                <span class="max-w-full break-all rounded-full bg-md3-primary-container px-2.5 py-1 text-xs text-md3-on-primary-container">
                  {permission}
                </span>
              {/each}
            {/if}
          </div>
        </section>

        {#if localInheritedPermissions !== undefined}
          <section class="min-w-0" aria-labelledby="inherited-permissions-title">
            <h3 id="inherited-permissions-title" class="text-xs font-semibold text-md3-on-surface">
              {$t('manage.inheritedPermissions')}
            </h3>
            <div class="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-auto">
              {#if localInheritedPermissions.length === 0}
                <span class="text-xs text-md3-on-surface-variant">{$t('manage.noInheritedPermissions')}</span>
              {:else}
                {#each localInheritedPermissions as permission (permission)}
                  <span class="max-w-full break-all rounded-full bg-md3-surface-container-high px-2.5 py-1 text-xs text-md3-on-surface-variant">
                    {permission}
                  </span>
                {/each}
              {/if}
            </div>
          </section>
        {/if}
      </div>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div class="relative min-w-0 flex-1">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
            <Icon name="search" size="18px" />
          </span>
          <input
            class="w-full rounded-lg border border-md3-outline bg-md3-field py-2.5 pl-10 pr-3 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
            aria-label={$t('manage.searchPermissionEntries')}
            placeholder={$t('manage.searchPermissionEntries')}
            bind:value={query}
            disabled={loading || saving}
          />
        </div>
        <DialogActionButton
          variant="tonal"
          disabled={loading || saving || draft !== null}
          onclick={startCreating}
        >
          <Icon name="add" size="17px" />
          {$t('manage.addPermissionEntry')}
        </DialogActionButton>
      </div>
    </div>

    <div class="modal-flex-region min-h-[20rem] flex-1 overflow-auto p-5">
      {#if error}
        <div class="mb-4 flex items-start gap-2 rounded-lg border border-md3-error/35 bg-md3-error-container/25 p-3 text-sm text-md3-on-error-container" role="alert">
          <Icon name="errorFilled" size="17px" />
          <p class="min-w-0 break-words">{error}</p>
        </div>
      {/if}

      {#if draft}
        <form
          class="mb-5 space-y-4 rounded-xl bg-md3-surface-container-high p-4"
          aria-label={$t(draft.sourceKey === null ? 'manage.addPermissionEntry' : 'manage.editPermissionEntry')}
          onsubmit={(event) => {
            event.preventDefault();
            applyDraft();
          }}
        >
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-sm font-semibold text-md3-on-surface">
              {$t(draft.sourceKey === null ? 'manage.addPermissionEntry' : 'manage.editPermissionEntry')}
            </h3>
            <button
              type="button"
              class="rounded-full p-1.5 text-md3-on-surface-variant hover:bg-md3-surface-container-highest hover:text-md3-on-surface"
              aria-label={$t('common.cancel')}
              onclick={cancelEditing}
            >
              <Icon name="close" size="18px" />
            </button>
          </div>

          <label class="grid gap-1.5 text-sm text-md3-on-surface">
            <span class="font-medium">{$t('manage.permissionName')}</span>
            <input
              bind:value={draft.permission}
              maxlength="255"
              autocomplete="off"
              class="w-full rounded-lg border border-md3-outline bg-md3-field px-3 py-2.5 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
              disabled={saving}
            />
          </label>

          <fieldset class="grid gap-2">
            <legend class="text-sm font-medium text-md3-on-surface">{$t('manage.permissionEffect')}</legend>
            <div class="grid grid-cols-2 overflow-hidden rounded-lg border border-md3-outline">
              <button
                type="button"
                class="flex min-h-10 items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition-colors {draft.granted ? 'bg-md3-primary-container text-md3-on-primary-container' : 'text-md3-on-surface-variant hover:bg-md3-surface-container-high'}"
                aria-pressed={draft.granted}
                onclick={() => (draft!.granted = true)}
              >
                <Icon name="checkCircle" size="17px" />
                {$t('manage.permissionGrant')}
              </button>
              <button
                type="button"
                class="flex min-h-10 items-center justify-center gap-2 border-l border-md3-outline px-3 py-2 text-sm font-medium transition-colors {!draft.granted ? 'bg-md3-error-container text-md3-on-error-container' : 'text-md3-on-surface-variant hover:bg-md3-surface-container-high'}"
                aria-pressed={!draft.granted}
                onclick={() => (draft!.granted = false)}
              >
                <Icon name="block" size="17px" />
                {$t('manage.permissionRevoke')}
              </button>
            </div>
          </fieldset>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="grid min-w-0 gap-1.5 text-sm text-md3-on-surface">
              <span class="font-medium">{$t('manage.permissionStartsAt')}</span>
              <input
                bind:value={draft.startTime}
                type="datetime-local"
                step="1"
                class="min-w-0 rounded-lg border border-md3-outline bg-md3-field px-3 py-2.5 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
                disabled={saving}
              />
            </label>
            <div class="grid min-w-0 gap-1.5">
              <div class="flex min-h-5 items-center justify-between gap-3">
                <span class="text-sm font-medium text-md3-on-surface">{$t('manage.permissionEndsAt')}</span>
                <MdSwitch
                  bind:checked={draft.expiryEnabled}
                  disabled={saving}
                  ariaLabel={$t('manage.permissionExpiryEnabled')}
                />
              </div>
              {#if draft.expiryEnabled}
                <input
                  bind:value={draft.endTime}
                  type="datetime-local"
                  step="1"
                  aria-label={$t('manage.permissionEndsAt')}
                  class="min-w-0 rounded-lg border border-md3-outline bg-md3-field px-3 py-2.5 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
                  disabled={saving}
                />
              {:else}
                <div class="flex min-h-[42px] items-center rounded-lg bg-md3-surface-container-highest px-3 text-sm text-md3-on-surface-variant">
                  {$t('manage.permissionNeverExpires')}
                </div>
              {/if}
            </div>
          </div>

          {#if editorError}
            <p class="text-sm text-md3-error" role="alert">{editorError}</p>
          {/if}

          <div class="flex flex-wrap justify-end gap-2">
            <DialogActionButton disabled={saving} onclick={cancelEditing}>
              {$t('common.cancel')}
            </DialogActionButton>
            <DialogActionButton type="submit" variant="primary" disabled={saving}>
              <Icon name="done" size="16px" />
              {$t('manage.applyPermissionEntry')}
            </DialogActionButton>
          </div>
        </form>
      {/if}

      {#if loading}
        <div class="flex items-center justify-center gap-2 py-12 text-sm text-md3-on-surface-variant">
          <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {$t('common.loadingEllipsis')}
        </div>
      {:else if visibleEntries.length === 0}
        <div class="rounded-lg border border-dashed border-md3-outline px-4 py-10 text-center">
          <p class="text-sm text-md3-on-surface-variant">
            {query.trim() ? $t('manage.noPermissionEntryMatches') : $t('manage.noPermissionEntries')}
          </p>
          {#if !query.trim() && draft === null}
            <button
              type="button"
              class="mt-3 text-sm font-semibold text-md3-primary-emphasis hover:underline"
              onclick={startCreating}
            >
              {$t('manage.addPermissionEntry')}
            </button>
          {/if}
        </div>
      {:else}
        <div class="divide-y divide-md3-outline/60 overflow-hidden rounded-lg border border-md3-outline">
          {#each visibleEntries as row (row.key)}
            {@const state = permissionEntryState(row.entry, nowSeconds)}
            <article class="grid min-w-0 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div class="min-w-0">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <strong class="min-w-0 break-all text-sm text-md3-on-surface">{row.entry.permission}</strong>
                  <span class="rounded-full px-2 py-0.5 text-xs font-semibold {row.entry.granted ? 'bg-md3-primary-container text-md3-on-primary-container' : 'bg-md3-error-container text-md3-on-error-container'}">
                    {row.entry.granted ? $t('manage.permissionGrant') : $t('manage.permissionRevoke')}
                  </span>
                  <span class="rounded-full px-2 py-0.5 text-xs font-semibold {stateClass(state)}">
                    {stateLabel(state)}
                  </span>
                </div>
                <dl class="mt-2 grid gap-x-4 gap-y-1 text-xs text-md3-on-surface-variant sm:grid-cols-[auto_1fr]">
                  <dt>{$t('manage.permissionStartsAt')}</dt>
                  <dd class="min-w-0 break-words">{formatTimestamp(row.entry.start_time)}</dd>
                  <dt>{$t('manage.permissionEndsAt')}</dt>
                  <dd class="min-w-0 break-words">
                    {row.entry.end_time === null
                      ? $t('manage.permissionNeverExpires')
                      : formatTimestamp(row.entry.end_time)}
                  </dd>
                </dl>
              </div>
              <div class="flex items-center justify-end gap-1">
                <button
                  type="button"
                  class="rounded-full p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high hover:text-md3-on-surface disabled:opacity-45"
                  aria-label={$t('manage.editPermissionEntry')}
                  title={$t('manage.editPermissionEntry')}
                  disabled={saving || draft !== null}
                  onclick={() => startEditing(row)}
                >
                  <Icon name="edit" size="18px" />
                </button>
                <button
                  type="button"
                  class="rounded-full p-2 text-md3-error transition-colors hover:bg-md3-error-container disabled:opacity-45"
                  aria-label={$t('manage.deletePermissionEntry')}
                  title={$t('manage.deletePermissionEntry')}
                  disabled={saving}
                  onclick={() => deleteEntry(row.key)}
                >
                  <Icon name="delete" size="18px" />
                </button>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-md3-outline/60 p-4">
      <span class="text-xs text-md3-on-surface-variant">
        {$t('manage.permissionEntryCount', { values: { count: localEntries.length } })}
      </span>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <DialogActionButton disabled={saving} onclick={onClose}>
          {$t('common.cancel')}
        </DialogActionButton>
        <DialogActionButton
          variant="primary"
          disabled={loading || saving || draft !== null}
          onclick={save}
        >
          {#if saving}
            <ProgressRing size={16} strokeWidth={2.4} label={$t('common.saving')} />
            {$t('common.saving')}
          {:else}
            <Icon name="done" size="16px" />
            {$t('common.save')}
          {/if}
        </DialogActionButton>
      </div>
    </div>
  </div>
</ModalFrame>
