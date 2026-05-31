<script lang="ts">
  // A single download task card — MD3 elevated surface with actions.
  //
  // Uses MD3 colour tokens and shape system (12px card radius, 20px button radius).

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

  /** Returns MD3 status badge classes. */
  function statusBadgeClass(): string {
    switch (task.status) {
      case "completed":
        return "bg-md3-success-container text-md3-on-success-container";
      case "failed":
        return "bg-md3-error-container text-md3-on-error-container";
      case "downloading":
      case "decrypting":
      case "verifying":
        return "bg-md3-primary-container text-md3-on-primary-container";
      case "paused":
        return "bg-md3-warning-container text-md3-on-warning-container";
      case "cancelled":
        return "bg-md3-surface-container-highest text-md3-on-surface-variant";
      default:
        return "bg-md3-surface-container-high text-md3-on-surface-variant";
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

<!-- MD3 card: rounded-xl (12px) surface container with outline border -->
<div
  class="bg-md3-surface-container/70 backdrop-blur-sm
         rounded-xl border border-md3-outline
         p-4 transition-shadow hover:shadow-lg hover:shadow-md3-primary/5"
>
  <!-- Top row: filename + status badge -->
  <div class="flex items-start justify-between gap-3 mb-2">
    <div class="min-w-0 flex-1">
      <p
        class="font-medium text-md3-on-surface truncate"
        title={task.filename}
        style="font-family: var(--font-md3-sans);"
      >
        {task.filename}
      </p>
      <p
        class="text-xs text-md3-on-surface-variant truncate mt-0.5"
        title={task.file_path}
      >
        {task.file_path}
      </p>
    </div>
    <!-- MD3 badge: fully rounded pill (rounded-full) -->
    <span
      class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
             shrink-0 {statusBadgeClass()}"
      style="font-family: var(--font-md3-sans);"
    >
      {task.status}
    </span>
  </div>

  <!-- Error message -->
  {#if task.error}
    <p class="text-xs text-md3-error mb-2">{task.error}</p>
  {/if}

  <!-- Progress bar -->
  <DownloadProgress
    progress={task.progress}
    currentBytes={task.current_bytes}
    totalBytes={task.total_bytes}
    status={task.status}
  />

  <!-- Actions — MD3 pill buttons (rounded-full = 20px equivalent) -->
  <div class="flex gap-2 mt-3">
    {#if isActive}
      <button
        class="text-xs px-4 py-1.5 rounded-full font-medium
               bg-md3-warning-container text-md3-on-warning-container
               hover:brightness-110
               disabled:opacity-50 transition-all"
        onclick={handlePause}
        disabled={actionPending}
      >
        Pause
      </button>
      <button
        class="text-xs px-4 py-1.5 rounded-full font-medium
               bg-md3-error-container text-md3-on-error-container
               hover:brightness-110
               disabled:opacity-50 transition-all"
        onclick={handleCancel}
        disabled={actionPending}
      >
        Cancel
      </button>
    {:else if isPaused}
      <button
        class="text-xs px-4 py-1.5 rounded-full font-medium
               bg-md3-primary-container text-md3-on-primary-container
               hover:brightness-110
               disabled:opacity-50 transition-all"
        onclick={handleResume}
        disabled={actionPending}
      >
        Resume
      </button>
      <button
        class="text-xs px-4 py-1.5 rounded-full font-medium
               bg-md3-error-container text-md3-on-error-container
               hover:brightness-110
               disabled:opacity-50 transition-all"
        onclick={handleCancel}
        disabled={actionPending}
      >
        Cancel
      </button>
    {/if}

    <!-- Task ID for debugging -->
    <span class="ml-auto text-[10px] text-md3-on-surface-variant self-end font-mono">
      {task.task_id.slice(0, 12)}…
    </span>
  </div>
</div>
