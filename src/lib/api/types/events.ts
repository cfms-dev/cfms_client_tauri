import type { RevocationStatus } from './connection';
import type { DownloadTaskDto } from './transfers';

// ---------------------------------------------------------------------------
// Service Events (tagged union — cfms_core::ServiceEvent)
// ---------------------------------------------------------------------------

export type ServiceEvent =
  | { event: "DownloadProgress"; data: { task_id: string; phase: string; progress: number; message: string; current_bytes: number; total_bytes: number } }
  | { event: "DownloadTaskUpdated"; data: { task: DownloadTaskDto } }
  | { event: "DownloadTaskReplaced"; data: { old_task_id: string; task: DownloadTaskDto } }
  | { event: "DownloadCompleted"; data: { task_id: string; file_path: string } }
  | { event: "DownloadFailed"; data: { task_id: string; error: string } }
  | { event: "DownloadPaused"; data: { task_id: string } }
  | { event: "DownloadCancelled"; data: { task_id: string } }
  | { event: "ActiveCountChanged"; data: { count: number } }
  | { event: "Lockdown"; data: { status: boolean; reason: string | null } }
  | { event: "ConnectionRestored"; data: { connection_id: number; status: RevocationStatus } }
  | { event: "ConnectionSecurityChanged"; data: { connection_id: number; status: RevocationStatus } }
  | { event: "ConnectionLost"; data: { error: string } }
  | { event: "TokenExpired" }
  | {
      event: "FavoritesValidationComplete";
      data: {
        invalid_count: number;
        invalid_files: string[];
        invalid_directories: string[];
        access_denied_files: string[];
        access_denied_directories: string[];
      };
    };
