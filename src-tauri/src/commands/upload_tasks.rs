// Persistent upload task metadata commands.

/// Persist an entire selection before the scheduler can claim its members.
#[tauri::command]
pub async fn enqueue_upload_batch<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    requests: Vec<UploadEnqueueRequest>,
) -> Result<UploadBatchResult, String> {
    let mut accepted = Vec::new();
    let mut failed = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for request in requests {
        let id = request.upload_id.clone();
        if id.is_empty() || !seen.insert(id.clone()) || state.upload_tasks.get(&id).is_some() {
            failed.push(BatchActionFailure {
                id,
                error: "Upload ID is empty or already exists".into(),
            });
            continue;
        }
        let now = unix_now();
        let available = upload_source_available(&request.source_path);
        #[cfg(not(target_os = "android"))]
        if !available {
            failed.push(BatchActionFailure {
                id,
                error: "Upload source is unavailable".into(),
            });
            continue;
        }
        let task = cfms_core::UploadTaskDto {
            upload_id: id,
            task_id: None,
            file_name: request.file_name.clone(),
            source_path: request.source_path.clone(),
            kind: request.kind,
            target_parent_id: request.target_parent_id.clone(),
            status: cfms_core::UploadTaskStatus::Pending,
            progress: 0.0,
            current_bytes: 0,
            total_bytes: std::fs::metadata(&request.source_path)
                .ok()
                .filter(|m| m.is_file())
                .map(|m| m.len())
                .unwrap_or(0),
            message: Some("Waiting to upload".into()),
            error: None,
            created_at: now,
            updated_at: now,
            completed_at: None,
            retry_count: 0,
            max_retries: cfms_service::services::retry::MAX_BACKGROUND_RETRIES as u32,
            source_available: available,
            batch_id: request.batch_id.clone(),
            batch_name: request.batch_name.clone(),
            batch_created_at: request.batch_created_at,
            batch_index: request.batch_index,
            queue_order: 0,
            revision: 0,
        };
        let request_json = serde_json::to_value(&request).map_err(|e| e.to_string())?;
        accepted.push((task, request_json));
    }
    let ids: Vec<_> = accepted.iter().map(|(t, _)| t.upload_id.clone()).collect();
    state
        .upload_tasks
        .insert_many(accepted)
        .map_err(|e| e.to_string())?;
    let tasks = ids
        .iter()
        .filter_map(|id| state.upload_tasks.get(id))
        .collect();
    for id in &ids {
        emit_upload_snapshot(&app, id);
    }
    state.active_uploads.changed.notify_one();
    Ok(UploadBatchResult { tasks, failed })
}

#[tauri::command]
pub async fn enqueue_upload<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    request: UploadEnqueueRequest,
) -> Result<cfms_core::UploadTaskDto, String> {
    let result = enqueue_upload_batch(app, state, vec![request]).await?;
    result.tasks.into_iter().next().ok_or_else(|| {
        result
            .failed
            .into_iter()
            .next()
            .map(|f| f.error)
            .unwrap_or_else(|| "Upload was not accepted".into())
    })
}

#[tauri::command]
pub async fn get_upload_tasks(
    state: tauri::State<'_, AppHandleState>,
) -> Result<Vec<cfms_core::UploadTaskDto>, String> {
    Ok(state.upload_tasks.list())
}

#[tauri::command]
pub async fn retry_upload<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    upload_id: String,
    replacement_source: Option<String>,
) -> Result<UploadEnqueueRequest, String> {
    let request = state
        .upload_tasks
        .retry_request(&upload_id)
        .ok_or_else(|| "Upload task not found".to_string())?;
    let mut request: UploadEnqueueRequest = serde_json::from_value(request)
        .map_err(|error| format!("Stored upload request is invalid: {error}"))?;
    if let Some(source_path) = replacement_source {
        #[cfg(not(target_os = "android"))]
        if !upload_source_available(&source_path) {
            return Err("Upload source is unavailable".into());
        }
        request.source_path = source_path;
        let request_json = serde_json::to_value(&request)
            .map_err(|error| format!("Failed to serialize upload request: {error}"))?;
        state
            .upload_tasks
            .replace_retry_source(&upload_id, &request.source_path, request_json)
            .map_err(|error| format!("Failed to update upload source: {error}"))?;
    }
    if state.active_uploads.subscribe(&upload_id).is_some() {
        return Err("Previous upload execution has not stopped yet".into());
    }
    #[cfg(not(target_os = "android"))]
    if !upload_source_available(&request.source_path) {
        return Err("Upload source is unavailable".into());
    }
    let changed = state
        .upload_tasks
        .mark_pending(&upload_id)
        .map_err(|error| format!("Failed to update upload task: {error}"))?;
    if !changed {
        return Err("Upload source is unavailable or the task cannot be restarted".into());
    }
    emit_upload_snapshot(&app, &upload_id);
    state.active_uploads.changed.notify_one();
    Ok(request)
}

