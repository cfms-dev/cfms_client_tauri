//! JSON-file persistence for the download task list.
//!
//! Mirrors the Python reference implementation in
//! `reference/src/include/classes/services/download.py`:
//!
//! - Task metadata is stored in per-user encrypted JSON files:
//!   `{app_data}/download_tasks/{server_hash}_{username}.json`
//! - Files are encrypted with the DEK (AES-256-GCM) via
//!   [`cfms_crypto::config`].
//! - No plaintext fallback — this is a greenfield client without legacy
//!   compatibility requirements.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use cfms_core::constants::KEY_LEN;
use cfms_core::{DownloadTaskDto, DownloadTaskStatus, Result};
use serde::{Deserialize, Serialize};

/// Shape of the JSON written to disk.
///
/// A flat dict keyed by `task_id`, matching the Python reference's
/// `_save_tasks` / `_load_tasks` format.
type TasksJson = HashMap<String, TaskJson>;

/// A single task entry in the JSON persistence format.
///
/// All fields use primitive JSON types so the file is compact and
/// human-readable (when decrypted).  This deliberately mirrors the
/// Python reference's task-dict shape.
#[derive(Debug, Serialize, Deserialize)]
struct TaskJson {
    task_id: String,
    file_id: String,
    filename: String,
    file_path: String,
    status: String,
    progress: f64,
    current_bytes: u64,
    total_bytes: u64,
    message: Option<String>,
    error: Option<String>,
    created_at: i64,
    started_at: Option<i64>,
    completed_at: Option<i64>,
    stage: i32,
    priority: i32,
    retry_count: u32,
    max_retries: u32,
    scheduled_time: Option<i64>,
    bandwidth_limit: Option<i64>,
    pause_position: Option<u64>,
    supports_resume: bool,
    #[serde(default)]
    batch_id: Option<String>,
    #[serde(default)]
    batch_name: Option<String>,
    #[serde(default)]
    batch_root_id: Option<String>,
    #[serde(default)]
    batch_created_at: Option<i64>,
    #[serde(default)]
    batch_estimated_total: Option<u32>,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Build the persistence file path.
///
/// Returns `{app_data}/download_tasks/{server_hash}_{username}.json`,
/// matching `_get_persistence_file_path()` in the Python reference.
pub fn file_path(app_data: &Path, server_hash: &str, username: &str) -> PathBuf {
    app_data
        .join("download_tasks")
        .join(format!("{server_hash}_{username}.json"))
}

/// Return whether a persisted task file exists for a user.
pub fn exists(app_data: &Path, server_hash: &str, username: &str) -> bool {
    file_path(app_data, server_hash, username).exists()
}

/// Delete the persisted task file for a user, if one exists.
pub fn discard(app_data: &Path, server_hash: &str, username: &str) -> Result<()> {
    let path = file_path(app_data, server_hash, username);
    if !path.exists() {
        return Ok(());
    }

    std::fs::remove_file(&path).map_err(|e| {
        cfms_core::Error::Other(format!(
            "Failed to delete task file {}: {e}",
            path.display()
        ))
    })
}

/// Load the task list from the encrypted JSON persistence file.
///
/// # Returns
/// - `Ok(vec)` — tasks loaded and crash-recovered (in-flight → pending).
/// - `Ok(empty vec)` — file doesn't exist.
/// - `Ok(empty vec)` — file exists but DEK is `None` (can't decrypt).
/// - `Err(...)` — file exists, DEK is available, but decryption/parse failed.
///
/// # Crash recovery
/// Tasks that were `downloading` or `decrypting` when the app last exited are
/// reset to `pending`, exactly matching the Python reference's `_load_tasks`.
pub fn load(
    app_data: &Path,
    server_hash: &str,
    username: &str,
    dek: Option<&[u8; KEY_LEN]>,
) -> Result<Vec<DownloadTaskDto>> {
    let path = file_path(app_data, server_hash, username);

    if !path.exists() {
        return Ok(Vec::new());
    }

    let dek = match dek {
        Some(k) => k,
        None => {
            tracing::warn!(
                "Task file exists but DEK is not available; skipping load: {}",
                path.display()
            );
            return Ok(Vec::new());
        }
    };

    let raw = std::fs::read(&path).map_err(|e| {
        cfms_core::Error::Other(format!("Failed to read task file {}: {e}", path.display()))
    })?;

    if !cfms_crypto::is_encrypted(&raw) {
        return Err(cfms_core::Error::Other(format!(
            "Task file is not encrypted (unexpected): {}",
            path.display()
        )));
    }

    let plaintext = cfms_crypto::decrypt_config(&raw, dek).map_err(|e| {
        cfms_core::Error::Other(format!(
            "Failed to decrypt task file {}: {e}",
            path.display()
        ))
    })?;

    let tasks_data: TasksJson = serde_json::from_slice(&plaintext).map_err(|e| {
        cfms_core::Error::Other(format!("Invalid task data in {}: {e}", path.display()))
    })?;

    let tasks: Vec<DownloadTaskDto> = tasks_data
        .into_values()
        .map(|tj| {
            let status = status_from_str(&tj.status);

            // Crash recovery: reset in-flight tasks to pending.
            let status = if status == DownloadTaskStatus::Downloading
                || status == DownloadTaskStatus::Decrypting
            {
                DownloadTaskStatus::Pending
            } else {
                status
            };

            DownloadTaskDto {
                task_id: tj.task_id,
                file_id: tj.file_id,
                filename: tj.filename,
                file_path: tj.file_path,
                status,
                progress: tj.progress,
                current_bytes: tj.current_bytes,
                total_bytes: tj.total_bytes,
                message: tj.message,
                error: tj.error,
                created_at: tj.created_at,
                started_at: if status == DownloadTaskStatus::Pending {
                    None
                } else {
                    tj.started_at
                },
                completed_at: tj.completed_at,
                priority: tj.priority,
                retry_count: tj.retry_count,
                max_retries: tj.max_retries,
                scheduled_time: tj.scheduled_time,
                stage: tj.stage,
                bandwidth_limit: tj.bandwidth_limit,
                pause_position: tj.pause_position,
                supports_resume: tj.supports_resume,
                batch_id: tj.batch_id,
                batch_name: tj.batch_name,
                batch_root_id: tj.batch_root_id,
                batch_created_at: tj.batch_created_at,
                batch_estimated_total: tj.batch_estimated_total,
            }
        })
        .collect();

    Ok(tasks)
}

/// Save the task list to the encrypted JSON persistence file.
///
/// The file is always encrypted with the DEK.  The directory is created
/// automatically if it doesn't exist.
///
/// # Panics
/// The DEK must be available — tasks only exist after login, and the DEK is
/// always set by then.  If called with `None`, an error is returned.
pub fn save(
    app_data: &Path,
    server_hash: &str,
    username: &str,
    dek: Option<&[u8; KEY_LEN]>,
    tasks: &[DownloadTaskDto],
) -> Result<()> {
    let dek = match dek {
        Some(k) => k,
        None => {
            return Err(cfms_core::Error::Other(
                "Cannot persist tasks: DEK is not available".into(),
            ));
        }
    };

    let tasks_json: TasksJson = tasks
        .iter()
        .map(|t| {
            (
                t.task_id.clone(),
                TaskJson {
                    task_id: t.task_id.clone(),
                    file_id: t.file_id.clone(),
                    filename: t.filename.clone(),
                    file_path: t.file_path.clone(),
                    status: status_to_str(t.status).to_string(),
                    progress: t.progress,
                    current_bytes: t.current_bytes,
                    total_bytes: t.total_bytes,
                    message: t.message.clone(),
                    error: t.error.clone(),
                    created_at: t.created_at,
                    started_at: t.started_at,
                    completed_at: t.completed_at,
                    stage: t.stage,
                    priority: t.priority,
                    retry_count: t.retry_count,
                    max_retries: t.max_retries,
                    scheduled_time: t.scheduled_time,
                    bandwidth_limit: t.bandwidth_limit,
                    pause_position: t.pause_position,
                    supports_resume: t.supports_resume,
                    batch_id: t.batch_id.clone(),
                    batch_name: t.batch_name.clone(),
                    batch_root_id: t.batch_root_id.clone(),
                    batch_created_at: t.batch_created_at,
                    batch_estimated_total: t.batch_estimated_total,
                },
            )
        })
        .collect();

    let plaintext = serde_json::to_vec(&tasks_json)
        .map_err(|e| cfms_core::Error::Other(format!("Failed to serialize tasks: {e}")))?;

    let encrypted = cfms_crypto::encrypt_config(&plaintext, dek)
        .map_err(|e| cfms_core::Error::Other(format!("Failed to encrypt tasks: {e}")))?;

    let path = file_path(app_data, server_hash, username);

    // Ensure the directory exists.
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            cfms_core::Error::Other(format!("Failed to create download_tasks dir: {e}"))
        })?;
    }

    std::fs::write(&path, &encrypted).map_err(|e| {
        cfms_core::Error::Other(format!("Failed to write task file {}: {e}", path.display()))
    })?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn status_to_str(s: DownloadTaskStatus) -> &'static str {
    match s {
        DownloadTaskStatus::Pending => "pending",
        DownloadTaskStatus::Downloading => "downloading",
        DownloadTaskStatus::Paused => "paused",
        DownloadTaskStatus::Decrypting => "decrypting",
        DownloadTaskStatus::Verifying => "verifying",
        DownloadTaskStatus::Completed => "completed",
        DownloadTaskStatus::Deleted => "deleted",
        DownloadTaskStatus::Failed => "failed",
        DownloadTaskStatus::Cancelled => "cancelled",
        DownloadTaskStatus::Scheduled => "scheduled",
    }
}

