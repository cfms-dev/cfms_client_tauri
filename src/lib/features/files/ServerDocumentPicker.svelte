<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { onMount } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { _ as t } from 'svelte-i18n';
  import {
    listDirectory,
    type ServerDirectoryEntry,
    type ServerDocumentEntry,
  } from '$lib/api';
  import {
    formatDirectoryPath,
    normalizeDirectoryId,
    ROOT_DIRECTORY_ID,
    type DirectoryBreadcrumbSegment,
  } from '$lib/features/files/file-browser';
  import Breadcrumb from '$lib/features/files/Breadcrumb.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import VirtualList from '$lib/shared/ui/VirtualList.svelte';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';

  type PickerRow =
    | { kind: 'folder'; folder: ServerDirectoryEntry }
    | { kind: 'document'; document: ServerDocumentEntry };

  let {
    title,
    description,
    selectionBusy = false,
    documentFilter = () => true,
    onSelect,
    onCancel,
  }: {
    title: string;
    description?: string;
    selectionBusy?: boolean;
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
  const coarsePointer = new MediaQuery('(pointer: coarse)', false);
  const rowHeight = $derived(coarsePointer.current ? 48 : 40);
  const currentPath = $derived(formatDirectoryPath(breadcrumb));
  const pickerRows = $derived.by<PickerRow[]>(() => [
    ...folders.map((folder) => ({ kind: 'folder' as const, folder })),
    ...visibleDocuments.map((document) => ({ kind: 'document' as const, document })),
  ]);

  onMount(() => {
    void loadDirectory(null);
  });

  async function loadDirectory(folderId: string | null): Promise<boolean> {
    if (selectionBusy) return false;
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
      loadError = formatUserFacingError(err);
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
</script>

<ModalFrame
  {title}
  maxWidth="max-w-3xl"
  resizable
  maximizable
  minWidth={520}
  minHeight={420}
  closeLabel={$t('common.close')}
  dismissible={!selectionBusy}
  onClose={onCancel}
>
  <div class="flex h-full min-h-0 max-h-[78vh] flex-col" aria-busy={selectionBusy} style:--picker-row-height={`${rowHeight}px`}>
    <div class="shrink-0 space-y-3 border-b border-md3-outline/60 p-5">
      {#if selectionBusy}
        <p class="selection-busy" role="status"><span aria-hidden="true"><ProgressRing size={16} label={$t('common.saving')} /></span>{$t('common.saving')}</p>
      {/if}
      {#if description}
        <p class="max-w-[70ch] text-xs leading-5 text-md3-on-surface-variant">
          {description}
        </p>
      {/if}
      <div class="flex min-w-0 items-center gap-2 text-sm text-md3-on-surface-variant">
        <span class="text-md3-primary-emphasis"><Icon name="folderOpen" size="18px" /></span>
        <span class="shrink-0 font-medium">{$t('files.currentLocation')}</span>
        <span class="min-w-0 truncate text-md3-on-surface">{currentPath}</span>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumb segments={breadcrumb.map((segment) => ({ label: segment.label, path: segment.id }))} onNavigate={navigateByBreadcrumb} />
        <div class="flex items-center gap-2">
          <FluentButton data-fluent-owner="lib-components-server-document-picker"
            type="button"
            title={$t('files.goToRoot')}
            disabled={loading || selectionBusy || currentFolderId === null}
            onclick={navigateToRoot}
            appearance="subtle"
            class="rounded p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high hover:text-md3-on-surface disabled:cursor-not-allowed disabled:opacity-45"
            iconOnly
            aria-label={$t('files.goToRoot')}
          >
            <Icon name="home" size="18px" />
          </FluentButton>
          <FluentButton data-fluent-owner="lib-components-server-document-picker"
            type="button"
            title={$t('common.refresh')}
            disabled={loading || selectionBusy}
            onclick={() => loadDirectory(currentFolderId)}
            appearance="subtle"
            class="rounded p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high hover:text-md3-on-surface disabled:cursor-not-allowed disabled:opacity-45"
            iconOnly
            aria-label={$t('common.refresh')}
          >
            <Icon name="refresh" size="18px" />
          </FluentButton>
        </div>
      </div>
    </div>

    <div class="modal-flex-region flex min-h-[20rem] flex-1 flex-col overflow-auto p-5">
      {#if loading}
        <div class="flex items-center gap-2 py-10 text-sm text-md3-on-surface-variant">
          <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {$t('common.loadingEllipsis')}
        </div>
      {:else if loadError}
        <div class="rounded-lg border border-md3-error/35 bg-md3-error-container/20 p-4 text-sm text-md3-on-error-container">
          <div class="mb-3 flex items-start gap-2">
            <span class="cfms-icon-text__icon"><Icon name="warningAmber" size="18px" /></span>
            <p class="min-w-0 break-words">{loadError}</p>
          </div>
          <FluentButton data-fluent-owner="lib-components-server-document-picker"
            type="button"
            onclick={() => loadDirectory(currentFolderId)}
            appearance="subtle"
            tone="danger"
            class="rounded bg-md3-error-container px-3 py-1.5 text-xs font-medium transition-all "
          >
            {$t('common.refresh')}
          </FluentButton>
        </div>
      {:else}
        <div class="server-picker-content flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-md3-outline">
          {#if parentId !== null}
            <button
              type="button"
              disabled={selectionBusy}
              class="server-picker-row server-picker-parent"
              onclick={navigateToParent}
            >
              <span class="text-md3-primary-emphasis"><Icon name="arrowUpward" size="20px" /></span>
              <span class="min-w-0 truncate">{$t('files.parentDirectory')}</span>
            </button>
          {/if}
          {#if pickerRows.length === 0}
            <div class="server-picker-empty" role="status">
              <p>{$t('files.empty')}</p>
            </div>
          {:else}
          <VirtualList
            items={pickerRows}
            keyOf={(row) => row.kind === 'folder'
                ? `folder:${row.folder.id}`
                : `document:${row.document.id}`}
            estimateSize={rowHeight}
            overscan={8}
            threshold={80}
            resetKey={currentFolderId ?? 'root'}
            viewportClass="server-picker-list-viewport"
            keyboardNavigation
          >
            {#snippet children(row, index)}
              {#if row.kind === 'folder'}
                <button data-fluent-owner="lib-components-server-document-picker"
                  type="button"
                  disabled={selectionBusy}
                  onclick={() => navigateToFolder(row.folder)}

                  class="server-picker-row"
                  class:server-picker-row--last={index === pickerRows.length - 1}
                >
                  <span class="text-md3-primary-emphasis"><Icon name="folder" size="20px" /></span>
                  <span class="min-w-0 truncate text-sm font-medium text-md3-primary-emphasis">{row.folder.name}</span>
                </button>
              {:else}
                <button data-fluent-owner="lib-components-server-document-picker"
                  type="button"
                  disabled={selectionBusy}
                  onclick={() => onSelect(row.document)}

                  class="server-picker-row server-picker-document"
                  class:server-picker-row--last={index === pickerRows.length - 1}
                >
                  <span class="text-md3-on-surface-variant"><Icon name="filePresent" size="20px" /></span>
                  <span class="min-w-0 truncate text-sm text-md3-on-surface">{row.document.title}</span>
                  <span class="text-md3-primary-emphasis"><Icon name="done" size="18px" /></span>
                </button>
              {/if}
            {/snippet}
          </VirtualList>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</ModalFrame>

<style>
  .selection-busy { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--colorNeutralForeground2); font: 400 14px/20px var(--fontFamilyBase); }
  .server-picker-row:disabled { cursor: wait; color: var(--colorNeutralForegroundDisabled); }
  .server-picker-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: var(--picker-row-height);
    border: 0;
    border-bottom: 1px solid var(--colorNeutralStroke2);
    border-radius: 0;
    padding: 8px 16px;
    text-align: left;
    color: var(--colorNeutralForeground1);
    background: transparent;
    font: 400 14px/20px var(--fontFamilyBase);
    transition: background-color var(--durationFaster) var(--curveEasyEase);
  }
  .server-picker-row:hover { background: var(--colorNeutralBackground1Hover); }
  .server-picker-row:active { background: var(--colorNeutralBackground1Pressed); }
  .server-picker-row:focus-visible { outline-offset: -2px; }
  .server-picker-row--last { border-bottom: 0; }
  .server-picker-parent { flex: none; color: var(--colorBrandForeground1); }
  .server-picker-document { grid-template-columns: auto minmax(0, 1fr) auto; }
  .server-picker-empty {
    display: grid;
    flex: 1 1 auto;
    min-height: 0;
    place-items: center;
    padding: 40px 16px;
    color: var(--colorNeutralForeground2);
    text-align: center;
    font: 400 14px/20px var(--fontFamilyBase);
  }

  :global(.server-picker-list-viewport) {
    min-height: 0;
    flex: 1 1 auto;
    max-height: calc(78vh - 11rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  :global(.modal-positioner--sized .server-picker-list-viewport),
  :global(.modal-positioner--maximized .server-picker-list-viewport) {
    max-height: none;
  }
</style>