#[tauri::command]
pub async fn remove_upload_records<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    ids: Vec<String>,
) -> Result<BatchActionResult, String> {
    remove_transfer_records(app, state, TransferDirection::Upload, ids, None).await
}

#[tauri::command]
pub async fn remove_transfer_records<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    direction: TransferDirection,
    ids: Vec<String>,
    statuses: Option<Vec<String>>,
) -> Result<BatchActionResult, String> {
    let resolved_ids = if ids.is_empty() {
        let statuses = statuses.unwrap_or_default();
        match direction {
            TransferDirection::Download => state
                .tasks
                .list(None)
                .into_iter()
                .filter(|task| {
                    statuses
                        .iter()
                        .any(|status| status_matches(task.status, status))
                })
                .map(|task| task.task_id)
                .collect(),
            TransferDirection::Upload => state
                .upload_tasks
                .list()
                .into_iter()
                .filter(|task| {
                    statuses
                        .iter()
                        .any(|status| status_matches(task.status, status))
                })
                .map(|task| task.upload_id)
                .collect(),
        }
    } else {
        ids
    };
    let (idle, busy): (Vec<_>, Vec<_>) = resolved_ids.into_iter().partition(|id| match direction {
        TransferDirection::Upload => state.active_uploads.subscribe(id).is_none(),
        TransferDirection::Download => !state.active_downloads.contains(id),
    });
    let (succeeded, mut failed) = match direction {
        TransferDirection::Download => state.tasks.remove_terminal(&idle),
        TransferDirection::Upload => state.upload_tasks.remove_terminal(&idle),
    };
    failed.extend(busy.into_iter().map(|id| {
        (
            id,
            "Transfer is still stopping. Its record was kept; try again.".into(),
        )
    }));
    let _ = app.emit(
        "cfms:transfer-records-removed",
        serde_json::json!({"direction": direction, "ids": succeeded}),
    );
    Ok(BatchActionResult {
        succeeded,
        failed: failed
            .into_iter()
            .map(|(id, error)| BatchActionFailure { id, error })
            .collect(),
    })
}

fn status_matches(status: impl serde::Serialize, expected: &str) -> bool {
    serde_json::to_value(status)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .as_deref()
        == Some(expected)
}

