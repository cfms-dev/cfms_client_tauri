// CFMS Client — Backend event listener setup
//
// Subscribes to the `cfms:event` Tauri event channel and dispatches
// updates to the reactive stores.  Called once from `+layout.svelte`.

import { listen } from "@tauri-apps/api/event";
import { get } from "svelte/store";
import { _ as t } from "svelte-i18n";
import type { ServiceEvent, UploadProgressEvent } from "./api";
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
        break;
      }

      case "ConnectionLost": {
        serverStateStore.connected = false;
        eventLog.push("error", `Connection lost: ${event.data.error}`);
        notificationStore.error("Connection lost. Please reconnect.", 8000);
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

  unlistenUpload = await listen<UploadProgressEvent>("cfms:upload-progress", (payload) => {
    const event = payload.payload;
    uploadStore.applyProgress(event);
    if (event.status === "completed") {
      eventLog.push("success", `Upload complete: ${event.file_name}`);
    } else if (event.status === "failed") {
      eventLog.push("error", `Upload failed: ${event.message ?? event.file_name}`);
      notificationStore.error(`Upload failed: ${event.message ?? event.file_name}`, 3000, {
        groupKey: "upload-failed",
        groupTitle: "Uploads failed",
        itemText: `${event.file_name}: ${event.message ?? "Unknown error"}`,
        summaryText: (count) => `${count} upload${count === 1 ? "" : "s"} failed`,
      });
    }
  });
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
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  if (unlistenUpload) {
    unlistenUpload();
    unlistenUpload = null;
  }
}
