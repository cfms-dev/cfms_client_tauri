use super::transfer_types::BatchActionFailure;
use super::transfer_types::BatchActionResult;
use crate::AppHandleState;
use cfms_core::DownloadTaskDto;
use cfms_core::DownloadTaskStatus;
use cfms_core::ServiceEvent;
use cfms_service::transfers::download_queue;

// Download queue commands
// ---------------------------------------------------------------------------

pub(super) async fn enqueue_download_task(
    state: &AppHandleState,
    identity: &cfms_service::rpc::SessionIdentity,
    task: &DownloadTaskDto,
) -> Result<(), String> {
    let guard = state.inner.auth_update.lock().await;
    identity.ensure_current_locked(&state.inner, &guard).await?;

    state
        .tasks
        .insert(task)
        .map_err(|e| format!("Failed to add download: {e}"))?;
    let _ = state
        .inner
        .event_tx
        .send(ServiceEvent::DownloadTaskUpdated { task: task.clone() });
    let _ = state.inner.event_tx.send(ServiceEvent::ActiveCountChanged {
        count: state.tasks.active_count(),
    });
    Ok(())
}

fn emit_download_task_updated(
    state: &AppHandleState,
    task_id: &str,
    extra_event: Option<ServiceEvent>,
) {
    if let Some(task) = state.tasks.get(task_id) {
        let _ = state
            .inner
            .event_tx
            .send(ServiceEvent::DownloadTaskUpdated { task });
    }
    if let Some(event) = extra_event {
        let _ = state.inner.event_tx.send(event);
    }
    let _ = state.inner.event_tx.send(ServiceEvent::ActiveCountChanged {
        count: state.tasks.active_count(),
    });
}

/// Get all download tasks, optionally filtered by status.
#[tauri::command]
pub async fn get_download_tasks(
    state: tauri::State<'_, AppHandleState>,
    status_filter: Option<DownloadTaskStatus>,
) -> Result<Vec<DownloadTaskDto>, String> {
    Ok(state.tasks.list(status_filter))
}

/// Pause an in-progress download.
#[tauri::command]
pub async fn pause_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    let paused = download_queue::pause_task(&state.tasks, &state.active_downloads, &task_id)
        .map_err(|e| format!("Failed to pause download: {e}"))?;
    if paused {
        emit_download_task_updated(
            &state,
            &task_id,
            Some(ServiceEvent::DownloadPaused {
                task_id: task_id.clone(),
            }),
        );
    }
    Ok(paused)
}

/// Resume a paused download.
#[tauri::command]
pub async fn resume_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    let resumed = download_queue::resume_task(&state.tasks, &task_id)
        .map_err(|e| format!("Failed to resume download: {e}"))?;
    if resumed {
        emit_download_task_updated(&state, &task_id, None);
    }
    Ok(resumed)
}

/// Retry a failed download.
#[tauri::command]
pub async fn retry_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    retry_download_task(&state, task_id).await
}

pub(super) async fn retry_download_task(
    state: &AppHandleState,
    task_id: String,
) -> Result<bool, String> {
    if state.tasks.get(&task_id).is_some_and(|task| {
        task.status == DownloadTaskStatus::Failed
            && task.failure_kind == Some(cfms_core::DownloadFailureKind::ServerTaskUnclaimable)
    }) {
        let replacement = download_queue::recreate_server_task(
            &state.inner,
            &state.tasks,
            &task_id,
            DownloadTaskStatus::Failed,
        )
        .await
        .map_err(|e| format!("Failed to recreate download: {e}"))?;
        let Some(replacement) = replacement else {
            return Ok(false);
        };
        let _ = state
            .inner
            .event_tx
            .send(ServiceEvent::DownloadTaskReplaced {
                old_task_id: task_id,
                task: replacement,
            });
        let _ = state.inner.event_tx.send(ServiceEvent::ActiveCountChanged {
            count: state.tasks.active_count(),
        });
        return Ok(true);
    }

    let retried = download_queue::retry_failed_task(&state.tasks, &task_id)
        .map_err(|e| format!("Failed to retry download: {e}"))?;
    if retried {
        emit_download_task_updated(state, &task_id, None);
    }
    Ok(retried)
}

/// Cancel a download task.
#[tauri::command]
pub async fn cancel_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    let cancelled = download_queue::cancel_task(&state.tasks, &state.active_downloads, &task_id)
        .map_err(|e| format!("Failed to cancel download: {e}"))?;
    if cancelled {
        emit_download_task_updated(&state, &task_id, None);
    }
    Ok(cancelled)
}

/// Delete completed output files while retaining their task records.
#[tauri::command]
pub async fn delete_downloaded_files(
    state: tauri::State<'_, AppHandleState>,
    ids: Vec<String>,
) -> Result<BatchActionResult, String> {
    let mut failed = Vec::new();
    let tasks = state.tasks.get_many(&ids);
    let mut candidates = Vec::with_capacity(ids.len());
    for (id, task) in ids.into_iter().zip(tasks) {
        let Some(task) = task else {
            failed.push(BatchActionFailure {
                id,
                error: "Task not found".into(),
            });
            continue;
        };
        if task.status != DownloadTaskStatus::Completed {
            failed.push(BatchActionFailure {
                id,
                error: "Only completed downloads have an output file".into(),
            });
            continue;
        }
        candidates.push((id, std::path::PathBuf::from(task.file_path)));
    }

    // Filesystem metadata operations are blocking. Keep them off the async
    // command executor, then persist all successful state changes in one pass.
    let delete_results = tokio::task::spawn_blocking(move || {
        candidates
            .into_iter()
            .map(|(id, path)| match std::fs::remove_file(path) {
                Ok(()) => Ok(id),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(id),
                Err(error) => Err(BatchActionFailure {
                    id,
                    error: error.to_string(),
                }),
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|error| format!("Downloaded file deletion worker failed: {error}"))?;

    let mut succeeded = Vec::new();
    for result in delete_results {
        match result {
            Ok(id) => succeeded.push(id),
            Err(error) => failed.push(error),
        }
    }
    if let Err(error) = state.tasks.mark_files_deleted(&succeeded) {
        for id in succeeded.drain(..) {
            failed.push(BatchActionFailure {
                id,
                error: error.to_string(),
            });
        }
    }
    Ok(BatchActionResult { succeeded, failed })
}
