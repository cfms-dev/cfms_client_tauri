//! Download task DAO — CRUD operations on the `download_tasks` table.

use rusqlite::{Connection, params};
use std::sync::{Arc, Mutex};

use cfms_core::{DownloadTaskDto, DownloadTaskStatus, Result};

/// A thread-safe, cloneable handle to the persistent download task store.
///
/// Wraps `Arc<Mutex<Connection>>` so it can be shared across services and
/// Tauri commands without lifetime issues.
#[derive(Clone)]
pub struct TaskStore {
    db: Arc<Mutex<Connection>>,
}

impl TaskStore {
    /// Create a new `TaskStore` from an open database connection.
    pub fn new(db: Connection) -> Self {
        Self {
            db: Arc::new(Mutex::new(db)),
        }
    }

    // ------------------------------------------------------------------
    // Write operations
    // ------------------------------------------------------------------

    /// Insert a new download task.
    pub fn insert(&self, task: &DownloadTaskDto) -> Result<()> {
        let db = self.db.lock().unwrap();
        db.execute(
            "INSERT INTO download_tasks \
             (task_id, file_id, filename, file_path, status, progress, \
              current_bytes, total_bytes, error, created_at, started_at, \
              completed_at, priority, retry_count, max_retries, scheduled_time) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                task.task_id,
                task.file_id,
                task.filename,
                task.file_path,
                status_to_str(task.status),
                task.progress,
                task.current_bytes as i64,
                task.total_bytes as i64,
                task.error,
                task.created_at,
                task.started_at,
                task.completed_at,
                task.priority,
                task.retry_count,
                task.max_retries,
                task.scheduled_time,
            ],
        )
        .map_err(|e| cfms_core::Error::Other(format!("insert task: {e}")))?;
        Ok(())
    }

    /// Update the status of a task.
    pub fn update_status(&self, task_id: &str, status: DownloadTaskStatus) -> Result<()> {
        let db = self.db.lock().unwrap();
        let s = status_to_str(status);
        db.execute(
            "UPDATE download_tasks SET status = ?1 WHERE task_id = ?2",
            params![s, task_id],
        )
        .map_err(|e| cfms_core::Error::Other(format!("update task status: {e}")))?;
        Ok(())
    }

    /// Update progress fields for an in-flight task.
    pub fn update_progress(
        &self,
        task_id: &str,
        status: DownloadTaskStatus,
        current_bytes: u64,
        total_bytes: u64,
    ) -> Result<()> {
        let db = self.db.lock().unwrap();
        let progress = if total_bytes > 0 {
            current_bytes as f64 / total_bytes as f64
        } else {
            0.0
        };
        db.execute(
            "UPDATE download_tasks \
             SET status = ?1, progress = ?2, current_bytes = ?3, total_bytes = ?4 \
             WHERE task_id = ?5",
            params![
                status_to_str(status),
                progress,
                current_bytes as i64,
                total_bytes as i64,
                task_id
            ],
        )
        .map_err(|e| cfms_core::Error::Other(format!("update task progress: {e}")))?;
        Ok(())
    }

    /// Set the task's started_at timestamp (called when download begins).
    pub fn mark_started(&self, task_id: &str) -> Result<()> {
        let db = self.db.lock().unwrap();
        let now = unix_now();
        db.execute(
            "UPDATE download_tasks SET started_at = ?1, status = 'downloading' WHERE task_id = ?2",
            params![now, task_id],
        )
        .map_err(|e| cfms_core::Error::Other(format!("mark started: {e}")))?;
        Ok(())
    }

    /// Mark a task as completed successfully.
    pub fn mark_completed(&self, task_id: &str, bytes: u64) -> Result<()> {
        let db = self.db.lock().unwrap();
        let now = unix_now();
        db.execute(
            "UPDATE download_tasks \
             SET status = 'completed', progress = 1.0, current_bytes = ?1, \
                 total_bytes = ?1, completed_at = ?2 \
             WHERE task_id = ?3",
            params![bytes as i64, now, task_id],
        )
        .map_err(|e| cfms_core::Error::Other(format!("mark completed: {e}")))?;
        Ok(())
    }

    /// Mark a task as failed with an error message.
    pub fn mark_failed(&self, task_id: &str, error: &str) -> Result<()> {
        let db = self.db.lock().unwrap();
        let now = unix_now();
        db.execute(
            "UPDATE download_tasks \
             SET status = 'failed', error = ?1, completed_at = ?2 \
             WHERE task_id = ?3",
            params![error, now, task_id],
        )
        .map_err(|e| cfms_core::Error::Other(format!("mark failed: {e}")))?;
        Ok(())
    }

    /// Increment retry count and reset to pending (or fail if exhausted).
    pub fn retry_or_fail(&self, task_id: &str, error: &str) -> Result<DownloadTaskStatus> {
        let db = self.db.lock().unwrap();
        let (retry_count, max_retries): (u32, u32) = db
            .query_row(
                "SELECT retry_count, max_retries FROM download_tasks WHERE task_id = ?1",
                params![task_id],
                |row| Ok((row.get::<_, u32>(0)?, row.get::<_, u32>(1)?)),
            )
            .map_err(|e| cfms_core::Error::Other(format!("retry_or_fail: {e}")))?;

        let new_retry = retry_count + 1;
        if new_retry > max_retries {
            let now = unix_now();
            db.execute(
                "UPDATE download_tasks SET status = 'failed', retry_count = ?1, error = ?2, completed_at = ?3 WHERE task_id = ?4",
                params![new_retry, error, now, task_id],
            )
            .map_err(|e| cfms_core::Error::Other(format!("retry_or_fail: {e}")))?;
            Ok(DownloadTaskStatus::Failed)
        } else {
            db.execute(
                "UPDATE download_tasks SET status = 'pending', retry_count = ?1, error = ?2 WHERE task_id = ?3",
                params![new_retry, error, task_id],
            )
            .map_err(|e| cfms_core::Error::Other(format!("retry_or_fail: {e}")))?;
            Ok(DownloadTaskStatus::Pending)
        }
    }

    /// Reset all in-flight tasks (downloading/decrypting/verifying) to pending.
    /// Called on app startup for crash recovery.
    pub fn reset_in_flight(&self) -> Result<usize> {
        let db = self.db.lock().unwrap();
        let count = db
            .execute(
                "UPDATE download_tasks SET status = 'pending' \
             WHERE status IN ('downloading', 'decrypting', 'verifying')",
                [],
            )
            .map_err(|e| cfms_core::Error::Other(format!("reset_in_flight: {e}")))?;
        Ok(count)
    }

    /// Delete a task by ID.
    pub fn delete(&self, task_id: &str) -> Result<()> {
        let db = self.db.lock().unwrap();
        db.execute(
            "DELETE FROM download_tasks WHERE task_id = ?1",
            params![task_id],
        )
        .map_err(|e| cfms_core::Error::Other(format!("delete task: {e}")))?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Read operations
    // ------------------------------------------------------------------

    /// Get a single task by ID.
    pub fn get(&self, task_id: &str) -> Result<Option<DownloadTaskDto>> {
        let db = self.db.lock().unwrap();
        let mut stmt = db
            .prepare("SELECT * FROM download_tasks WHERE task_id = ?1")
            .map_err(|e| cfms_core::Error::Other(format!("get task: {e}")))?;
        let mut rows = stmt
            .query_map(params![task_id], row_to_dto)
            .map_err(|e| cfms_core::Error::Other(format!("get task: {e}")))?;
        match rows.next() {
            Some(Ok(task)) => Ok(Some(task)),
            Some(Err(e)) => Err(cfms_core::Error::Other(format!("get task: {e}"))),
            None => Ok(None),
        }
    }

    /// Get all tasks, optionally filtered by status.
    pub fn list(&self, status_filter: Option<DownloadTaskStatus>) -> Result<Vec<DownloadTaskDto>> {
        let db = self.db.lock().unwrap();
        let (sql, param): (&str, Option<String>) = match status_filter {
            Some(s) => (
                "SELECT * FROM download_tasks WHERE status = ?1 ORDER BY priority DESC, created_at ASC",
                Some(status_to_str(s).to_string()),
            ),
            None => (
                "SELECT * FROM download_tasks ORDER BY priority DESC, created_at ASC",
                None,
            ),
        };

        let mut stmt = db
            .prepare(sql)
            .map_err(|e| cfms_core::Error::Other(format!("list tasks: {e}")))?;

        let rows: Vec<DownloadTaskDto> = if let Some(ref p) = param {
            stmt.query_map(params![p], row_to_dto)
                .map_err(|e| cfms_core::Error::Other(format!("list tasks: {e}")))?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            stmt.query_map([], row_to_dto)
                .map_err(|e| cfms_core::Error::Other(format!("list tasks: {e}")))?
                .filter_map(|r| r.ok())
                .collect()
        };

        Ok(rows)
    }

    /// Get tasks by status (returns owned Vec). Used by the queue processor.
    pub fn list_by_status(&self, status: DownloadTaskStatus) -> Result<Vec<DownloadTaskDto>> {
        self.list(Some(status))
    }

    /// Count tasks with a given status.
    pub fn count_by_status(&self, status: DownloadTaskStatus) -> Result<u32> {
        let db = self.db.lock().unwrap();
        let s = status_to_str(status);
        let count: u32 = db
            .query_row(
                "SELECT COUNT(*) FROM download_tasks WHERE status = ?1",
                params![s],
                |row| row.get(0),
            )
            .map_err(|e| cfms_core::Error::Other(format!("count tasks: {e}")))?;
        Ok(count)
    }

    /// Move all SCHEDULED tasks whose scheduled_time has passed to PENDING.
    /// Returns the number of tasks moved.
    pub fn promote_scheduled(&self) -> Result<usize> {
        let db = self.db.lock().unwrap();
        let now = unix_now();
        let count = db
            .execute(
                "UPDATE download_tasks SET status = 'pending' \
                 WHERE status = 'scheduled' AND scheduled_time <= ?1",
                params![now],
            )
            .map_err(|e| cfms_core::Error::Other(format!("promote_scheduled: {e}")))?;
        Ok(count)
    }

    /// Get all PENDING tasks ordered by priority descending.
    pub fn pending_tasks(&self) -> Result<Vec<DownloadTaskDto>> {
        self.list_by_status(DownloadTaskStatus::Pending)
    }

    /// Clear tasks with terminal statuses. Returns count removed.
    pub fn clear_completed(&self) -> Result<usize> {
        let db = self.db.lock().unwrap();
        let count = db
            .execute(
                "DELETE FROM download_tasks WHERE status IN ('completed', 'cancelled')",
                [],
            )
            .map_err(|e| cfms_core::Error::Other(format!("clear_completed: {e}")))?;
        Ok(count)
    }

    /// Clear failed tasks. Returns count removed.
    pub fn clear_failed(&self) -> Result<usize> {
        let db = self.db.lock().unwrap();
        let count = db
            .execute("DELETE FROM download_tasks WHERE status = 'failed'", [])
            .map_err(|e| cfms_core::Error::Other(format!("clear_failed: {e}")))?;
        Ok(count)
    }

    // ------------------------------------------------------------------
    // User settings
    // ------------------------------------------------------------------

    /// Store a user setting (upsert).
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let db = self.db.lock().unwrap();
        db.execute(
            "INSERT INTO user_settings (key, value) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| cfms_core::Error::Other(format!("set_setting: {e}")))?;
        Ok(())
    }

    /// Retrieve a user setting.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let db = self.db.lock().unwrap();
        let result: std::result::Result<String, _> = db.query_row(
            "SELECT value FROM user_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        );
        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(cfms_core::Error::Other(format!("get_setting: {e}"))),
        }
    }
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
        DownloadTaskStatus::Failed => "failed",
        DownloadTaskStatus::Cancelled => "cancelled",
        DownloadTaskStatus::Scheduled => "scheduled",
    }
}

