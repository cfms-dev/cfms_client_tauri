// CFMS Client — Backend event listener setup
//
// Subscribes to the `cfms:event` Tauri event channel and dispatches
// updates to the reactive stores.  Called once from `+layout.svelte`.

import { listen } from "@tauri-apps/api/event";
import { get } from "svelte/store";
import { _ as t } from "svelte-i18n";
import type { ServiceEvent, UploadTaskDto, TransferDirection } from "./api";
import {
  authStore,
  downloadStore,
  eventLog,
  fileShortcutValidationStore,
  notificationStore,
  serverStateStore,
  uploadStore,
} from "./stores.svelte";

let unlisten: (() => void) | null = null;
let unlistenRemoved: (() => void) | null = null;
let unlistenUpload: (() => void) | null = null;

/** Start listening for backend `cfms:event` events. */
export async function initEventListeners(): Promise<void> {
  if (unlisten) return; // Already initialized.

  unlisten = await listen<ServiceEvent>("cfms:event", (payload) => {
    const event = payload.payload;

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
        emitExtensionEvent("tasks.changed");
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
        emitExtensionEvent("tasks.changed");
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

      case "Lockdown": {
        serverStateStore.lockdown = event.data.status;
        serverStateStore.lockdownReason = event.data.reason;
        eventLog.push(
          "warning",
          `Lockdown ${event.data.status ? "activated" : "deactivated"}`,
        );
        break;
      }

      case "ConnectionRestored": {
        serverStateStore.connected = true;
        eventLog.push("success", "Connection restored");
        emitExtensionEvent("connection.changed");
        break;
      }

      case "ConnectionLost": {
        serverStateStore.connected = false;
        eventLog.push("error", `Connection lost: ${event.data.error}`);
        notificationStore.error("Connection lost. Please reconnect.", 8000);
        emitExtensionEvent("connection.changed");
        break;
      }

      case "TokenExpired": {
        authStore.clear();
        eventLog.push("error", "Authentication token expired");
        notificationStore.error("Authentication token expired", 8000);
        break;
      }

      case "FavoritesValidationComplete": {
        const { invalid_count } = event.data;
        fileShortcutValidationStore.apply(event.data);
        if (invalid_count > 0) {
          eventLog.push(
            "warning",
            `Shortcut validation: ${invalid_count} items are no longer accessible`,
          );
        }
        break;
      }
    }
  });

  unlistenUpload = await listen<UploadTaskDto>("cfms:upload-task", ({ payload: task }) => {
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
    emitExtensionEvent('tasks.changed');
  });
  unlistenRemoved = await listen<{ direction: TransferDirection; ids: string[] }>('cfms:transfer-records-removed', ({ payload }) => {
    for (const id of payload.ids) {
      if (payload.direction === 'upload') uploadStore.remove(id);
      else downloadStore.remove(id);
    }
    updateDownloadBadgeFromStore();
  });
}

function emitExtensionEvent(name: "connection.changed" | "tasks.changed") {
  window.dispatchEvent(new CustomEvent("cfms:extension-event", { detail: name }));
}

function translate(key: string, values: Record<string, string | number> = {}) {
  return get(t)(key, { values });
}

function updateDownloadBadgeFromStore() {
  downloadStore.activeBadgeCount = [...downloadStore.tasks.values()].filter((task) =>
    ["pending", "downloading", "decrypting", "verifying", "scheduled"].includes(task.status),
  ).length;
}

/** Stop listening for backend events. */
export function stopEventListeners(): void {
  unlistenRemoved?.();
  unlistenRemoved = null;
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  if (unlistenUpload) {
    unlistenUpload();
    unlistenUpload = null;
  }
}
