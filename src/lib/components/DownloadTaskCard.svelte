<script lang="ts">
  // A single download task card showing filename, progress, and actions.

  import type { DownloadTaskDto } from "../api";
  import { pauseDownload, resumeDownload, cancelDownload } from "../api";
  import DownloadProgress from "./DownloadProgress.svelte";

  interface Props {
    task: DownloadTaskDto;
    onRemove: (taskId: string) => void;
  }

  let { task, onRemove }: Props = $props();

  let actionPending = $state(false);

  async function handlePause() {
    actionPending = true;
    try {
      await pauseDownload(task.task_id);
    } finally {
      actionPending = false;
    }
  }

  async function handleResume() {
    actionPending = true;
    try {
      await resumeDownload(task.task_id);
    } finally {
      actionPending = false;
    }
  }

  async function handleCancel() {
    actionPending = true;
    try {
      await cancelDownload(task.task_id);
      onRemove(task.task_id);
    } finally {
      actionPending = false;
    }
  }

  function statusBadgeClass(): string {
    switch (task.status) {
      case "completed":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "failed":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "downloading":
      case "decrypting":
      case "verifying":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "paused":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "cancelled":
        return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
      default:
        return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
    }
  }

  const isActive = $derived(
    ["downloading", "decrypting", "verifying", "pending"].includes(task.status),
  );
  const isPaused = $derived(task.status === "paused");
  const isTerminal = $derived(
    ["completed", "failed", "cancelled"].includes(task.status),
  );
</script>

<div
  class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700
         p-4 shadow-sm hover:shadow-md transition-shadow"
>
  <!-- Top row: filename + status badge -->
  <div class="flex items-start justify-between gap-3 mb-2">
    <div class="min-w-0 flex-1">
      <p class="font-medium text-gray-900 dark:text-gray-100 truncate" title={task.filename}>
        {task.filename}
      </p>
      <p class="text-xs text-gray-500 dark:text-gray-400 truncate" title={task.file_path}>
        {task.file_path}
      </p>
    </div>
    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 {statusBadgeClass()}">
      {task.status}
    </span>
  </div>

  <!-- Error message -->
  {#if task.error}
    <p class="text-xs text-red-600 dark:text-red-400 mb-2">{task.error}</p>
  {/if}

  <!-- Progress bar -->
  <DownloadProgress
    progress={task.progress}
    currentBytes={task.current_bytes}
    totalBytes={task.total_bytes}
    status={task.status}
  />

  <!-- Actions -->
  <div class="flex gap-2 mt-3">
    {#if isActive}
      <button
        class="text-xs px-3 py-1 rounded bg-yellow-100 text-yellow-700
               dark:bg-yellow-900 dark:text-yellow-200
               hover:bg-yellow-200 dark:hover:bg-yellow-800
               disabled:opacity-50 transition-colors"
        onclick={handlePause}
        disabled={actionPending}
      >
        Pause
      </button>
      <button
        class="text-xs px-3 py-1 rounded bg-red-100 text-red-700
               dark:bg-red-900 dark:text-red-200
               hover:bg-red-200 dark:hover:bg-red-800
               disabled:opacity-50 transition-colors"
        onclick={handleCancel}
        disabled={actionPending}
      >
        Cancel
      </button>
    {:else if isPaused}
      <button
        class="text-xs px-3 py-1 rounded bg-blue-100 text-blue-700
               dark:bg-blue-900 dark:text-blue-200
               hover:bg-blue-200 dark:hover:bg-blue-800
               disabled:opacity-50 transition-colors"
        onclick={handleResume}
        disabled={actionPending}
      >
        Resume
      </button>
      <button
        class="text-xs px-3 py-1 rounded bg-red-100 text-red-700
               dark:bg-red-900 dark:text-red-200
               hover:bg-red-200 dark:hover:bg-red-800
               disabled:opacity-50 transition-colors"
        onclick={handleCancel}
        disabled={actionPending}
      >
        Cancel
      </button>
    {/if}

    <!-- Task ID for debugging -->
    <span class="ml-auto text-[10px] text-gray-400 dark:text-gray-600 self-end">
      {task.task_id.slice(0, 12)}…
    </span>
  </div>
</div>
