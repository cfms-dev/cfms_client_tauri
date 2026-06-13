// User preference commands (mirrors reference/src/include/util/userpref.py)
// ---------------------------------------------------------------------------

/// Load the user preference file from disk.
///
/// File path: `{app_data}/user_preferences/{server_hash}_{username}.json`
///
/// Handles three cases:
/// 1. File doesn't exist → returns default `UserPreference`.
/// 2. File is encrypted → decrypts with DEK; returns error if decryption fails.
/// 3. File is plain JSON → parses it; migrates to encrypted if DEK is available.
///
/// Mirrors [`load_user_preference`] in the Python reference.
#[tauri::command]
pub async fn load_user_preference(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    let username = {
        let u = state.inner.username.read().await;
        u.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;

    let server_hash = cfms_core::get_server_hash(&server_addr);
    let dek = {
        let d = state.inner.dek.read().await;
        d.clone()
    };

    let app_data_dir = state.app_data_dir.clone();
    let mut pref = tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::load(&app_data_dir, &server_hash, &username, dek.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Preference load task failed: {e}"))??;

    pref.task_concurrency = pref.task_concurrency.normalized();
    sync_runtime_preferences(&state, &pref);

    serde_json::to_value(pref).map_err(|e| format!("Serialization error: {e}"))
}

/// Save the user preference file to disk.
///
/// Writes the preference encrypted with the DEK when available.  When the DEK
/// is `None`, the file is only written if it doesn't already exist in
/// encrypted form (to prevent data loss and security downgrade).
///
/// Mirrors [`save_user_preference`] in the Python reference.
#[tauri::command]
pub async fn save_user_preference(
    state: tauri::State<'_, AppHandleState>,
    preferences: serde_json::Value,
) -> Result<(), String> {
    let username = {
        let u = state.inner.username.read().await;
        u.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;

    let server_hash = cfms_core::get_server_hash(&server_addr);
    let mut preferences: UserPreference =
        serde_json::from_value(preferences).map_err(|e| format!("Invalid preference data: {e}"))?;
    preferences.task_concurrency = preferences.task_concurrency.normalized();
    sync_runtime_preferences(&state, &preferences);

    let dek = {
        let d = state.inner.dek.read().await;
        d.clone()
    };

    let app_data_dir = state.app_data_dir.clone();
    tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::save(
            &app_data_dir,
            &server_hash,
            &username,
            dek.as_deref(),
            &preferences,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Preference save task failed: {e}"))?
}

fn sync_runtime_preferences(state: &AppHandleState, preferences: &UserPreference) {
    state.inner.download_max_concurrent.store(
        preferences.task_concurrency.max_downloads as usize,
        std::sync::atomic::Ordering::Relaxed,
    );
}

// ---------------------------------------------------------------------------
