// Device-local data reset
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_local_data_reset_status(
    reset: tauri::State<'_, crate::local_data_reset::LocalDataResetRuntime>,
) -> crate::local_data_reset::LocalDataResetStatus {
    reset.status()
}

#[tauri::command]
pub async fn reset_local_data<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    reset: tauri::State<'_, crate::local_data_reset::LocalDataResetRuntime>,
    delete_downloads: bool,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;

    if reset
        .in_progress
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("A local data reset is already in progress.".into());
    }

    if let Err(error) = crate::local_data_reset::schedule_reset(
        reset.marker_path(),
        delete_downloads,
    ) {
        reset.in_progress.store(false, Ordering::SeqCst);
        return Err(error);
    }

    let clear_result = app
        .get_webview_window("main")
        .ok_or_else(|| "The main application WebView is unavailable.".to_string())
        .and_then(|webview| {
            webview
                .clear_all_browsing_data()
                .map_err(|e| format!("Failed to clear WebView browsing data: {e}"))
        });
    if let Err(error) = clear_result {
        crate::local_data_reset::cancel_scheduled_reset(reset.marker_path());
        reset.in_progress.store(false, Ordering::SeqCst);
        return Err(error);
    }

    state.connect_attempts.cancel();
    state.active_uploads.interrupt_all(UploadInterruption::Cancelled);
    state.active_downloads.cancel_all();

    if let Some(manager) = state.service_manager.lock().await.take() {
        let _ = manager.shutdown(std::time::Duration::from_secs(8)).await;
    }

    clear_auth_state(&state).await;
    close_primary_connection(&state).await;
    clear_connection_state(&state).await;
    if let Ok(mut pending) = state.pending_update.lock() {
        *pending = None;
    }
    #[cfg(target_os = "android")]
    if let Ok(mut pending) = state.pending_mobile_update.lock() {
        *pending = None;
    }

    app.request_restart();
    Ok(())
}

#[tauri::command]
pub fn retry_local_data_reset<R: Runtime>(
    app: tauri::AppHandle<R>,
    reset: tauri::State<'_, crate::local_data_reset::LocalDataResetRuntime>,
) -> Result<crate::local_data_reset::LocalDataResetStatus, String> {
    use std::sync::atomic::Ordering;

    if reset
        .in_progress
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("A local data reset is already in progress.".into());
    }

    let result: Result<crate::local_data_reset::LocalDataResetStatus, String> = (|| {
        crate::local_data_reset::ensure_retryable_marker(reset.marker_path())?;
        if let Some(webview) = app.get_webview_window("main") {
            webview
                .clear_all_browsing_data()
                .map_err(|e| format!("Failed to clear WebView browsing data: {e}"))?;
        }
        let status = crate::local_data_reset::complete_pending_reset(&app, reset.marker_path());
        reset.set_status(status.clone());
        Ok(status)
    })();

    reset.in_progress.store(false, Ordering::SeqCst);
    let status = result?;
    if !status.pending {
        app.request_restart();
    }
    Ok(status)
}