/// Freeze all selected states before waiting, so cancelling a batch cannot
/// accidentally dispatch its next queued member between per-item requests.
#[tauri::command]
pub async fn control_transfer_tasks<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    direction: TransferDirection,
    ids: Vec<String>,
    action: TransferControlAction,
    batch_ids: Option<Vec<String>>,
) -> Result<BatchActionResult, String> {
    let mut succeeded = Vec::new();
    let mut failed = Vec::new();
    let generation = state.upload_tasks.generation();
    let cancelling = matches!(
        action,
        TransferControlAction::Cancel | TransferControlAction::CancelAndRemove
    );
    let mut ids: std::collections::HashSet<_> = ids.into_iter().collect();
    if cancelling && matches!(direction, TransferDirection::Download) {
        ids.extend(state.tasks.stop_batches(&batch_ids.unwrap_or_default()));
    }
    let ids: Vec<_> = ids.into_iter().collect();
    let frozen = if cancelling {
        let include_finished = matches!(action, TransferControlAction::CancelAndRemove);
        let accepted = match direction {
            TransferDirection::Upload => state.upload_tasks.cancel_many(&ids, include_finished),
            TransferDirection::Download => state.tasks.cancel_many(&ids, include_finished),
        };
        for id in &accepted {
            match direction {
                TransferDirection::Upload => {
                    state
                        .active_uploads
                        .interrupt(id, UploadInterruption::Cancelled);
                }
                TransferDirection::Download => state.active_downloads.request_cancel(id),
            }
        }
        accepted
            .into_iter()
            .collect::<std::collections::HashSet<_>>()
    } else {
        std::collections::HashSet::new()
    };
    for id in ids {
        let result = if cancelling {
            Ok(frozen.contains(&id))
        } else {
            match direction {
                TransferDirection::Download => {
                    if matches!(action, TransferControlAction::Retry) {
                        retry_download_task(&state, id.clone()).await
                    } else {
                        match action {
                            TransferControlAction::Pause => download_queue::pause_task(
                                &state.tasks,
                                &state.active_downloads,
                                &id,
                            ),
                            TransferControlAction::Resume => {
                                download_queue::resume_task(&state.tasks, &id)
                            }
                            TransferControlAction::Retry => unreachable!(),
                            TransferControlAction::Cancel
                            | TransferControlAction::CancelAndRemove => {
                                if state.tasks.get(&id).is_some_and(|t| t.status.is_terminal()) {
                                    Ok(true)
                                } else {
                                    download_queue::cancel_task(
                                        &state.tasks,
                                        &state.active_downloads,
                                        &id,
                                    )
                                }
                            }
                        }
                        .map_err(|error| error.to_string())
                    }
                }
                TransferDirection::Upload => control_upload_task(&state, &id, action),
            }
        };
        match result {
            Ok(true) => succeeded.push(id),
            Ok(false) => failed.push(BatchActionFailure {
                id,
                error: "Action is not available for this task".into(),
            }),
            Err(error) => failed.push(BatchActionFailure { id, error }),
        }
    }
    if matches!(action, TransferControlAction::CancelAndRemove) {
        let (stopped, waiting) = crate::upload_runtime::wait_for_stopped(
            succeeded,
            std::time::Duration::from_secs(10),
            |id| match direction {
                TransferDirection::Download => state.active_downloads.contains(id),
                TransferDirection::Upload => state.active_uploads.subscribe(id).is_some(),
            },
        )
        .await;
        succeeded = stopped;
        if state.upload_tasks.generation() != generation {
            return Err("The transfer session changed while stopping tasks. Refresh the task list.".into());
        }
        for id in waiting {
            failed.push(BatchActionFailure { id, error: "Cancellation was not confirmed within 10 seconds. The record was kept; try again.".into() });
        }
        let (removed, removal_errors) = match direction {
            TransferDirection::Download => state.tasks.remove_terminal(&succeeded),
            TransferDirection::Upload => state.upload_tasks.remove_terminal(&succeeded),
        };
        succeeded = removed;
        failed.extend(
            removal_errors
                .into_iter()
                .map(|(id, error)| BatchActionFailure { id, error }),
        );
        let _ = app.emit(
            "cfms:transfer-records-removed",
            serde_json::json!({"direction": direction, "ids": succeeded}),
        );
    }
    if matches!(direction, TransferDirection::Upload) {
        for id in &succeeded {
            emit_upload_snapshot(&app, id);
        }
        state.active_uploads.changed.notify_one();
    }
    if matches!(direction, TransferDirection::Download) {
        for id in &succeeded {
            if let Some(task) = state.tasks.get(id) {
                let _ = state
                    .inner
                    .event_tx
                    .send(ServiceEvent::DownloadTaskUpdated { task });
            }
        }
        let _ = state.inner.event_tx.send(ServiceEvent::ActiveCountChanged {
            count: state.tasks.active_count(),
        });
    }
    Ok(BatchActionResult { succeeded, failed })
}

