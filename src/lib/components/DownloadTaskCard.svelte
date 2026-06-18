<script lang="ts">
  // A single download task card — MD3 elevated surface with actions.
  //
  // Updated with Material Symbol status icons, priority badge,
  // and open/delete file buttons for completed tasks.
  //
  // Reference: TaskTile in reference/src/include/ui/controls/components/explorer/tile.py

  import type { DownloadTaskDto, DownloadTaskStatus } from "../api";
  import { pauseDownload, resumeDownload, retryDownload, cancelDownload, deleteDownload, openDownloadedFile } from "../api";
  import { _ as t } from 'svelte-i18n';
  import DownloadProgress from "./DownloadProgress.svelte";
  import Icon from "./Icon.svelte";
  import type { IconName } from "$lib/icons";
  import { shortIdentifier } from "$lib/identifiers";
  import { formatPathFilename } from "$lib/path-format";

  interface Props {
    task: DownloadTaskDto;
    onRemove: (taskId: string) => void;
    onContextMenu?: (event: MouseEvent, task: DownloadTaskDto) => void;
  }

  let { task, onRemove, onContextMenu }: Props = $props();

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

  async function handleRetry() {
    actionPending = true;
    try {
      await retryDownload(task.task_id);
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

  async function handleOpen() {
    try {
      await openDownloadedFile(task.file_path);
    } catch (e) {
      console.error('Failed to open file:', e);
    }
  }

  async function handleDelete() {
    actionPending = true;
    try {
      await deleteDownload(task.task_id);
      onRemove(task.task_id);
    } catch (e) {
      console.error('Failed to delete download:', e);
    } finally {
      actionPending = false;
    }
  }

  /** Returns the Material Symbol icon for a download status. */
  function statusIcon(status: DownloadTaskStatus): IconName {
    switch (status) {
      case "pending":      return "schedule";
      case "downloading":  return "download";
      case "paused":       return "pauseCircle";
      case "decrypting":   return "lockOpen";
      case "verifying":    return "verified";
      case "completed":    return "checkCircle";
      case "failed":       return "errorFilled";
      case "cancelled":    return "cancel";
      case "scheduled":    return "accessTime";
      default:             return "help";
    }
  }

  /** Returns the color class for a status icon (per-status, mirrors reference). */
  function statusColor(status: DownloadTaskStatus): string {
    switch (status) {
      case "pending":     return "text-md3-on-surface-variant";
      case "downloading": return "text-md3-primary-emphasis";
      case "paused":      return "text-md3-warning";
      case "decrypting":  return "text-md3-tertiary";
      case "verifying":   return "text-md3-tertiary";
      case "completed":   return "text-md3-success";
      case "failed":      return "text-md3-error";
      case "cancelled":   return "text-md3-on-surface-variant";
      case "scheduled":   return "text-md3-secondary";
      default:            return "text-md3-on-surface-variant";
    }
  }

  function statusBadgeClass(): string {
    switch (task.status) {
      case "completed":
        return "bg-md3-success-container text-md3-on-success-container";
      case "failed":
        return "bg-md3-error-container text-md3-on-error-container";
      case "downloading":
        return "bg-md3-primary-container text-md3-on-primary-container";
      case "decrypting":
        return "bg-md3-tertiary-container text-md3-on-tertiary-container";
      case "verifying":
        return "bg-md3-tertiary-container text-md3-on-tertiary-container";
      case "paused":
        return "bg-md3-warning-container text-md3-on-warning-container";
      case "cancelled":
        return "bg-md3-surface-container-highest text-md3-on-surface-variant";
      case "scheduled":
        return "bg-md3-secondary-container text-md3-on-secondary-container";
      default:
        return "bg-md3-surface-container-high text-md3-on-surface-variant";
    }
  }

  function statusLabel(status: DownloadTaskStatus): string {
    switch (status) {
      case "pending": return $t('tasks.pending');
      case "downloading": return $t('tasks.downloading');
      case "paused": return $t('tasks.paused');
      case "completed": return $t('tasks.completed');
      case "failed": return $t('tasks.failed');
      case "cancelled": return $t('tasks.cancelled');
      case "decrypting": return $t('login.settingUpEncryption');
      case "verifying": return $t('common.verifying');
      case "scheduled": return $t('tasks.pending');
      default: return status;
    }
  }

  const isActive = $derived(
    ["downloading", "decrypting", "verifying"].includes(task.status),
  );
  const isPending = $derived(task.status === "pending");
  const isPaused = $derived(task.status === "paused");
  const isScheduled = $derived(task.status === "scheduled");
  const isTerminal = $derived(
    ["completed", "failed", "cancelled"].includes(task.status),
  );
  /** Whether the pause button should be visible. */
  const canPause = $derived(
    ["pending", "scheduled", "downloading", "decrypting", "verifying"].includes(task.status),
  );
  const canResume = $derived(task.status === "paused");
  const canRetry = $derived(task.status === "failed");
  /** Tasks that can be cancelled (matches reference — includes SCHEDULED). */
  const canCancel = $derived(
    !isTerminal && (isActive || isPending || isPaused || isScheduled),
  );
  const displayFilename = $derived(formatPathFilename(task.filename));
</script>

<!-- MD3 card: rounded-xl (12px) surface container with outline border -->
<div
  class="w-full min-w-0 bg-md3-surface-container/70 backdrop-blur-sm
         rounded-xl border border-md3-outline
         p-4 transition-shadow hover:shadow-lg hover:shadow-md3-primary/5"
  role="group"
  aria-label={displayFilename}
  oncontextmenu={(event) => onContextMenu?.(event, task)}
>
  <!-- Top row: status icon + filename + priority badge -->
  <div class="mb-2 flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
    <!-- Status icon -->
    <span class="shrink-0 mt-0.5 {statusColor(task.status)}">
      <Icon name={statusIcon(task.status)} size="24px" />
    </span>

    <div class="min-w-0 flex-1 basis-[14rem]">
      <div class="flex min-w-0 items-center gap-2">
        <p
          class="min-w-0 truncate font-medium text-md3-on-surface"
          title={displayFilename}
          style="font-family: var(--font-md3-sans);"
        >
          {displayFilename}
        </p>
        <!-- Priority badge -->
        {#if task.priority > 0}
          <span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full
                       bg-md3-surface-container-highest text-md3-on-surface-variant
                       font-medium">
            P{task.priority}
          </span>
        {/if}
      </div>
      <p
        class="text-xs text-md3-on-surface-variant truncate mt-0.5"
        title={task.file_path}
      >
        {task.file_path}
      </p>
    </div>

    <!-- Status badge -->
    <span
      class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
             shrink-0 {statusBadgeClass()}"
      style="font-family: var(--font-md3-sans);"
    >
      {statusLabel(task.status)}
      {#if task.status === "pending" && task.retry_count > 0}
        ({$t('tasks.retry', { values: { retry: task.retry_count, max: task.max_retries } })})
      {/if}
    </span>
  </div>

  <!-- Error message (reference format: "Failed: {error}" for failed, raw error otherwise) -->
  {#if task.error}
    <p class="text-xs text-md3-error mb-2 flex items-center gap-1">
      <Icon name="errorFilled" size="14px" />
      {task.status === "failed" ? $t('tasks.failedWithError', { values: { error: task.error } }) : task.error}
    </p>
  {/if}

  <!-- Progress bar -->
  <DownloadProgress
    progress={task.progress}
    currentBytes={task.current_bytes}
    totalBytes={task.total_bytes}
    message={task.message}
    status={task.status}
  />

  <!-- Actions (mirrors reference TaskTile button visibility) -->
  <div class="mt-3 flex min-w-0 flex-wrap gap-2">
    <!-- Pause/Resume -->
    {#if canPause}
      <button
        class="text-xs px-3 py-1.5 rounded-full font-medium
               bg-md3-warning-container text-md3-on-warning-container
               hover:brightness-110
               disabled:opacity-50 transition-all flex items-center gap-1"
        onclick={handlePause}
        disabled={actionPending}
      >
        <Icon name="pause" size="14px" />
        {$t('tasks.pause')}
      </button>
    {:else if canResume}
      <button
        class="text-xs px-3 py-1.5 rounded-full font-medium
               bg-md3-primary-container text-md3-on-primary-container
               hover:brightness-110
               disabled:opacity-50 transition-all flex items-center gap-1"
        onclick={handleResume}
        disabled={actionPending}
      >
        <Icon name="resume" size="14px" />
        {$t('tasks.resume')}
      </button>
    {/if}

    {#if canRetry}
      <button
        class="text-xs px-3 py-1.5 rounded-full font-medium
               bg-md3-primary-container text-md3-on-primary-container
               hover:brightness-110
               disabled:opacity-50 transition-all flex items-center gap-1"
        onclick={handleRetry}
        disabled={actionPending}
      >
        <Icon name="restartAlt" size="14px" />
        {$t('tasks.retryAction')}
      </button>
    {/if}

    <!-- Cancel: all non-terminal states (including scheduled) -->
    {#if canCancel}
      <button
        class="text-xs px-3 py-1.5 rounded-full font-medium
               bg-md3-error-container text-md3-on-error-container
               hover:brightness-110
               disabled:opacity-50 transition-all flex items-center gap-1"
        onclick={handleCancel}
        disabled={actionPending}
      >
        <Icon name="cancel" size="14px" />
        {$t('tasks.cancel')}
      </button>
    {/if}

    <!-- Open + Delete for completed tasks -->
    {#if task.status === "completed"}
      <button
        class="text-xs px-3 py-1.5 rounded-full font-medium
               bg-md3-primary-container text-md3-on-primary-container
               hover:brightness-110
               disabled:opacity-50 transition-all flex items-center gap-1"
        onclick={handleOpen}
        disabled={actionPending}
      >
        <Icon name="openInNew" size="14px" />
        {$t('common.open')}
      </button>
      <button
        class="text-xs px-3 py-1.5 rounded-full font-medium
               bg-md3-error-container text-md3-on-error-container
               hover:brightness-110
               disabled:opacity-50 transition-all flex items-center gap-1"
        onclick={handleDelete}
        disabled={actionPending}
      >
        <Icon name="delete" size="14px" />
        {$t('common.delete')}
      </button>
    {/if}

    <!-- Task ID -->
    <span class="ml-auto min-w-0 self-end truncate font-mono text-[10px] text-md3-on-surface-variant">
      {shortIdentifier(task.task_id, 12)}&hellip;
    </span>
  </div>
</div>