fn str_to_status(s: &str) -> DownloadTaskStatus {
    match s {
        "pending" => DownloadTaskStatus::Pending,
        "downloading" => DownloadTaskStatus::Downloading,
        "paused" => DownloadTaskStatus::Paused,
        "decrypting" => DownloadTaskStatus::Decrypting,
        "verifying" => DownloadTaskStatus::Verifying,
        "completed" => DownloadTaskStatus::Completed,
        "failed" => DownloadTaskStatus::Failed,
        "cancelled" => DownloadTaskStatus::Cancelled,
        "scheduled" => DownloadTaskStatus::Scheduled,
        _ => DownloadTaskStatus::Pending,
    }
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn row_to_dto(row: &rusqlite::Row<'_>) -> rusqlite::Result<DownloadTaskDto> {
    let status_str: String = row.get("status")?;
    Ok(DownloadTaskDto {
        task_id: row.get("task_id")?,
        file_id: row.get("file_id")?,
        filename: row.get("filename")?,
        file_path: row.get("file_path")?,
        status: str_to_status(&status_str),
        progress: row.get::<_, f64>("progress")?,
        current_bytes: row.get::<_, i64>("current_bytes")? as u64,
        total_bytes: row.get::<_, i64>("total_bytes")? as u64,
        error: row.get("error")?,
        created_at: row.get("created_at")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        priority: row.get("priority")?,
        retry_count: row.get::<_, u32>("retry_count")?,
        max_retries: row.get::<_, u32>("max_retries")?,
        scheduled_time: row.get("scheduled_time")?,
    })
}
