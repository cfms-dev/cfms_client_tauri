<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';
  import { formatBytes, formatDate } from '$lib/files/formatting';
  import type { SortField } from '$lib/files/sorting';
  import type { IconName } from '$lib/icons';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  let {
    loading,
    folders,
    documents,
    canGoToParent,
    selectMode,
    selectedFolderIds,
    selectedDocumentIds,
    sortTitle,
    sortIcon,
    onSort,
    onGoToParent,
    onFolderClick,
    onDocumentClick,
    onFolderContextMenu,
    onDocumentContextMenu,
  }: {
    loading: boolean;
    folders: ServerDirectoryEntry[];
    documents: ServerDocumentEntry[];
    canGoToParent: boolean;
    selectMode: boolean;
    selectedFolderIds: Set<string>;
    selectedDocumentIds: Set<string>;
    sortTitle: (field: SortField) => string;
    sortIcon: (field: SortField) => IconName;
    onSort: (field: SortField) => void;
    onGoToParent: () => void;
    onFolderClick: (folder: ServerDirectoryEntry) => void;
    onDocumentClick: (document: ServerDocumentEntry) => void;
    onFolderContextMenu: (event: MouseEvent, folder: ServerDirectoryEntry) => void;
    onDocumentContextMenu: (event: MouseEvent, document: ServerDocumentEntry) => void;
  } = $props();
</script>

{#if loading}
  <div class="flex items-center gap-2 text-sm text-md3-on-surface-variant">
    <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
    {$t('common.loadingEllipsis')}
  </div>
{/if}

{#if !loading}
  <div class="overflow-x-auto rounded-xl border border-md3-outline bg-md3-surface-container/70 backdrop-blur-sm">
    <div class="min-w-[620px] overflow-hidden">
      <div
        class="grid grid-cols-[auto_minmax(260px,1fr)_100px_160px] gap-3 border-b border-md3-outline bg-md3-surface-container-high/50 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-md3-on-surface-variant"
        style="font-family: var(--font-md3-sans);"
      >
        <span aria-hidden="true"></span>
        <button
          type="button"
          class="flex min-w-0 items-center gap-1 text-left uppercase transition-colors hover:text-md3-on-surface"
          title={sortTitle('name')}
          onclick={() => onSort('name')}
        >
          <span class="select-none">{$t('files.name')}</span>
          <Icon name={sortIcon('name')} size="15px" />
        </button>
        <button
          type="button"
          class="flex items-center justify-end gap-1 text-right uppercase transition-colors hover:text-md3-on-surface"
          title={sortTitle('size')}
          onclick={() => onSort('size')}
        >
          <span class="select-none">{$t('files.size')}</span>
          <Icon name={sortIcon('size')} size="15px" />
        </button>
        <button
          type="button"
          class="flex items-center justify-end gap-1 text-right uppercase transition-colors hover:text-md3-on-surface"
          title={sortTitle('modified')}
          onclick={() => onSort('modified')}
        >
          <span class="select-none">{$t('files.modified')}</span>
          <Icon name={sortIcon('modified')} size="15px" />
        </button>
      </div>

      {#if folders.length === 0 && documents.length === 0 && !canGoToParent}
        <p class="px-4 py-12 text-center text-sm text-md3-on-surface-variant">
          {$t('files.empty')}
        </p>
      {/if}

      {#if canGoToParent}
        <button
          class="grid w-full grid-cols-[auto_minmax(260px,1fr)_100px_160px] gap-3 px-4 py-2.5 text-left text-md3-primary-emphasis transition-colors hover:bg-md3-primary-container/20"
          class:border-b={folders.length > 0 || documents.length > 0}
          onclick={onGoToParent}
        >
          <span class="self-center text-md3-primary-emphasis" aria-hidden="true">
            <Icon name="arrowUpward" size="20px" />
          </span>
          <span class="truncate text-sm font-medium">
            {$t('files.parentDirectory')}
          </span>
          <span class="self-center text-right text-xs text-md3-on-surface-variant">—</span>
          <span class="self-center text-right text-xs text-md3-on-surface-variant">—</span>
        </button>
      {/if}

      {#each folders as folder (folder.id)}
        <button
          class="grid w-full grid-cols-[auto_minmax(260px,1fr)_100px_160px] gap-3 border-b border-md3-outline/50 px-4 py-2.5 text-left transition-colors hover:bg-md3-primary-container/20"
          onclick={() => onFolderClick(folder)}
          oncontextmenu={(event) => onFolderContextMenu(event, folder)}
        >
          {#if selectMode}
            <span
              class="self-center {selectedFolderIds.has(folder.id) ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}"
              aria-hidden="true"
            >
              <Icon name={selectedFolderIds.has(folder.id) ? 'checkBox' : 'checkBoxBlank'} size="22px" />
            </span>
          {:else}
            <span class="self-center text-md3-primary-emphasis">
              <Icon name="folder" size="20px" />
            </span>
          {/if}
          <span class="truncate text-sm font-medium text-md3-primary-emphasis">
            {folder.name}
          </span>
          <span class="self-center text-right text-xs text-md3-on-surface-variant">—</span>
          <span class="self-center text-right text-xs text-md3-on-surface-variant">
            {formatDate(folder.created_time)}
          </span>
        </button>
      {/each}

      {#each documents as doc (doc.id)}
        <button
          class="grid w-full grid-cols-[auto_minmax(260px,1fr)_100px_160px] gap-3 border-b border-md3-outline/50 px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-md3-surface-container-high/30"
          onclick={() => onDocumentClick(doc)}
          oncontextmenu={(event) => onDocumentContextMenu(event, doc)}
        >
          {#if selectMode}
            <span
              class="self-center {selectedDocumentIds.has(doc.id) ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}"
              aria-hidden="true"
            >
              <Icon name={selectedDocumentIds.has(doc.id) ? 'checkBox' : 'checkBoxBlank'} size="22px" />
            </span>
          {:else}
            <span class="self-center text-md3-on-surface-variant">
              <Icon name="filePresent" size="20px" />
            </span>
          {/if}
          <span class="truncate text-sm text-md3-on-surface">
            {doc.title}
          </span>
          <span class="self-center text-right text-xs text-md3-on-surface-variant">
            {formatBytes(doc.size)}
          </span>
          <span class="self-center text-right text-xs text-md3-on-surface-variant">
            {formatDate(doc.last_modified)}
          </span>
        </button>
      {/each}
    </div>
  </div>
{/if}
