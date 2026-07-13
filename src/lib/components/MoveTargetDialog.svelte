<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    listDirectory,
    type ServerDirectoryEntry,
    type ServerObjectType,
  } from '$lib/api';
  import {
    excludedDirectorySet,
    formatDirectoryPath,
    normalizeDirectoryId,
    ROOT_DIRECTORY_ID,
    sameDirectoryId,
    type DirectoryBreadcrumbSegment,
  } from '$lib/file-browser';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import VirtualList from '$lib/components/VirtualList.svelte';

  type MoveTargetRow =
    | { kind: 'parent' }
    | { kind: 'folder'; folder: ServerDirectoryEntry };

  let {
    objectType,
    objectName,
    initialFolderId = null,
    navigationRootId = null,
    originalParentId = null,
    initialBreadcrumb = [],
    excludedDirectoryIds = [],
    moving = false,
    onMove,
    onCancel,
  }: {
    objectType: ServerObjectType;
    objectName: string;
    initialFolderId?: string | null;
    navigationRootId?: string | null;
    originalParentId?: string | null;
    initialBreadcrumb?: DirectoryBreadcrumbSegment[];
    excludedDirectoryIds?: string[];
    moving?: boolean;
    onMove: (targetFolderId: string | null) => void;
    onCancel: () => void;
  } = $props();

  let currentFolderId = $state<string | null>(null);
  let parentId = $state<string | null>(null);
  let folders = $state<ServerDirectoryEntry[]>([]);
  let breadcrumb = $state<DirectoryBreadcrumbSegment[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  const title = $derived(
    objectType === 'directory'
      ? $t('files.moveDirectoryTitle', { values: { name: objectName } })
      : $t('files.moveDocumentTitle', { values: { name: objectName } }),
  );
  const excludedIds = $derived(excludedDirectorySet(excludedDirectoryIds));
  const visibleFolders = $derived(folders.filter((folder) => !excludedIds.has(folder.id)));
  const currentPath = $derived(formatDirectoryPath(breadcrumb));
  const normalizedNavigationRootId = $derived(normalizeDirectoryId(navigationRootId));
  const parentTargetId = $derived.by<string | null | undefined>(() => {
    if (
      normalizedNavigationRootId !== null
      && breadcrumb.length <= 1
      && sameDirectoryId(currentFolderId, normalizedNavigationRootId)
    ) {
      return undefined;
    }

    if (parentId !== null) return parentId;

    const currentBreadcrumbEntry = breadcrumb[breadcrumb.length - 1];
    if (currentBreadcrumbEntry && sameDirectoryId(currentFolderId, currentBreadcrumbEntry.id)) {
      return breadcrumb[breadcrumb.length - 2]?.id ?? null;
    }

    return undefined;
  });
  const targetRows = $derived.by<MoveTargetRow[]>(() => [
    ...(parentTargetId !== undefined ? [{ kind: 'parent' } as const] : []),
    ...visibleFolders.map((folder) => ({ kind: 'folder' as const, folder })),
  ]);
  const canMoveHere = $derived(
    !moving
      && !loading
      && loadError === null
      && !sameDirectoryId(currentFolderId, originalParentId),
  );

  onMount(() => {
    currentFolderId = normalizeDirectoryId(initialFolderId);
    breadcrumb = [...initialBreadcrumb];
    void loadDirectory(currentFolderId);
  });

  async function loadDirectory(folderId: string | null): Promise<boolean> {
    loading = true;
    loadError = null;

    try {
      const normalizedFolderId = normalizeDirectoryId(folderId);
      const response = await listDirectory(normalizedFolderId);
      currentFolderId = normalizedFolderId;
      folders = response.folders;
      parentId = normalizeDirectoryId(response.parent_id);
      return true;
    } catch (err) {
      loadError = formatError(err);
      folders = [];
      parentId = null;
      return false;
    } finally {
      loading = false;
    }
  }

  async function navigateToFolder(folder: ServerDirectoryEntry) {
    const ok = await loadDirectory(folder.id);
    if (ok) {
      breadcrumb = [...breadcrumb, { label: folder.name, id: folder.id }];
    }
  }

  async function navigateToParent() {
    if (parentTargetId === undefined) return;
    const ok = await loadDirectory(parentTargetId);
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
    if (targetId === ROOT_DIRECTORY_ID) {
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

  function handleMoveHere() {
    if (!canMoveHere) return;
    onMove(currentFolderId);
  }

  function formatError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
</script>

<ModalFrame title={title} maxWidth="max-w-3xl" closeLabel={$t('common.close')} onClose={onCancel}>
  <div class="flex max-h-[78vh] flex-col">
    <div class="space-y-3 border-b border-md3-outline/60 p-5">
      <div class="flex min-w-0 items-center gap-2 text-sm text-md3-on-surface-variant">
        <span class="text-md3-primary-emphasis">
          <Icon name="folderOpen" size="18px" />
        </span>
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
            disabled={loading || moving || currentFolderId === null}
            onclick={navigateToRoot}
          >
            <Icon name="home" size="18px" />
          </button>
          <button
            type="button"
            class="rounded-full p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high hover:text-md3-on-surface disabled:cursor-not-allowed disabled:opacity-45"
            title={$t('common.refresh')}
            disabled={loading || moving}
            onclick={() => loadDirectory(currentFolderId)}
          >
            <Icon name="refresh" size="18px" />
          </button>
        </div>
      </div>
    </div>

    <div class="min-h-[18rem] overflow-auto p-5">
      {#if loading}
        <div class="flex items-center gap-2 py-10 text-sm text-md3-on-surface-variant">
          <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {$t('common.loadingEllipsis')}
        </div>
      {:else if loadError}
        <div class="rounded-lg border border-md3-error/35 bg-md3-error-container/20 p-4">
          <div class="mb-3 flex items-start gap-2 text-sm text-md3-on-error-container">
            <Icon name="warningAmber" size="18px" />
            <p class="min-w-0 break-words">{loadError}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-full bg-md3-error-container px-3 py-1.5 text-xs font-medium text-md3-on-error-container transition-all hover:brightness-110"
              onclick={() => loadDirectory(currentFolderId)}
            >
              {$t('common.refresh')}
            </button>
            <button
              type="button"
              class="rounded-full bg-md3-surface-container-high px-3 py-1.5 text-xs font-medium text-md3-on-surface-variant transition-all hover:brightness-110"
              onclick={navigateToRoot}
            >
              {$t('files.goToRoot')}
            </button>
          </div>
        </div>
      {:else}
        <div class="overflow-hidden rounded-lg border border-md3-outline">
          <VirtualList
            items={targetRows}
            keyOf={(row) => row.kind === 'parent' ? 'parent' : `folder:${row.folder.id}`}
            estimateSize={45}
            overscan={8}
            threshold={80}
            resetKey={currentFolderId ?? 'root'}
            viewportClass="move-target-list-viewport"
          >
            {#snippet children(row, index)}
              {#if row.kind === 'parent'}
                <button
                  type="button"
                  class="grid w-full grid-cols-[auto_1fr] items-center gap-3 border-b border-md3-outline/50 px-4 py-3 text-left transition-colors hover:bg-md3-primary-container/20 disabled:cursor-not-allowed disabled:opacity-50"
                  class:border-b-0={index === targetRows.length - 1}
                  disabled={moving}
                  onclick={navigateToParent}
                >
                  <span class="text-md3-primary-emphasis">
                    <Icon name="arrowUpward" size="20px" />
                  </span>
                  <span class="min-w-0 truncate text-sm font-medium text-md3-primary-emphasis">
                    {$t('files.parentDirectory')}
                  </span>
                </button>
              {:else}
                <button
                  type="button"
                  class="grid w-full grid-cols-[auto_1fr] items-center gap-3 border-b border-md3-outline/50 px-4 py-3 text-left transition-colors hover:bg-md3-primary-container/20 disabled:cursor-not-allowed disabled:opacity-50"
                  class:border-b-0={index === targetRows.length - 1}
                  disabled={moving}
                  onclick={() => navigateToFolder(row.folder)}
                >
                  <span class="text-md3-primary-emphasis">
                    <Icon name="folder" size="20px" />
                  </span>
                  <span class="min-w-0 truncate text-sm font-medium text-md3-primary-emphasis">
                    {row.folder.name}
                  </span>
                </button>
              {/if}
            {/snippet}
          </VirtualList>

          {#if visibleFolders.length === 0 && parentTargetId === undefined}
            <p class="px-4 py-10 text-center text-sm text-md3-on-surface-variant">
              {$t('files.noSubdirectories')}
            </p>
          {:else if visibleFolders.length === 0}
            <p class="border-t border-md3-outline/50 px-4 py-10 text-center text-sm text-md3-on-surface-variant">
              {$t('files.noSubdirectories')}
            </p>
          {/if}
        </div>
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2 border-t border-md3-outline/60 p-4">
      <button
        type="button"
        class="rounded-full bg-md3-surface-container-high px-4 py-2 text-sm font-medium text-md3-on-surface-variant transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={moving}
        onclick={onCancel}
      >
        {$t('common.cancel')}
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-full bg-md3-primary px-4 py-2 text-sm font-medium text-md3-on-primary transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canMoveHere}
        onclick={handleMoveHere}
      >
        {#if moving}
          <ProgressRing size={16} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
        {:else}
          <Icon name="driveFileMove" size="16px" />
        {/if}
        {$t('files.moveHere')}
      </button>
    </div>
  </div>
</ModalFrame>

<style>
  :global(.move-target-list-viewport) {
    max-height: calc(78vh - 14rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
