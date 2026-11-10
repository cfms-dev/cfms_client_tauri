import type { ServiceEvent } from '$lib/api/types';
import { eventLog } from '$lib/features/diagnostics/event-log.svelte';
import { notificationStore } from '$lib/shared/notifications/notifications.svelte';
import { translate } from '$lib/shared/i18n/translate';
import type { UploadTaskDto, TransferDirection } from '$lib/api/types';
import { downloadStore } from './download-state.svelte';
import { uploadStore } from './upload-state.svelte';

export function handleTransferEvent(event: ServiceEvent): void {
  switch (event.event) {
      case "DownloadProgress": {
        const { task_id, phase, progress, message, current_bytes, total_bytes } = event.data;
        downloadStore.updateProgress(task_id, phase, progress, message, current_bytes, total_bytes);
        updateDownloadBadgeFromStore();
        break;
      }

      case "DownloadTaskUpdated": {
        downloadStore.upsert(event.data.task);
        updateDownloadBadgeFromStore();
        break;
      }

      case "DownloadTaskReplaced": {
        downloadStore.remove(event.data.old_task_id);
        downloadStore.upsert(event.data.task);
        updateDownloadBadgeFromStore();
        eventLog.push(
          "info",
          `Download task renewed: ${event.data.old_task_id.slice(0, 8)}… → ${event.data.task.task_id.slice(0, 8)}…`,
        );
        break;
      }

      case "DownloadCompleted": {
        const { task_id, file_path } = event.data;
        downloadStore.markCompleted(task_id);
        eventLog.push("success", `Download complete: ${file_path}`);
        break;
      }

      case "DownloadFailed": {
        const { task_id, error } = event.data;
        downloadStore.markFailed(task_id, error);
        eventLog.push("error", `Download failed: ${error}`);
        notificationStore.error(translate("downloads.failedOne", { error }), 5000, {
          groupKey: "download-failed",
          groupTitle: translate("downloads.failedTitle"),
          itemText: error,
          summaryText: (count) => translate("downloads.failedSummary", { count }),
        });
        break;
      }

      case "DownloadPaused": {
        const { task_id } = event.data;
        downloadStore.markPaused(task_id);
        eventLog.push("info", `Download paused: ${task_id.slice(0, 8)}…`);
        break;
      }

      case "DownloadCancelled": {
        const { task_id } = event.data;
        downloadStore.markCancelled(task_id);
        eventLog.push("info", `Download cancelled: ${task_id.slice(0, 8)}…`);
        break;
      }

      case "ActiveCountChanged": {
        const { count } = event.data;
        downloadStore.activeBadgeCount = count;
        break;
      }

  }
}

export function handleUploadTask(task: UploadTaskDto): void {
    const previous = uploadStore.tasks.get(task.upload_id);
    if (!uploadStore.applyTask(task) || previous?.status === task.status) return;
    if (task.status === 'completed') eventLog.push('success', `Upload complete: ${task.file_name}`);
    if (task.status === 'failed') eventLog.push('error', `Upload failed: ${task.error ?? task.message ?? task.file_name}`);
    if (['completed', 'failed', 'skipped', 'cancelled', 'interrupted'].includes(task.status)) {
      const batchId = task.batch_id;
      const batch = uploadStore.allTasks.filter(t => batchId ? t.batch_id === batchId : t.upload_id === task.upload_id);
      const finished = batch.every(t => ['completed', 'failed', 'skipped', 'cancelled', 'interrupted'].includes(t.status));
      if (finished) {
        const failed = batch.filter(t => ['failed', 'interrupted'].includes(t.status)).length;
        const message = translate(failed ? 'tasks.batchFinishedWithErrors' : 'tasks.batchFinished', { count: batch.length, failed });
        if (failed) notificationStore.error(message, 8000);
        else if (batch.length > 1) notificationStore.success(message);
      }
    }
}

export function handleRemovedRecords(payload: { direction: TransferDirection; ids: string[] }): void {
    for (const id of payload.ids) {
      if (payload.direction === 'upload') uploadStore.remove(id);
      else downloadStore.remove(id);
    }
    updateDownloadBadgeFromStore();
}

function updateDownloadBadgeFromStore() {
  downloadStore.activeBadgeCount = [...downloadStore.tasks.values()].filter((task) =>
    ["pending", "downloading", "decrypting", "verifying", "scheduled"].includes(task.status),
  ).length;
}
