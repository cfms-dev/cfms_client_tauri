<script lang="ts">
  // File Manager page
  //
  // Browses files and folders on the CFMS server via the `list_directory`
  // and `get_document` actions sent over the active WSS connection.
  //
  // Reference: get_directory / get_document in reference/src/include/ui/util/path.py

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    listDirectory,
    getDocument,
    createDirectory,
    deleteDirectory,
    deleteDocument,
  } from '$lib/api';
  import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Icon from '$lib/components/Icon.svelte';

  // --- Navigation state ---
  let currentFolderId = $state<string | null>(null);
  let folders = $state<ServerDirectoryEntry[]>([]);
  let documents = $state<ServerDocumentEntry[]>([]);
  let parentId = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let searchPattern = $state('');

  // Selection mode
  let selectMode = $state(false);
  let selectedFolderIds = $state<Set<string>>(new Set());
  let selectedDocumentIds = $state<Set<string>>(new Set());

  // Context menu state
  let contextMenu = $state<{
    visible: boolean;
    x: number;
    y: number;
    kind: 'folder' | 'document' | null;
    item: ServerDirectoryEntry | ServerDocumentEntry | null;
  }>({ visible: false, x: 0, y: 0, kind: null, item: null });

  // Breadcrumb navigation history — each entry records the folder name and its
  // server-side ID so we can jump back to any ancestor.
  let navHistory = $state<Array<{ label: string; id: string }>>([]);

  const breadcrumbSegments = $derived(
    navHistory.map((h) => ({ label: h.label, path: h.id })),
  );

  // --- Data loading ---

  async function loadDirectory(folderId: string | null) {
    loading = true;
    error = null;
    currentFolderId = folderId;
    selectedFolderIds = new Set();
    selectedDocumentIds = new Set();
    try {
      const resp = await listDirectory(folderId);
      folders = resp.folders;
      documents = resp.documents;
      parentId = resp.parent_id;
    } catch (e) {
      error = String(e);
      folders = [];
      documents = [];
      parentId = null;
    } finally {
      loading = false;
    }
  }

  // --- Navigation ---

  function handleNavigate(folderId: string, folderName: string) {
    navHistory.push({ label: folderName, id: folderId });
    loadDirectory(folderId);
  }

  function handleBreadcrumbNavigate(targetId: string) {
    // "/" means root
    if (targetId === '/') {
      navHistory = [];
      loadDirectory(null);
      return;
    }
    // Truncate history to the clicked segment
    const idx = navHistory.findIndex((h) => h.id === targetId);
    if (idx >= 0) {
      navHistory = navHistory.slice(0, idx + 1);
    }
    loadDirectory(targetId);
  }

  function handleGoToParent() {
    // Pop the last entry and navigate to its parent
    if (navHistory.length > 0) {
      navHistory.pop();
    }
    loadDirectory(parentId);
  }

  // --- Selection ---

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

  function toggleSelectMode() {
    selectMode = !selectMode;
    if (!selectMode) clearSelection();
  }

  const totalSelected = $derived(selectedFolderIds.size + selectedDocumentIds.size);

  // --- Download ---

  async function handleDownload(doc: ServerDocumentEntry) {
    try {
      await getDocument(doc.id, doc.title);
    } catch (e) {
      error = String(e);
    }
  }

  // --- Document row click: download (normal) or toggle selection ---
  function handleDocumentClick(doc: ServerDocumentEntry) {
    if (selectMode) {
      toggleSelectDocument(doc.id);
    } else {
      handleDownload(doc);
    }
  }

  // --- Folder row click: navigate (normal) or toggle selection ---
  function handleFolderClick(folder: ServerDirectoryEntry) {
    if (selectMode) {
      toggleSelectFolder(folder.id);
    } else {
      handleNavigate(folder.id, folder.name);
    }
  }

  // --- Context menu ---

  function hideContextMenu() {
    contextMenu = { visible: false, x: 0, y: 0, kind: null, item: null };
  }

  function showFolderContextMenu(e: MouseEvent, folder: ServerDirectoryEntry) {
    e.preventDefault();
    contextMenu = { visible: true, x: e.clientX, y: e.clientY, kind: 'folder', item: folder };
  }

  function showDocumentContextMenu(e: MouseEvent, doc: ServerDocumentEntry) {
    e.preventDefault();
    contextMenu = { visible: true, x: e.clientX, y: e.clientY, kind: 'document', item: doc };
  }

  async function contextDownload() {
    if (contextMenu.kind === 'document' && contextMenu.item) {
      await handleDownload(contextMenu.item as ServerDocumentEntry);
    }
    hideContextMenu();
  }

  async function contextDelete() {
    try {
      if (contextMenu.kind === 'folder' && contextMenu.item) {
        const folder = contextMenu.item as ServerDirectoryEntry;
        await deleteDirectory(folder.id);
      } else if (contextMenu.kind === 'document' && contextMenu.item) {
        const doc = contextMenu.item as ServerDocumentEntry;
        await deleteDocument(doc.id);
      }
      // Reload current directory after delete.
      await loadDirectory(currentFolderId);
    } catch (e) {
      error = String(e);
    }
    hideContextMenu();
  }

  // --- Toolbar actions ---

  async function handleCreateFolder() {
    const name = window.prompt('New folder name:');
    if (!name || !name.trim()) return;
    try {
      await createDirectory(currentFolderId, name.trim(), true);
      await loadDirectory(currentFolderId);
    } catch (e) {
      error = String(e);
    }
  }

  async function handleDeleteSelected() {
    if (totalSelected === 0) return;
    const confirmed = window.confirm(
      `Delete ${totalSelected} selected item(s)? This action cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      for (const id of selectedFolderIds) {
        await deleteDirectory(id);
      }
      for (const id of selectedDocumentIds) {
        await deleteDocument(id);
      }
      clearSelection();
      await loadDirectory(currentFolderId);
    } catch (e) {
      error = String(e);
    }
  }

  function handleNavigateTrash() {
    goto('/home/trash');
  }

  // Dismiss context menu on any click outside.
  function handleGlobalClick(_e: MouseEvent) {
    if (contextMenu.visible) {
      hideContextMenu();
    }
  }

  // --- Formatting helpers ---

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '—';
    const k = 1024;
    const sizes = ['B', 'KiB', 'MiB', 'GiB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
  }

  function formatDate(ts: number | null): string {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString();
  }

  // --- Init ---

  onMount(() => {
    loadDirectory(null);
  });

  // --- Filtered lists ---

  const filteredFolders = $derived(
    searchPattern
      ? folders.filter((f) =>
          f.name.toLowerCase().includes(searchPattern.toLowerCase()),
        )
      : folders,
  );

  const filteredDocuments = $derived(
    searchPattern
      ? documents.filter((d) =>
          d.title.toLowerCase().includes(searchPattern.toLowerCase()),
        )
      : documents,
  );
</script>

<div class="p-6 space-y-4">
  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    File Management
  </h1>

  <!-- Top toolbar -->
  <div class="flex flex-wrap items-center gap-2">
    <!-- Create folder -->
    <button
      class="px-3 py-1.5 text-xs rounded-full font-medium
             bg-md3-surface-container-high text-md3-on-surface-variant
             hover:brightness-110 transition-all flex items-center gap-1.5"
      style="font-family: var(--font-md3-sans);"
      title="Create folder"
      onclick={handleCreateFolder}
    >
      <Icon name="createNewFolder" size="16px" />
      New Folder
    </button>

    <!-- Selection mode toggle -->
    <button
      class="px-3 py-1.5 text-xs rounded-full font-medium
             {selectMode
               ? 'bg-md3-primary-container text-md3-on-primary-container'
               : 'bg-md3-surface-container-high text-md3-on-surface-variant'}
             hover:brightness-110 transition-all flex items-center gap-1.5"
      style="font-family: var(--font-md3-sans);"
      onclick={toggleSelectMode}
    >
      <Icon name="checklist" size="16px" />
      Select
    </button>

    <!-- Trash -->
    <button
      class="px-3 py-1.5 text-xs rounded-full font-medium
             bg-md3-surface-container-high text-md3-on-surface-variant
             hover:brightness-110 transition-all flex items-center gap-1.5"
      style="font-family: var(--font-md3-sans);"
      title="Recycle bin"
      onclick={handleNavigateTrash}
    >
      <Icon name="deleteSweep" size="16px" />
      Trash
    </button>

    <!-- Spacer -->
    <span class="flex-1"></span>

    <!-- Search -->
    <form
      class="flex gap-2"
      onsubmit={(e) => { e.preventDefault(); }}
    >
      <input
        type="text"
        class="px-3 py-1.5 text-sm rounded-xl border border-md3-outline
               bg-md3-field text-md3-on-surface w-36
               placeholder:text-md3-on-surface-variant
               focus:ring-2 focus:ring-md3-primary focus:border-transparent
               transition-colors"
        placeholder="Search…"
        bind:value={searchPattern}
      />
      <button
        type="submit"
        class="px-3 py-1.5 text-xs rounded-full font-medium
               bg-md3-primary-container text-md3-on-primary-container
               hover:brightness-110 transition-all flex items-center gap-1"
        style="font-family: var(--font-md3-sans);"
      >
        <Icon name="search" size="16px" />
        Filter
      </button>
    </form>

    <!-- Refresh -->
    <button
      class="p-1.5 rounded-full text-md3-on-surface-variant
             hover:bg-md3-surface-container-high transition-colors"
      onclick={() => loadDirectory(currentFolderId)}
      title="Refresh"
    >
      <Icon name="refresh" size="20px" />
    </button>
  </div>

  <!-- Selection toolbar -->
  {#if selectMode && totalSelected > 0}
    <div class="flex items-center gap-2 bg-md3-primary-container/30 rounded-xl
                border border-md3-primary/20 px-3 py-2">
      <span class="text-xs text-md3-on-surface-variant">
        {totalSelected} selected
      </span>
      <button
        class="px-2.5 py-1 text-xs rounded-full font-medium
               bg-md3-error-container text-md3-on-error-container
               hover:brightness-110 transition-all flex items-center gap-1"
        style="font-family: var(--font-md3-sans);"
        onclick={handleDeleteSelected}
      >
        <Icon name="delete" size="14px" />
        Delete
      </button>
      <button
        class="px-2.5 py-1 text-xs rounded-full font-medium
               bg-md3-surface-container-high text-md3-on-surface-variant
               hover:brightness-110 transition-all flex items-center gap-1"
        style="font-family: var(--font-md3-sans);"
        onclick={clearSelection}
      >
        <Icon name="close" size="14px" />
        Clear
      </button>
    </div>
  {/if}

  <!-- Breadcrumb -->
  <Breadcrumb segments={breadcrumbSegments} onNavigate={handleBreadcrumbNavigate} />

  <!-- Error -->
  {#if error}
    <div class="bg-md3-error-container/60 border border-md3-error/30
                text-md3-on-error-container text-sm rounded-xl p-3">
      {error}
    </div>
  {/if}

  <!-- Loading -->
  {#if loading}
    <div class="flex items-center gap-2 text-sm text-md3-on-surface-variant">
      <span class="animate-spin">
        <Icon name="refresh" size="18px" />
      </span>
      Loading…
    </div>
  {/if}

  <!-- File list -->
  {#if !loading}
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline overflow-hidden">
      <!-- Header -->
      <div class="grid grid-cols-[auto_1fr_100px_160px] gap-3 px-4 py-2.5
                  bg-md3-surface-container-high/50
                  text-xs font-medium text-md3-on-surface-variant
                  uppercase tracking-wider
                  border-b border-md3-outline"
           style="font-family: var(--font-md3-sans);">
        <span></span>
        <span class="select-none">Name</span>
        <span class="text-right select-none">Size</span>
        <span class="text-right select-none">Modified</span>
      </div>

      {#if filteredFolders.length === 0 && filteredDocuments.length === 0}
        <p class="px-4 py-12 text-center text-sm text-md3-on-surface-variant">
          This directory is empty.
        </p>
      {/if}

      <!-- Parent directory link -->
      {#if parentId !== null}
        <button
          class="grid grid-cols-[auto_1fr_100px_160px] gap-3 px-4 py-2.5 w-full text-left
                 hover:bg-md3-primary-container/20
                 border-b border-md3-outline/50
                 transition-colors select-none"
          onclick={handleGoToParent}
        >
          <span class="self-center text-md3-primary">
            <Icon name="arrowBack" size="20px" />
          </span>
          <span class="text-sm font-medium text-md3-primary truncate">
            &lt;…&gt;
          </span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">—</span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">Parent directory</span>
        </button>
      {/if}

      <!-- Folders -->
      {#each filteredFolders as folder (folder.id)}
        <button
          class="grid grid-cols-[auto_1fr_100px_160px] gap-3 px-4 py-2.5 w-full text-left
                 hover:bg-md3-primary-container/20
                 border-b border-md3-outline/50
                 transition-colors select-none"
          onclick={() => handleFolderClick(folder)}
          oncontextmenu={(e) => showFolderContextMenu(e, folder)}
        >
          {#if selectMode}
            <span class="self-center">
              <input type="checkbox" checked={selectedFolderIds.has(folder.id)}
                     class="rounded border-md3-outline text-md3-primary" />
            </span>
          {:else}
            <span class="self-center text-md3-primary">
              <Icon name="folder" size="20px" />
            </span>
          {/if}
          <span class="text-sm font-medium text-md3-primary truncate">
            {folder.name}
          </span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">—</span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">
            {formatDate(folder.created_time)}
          </span>
        </button>
      {/each}

      <!-- Documents / Files -->
      {#each filteredDocuments as doc (doc.id)}
        <button
          class="grid grid-cols-[auto_1fr_100px_160px] gap-3 px-4 py-2.5 w-full text-left
                 hover:bg-md3-surface-container-high/30
                 border-b border-md3-outline/50 last:border-b-0
                 transition-colors select-none"
          onclick={() => handleDocumentClick(doc)}
          oncontextmenu={(e) => showDocumentContextMenu(e, doc)}
        >
          {#if selectMode}
            <span class="self-center">
              <input type="checkbox" checked={selectedDocumentIds.has(doc.id)}
                     class="rounded border-md3-outline text-md3-primary" />
            </span>
          {:else}
            <span class="self-center text-md3-on-surface-variant">
              <Icon name="filePresent" size="20px" />
            </span>
          {/if}
          <span class="text-sm text-md3-on-surface truncate">
            {doc.title}
          </span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">
            {formatBytes(doc.size)}
          </span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">
            {formatDate(doc.last_modified)}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<!-- Context menu (portal-like, positioned at viewport coordinates) -->
{#if contextMenu.visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="fixed inset-0 z-40" role="presentation" onclick={hideContextMenu} oncontextmenu={(e) => { e.preventDefault(); hideContextMenu(); }}></div>
  <div
    class="fixed z-50 bg-md3-surface-container/95 backdrop-blur-sm
           rounded-xl border border-md3-outline shadow-lg
           py-1 min-w-[140px]"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    role="menu"
  >
    {#if contextMenu.kind === 'document'}
      <button
        class="w-full text-left px-3 py-2 text-sm text-md3-on-surface
               hover:bg-md3-primary-container/30 transition-colors
               flex items-center gap-2"
        style="font-family: var(--font-md3-sans);"
        role="menuitem"
        onclick={contextDownload}
      >
        <Icon name="download" size="16px" />
        Download
      </button>
    {/if}
    <button
      class="w-full text-left px-3 py-2 text-sm text-md3-error
             hover:bg-md3-error-container/30 transition-colors
             flex items-center gap-2"
      style="font-family: var(--font-md3-sans);"
      role="menuitem"
      onclick={contextDelete}
    >
      <Icon name="delete" size="16px" />
      Delete
    </button>
  </div>
{/if}

<!-- Dismiss context menu on any click outside -->
<svelte:window onclick={handleGlobalClick} />
