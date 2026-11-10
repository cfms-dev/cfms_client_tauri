use tauri::Manager;

use super::session::clear_auth_state;
use super::session::clear_connection_state;
use super::session::close_primary_connection;
use crate::AppHandleState;
use crate::UploadInterruption;
use tauri::Runtime;

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
    credentials: tauri::State<'_, crate::github_credentials::GithubCredentialState>,
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
    credentials.begin_reset();

    if let Err(error) =
        crate::local_data_reset::schedule_reset(reset.marker_path(), delete_downloads)
    {
        credentials.cancel_reset();
        reset.in_progress.store(false, Ordering::SeqCst);
        return Err(error);
    }

    // A locked vault leaves the current UI usable; no WebView or app files have
    // been cleared yet. Once the credential is gone, preserve the reset marker
    // through any later failure so cleanup can finish after restart.
    let preference_cleanup = {
        let app = app.clone();
        tokio::task::spawn_blocking(move || {
            let vault = app.state::<crate::preference_keys::PreferenceKeys>();
            let _guard = vault.operation.lock().unwrap();
            crate::preference_keys::clear(&app)
        })
        .await
        .map_err(|_| crate::secure_store::UNAVAILABLE.to_string())
        .and_then(|result| result)
    };
    if let Err(error) = preference_cleanup {
        crate::local_data_reset::cancel_scheduled_reset(reset.marker_path());
        credentials.cancel_reset();
        reset.in_progress.store(false, Ordering::SeqCst);
        return Err(error);
    }
    if let Err(error) = credentials.delete_for_reset().await {
        crate::local_data_reset::cancel_scheduled_reset(reset.marker_path());
        credentials.cancel_reset();
        reset.in_progress.store(false, Ordering::SeqCst);
        return Err(error);
    }
    if let Err(error) = crate::local_data_reset::mark_credential_cleared(reset.marker_path()) {
        // The credential has already been deleted. Keep the reset flag and
        // restart into recovery with the still-present pending marker.
        tracing::warn!("Credential cleanup succeeded, but reset marker update failed: {error}");
    }

    if app
        .get_webview_window("main")
        .is_none_or(|webview| webview.clear_all_browsing_data().is_err())
    {
        tracing::warn!("WebView browsing-data clear failed; startup reset cleanup will retry");
    }

    state.connect_attempts.cancel();
    state
        .active_uploads
        .interrupt_all(UploadInterruption::Cancelled);
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
pub async fn retry_local_data_reset<R: Runtime>(
    app: tauri::AppHandle<R>,
    reset: tauri::State<'_, crate::local_data_reset::LocalDataResetRuntime>,
    credentials: tauri::State<'_, crate::github_credentials::GithubCredentialState>,
) -> Result<crate::local_data_reset::LocalDataResetStatus, String> {
    use std::sync::atomic::Ordering;

    if reset
        .in_progress
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("A local data reset is already in progress.".into());
    }
    credentials.begin_reset();

    let result: Result<crate::local_data_reset::LocalDataResetStatus, String> = async {
        crate::local_data_reset::ensure_retryable_marker(reset.marker_path())?;
        if !crate::local_data_reset::credential_cleared(reset.marker_path())? {
            {
                let vault = app.state::<crate::preference_keys::PreferenceKeys>();
                let _guard = vault.operation.lock().unwrap();
                crate::preference_keys::clear(&app)?;
            }
            credentials.delete_for_reset().await?;
            if let Err(error) =
                crate::local_data_reset::mark_credential_cleared(reset.marker_path())
            {
                tracing::warn!(
                    "Credential cleanup succeeded, but reset marker update failed: {error}"
                );
            }
        }
        if let Some(webview) = app.get_webview_window("main") {
            let _ = webview.clear_all_browsing_data();
        }
        Ok(reset.status())
    }
    .await;

    reset.in_progress.store(false, Ordering::SeqCst);
    let status = match result {
        Ok(status) => status,
        Err(error) => {
            if !reset.status().pending && !reset.marker_path().exists() {
                credentials.cancel_reset();
            }
            return Err(error);
        }
    };
    // The WebView owns files inside app-local-data for the lifetime of this
    // process. Restart into the pre-window startup cleanup instead of retrying
    // against a directory that is guaranteed to be locked on Windows.
    app.request_restart();
    Ok(status)
}