fn control_upload_task(
    state: &AppHandleState,
    id: &str,
    action: TransferControlAction,
) -> Result<bool, String> {
    use cfms_core::UploadTaskStatus as Status;
    let Some(task) = state.upload_tasks.get(id) else {
        return Ok(false);
    };
    let result = match action {
        TransferControlAction::Pause => {
            if !matches!(task.status, Status::Pending | Status::Uploading) {
                return Ok(false);
            }
            state
                .active_uploads
                .interrupt(id, UploadInterruption::Paused);
            state
                .upload_tasks
                .set_status(id, Status::Paused, "Upload paused")
        }
        TransferControlAction::Resume => {
            state
                .upload_tasks
                .set_status(id, Status::Pending, "Waiting to upload")
        }
        TransferControlAction::Retry => {
            if state.active_uploads.subscribe(id).is_some()
                || !upload_source_available(&task.source_path)
            {
                return Ok(false);
            }
            state.upload_tasks.mark_pending(id)
        }
        TransferControlAction::Cancel | TransferControlAction::CancelAndRemove => {
            if task.status.is_terminal() {
                return Ok(matches!(action, TransferControlAction::CancelAndRemove));
            }
            state
                .active_uploads
                .interrupt(id, UploadInterruption::Cancelled);
            state
                .upload_tasks
                .set_status(id, Status::Cancelled, "Upload cancelled")
        }
    };
    result.map_err(|error| error.to_string())
}

fn emit_upload_snapshot<R: Runtime>(app: &tauri::AppHandle<R>, id: &str) {
    if let Some(task) = app.state::<AppHandleState>().upload_tasks.get(id) {
        let _ = app.emit("cfms:upload-task", &task);
    }
}

pub async fn run_upload_queue<R: Runtime>(app: tauri::AppHandle<R>) {
    loop {
        let state = app.state::<AppHandleState>();
        let registry = state.active_uploads.clone();
        let max = state
            .inner
            .upload_max_concurrent
            .load(std::sync::atomic::Ordering::Relaxed);
        for admission in crate::upload_runtime::admit_uploads(&state.upload_tasks, &registry, max) {
            emit_upload_snapshot(&app, &admission.id);
            if let Some(control) = admission.control {
                let worker_app = app.clone();
                tauri::async_runtime::spawn(async move {
                    execute_queued_upload(worker_app, admission.id, admission.generation, control)
                        .await;
                });
            }
        }
        tokio::select! {
            _ = registry.changed.notified() => {},
            _ = tokio::time::sleep(std::time::Duration::from_millis(250)) => {},
        }
    }
}

async fn execute_queued_upload<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    generation: u64,
    mut control: tokio::sync::watch::Receiver<Option<UploadInterruption>>,
) {
    let state = app.state::<AppHandleState>();
    let _guard = crate::upload_runtime::UploadWorkerGuard(state.active_uploads.clone(), id.clone());
    let run = async {
        let request = state
            .upload_tasks
            .retry_request(&id)
            .ok_or("Upload task not found")?;
        let request: UploadEnqueueRequest =
            serde_json::from_value(request).map_err(|e| e.to_string())?;
        match request.kind {
            cfms_core::UploadTaskKind::File => {
                upload_document_file(
                    app.clone(),
                    app.state(),
                    request.target_parent_id,
                    request.source_path,
                    id.clone(),
                    Some(request.conflict_strategy),
                    request.upload_name,
                )
                .await
            }
            cfms_core::UploadTaskKind::Directory => {
                upload_directory(
                    app.clone(),
                    app.state(),
                    request.target_parent_id,
                    request.source_path,
                    id.clone(),
                    Some(request.conflict_strategy),
                    Some(request.conflict_resolutions),
                    request.upload_name,
                )
                .await
            }
        }
    };
    let cancelled = async {
        loop {
            if *control.borrow() == Some(UploadInterruption::Cancelled)
                || state.upload_tasks.generation() != generation
            {
                break;
            }
            tokio::select! {
                _ = control.changed() => {},
                _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {},
            }
        }
    };
    let result = tokio::select! {
        biased;
        _ = cancelled => Err("Upload cancelled".into()),
        result = run => result,
    };
    if state.upload_tasks.generation() == generation {
        if let Err(error) = result {
            let cancelled = state
                .upload_tasks
                .get(&id)
                .is_some_and(|t| t.status == cfms_core::UploadTaskStatus::Cancelled);
            if !cancelled {
                let _ =
                    state
                        .upload_tasks
                        .set_status(&id, cfms_core::UploadTaskStatus::Failed, &error);
            }
        }
        emit_upload_snapshot(&app, &id);
    }
}

#[cfg(target_os = "android")]
fn upload_source_available(_path: &str) -> bool {
    false
}

#[cfg(not(target_os = "android"))]
fn upload_source_available(path: &str) -> bool {
    std::path::Path::new(path).exists()
}
