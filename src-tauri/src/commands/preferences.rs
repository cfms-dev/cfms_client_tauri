// User preference commands (mirrors reference/src/include/util/userpref.py)
// ---------------------------------------------------------------------------

/// Load the user preference file from disk.
///
/// File path: `{app_data}/user_preferences/{server_hash}_{username}.json`
///
/// Handles three cases:
/// 1. File doesn't exist → returns default `UserPreference`.
/// 2. File is encrypted → decrypts with DEK; returns error if decryption fails.
/// 3. File is not encrypted → returns an error; plaintext preferences are not supported.
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
    }
    .ok_or_else(|| "Preference DEK is unavailable; user preferences cannot be loaded".to_string())?;

    let app_data_dir = state.app_data_dir.clone();
    let mut pref = tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::load(&app_data_dir, &server_hash, &username, Some(&*dek))
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
/// Writes the preference encrypted with the DEK.  Saving without a DEK is an
/// error because local preference files must never be persisted as plaintext.
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

/// Set up preference encryption during the post-login loading flow.
///
/// This performs all DEK work that depends on the login password: decrypting
/// an existing server DEK, creating and uploading a fresh DEK when there is no
/// recoverable local encrypted state, or reporting that user recovery/deletion
/// is required.
#[tauri::command]
pub async fn setup_preference_dek(
    state: tauri::State<'_, AppHandleState>,
    current_password: String,
) -> Result<serde_json::Value, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;
    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;
    let server_hash = cfms_core::get_server_hash(&server_addr);

    let has_local_encrypted_state =
        cfms_service::user_preferences::exists(&state.app_data_dir, &server_hash, &username)
            || cfms_service::services::task_persistence::exists(
                &state.app_data_dir,
                &server_hash,
                &username,
            );

    let status = setup_preference_dek_for_loading(
        &state.inner,
        &current_password,
        &username,
        &token,
        &conn,
        has_local_encrypted_state,
    )
    .await?;

    let status = match status {
        DekSetupStatus::Ready => "ready",
        DekSetupStatus::RecoveryRequired => "recovery_required",
        DekSetupStatus::ResetRequired => "reset_required",
    };

    Ok(serde_json::json!({ "status": status }))
}

/// Delete the current user's local preference file.
///
/// Used when an encrypted preference file can no longer be decrypted because
/// the server-side DEK was reset, lost, or replaced.
#[tauri::command]
pub async fn discard_user_preference(
    state: tauri::State<'_, AppHandleState>,
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
    let app_data_dir = state.app_data_dir.clone();

    tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::discard(&app_data_dir, &server_hash, &username)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Preference discard task failed: {e}"))?
}

/// Reset the current session's preference DEK after the user discards local
/// encrypted state that could not be decrypted.
#[tauri::command]
pub async fn reset_preference_dek(
    state: tauri::State<'_, AppHandleState>,
    current_password: String,
) -> Result<(), String> {
    if state.inner.dek.read().await.is_some() {
        return Ok(());
    }

    let (conn, username, token) = get_connection_auth(&state).await?;
    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;

    let server_hash = cfms_core::get_server_hash(&server_addr);
    let app_data_dir = state.app_data_dir.clone();

    ensure_preference_dek(
        &state.inner,
        &current_password,
        &username,
        &token,
        &conn,
    )
    .await?;

    tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::discard(&app_data_dir, &server_hash, &username)
            .and_then(|_| {
                cfms_service::services::task_persistence::discard(
                    &app_data_dir,
                    &server_hash,
                    &username,
                )
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Preference DEK reset cleanup task failed: {e}"))??;

    state.tasks.clear();
    Ok(())
}

fn sync_runtime_preferences(state: &AppHandleState, preferences: &UserPreference) {
    state.inner.download_max_concurrent.store(
        preferences.task_concurrency.max_downloads as usize,
        std::sync::atomic::Ordering::Relaxed,
    );
}

/// Load the effective appearance preference for the current application scope.
/// Authenticated sessions always use the encrypted per-user preference file;
/// signed-out sessions use the existing application settings store.
#[tauri::command]
pub async fn load_appearance_preference(
    state: tauri::State<'_, AppHandleState>,
) -> Result<AppearancePreference, String> {
    let user_scope = appearance_user_scope(&state).await?;
    let Some((server_hash, username, dek)) = user_scope else {
        return state
            .settings
            .get_appearance()
            .map_err(|e| format!("Failed to read global appearance setting: {e}"));
    };
    let app_data_dir = state.app_data_dir.clone();

    tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::load(
            &app_data_dir,
            &server_hash,
            &username,
            Some(&*dek),
        )
        .map(|preferences| preferences.appearance)
    })
    .await
    .map_err(|e| format!("Appearance preference load task failed: {e}"))?
    .map_err(|e| e.to_string())
}

/// Save appearance preferences to the active scope without allowing an
/// authenticated session to fall back to application-wide configuration.
#[tauri::command]
pub async fn save_appearance_preference(
    state: tauri::State<'_, AppHandleState>,
    appearance: AppearancePreference,
) -> Result<(), String> {
    let user_scope = appearance_user_scope(&state).await?;
    let Some((server_hash, username, dek)) = user_scope else {
        return state
            .settings
            .set_appearance(&appearance)
            .map_err(|e| format!("Failed to write global appearance setting: {e}"));
    };
    let app_data_dir = state.app_data_dir.clone();

    tokio::task::spawn_blocking(move || {
        let mut preferences = cfms_service::user_preferences::load(
            &app_data_dir,
            &server_hash,
            &username,
            Some(&*dek),
        )?;
        preferences.appearance = appearance;
        cfms_service::user_preferences::save(
            &app_data_dir,
            &server_hash,
            &username,
            Some(&*dek),
            &preferences,
        )
    })
    .await
    .map_err(|e| format!("Appearance preference save task failed: {e}"))?
    .map_err(|e| e.to_string())
}

async fn appearance_user_scope(
    state: &AppHandleState,
) -> Result<Option<(String, String, zeroize::Zeroizing<[u8; 32]>)>, String> {
    if state
        .inner
        .pending_2fa
        .load(std::sync::atomic::Ordering::Relaxed)
    {
        return Ok(None);
    }

    let username = state.inner.username.read().await.clone();
    let Some(username) = username else {
        return Ok(None);
    };
    let server_address = state
        .inner
        .server_address
        .read()
        .await
        .clone()
        .ok_or_else(|| "Authenticated appearance preference has no server address".to_string())?;
    let dek = state
        .inner
        .dek
        .read()
        .await
        .clone()
        .ok_or_else(|| {
            "Authenticated appearance preference requires the user preference DEK".to_string()
        })?;

    Ok(Some((
        cfms_core::get_server_hash(&server_address),
        username,
        dek,
    )))
}

// ---------------------------------------------------------------------------
