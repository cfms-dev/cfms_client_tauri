// Download queue commands
// ---------------------------------------------------------------------------

/// Add a download task to the persistent queue.
#[tauri::command]
pub async fn add_download(
    state: tauri::State<'_, AppHandleState>,
    task: DownloadTaskDto,
) -> Result<(), String> {
    state
        .tasks
        .insert(&task)
        .map_err(|e| format!("Failed to add download: {e}"))?;
    let _ = state
        .inner
        .event_tx
        .send(ServiceEvent::DownloadTaskUpdated { task });
    let _ = state.inner.event_tx.send(ServiceEvent::ActiveCountChanged {
        count: state.tasks.active_count(),
    });
    Ok(())
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
        if let Some(task) = state.tasks.get(&task_id) {
            let _ = state
                .inner
                .event_tx
                .send(ServiceEvent::DownloadTaskUpdated { task });
        }
        let _ = state.inner.event_tx.send(ServiceEvent::DownloadPaused {
            task_id: task_id.clone(),
        });
        let _ = state.inner.event_tx.send(ServiceEvent::ActiveCountChanged {
            count: state.tasks.active_count(),
        });
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
        if let Some(task) = state.tasks.get(&task_id) {
            let _ = state
                .inner
                .event_tx
                .send(ServiceEvent::DownloadTaskUpdated { task });
        }
        let _ = state.inner.event_tx.send(ServiceEvent::ActiveCountChanged {
            count: state.tasks.active_count(),
        });
    }
    Ok(resumed)
}

/// Retry a failed download.
#[tauri::command]
pub async fn retry_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    let retried = download_queue::retry_failed_task(&state.tasks, &task_id)
        .map_err(|e| format!("Failed to retry download: {e}"))?;
    if retried {
        if let Some(task) = state.tasks.get(&task_id) {
            let _ = state
                .inner
                .event_tx
                .send(ServiceEvent::DownloadTaskUpdated { task });
        }
        let _ = state.inner.event_tx.send(ServiceEvent::ActiveCountChanged {
            count: state.tasks.active_count(),
        });
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
        if let Some(task) = state.tasks.get(&task_id) {
            let _ = state
                .inner
                .event_tx
                .send(ServiceEvent::DownloadTaskUpdated { task });
        }
        let _ = state.inner.event_tx.send(ServiceEvent::ActiveCountChanged {
            count: state.tasks.active_count(),
        });
    }
    Ok(cancelled)
}

/// Clear completed and cancelled tasks.
#[tauri::command]
pub async fn clear_completed_tasks(state: tauri::State<'_, AppHandleState>) -> Result<u32, String> {
    Ok(state.tasks.clear_completed() as u32)
}

/// Clear failed tasks. Returns count removed.
#[tauri::command]
pub async fn clear_failed_tasks(state: tauri::State<'_, AppHandleState>) -> Result<u32, String> {
    Ok(state.tasks.clear_failed() as u32)
}

/// Delete a download task and remove its file from disk.
///
/// Removes the task from the in-memory queue and deletes the associated file
/// if it exists on the filesystem.
#[tauri::command]
pub async fn delete_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    // Look up the task to get its file_path for filesystem cleanup.
    if let Some(task) = state.tasks.get(&task_id) {
        // Try to delete the file from disk (best-effort, don't fail if missing).
        let path = std::path::Path::new(&task.file_path);
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
        cleanup_resume_state(&task.file_path, &task_id);
    }

    // Remove from the in-memory queue.
    state.tasks.delete(&task_id);

    Ok(true)
}

// ---------------------------------------------------------------------------

fn cleanup_resume_state(file_path: &str, task_id: &str) {
    let dest = std::path::Path::new(file_path);
    let filename = format!(".cfms-download-{task_id}.chunks.db");
    let path = dest
        .parent()
        .map(|parent| parent.join(&filename))
        .unwrap_or_else(|| std::path::PathBuf::from(filename));

    for candidate in [
        path.clone(),
        std::path::PathBuf::from(format!("{}-wal", path.display())),
        std::path::PathBuf::from(format!("{}-shm", path.display())),
    ] {
        if let Err(e) = std::fs::remove_file(candidate)
            && e.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!("Failed to remove download resume state: {e}");
        }
    }
}
