

export type DownloadTaskStatus =
  | "pending"
  | "downloading"
  | "paused"
  | "decrypting"
  | "verifying"
  | "completed"
  | "deleted"
  | "failed"
  | "cancelled"
  | "scheduled";

export type UploadTaskStatus =
  | "pending"
  | "uploading"
  | "paused"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export type DownloadPhase =
  | "downloading"
  | "decrypting"
  | "cleaning"
  | "verifying";

// ---------------------------------------------------------------------------
// DTOs (matching cfms_core::types)
// ---------------------------------------------------------------------------

export interface DownloadTaskDto {
  task_id: string;
  file_id: string;
  filename: string;
  file_path: string;
  status: DownloadTaskStatus;
  progress: number;
  current_bytes: number;
  total_bytes: number;
  message: string | null;
  error: string | null;
  failure_kind?: "server_task_unclaimable" | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  priority: number;
  retry_count: number;
  max_retries: number;
  scheduled_time: number | null;
  stage: number;
  bandwidth_limit: number | null;
  pause_position: number | null;
  supports_resume: boolean;
  server_task_recreate_count?: number;
  batch_id?: string | null;
  batch_name?: string | null;
  batch_root_id?: string | null;
  batch_created_at?: number | null;
  batch_estimated_total?: number | null;
}

export interface DownloadProgress {
  phase: DownloadPhase;
  progress: number;
  message: string;
}

export interface UploadProgress {
  current: number;
  total: number;
}

export interface UploadRevisionProgressEvent {
  document_id: string;
  task_id: string;
  current_bytes: number;
  total_bytes: number;
  progress: number;
}

export type UploadConflictStrategy = "fail" | "skip" | "overwrite" | "keep_both";

export interface DirectoryUploadConflict {
  relativePath: string;
  name: string;
}

export interface DirectoryFileConflictResolution {
  relativePath: string;
  conflictStrategy: UploadConflictStrategy;
}

export interface UploadProgressEvent {
  upload_id: string;
  task_id: string | null;
  file_name: string;
  current_bytes: number;
  total_bytes: number;
  progress: number;
  status: UploadTaskStatus;
  message: string | null;
}

export interface UploadTaskDto {
  upload_id: string;
  task_id: string | null;
  file_name: string;
  source_path: string;
  kind: "file" | "directory";
  target_parent_id: string | null;
  status: UploadTaskStatus;
  progress: number;
  current_bytes: number;
  total_bytes: number;
  message: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  retry_count: number;
  max_retries: number;
  source_available: boolean;
  batch_id?: string | null;
  batch_name?: string | null;
  batch_created_at?: number | null;
  batch_index?: number;
  queue_order?: number;
  revision?: number;
}

export interface UploadEnqueueRequest {
  uploadId: string;
  fileName: string;
  sourcePath: string;
  kind: "file" | "directory";
  targetParentId: string | null;
  conflictStrategy: UploadConflictStrategy;
  conflictResolutions: DirectoryFileConflictResolution[];
  uploadName: string | null;
  batchId?: string | null;
  batchName?: string | null;
  batchCreatedAt?: number | null;
  batchIndex?: number;
}

export interface UploadBatchResult {
  tasks: UploadTaskDto[];
  failed: BatchActionResult['failed'];
}

export interface BatchActionResult {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
}

export type TransferDirection = "download" | "upload";

export type TransferControlAction = "pause" | "resume" | "cancel" | "retry" | "cancel_and_remove";

export interface SelectedUploadDirectory {
  uri: string;
  name: string;
}
