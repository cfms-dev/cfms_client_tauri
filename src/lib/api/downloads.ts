// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { DownloadTaskDto, DownloadTaskStatus } from './types';

/** Add a download task to the queue. */
export async function addDownload(task: DownloadTaskDto): Promise<void> {
  return invoke("add_download", { task });
}

/** Get download tasks, optionally filtered by status. */
export async function getDownloadTasks(
  statusFilter?: DownloadTaskStatus,
): Promise<DownloadTaskDto[]> {
  return invoke("get_download_tasks", { statusFilter: statusFilter ?? null });
}

interface PauseDownloadOptions {
  stopActiveBatch?: boolean;
}

/** Pause an in-progress download. */
export async function pauseDownload(
  taskId: string,
  options: PauseDownloadOptions = {},
): Promise<boolean> {
  const paused = await invoke<boolean>("pause_download", { taskId });
  if (paused && options.stopActiveBatch !== false && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cfms:download-paused", { detail: { taskId } }));
  }
  return paused;
}

/** Resume a paused download. */
export async function resumeDownload(taskId: string): Promise<boolean> {
  return invoke("resume_download", { taskId });
}

/** Retry a failed download. */
export async function retryDownload(taskId: string): Promise<boolean> {
  return invoke("retry_download", { taskId });
}

/** Cancel a download task. */
export async function cancelDownload(taskId: string): Promise<boolean> {
  return invoke("cancel_download", { taskId });
}

/** Clear all completed and cancelled tasks. */
export async function clearCompletedTasks(): Promise<number> {
  return invoke("clear_completed_tasks");
}

/** Clear all failed tasks. */
export async function clearFailedTasks(): Promise<number> {
  return invoke("clear_failed_tasks");
}

// ---------------------------------------------------------------------------
