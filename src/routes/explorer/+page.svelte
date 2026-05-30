<script lang="ts">
  // CFMS Client — File Explorer page
  //
  // Browses files with hierarchical breadcrumb navigation.
  // Initially scans the local filesystem via the `scan_directory` command
  // (safe — runs Rust-side).  Server-side browsing will be added when
  // the `list_server_directory` command is implemented.

  import { onMount } from "svelte";
  import { scanDirectory, addDownload } from "$lib/api";
  import type { FileEntry, DownloadTaskDto } from "$lib/api";
  import Breadcrumb from "$lib/components/Breadcrumb.svelte";

  // Navigation state
  let currentPath = $state("/");
  let entries = $state<FileEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let searchPattern = $state("");

  // Build breadcrumb segments from the current path.
  const breadcrumbSegments = $derived(() => {
    if (currentPath === "/") return [];
    const parts = currentPath.replace(/\\/g, "/").split("/").filter(Boolean);
    const segs: Array<{ label: string; path: string }> = [];
    let acc = "";
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

  async function handleQuickDownload(entry: FileEntry) {
    if (entry.is_dir) return;
    const task: DownloadTaskDto = {
      task_id: crypto.randomUUID(),
      file_id: entry.path,
      filename: entry.path.split(/[\\/]/).pop() ?? entry.path,
      file_path: entry.path,
      status: "pending",
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
    if (bytes === 0) return "—";
    const k = 1024;
    const sizes = ["B", "KiB", "MiB", "GiB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
  }

  function formatDate(ts: number | null): string {
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleString();
  }

  // Load root on mount.
  onMount(() => {
    loadPath("/");
  });

  // Separate dirs and files.
  const dirs = $derived(entries.filter((e) => e.is_dir));
  const files = $derived(entries.filter((e) => !e.is_dir));
</script>

<div class="p-6 space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-bold">File Explorer</h1>
    <!-- Search -->
    <form
      class="flex gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        handleSearch();
      }}
    >
      <input
        type="text"
        class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600
               bg-white dark:bg-gray-800 w-48
               focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        placeholder="Filter pattern…"
        bind:value={searchPattern}
      />
      <button
        type="submit"
        class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg
               hover:bg-blue-700 transition-colors"
      >
        Filter
      </button>
    </form>
  </div>

  <!-- Breadcrumb -->
  <Breadcrumb segments={breadcrumbSegments()} onNavigate={handleNavigate} />

  <!-- Error -->
  {#if error}
    <div class="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800
                text-red-700 dark:text-red-300 text-sm rounded-lg p-3">
      {error}
    </div>
  {/if}

  <!-- Loading -->
  {#if loading}
    <div class="flex items-center gap-2 text-sm text-gray-500">
      <span class="animate-spin">⟳</span> Scanning…
    </div>
  {/if}

  <!-- File list -->
  {#if !loading}
    <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <!-- Header -->
      <div class="grid grid-cols-[1fr_100px_160px_80px] gap-3 px-4 py-2
                  bg-gray-50 dark:bg-gray-850 text-xs font-medium
                  text-gray-500 dark:text-gray-400 uppercase tracking-wider
                  border-b border-gray-200 dark:border-gray-700">
        <span>Name</span>
        <span class="text-right">Size</span>
        <span class="text-right">Modified</span>
        <span></span>
      </div>

      <!-- Empty state -->
      {#if dirs.length === 0 && files.length === 0}
        <p class="px-4 py-8 text-center text-sm text-gray-400">
          This directory is empty.
        </p>
      {/if}

      <!-- Directories first -->
      {#each dirs as dir (dir.path)}
        <button
          class="grid grid-cols-[1fr_100px_160px_80px] gap-3 px-4 py-2 w-full text-left
                 hover:bg-blue-50 dark:hover:bg-blue-950/30
                 border-b border-gray-100 dark:border-gray-800
                 transition-colors"
          onclick={() => handleNavigate(dir.path)}
        >
          <span class="text-sm font-medium text-blue-600 dark:text-blue-400 truncate">
            📁 {dir.path.split(/[\\/]/).pop() ?? dir.path}
          </span>
          <span class="text-xs text-gray-400 text-right self-center">—</span>
          <span class="text-xs text-gray-400 text-right self-center">{formatDate(dir.modified)}</span>
          <span></span>
        </button>
      {/each}

      <!-- Files -->
      {#each files as file (file.path)}
        <div
          class="grid grid-cols-[1fr_100px_160px_80px] gap-3 px-4 py-2
                 hover:bg-gray-50 dark:hover:bg-gray-750
                 border-b border-gray-100 dark:border-gray-800 last:border-b-0
                 transition-colors"
        >
          <span class="text-sm truncate">
            📄 {file.path.split(/[\\/]/).pop() ?? file.path}
          </span>
          <span class="text-xs text-gray-500 text-right self-center">
            {formatBytes(file.size)}
          </span>
          <span class="text-xs text-gray-500 text-right self-center">
            {formatDate(file.modified)}
          </span>
          <button
            class="text-xs px-2 py-1 bg-blue-100 text-blue-700
                   dark:bg-blue-900 dark:text-blue-200
                   hover:bg-blue-200 dark:hover:bg-blue-800
                   rounded transition-colors"
            onclick={() => handleQuickDownload(file)}
          >
            Download
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>