fn status_from_str(s: &str) -> DownloadTaskStatus {
    match s {
        "pending" => DownloadTaskStatus::Pending,
        "downloading" => DownloadTaskStatus::Downloading,
        "paused" => DownloadTaskStatus::Paused,
        "decrypting" => DownloadTaskStatus::Decrypting,
        "verifying" => DownloadTaskStatus::Verifying,
        "completed" => DownloadTaskStatus::Completed,
        "deleted" => DownloadTaskStatus::Deleted,
        "failed" => DownloadTaskStatus::Failed,
        "cancelled" => DownloadTaskStatus::Cancelled,
        "scheduled" => DownloadTaskStatus::Scheduled,
        _ => DownloadTaskStatus::Pending,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SERVER_HASH: &str = "server";
    const USERNAME: &str = "alice";

    #[test]
    fn discard_missing_task_file_is_ok() {
        let temp = tempfile::tempdir().unwrap();

        assert!(!exists(temp.path(), SERVER_HASH, USERNAME));
        discard(temp.path(), SERVER_HASH, USERNAME).unwrap();
    }

    #[test]
    fn discard_removes_task_file() {
        let temp = tempfile::tempdir().unwrap();
        let path = file_path(temp.path(), SERVER_HASH, USERNAME);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"stale encrypted task state").unwrap();

        assert!(exists(temp.path(), SERVER_HASH, USERNAME));
        discard(temp.path(), SERVER_HASH, USERNAME).unwrap();
        assert!(!exists(temp.path(), SERVER_HASH, USERNAME));
        assert!(!path.exists());
    }
}
