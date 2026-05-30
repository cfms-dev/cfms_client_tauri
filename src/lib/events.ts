// CFMS Client — Backend event listener setup
//
// Subscribes to the `cfms:event` Tauri event channel and dispatches
// updates to the reactive stores.  Called once from `+layout.svelte`.

import { listen } from "@tauri-apps/api/event";
import type { ServiceEvent } from "./api";
import { authStore, downloadStore, eventLog } from "./stores.svelte";

let unlisten: (() => void) | null = null;

/** Start listening for backend `cfms:event` events. */
export async function initEventListeners(): Promise<void> {
  if (unlisten) return; // Already initialized.

  unlisten = await listen<ServiceEvent>("cfms:event", (payload) => {
    const event = payload.payload;

    switch (event.event) {
      case "DownloadProgress": {
        const { task_id, phase, current, total } = event.data;
        downloadStore.updateProgress(task_id, phase, current, total);
        eventLog.push(
          "info",
          `Download ${task_id.slice(0, 8)}…: ${phase} ${formatBytes(current)}/${formatBytes(total)}`,
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
        break;
      }

      case "DownloadCancelled": {
        const { task_id } = event.data;
        downloadStore.markCancelled(task_id);
        eventLog.push("info", `Download cancelled: ${task_id.slice(0, 8)}…`);
        break;
      }

      case "Lockdown": {
        authStore.lockdown = event.data.status;
        eventLog.push(
          "warning",
          `Lockdown ${event.data.status ? "activated" : "deactivated"}`,
        );
        break;
      }

      case "TokenExpired": {
        authStore.clear();
        eventLog.push("error", "Authentication token expired");
        break;
      }

      case "FavoritesValidationComplete": {
        const { invalid_count } = event.data;
        if (invalid_count > 0) {
          eventLog.push(
            "warning",
            `Favorites validation: ${invalid_count} items are no longer accessible`,
          );
        }
        break;
      }
    }
  });
}

/** Stop listening for backend events. */
export function stopEventListeners(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KiB", "MiB", "GiB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}
