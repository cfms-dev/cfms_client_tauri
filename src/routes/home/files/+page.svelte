<script lang="ts">
  // File Manager page
  //
  // Browses files with hierarchical breadcrumb navigation.  Initially scans
  // the local filesystem via the `scan_directory` command (safe — runs Rust-side).
  // Server-side browsing will be added when the `list_server_directory` command
  // is implemented.
  //
  // Adapted from the existing explorer page.
  // Reference: FileManagerView in reference/src/include/ui/views/explorer.py

  import { onMount } from 'svelte';
  import { scanDirectory, addDownload } from '$lib/api';
  import type { FileEntry, DownloadTaskDto } from '$lib/api';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Icon from '$lib/components/Icon.svelte';

  // Navigation state
  let currentPath = $state('/');
  let entries = $state<FileEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let searchPattern = $state('');
  let selectMode = $state(false);
  let selectedPaths = $state<Set<string>>(new Set());

  const breadcrumbSegments = $derived.by(() => {
    if (currentPath === '/') return [];
    const parts = currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
    const segs: Array<{ label: string; path: string }> = [];
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : `/${part}`;
      segs.push({ label: part, path: acc });
    }
    return segs;
  });

  async function loadPath(path: string) {
    loading = true;
    error = null;
    currentPath = path;
    selectedPaths = new Set();
    try {
      entries = await scanDirectory(path, searchPattern || undefined);
    } catch (e) {
      error = String(e);
      entries = [];
    } finally {
      loading = false;
    }
  }

  function handleNavigate(path: string) {
    loadPath(path);
  }

  async function handleSearch() {
    await loadPath(currentPath);
  }

  function toggleSelect(path: string) {
    const next = new Set(selectedPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    selectedPaths = next;
  }

  function clearSelection() {
    selectedPaths = new Set();
    selectMode = false;
  }

  function toggleSelectMode() {
    selectMode = !selectMode;
    if (!selectMode) selectedPaths = new Set();
  }

  async function handleQuickDownload(entry: FileEntry) {
    if (entry.is_dir) return;
    const task: DownloadTaskDto = {
      task_id: crypto.randomUUID(),
      file_id: entry.path,
      filename: entry.path.split(/[\\/]/).pop() ?? entry.path,
      file_path: entry.path,
      status: 'pending',
      progress: 0,
      current_bytes: 0,
      total_bytes: entry.size,
      error: null,
      created_at: Math.floor(Date.now() / 1000),
      started_at: null,
      completed_at: null,
      priority: 0,
      retry_count: 0,
      max_retries: 3,
      scheduled_time: null,
    };
    try {
      await addDownload(task);
    } catch (e) {
      error = String(e);
    }
  }

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

  onMount(() => {
    loadPath('/');
  });

  const dirs = $derived(entries.filter((e) => e.is_dir));
  const files = $derived(entries.filter((e) => !e.is_dir));
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
    >
      <Icon name="deleteSweep" size="16px" />
      Trash
    </button>

    <!-- Spacer -->
    <span class="flex-1"></span>

    <!-- Search -->
    <form
      class="flex gap-2"
      onsubmit={(e) => { e.preventDefault(); handleSearch(); }}
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
      onclick={() => loadPath(currentPath)}
      title="Refresh"
    >
      <Icon name="refresh" size="20px" />
    </button>
  </div>

  <!-- Selection toolbar -->
  {#if selectMode && selectedPaths.size > 0}
    <div class="flex items-center gap-2 bg-md3-primary-container/30 rounded-xl
                border border-md3-primary/20 px-3 py-2">
      <span class="text-xs text-md3-on-surface-variant">
        {selectedPaths.size} selected
      </span>
      <button
        class="px-2.5 py-1 text-xs rounded-full font-medium
               bg-md3-error-container text-md3-on-error-container
               hover:brightness-110 transition-all flex items-center gap-1"
        style="font-family: var(--font-md3-sans);"
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
  <Breadcrumb segments={breadcrumbSegments} onNavigate={handleNavigate} />

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
      Scanning…
    </div>
  {/if}

  <!-- File list -->
  {#if !loading}
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline overflow-hidden">
      <!-- Header -->
      <div class="grid grid-cols-[auto_1fr_100px_160px_80px] gap-3 px-4 py-2.5
                  bg-md3-surface-container-high/50
                  text-xs font-medium text-md3-on-surface-variant
                  uppercase tracking-wider
                  border-b border-md3-outline"
           style="font-family: var(--font-md3-sans);">
        <span></span>
        <span>Name</span>
        <span class="text-right">Size</span>
        <span class="text-right">Modified</span>
        <span></span>
      </div>

      {#if dirs.length === 0 && files.length === 0}
        <p class="px-4 py-12 text-center text-sm text-md3-on-surface-variant">
          This directory is empty.
        </p>
      {/if}

      <!-- Directories -->
      {#each dirs as dir (dir.path)}
        <button
          class="grid grid-cols-[auto_1fr_100px_160px_80px] gap-3 px-4 py-2.5 w-full text-left
                 hover:bg-md3-primary-container/20
                 border-b border-md3-outline/50
                 transition-colors"
          onclick={() => selectMode ? toggleSelect(dir.path) : handleNavigate(dir.path)}
        >
          {#if selectMode}
            <span class="self-center">
              <input type="checkbox" checked={selectedPaths.has(dir.path)}
                     class="rounded border-md3-outline text-md3-primary" />
            </span>
          {:else}
            <span class="self-center text-md3-primary">
              <Icon name="folder" size="20px" />
            </span>
          {/if}
          <span class="text-sm font-medium text-md3-primary truncate">
            {dir.path.split(/[\\/]/).pop() ?? dir.path}
          </span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">—</span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">
            {formatDate(dir.modified)}
          </span>
          <span></span>
        </button>
      {/each}

      <!-- Files -->
      {#each files as file (file.path)}
        <div
          class="grid grid-cols-[auto_1fr_100px_160px_80px] gap-3 px-4 py-2.5
                 hover:bg-md3-surface-container-high/30
                 border-b border-md3-outline/50 last:border-b-0
                 transition-colors"
        >
          {#if selectMode}
            <span class="self-center">
              <input type="checkbox" checked={selectedPaths.has(file.path)}
                     class="rounded border-md3-outline text-md3-primary"
                     onchange={() => toggleSelect(file.path)} />
            </span>
          {:else}
            <span class="self-center text-md3-on-surface-variant">
              <Icon name="filePresent" size="20px" />
            </span>
          {/if}
          <span class="text-sm text-md3-on-surface truncate">
            {file.path.split(/[\\/]/).pop() ?? file.path}
          </span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">
            {formatBytes(file.size)}
          </span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">
            {formatDate(file.modified)}
          </span>
          <button
            class="text-xs px-3 py-1 rounded-full font-medium
                   bg-md3-primary-container text-md3-on-primary-container
                   hover:brightness-110 transition-all flex items-center gap-1"
            style="font-family: var(--font-md3-sans);"
            onclick={() => handleQuickDownload(file)}
          >
            <Icon name="download" size="14px" />
            Download
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>
