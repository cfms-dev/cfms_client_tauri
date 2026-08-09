// Persistent upload task metadata commands.

#[tauri::command]
pub async fn enqueue_upload(
    state: tauri::State<'_, AppHandleState>,
    request: UploadEnqueueRequest,
) -> Result<cfms_core::UploadTaskDto, String> {
    let now = unix_now();
    let task = cfms_core::UploadTaskDto {
        upload_id: request.upload_id.clone(), task_id: None,
        file_name: request.file_name.clone(), source_path: request.source_path.clone(),
        kind: request.kind, target_parent_id: request.target_parent_id.clone(),
        status: cfms_core::UploadTaskStatus::Pending, progress: 0.0,
        current_bytes: 0, total_bytes: 0,
        message: Some("Waiting to upload".into()), error: None,
        created_at: now, updated_at: now, completed_at: None,
        retry_count: 0,
        max_retries: cfms_service::services::retry::MAX_BACKGROUND_RETRIES as u32,
        source_available: upload_source_available(&request.source_path),
    };
    let request_json = serde_json::to_value(&request)
        .map_err(|error| format!("Failed to serialize upload request: {error}"))?;
    state.upload_tasks.insert(task.clone(), request_json)
        .map_err(|error| format!("Failed to persist upload task: {error}"))?;
    Ok(task)
}

#[tauri::command]
pub async fn get_upload_tasks(
    state: tauri::State<'_, AppHandleState>,
) -> Result<Vec<cfms_core::UploadTaskDto>, String> {
    Ok(state.upload_tasks.list())
}

#[tauri::command]
pub async fn retry_upload(
    state: tauri::State<'_, AppHandleState>,
    upload_id: String,
    replacement_source: Option<String>,
) -> Result<UploadEnqueueRequest, String> {
    let request = state.upload_tasks.retry_request(&upload_id)
        .ok_or_else(|| "Upload task not found".to_string())?;
    let mut request: UploadEnqueueRequest = serde_json::from_value(request)
        .map_err(|error| format!("Stored upload request is invalid: {error}"))?;
    if let Some(source_path) = replacement_source {
        request.source_path = source_path;
        let request_json = serde_json::to_value(&request)
            .map_err(|error| format!("Failed to serialize upload request: {error}"))?;
        state.upload_tasks.replace_retry_source(
            &upload_id,
            &request.source_path,
            request_json,
        ).map_err(|error| format!("Failed to update upload source: {error}"))?;
    }
    let changed = state.upload_tasks.mark_pending(&upload_id)
        .map_err(|error| format!("Failed to update upload task: {error}"))?;
    if !changed {
        return Err("Upload source is unavailable or the task cannot be restarted".into());
    }
    Ok(request)
}

#[tauri::command]
pub async fn remove_upload_records(
    state: tauri::State<'_, AppHandleState>,
    ids: Vec<String>,
) -> Result<BatchActionResult, String> {
    let (succeeded, failed) = state.upload_tasks.remove_terminal(&ids);
    Ok(BatchActionResult {
        succeeded,
        failed: failed.into_iter()
            .map(|(id, error)| BatchActionFailure { id, error }).collect(),
    })
}

#[tauri::command]
pub async fn remove_transfer_records(
    state: tauri::State<'_, AppHandleState>,
    direction: TransferDirection,
    ids: Vec<String>,
    statuses: Option<Vec<String>>,
) -> Result<BatchActionResult, String> {
    let resolved_ids = if ids.is_empty() {
        let statuses = statuses.unwrap_or_default();
        match direction {
            TransferDirection::Download => state.tasks.list(None).into_iter()
                .filter(|task| statuses.iter().any(|status| status_matches(task.status, status)))
                .map(|task| task.task_id)
                .collect(),
            TransferDirection::Upload => state.upload_tasks.list().into_iter()
                .filter(|task| statuses.iter().any(|status| status_matches(task.status, status)))
                .map(|task| task.upload_id)
                .collect(),
        }
    } else {
        ids
    };
    let (succeeded, failed) = match direction {
        TransferDirection::Download => state.tasks.remove_terminal(&resolved_ids),
        TransferDirection::Upload => state.upload_tasks.remove_terminal(&resolved_ids),
    };
    Ok(BatchActionResult {
        succeeded,
        failed: failed.into_iter()
            .map(|(id, error)| BatchActionFailure { id, error }).collect(),
    })
}

fn status_matches(status: impl serde::Serialize, expected: &str) -> bool {
    serde_json::to_value(status)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .as_deref()
        == Some(expected)
}

#[tauri::command]
pub async fn control_transfer_tasks(
    state: tauri::State<'_, AppHandleState>,
    direction: TransferDirection,
    ids: Vec<String>,
    action: TransferControlAction,
) -> Result<BatchActionResult, String> {
    let mut succeeded = Vec::new();
    let mut failed = Vec::new();
    for id in ids {
        let result = match direction {
            TransferDirection::Download => match action {
                TransferControlAction::Pause => download_queue::pause_task(&state.tasks, &state.active_downloads, &id),
                TransferControlAction::Resume => download_queue::resume_task(&state.tasks, &id),
                TransferControlAction::Cancel => download_queue::cancel_task(&state.tasks, &state.active_downloads, &id),
            }.map_err(|error| error.to_string()),
            TransferDirection::Upload => {
                let active = match action {
                    TransferControlAction::Pause => state.active_uploads.interrupt(&id, UploadInterruption::Paused),
                    TransferControlAction::Resume => state.active_uploads.resume(&id),
                    TransferControlAction::Cancel => state.active_uploads.interrupt(&id, UploadInterruption::Cancelled),
                };
                let (status, message) = match action {
                    TransferControlAction::Pause => (cfms_core::UploadTaskStatus::Paused, "Upload paused"),
                    TransferControlAction::Resume => (cfms_core::UploadTaskStatus::Pending, "Waiting to upload"),
                    TransferControlAction::Cancel => (cfms_core::UploadTaskStatus::Cancelled, "Upload cancelled"),
                };
                state.upload_tasks.set_status(&id, status, message)
                    .map(|changed| active || changed)
                    .map_err(|error| error.to_string())
            }
        };
        match result {
            Ok(true) => succeeded.push(id),
            Ok(false) => failed.push(BatchActionFailure { id, error: "Action is not available for this task".into() }),
            Err(error) => failed.push(BatchActionFailure { id, error }),
        }
    }
    Ok(BatchActionResult { succeeded, failed })
}

#[cfg(target_os = "android")]
fn upload_source_available(_path: &str) -> bool { false }

#[cfg(not(target_os = "android"))]
fn upload_source_available(path: &str) -> bool { std::path::Path::new(path).exists() }
