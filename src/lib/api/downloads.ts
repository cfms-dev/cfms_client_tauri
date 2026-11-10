// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { BatchActionResult, DownloadTaskDto, DownloadTaskStatus, TransferControlAction, TransferDirection } from './types/transfers';

export interface DownloadSelection { id: string; name: string; kind: 'directory' | 'document' }
export interface DownloadBatchSnapshot {
  batchId: string; batchName: string; batchRootId: string | null; batchCreatedAt: number;
  phase: 'collecting' | 'queueing'; paused: boolean; discovered: number; queued: number; failed: number;
  rateLimited: number; rateLimitWaiting: boolean; finished?: boolean; error?: string | null;
}
export function startDownloadBatch(selection: DownloadSelection[], name: string, rootId: string | null): Promise<DownloadBatchSnapshot> {
  return invoke('start_download_batch', { selection, name, rootId });
}
export function getDownloadBatches(): Promise<DownloadBatchSnapshot[]> { return invoke('get_download_batches'); }

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

/** Pause an in-progress download. */
export async function pauseDownload(taskId: string): Promise<boolean> {
  return invoke("pause_download", { taskId });
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

/** Remove terminal history records without deleting downloaded files. */
export async function removeDownloadRecords(ids: string[]): Promise<BatchActionResult> {
  return invoke("remove_download_records", { ids });
}

/** Delete completed output files while keeping their history records. */
export async function deleteDownloadedFiles(ids: string[]): Promise<BatchActionResult> {
  return invoke("delete_downloaded_files", { ids });
}

export async function controlTransferTasks(
  direction: TransferDirection,
  ids: string[],
  action: TransferControlAction,
  batchIds: string[] = [],
): Promise<BatchActionResult> {
  return invoke("control_transfer_tasks", { direction, ids, action, batchIds });
}

export async function removeTransferRecords(
  direction: TransferDirection,
  ids: string[] = [],
  statuses?: string[],
): Promise<BatchActionResult> {
  return invoke("remove_transfer_records", { direction, ids, statuses: statuses ?? null });
}

// ---------------------------------------------------------------------------
