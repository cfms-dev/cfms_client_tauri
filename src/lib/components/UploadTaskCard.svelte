<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import type { UploadTaskDto, UploadTaskStatus } from '$lib/api';
  import DownloadProgress from '$lib/components/DownloadProgress.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';
  import { shortIdentifier } from '$lib/identifiers';

  interface Props {
    task: UploadTaskDto;
    onPause: (uploadId: string) => Promise<void> | void;
    onResume: (uploadId: string) => Promise<void> | void;
    onCancel: (uploadId: string) => Promise<void> | void;
  }

  let { task, onPause, onResume, onCancel }: Props = $props();
  let actionPending = $state(false);

  const isTerminal = $derived(["completed", "failed", "cancelled", "skipped"].includes(task.status));

  function statusIcon(status: UploadTaskStatus): IconName {
    if (status === "uploading") return "upload";
    if (status === "paused") return "pauseCircle";
    if (status === "completed") return "checkCircle";
    if (status === "failed") return "errorFilled";
    if (status === "cancelled" || status === "skipped") return "cancel";
    return "schedule";
  }

  function statusColor(status: UploadTaskStatus): string {
    if (status === "uploading") return "text-md3-primary-emphasis";
    if (status === "paused") return "text-md3-warning";
    if (status === "completed") return "text-md3-success";
    if (status === "failed") return "text-md3-error";
    return "text-md3-on-surface-variant";
  }

  function statusBadgeClass(status: UploadTaskStatus): string {
    if (status === "completed") return "bg-md3-success-container text-md3-on-success-container";
    if (status === "failed") return "bg-md3-error-container text-md3-on-error-container";
    if (status === "uploading") return "bg-md3-primary-container text-md3-on-primary-container";
    if (status === "paused") return "bg-md3-warning-container text-md3-on-warning-container";
    return "bg-md3-surface-container-high text-md3-on-surface-variant";
  }

  function statusLabel(status: UploadTaskStatus): string {
    if (status === "pending") return $t('tasks.uploadQueued');
    if (status === "uploading") return $t('tasks.uploading');
    if (status === "paused") return $t('tasks.paused');
    if (status === "completed") return $t('tasks.uploadCompleted');
    if (status === "failed") return $t('tasks.failed');
    if (status === "cancelled" || status === "skipped") return $t('tasks.cancelled');
    return status;
  }

  async function runAction(action: (uploadId: string) => Promise<void> | void) {
    actionPending = true;
    try {
      await action(task.upload_id);
    } finally {
      actionPending = false;
    }
  }
</script>

<article class="rounded-xl border border-md3-outline bg-md3-surface-container/70 p-4 shadow-sm transition-shadow hover:shadow-lg hover:shadow-md3-primary/5">
  <div class="mb-2 flex items-start gap-3">
    <span class="mt-0.5 shrink-0 {statusColor(task.status)}">
      <Icon name={statusIcon(task.status)} size="24px" />
    </span>

    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold text-md3-on-surface" title={task.file_name}>{task.file_name}</p>
      <p class="mt-0.5 truncate text-xs text-md3-on-surface-variant" title={task.source_path}>
        {task.message ?? task.source_path}
      </p>
    </div>

    <span class="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium {statusBadgeClass(task.status)}">
      {statusLabel(task.status)}
    </span>
  </div>

  {#if task.error}
    <p class="mb-2 flex items-center gap-1 text-xs text-md3-error">
      <Icon name="errorFilled" size="14px" />
      {task.error}
    </p>
  {/if}

  <DownloadProgress
    progress={task.progress}
    currentBytes={task.current_bytes}
    totalBytes={task.total_bytes}
    message={task.message}
    status={task.status === "uploading" ? "downloading" : task.status === "paused" ? "paused" : task.status === "completed" ? "completed" : task.status === "failed" ? "failed" : task.status === "cancelled" ? "cancelled" : "pending"}
    completedText={$t('tasks.uploadCompleted')}
  />

  <div class="mt-3 flex gap-2">
    {#if task.status === "uploading" || task.status === "pending"}
      <button
        class="flex items-center gap-1 rounded-full bg-md3-warning-container px-3 py-1.5 text-xs font-medium text-md3-on-warning-container transition-all hover:brightness-110 disabled:opacity-50"
        onclick={() => runAction(onPause)}
        disabled={actionPending}
      >
        <Icon name="pause" size="14px" />
        {$t('tasks.pause')}
      </button>
    {/if}

    {#if task.status === "paused"}
      <button
        class="flex items-center gap-1 rounded-full bg-md3-primary-container px-3 py-1.5 text-xs font-medium text-md3-on-primary-container transition-all hover:brightness-110 disabled:opacity-50"
        onclick={() => runAction(onResume)}
        disabled={actionPending}
      >
        <Icon name="resume" size="14px" />
        {$t('tasks.resume')}
      </button>
    {/if}

    {#if !isTerminal}
      <button
        class="flex items-center gap-1 rounded-full bg-md3-error-container px-3 py-1.5 text-xs font-medium text-md3-on-error-container transition-all hover:brightness-110 disabled:opacity-50"
        onclick={() => runAction(onCancel)}
        disabled={actionPending}
      >
        <Icon name="cancel" size="14px" />
        {$t('tasks.cancel')}
      </button>
    {/if}

    <span class="ml-auto self-end font-mono text-[10px] text-md3-on-surface-variant" title={task.upload_id}>
      {shortIdentifier(task.upload_id, 12)}&hellip;
    </span>
  </div>
</article>
