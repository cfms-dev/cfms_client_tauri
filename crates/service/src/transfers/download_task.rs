//! Shared construction of ordinary, revision and directory-download queue entries.
use cfms_core::{DownloadTaskDto, DownloadTaskStatus};
use std::path::PathBuf;
pub fn from_response(
    raw: &serde_json::Value,
    id: String,
    path: PathBuf,
) -> Result<DownloadTaskDto, String> {
    let task = raw
        .get("task_data")
        .ok_or("Server response missing task_data")?;
    Ok(DownloadTaskDto {
        task_id: task
            .get("task_id")
            .and_then(|v| v.as_str())
            .filter(|v| !v.is_empty())
            .ok_or("Server response missing task_id")?
            .into(),
        file_id: id,
        filename: path
            .file_name()
            .ok_or("Missing filename")?
            .to_string_lossy()
            .into_owned(),
        file_path: path.to_string_lossy().into_owned(),
        status: DownloadTaskStatus::Pending,
        progress: 0.0,
        current_bytes: 0,
        total_bytes: 0,
        message: None,
        error: None,
        failure_kind: None,
        created_at: crate::authentication::unix_now() as i64,
        started_at: None,
        completed_at: None,
        priority: 0,
        retry_count: 0,
        max_retries: 3,
        scheduled_time: None,
        stage: 0,
        bandwidth_limit: None,
        pause_position: None,
        supports_resume: task
            .get("supports_resume")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        server_task_recreate_count: 0,
        batch_id: None,
        batch_name: None,
        batch_root_id: None,
        batch_created_at: None,
        batch_estimated_total: None,
    })
}
