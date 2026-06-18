<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    listDirectory,
    type ServerDirectoryEntry,
    type ServerDocumentEntry,
  } from '$lib/api';
  import {
    formatDirectoryPath,
    normalizeDirectoryId,
    type DirectoryBreadcrumbSegment,
  } from '$lib/file-browser';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import VirtualList from '$lib/components/VirtualList.svelte';

  type PickerRow =
    | { kind: 'parent' }
    | { kind: 'folder'; folder: ServerDirectoryEntry }
    | { kind: 'document'; document: ServerDocumentEntry };

  let {
    title,
    documentFilter = () => true,
    onSelect,
    onCancel,
  }: {
    title: string;
    documentFilter?: (document: ServerDocumentEntry) => boolean;
    onSelect: (document: ServerDocumentEntry) => void;
    onCancel: () => void;
  } = $props();

  let currentFolderId = $state<string | null>(null);
  let parentId = $state<string | null>(null);
  let folders = $state<ServerDirectoryEntry[]>([]);
  let documents = $state<ServerDocumentEntry[]>([]);
  let breadcrumb = $state<DirectoryBreadcrumbSegment[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  const visibleDocuments = $derived(documents.filter(documentFilter));
  const currentPath = $derived(formatDirectoryPath(breadcrumb));
  const pickerRows = $derived.by<PickerRow[]>(() => [
    ...(parentId !== null ? [{ kind: 'parent' } as const] : []),
    ...folders.map((folder) => ({ kind: 'folder' as const, folder })),
    ...visibleDocuments.map((document) => ({ kind: 'document' as const, document })),
  ]);

  onMount(() => {
    void loadDirectory(null);
  });

  async function loadDirectory(folderId: string | null): Promise<boolean> {
    loading = true;
    loadError = null;

    try {
      const normalized = normalizeDirectoryId(folderId);
      const response = await listDirectory(normalized);
      currentFolderId = normalized;
      parentId = normalizeDirectoryId(response.parent_id);
      folders = response.folders;
      documents = response.documents;
      return true;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
      folders = [];
      documents = [];
      parentId = null;
      return false;
    } finally {
      loading = false;
    }
  }

  async function navigateToFolder(folder: ServerDirectoryEntry) {
    const ok = await loadDirectory(folder.id);
    if (ok) {
      breadcrumb = [...breadcrumb, { id: folder.id, label: folder.name }];
    }
  }

  async function navigateToParent() {
    const ok = await loadDirectory(parentId);
    if (ok && breadcrumb.length > 0) {
      breadcrumb = breadcrumb.slice(0, -1);
    }
  }

  async function navigateToRoot() {
    const ok = await loadDirectory(null);
    if (ok) {
      breadcrumb = [];
    }
  }

  async function navigateByBreadcrumb(targetId: string) {
    if (targetId === '/') {
      await navigateToRoot();
      return;
    }

    const index = breadcrumb.findIndex((segment) => segment.id === targetId);
    if (index < 0) return;
    const ok = await loadDirectory(targetId);
    if (ok) {
      breadcrumb = breadcrumb.slice(0, index + 1);
    }
  }
</script>

<ModalFrame {title} maxWidth="max-w-3xl" closeLabel={$t('common.close')} onClose={onCancel}>
  <div class="flex max-h-[78vh] flex-col">
    <div class="space-y-3 border-b border-md3-outline/60 p-5">
      <div class="flex min-w-0 items-center gap-2 text-sm text-md3-on-surface-variant">
        <span class="text-md3-primary-emphasis"><Icon name="folderOpen" size="18px" /></span>
        <span class="shrink-0 font-medium">{$t('files.currentLocation')}</span>
        <span class="min-w-0 truncate text-md3-on-surface">{currentPath}</span>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumb segments={breadcrumb.map((segment) => ({ label: segment.label, path: segment.id }))} onNavigate={navigateByBreadcrumb} />
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-full p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high hover:text-md3-on-surface disabled:cursor-not-allowed disabled:opacity-45"
            title={$t('files.goToRoot')}
            disabled={loading || currentFolderId === null}
            onclick={navigateToRoot}
          >
            <Icon name="home" size="18px" />
          </button>
          <button
            type="button"
            class="rounded-full p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high hover:text-md3-on-surface disabled:cursor-not-allowed disabled:opacity-45"
            title={$t('common.refresh')}
            disabled={loading}
            onclick={() => loadDirectory(currentFolderId)}
          >
            <Icon name="refresh" size="18px" />
          </button>
        </div>
      </div>
    </div>

    <div class="min-h-[20rem] overflow-auto p-5">
      {#if loading}
        <div class="flex items-center gap-2 py-10 text-sm text-md3-on-surface-variant">
          <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {$t('common.loadingEllipsis')}
        </div>
      {:else if loadError}
        <div class="rounded-lg border border-md3-error/35 bg-md3-error-container/20 p-4 text-sm text-md3-on-error-container">
          <div class="mb-3 flex items-start gap-2">
            <Icon name="warningAmber" size="18px" />
            <p class="min-w-0 break-words">{loadError}</p>
          </div>
          <button
            type="button"
            class="rounded-full bg-md3-error-container px-3 py-1.5 text-xs font-medium transition-all hover:brightness-110"
            onclick={() => loadDirectory(currentFolderId)}
          >
            {$t('common.refresh')}
          </button>
        </div>
      {:else}
        <div class="overflow-hidden rounded-lg border border-md3-outline">
          <VirtualList
            items={pickerRows}
            keyOf={(row) => row.kind === 'parent'
              ? 'parent'
              : row.kind === 'folder'
                ? `folder:${row.folder.id}`
                : `document:${row.document.id}`}
            estimateSize={45}
            overscan={8}
            threshold={80}
            resetKey={currentFolderId ?? 'root'}
            viewportClass="server-picker-list-viewport"
          >
            {#snippet children(row, index)}
              {#if row.kind === 'parent'}
                <button
                  type="button"
                  class="grid w-full grid-cols-[auto_1fr] items-center gap-3 border-b border-md3-outline/50 px-4 py-3 text-left transition-colors hover:bg-md3-primary-container/20"
                  class:border-b-0={index === pickerRows.length - 1}
                  onclick={navigateToParent}
                >
                  <span class="text-md3-primary-emphasis"><Icon name="arrowUpward" size="20px" /></span>
                  <span class="min-w-0 truncate text-sm font-medium text-md3-primary-emphasis">{$t('files.parentDirectory')}</span>
                </button>
              {:else if row.kind === 'folder'}
                <button
                  type="button"
                  class="grid w-full grid-cols-[auto_1fr] items-center gap-3 border-b border-md3-outline/50 px-4 py-3 text-left transition-colors hover:bg-md3-primary-container/20"
                  class:border-b-0={index === pickerRows.length - 1}
                  onclick={() => navigateToFolder(row.folder)}
                >
                  <span class="text-md3-primary-emphasis"><Icon name="folder" size="20px" /></span>
                  <span class="min-w-0 truncate text-sm font-medium text-md3-primary-emphasis">{row.folder.name}</span>
                </button>
              {:else}
                <button
                  type="button"
                  class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-md3-outline/50 px-4 py-3 text-left transition-colors hover:bg-md3-surface-container-high/45"
                  class:border-b-0={index === pickerRows.length - 1}
                  onclick={() => onSelect(row.document)}
                >
                  <span class="text-md3-on-surface-variant"><Icon name="filePresent" size="20px" /></span>
                  <span class="min-w-0 truncate text-sm text-md3-on-surface">{row.document.title}</span>
                  <span class="text-md3-primary-emphasis"><Icon name="done" size="18px" /></span>
                </button>
              {/if}
            {/snippet}
          </VirtualList>

          {#if folders.length === 0 && visibleDocuments.length === 0}
            <p class="px-4 py-10 text-center text-sm text-md3-on-surface-variant">
              {$t('files.empty')}
            </p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</ModalFrame>

<style>
  :global(.server-picker-list-viewport) {
    max-height: calc(78vh - 11rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
