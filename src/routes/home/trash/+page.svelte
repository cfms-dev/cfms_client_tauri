<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
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
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import TopAppBar from '$lib/components/TopAppBar.svelte';

  type TrashKind = 'directory' | 'document';

  let folderId = $state('/');
  let currentFolderId = $state('/');
  let folders = $state<DeletedDirectoryEntry[]>([]);
  let documents = $state<DeletedDocumentEntry[]>([]);
  let loading = $state(false);
  let busyItemId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let status = $state<string | null>(null);

  const canRestore = $derived(authStore.permissions.includes('restore'));
  const canPurge = $derived(authStore.permissions.includes('purge'));

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
    loadItems(folderId);
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
      title: 'Restore',
      message: 'Restore with name (leave blank to keep original):',
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
      status = kind === 'document' ? 'Document restored successfully.' : 'Directory restored successfully.';
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
      message: `Permanently delete "${name}"? This action cannot be undone.`,
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
      status = kind === 'document' ? 'Document permanently deleted.' : 'Directory permanently deleted.';
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
</script>

<TopAppBar
  title={$t('trash.title')}
  subtitle={$t('trash.description')}
  backLabel={$t('common.back')}
  onBack={() => goto('/home/more')}
>
  {#snippet actions()}
    <IconButton icon="refresh" label={$t('common.refresh')} onclick={() => loadItems(currentFolderId)} disabled={loading} />
  {/snippet}
</TopAppBar>

<div class="p-6 space-y-4">

  <form
    class="flex flex-wrap items-end gap-2 bg-md3-surface-container/70 backdrop-blur-sm
           border border-md3-outline rounded-xl p-4"
    onsubmit={(e) => {
      e.preventDefault();
      loadItems(folderId);
    }}
  >
    <label class="flex-1 min-w-56 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      Folder ID
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
      Load
    </button>
  </form>

  {#if !canRestore && !canPurge}
    <div class="bg-md3-surface-container/70 border border-md3-outline
                text-md3-on-surface-variant text-sm rounded-xl p-3">
      You can view deleted items, but your account does not have restore or purge permission.
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center gap-2 text-sm text-md3-on-surface-variant">
      <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
      {$t('common.loadingEllipsis')}
    </div>
  {:else}
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline overflow-hidden">
      <div class="grid grid-cols-[auto_1fr_180px_auto] gap-3 px-4 py-2.5
                  bg-md3-surface-container-high/50 text-xs font-medium
                  text-md3-on-surface-variant uppercase tracking-wider
                  border-b border-md3-outline">
        <span></span>
        <span>Name</span>
        <span class="text-right">Created</span>
        <span class="text-right">Actions</span>
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
            class="grid grid-cols-[auto_1fr_180px_auto] gap-3 px-4 py-2.5
                   border-b border-md3-outline/50 last:border-b-0 items-center"
          >
            <span class={item.kind === 'directory' ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}>
              <Icon name={item.kind === 'directory' ? 'folder' : 'filePresent'} size="20px" />
            </span>
            <div class="min-w-0">
              <p class="text-sm text-md3-on-surface truncate line-through decoration-md3-on-surface-variant/60">
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
                title="Restore"
                onclick={() => handleRestore(item.kind, item.id, item.name)}
                disabled={!canRestore || busyItemId === item.id}
              >
                <Icon name="restoreFromTrash" size="18px" />
              </button>
              <button
                class="p-1.5 rounded-full text-md3-error
                       hover:bg-md3-error-container/40 disabled:opacity-40
                       transition-colors"
                title="Permanently delete"
                onclick={() => handlePurge(item.kind, item.id, item.name)}
                disabled={!canPurge || busyItemId === item.id}
              >
                <Icon name="deleteForever" size="18px" />
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>
