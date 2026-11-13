use super::preference_keys::cache_current_preference_key;
use super::preference_keys::restore_cached_preference_key;
use super::session::get_connection_auth;
use super::shared_helpers::DekSetupStatus;
use super::shared_helpers::ensure_preference_dek;
use super::shared_helpers::setup_preference_dek_for_loading;
use crate::AppHandleState;
use crate::UploadInterruption;
use cfms_core::AppearancePreference;
use cfms_core::UserPreference;
use tauri::Runtime;

// User preference commands (mirrors reference/src/include/util/userpref.py)
// ---------------------------------------------------------------------------

/// Load the user preference file from disk.
///
/// File path: `{app_data}/user_preferences/accounts/{server_hash}/{user_id_hash}.json`
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
    let _auth = state.inner.auth_update.lock().await;
    ensure_account_storage(&state).await?;
    let user_id = {
        let u = state.inner.user_id.read().await;
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
    .ok_or_else(|| {
        "Preference DEK is unavailable; user preferences cannot be loaded".to_string()
    })?;

    let app_data_dir = state.app_data_dir.clone();
    let mut pref = tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::load(&app_data_dir, &server_hash, &user_id, Some(&*dek))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Preference load task failed: {e}"))??;

    pref.task_concurrency = pref.task_concurrency.normalized();
    pref.transfer = pref.transfer.normalized();
    sync_runtime_preferences(&state, &pref);

    public_preferences(pref)
}

/// Domain updates capture one authenticated scope and publish only after persistence.
pub(super) async fn update_preferences(
    state: &AppHandleState,
    mutate: impl FnOnce(&mut UserPreference) -> Result<(), String> + Send + 'static,
) -> Result<UserPreference, String> {
    let generation = state
        .inner
        .auth_generation
        .load(std::sync::atomic::Ordering::SeqCst);
    let _auth = state.inner.auth_update.lock().await;
    if generation
        != state
            .inner
            .auth_generation
            .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Err("The active account changed".into());
    }
    let user_id = state
        .inner
        .user_id
        .read()
        .await
        .clone()
        .ok_or("Not logged in")?;
    let server = state
        .inner
        .server_address
        .read()
        .await
        .clone()
        .ok_or("No server address")?;
    let dek = state
        .inner
        .dek
        .read()
        .await
        .clone()
        .ok_or("Preference DEK is unavailable")?;
    ensure_account_storage(state).await?;
    let app_data = state.app_data_dir.clone();
    let preferences = tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::update(
            &app_data,
            &cfms_core::get_server_hash(&server),
            &user_id,
            &dek,
            mutate,
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    sync_runtime_preferences(state, &preferences);
    let _ = state
        .inner
        .event_tx
        .send(cfms_core::ServiceEvent::UserPreferencesChanged);
    Ok(preferences)
}

#[tauri::command]
pub async fn update_user_preferences(
    state: tauri::State<'_, AppHandleState>,
    patch: cfms_service::user_preferences::PreferencePatch,
) -> Result<serde_json::Value, String> {
    let pref = update_preferences(&state, move |pref| patch.apply(pref)).await?;
    public_preferences(pref)
}

#[tauri::command]
pub async fn mutate_file_preferences(
    state: tauri::State<'_, AppHandleState>,
    mutation: cfms_service::user_preferences::FilePreferenceMutation,
) -> Result<serde_json::Value, String> {
    let pref = update_preferences(&state, move |pref| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        mutation.apply(pref, now)
    })
    .await?;
    public_preferences(pref)
}

fn public_preferences(mut pref: UserPreference) -> Result<serde_json::Value, String> {
    pref.app_lock = serde_json::Value::Null;
    serde_json::to_value(pref).map_err(|e| e.to_string())
}

/// Set up preference encryption during the post-login loading flow.
///
/// This performs all DEK work that depends on the login password: decrypting
/// an existing server DEK, creating and uploading a fresh DEK when there is no
/// recoverable local encrypted state, or reporting that user recovery/deletion
/// is required.
#[tauri::command]
pub async fn setup_preference_dek<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    current_password: String,
) -> Result<serde_json::Value, String> {
    let current_password = zeroize::Zeroizing::new(current_password);
    let _update = state.inner.auth_update.lock().await;
    if restore_cached_preference_key(&app, &state)
        .await
        .unwrap_or(false)
    {
        return Ok(serde_json::json!({"status":"ready"}));
    }
    let (conn, username, token) = get_connection_auth(&state).await?;
    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;
    let server_hash = cfms_core::get_server_hash(&server_addr);

    let user_id = state
        .inner
        .user_id
        .read()
        .await
        .clone()
        .ok_or("Not logged in")?;
    let has_local_encrypted_state = cfms_service::account_storage::encrypted_paths(
        &state.app_data_dir,
        &server_hash,
        &user_id,
        &username,
    )
    .iter()
    .any(|path| path.exists());

    let status = setup_preference_dek_for_loading(
        &state.inner,
        current_password.as_str(),
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

    if status == "ready" {
        let _ = cache_current_preference_key(&app, &state).await;
    }
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
    let user_id = {
        let u = state.inner.user_id.read().await;
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
        cfms_service::account_storage::finish_legacy_import(&app_data_dir, &server_hash, &user_id)?;
        cfms_service::user_preferences::discard(&app_data_dir, &server_hash, &user_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Preference discard task failed: {e}"))?
}

/// Reset the current session's preference DEK after the user discards local
/// encrypted state that could not be decrypted.
#[tauri::command]
pub async fn reset_preference_dek<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    current_password: String,
) -> Result<(), String> {
    let current_password = zeroize::Zeroizing::new(current_password);
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
    let user_id = state
        .inner
        .user_id
        .read()
        .await
        .clone()
        .ok_or("Not logged in")?;

    ensure_preference_dek(
        &state.inner,
        current_password.as_str(),
        &username,
        &token,
        &conn,
    )
    .await?;

    tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::discard(&app_data_dir, &server_hash, &user_id)
            .and_then(|_| {
                cfms_service::transfers::task_persistence::discard(
                    &app_data_dir,
                    &server_hash,
                    &user_id,
                )
            })
            .and_then(|_| {
                cfms_service::transfers::upload_task_persistence::discard(
                    &app_data_dir,
                    &server_hash,
                    &user_id,
                )
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Preference DEK reset cleanup task failed: {e}"))??;

    state.tasks.clear();
    state
        .active_uploads
        .interrupt_all(UploadInterruption::Cancelled);
    state.upload_tasks.clear();
    state
        .inner
        .preference_dek_local_only
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let _ = cache_current_preference_key(&app, &state).await;
    Ok(())
}

fn sync_runtime_preferences(state: &AppHandleState, preferences: &UserPreference) {
    state.inner.upload_max_concurrent.store(
        preferences.task_concurrency.max_uploads as usize,
        std::sync::atomic::Ordering::Relaxed,
    );
    state.active_uploads.changed.notify_one();
    state.inner.download_max_concurrent.store(
        preferences.task_concurrency.max_downloads as usize,
        std::sync::atomic::Ordering::Relaxed,
    );
    state.inner.download_max_chunk_size.store(
        preferences.transfer.max_download_chunk_size as usize,
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
    if state.inner.user_id.read().await.is_some() {
        ensure_account_storage(&state).await?;
    }
    let user_scope = appearance_user_scope(&state).await?;
    let Some((server_hash, user_id, dek)) = user_scope else {
        return state
            .settings
            .get_appearance()
            .map_err(|e| format!("Failed to read global appearance setting: {e}"));
    };
    let app_data_dir = state.app_data_dir.clone();

    tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::load(&app_data_dir, &server_hash, &user_id, Some(&*dek))
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
    if state.inner.user_id.read().await.is_some() {
        ensure_account_storage(&state).await?;
    }
    let user_scope = appearance_user_scope(&state).await?;
    let Some((server_hash, user_id, dek)) = user_scope else {
        return state
            .settings
            .set_appearance(&appearance)
            .map_err(|e| format!("Failed to write global appearance setting: {e}"));
    };
    let _ = (server_hash, user_id, dek);
    update_preferences(&state, move |pref| {
        pref.appearance = appearance;
        Ok(())
    })
    .await?;
    Ok(())
}

async fn appearance_user_scope(
    state: &AppHandleState,
) -> Result<Option<(String, String, zeroize::Zeroizing<[u8; 32]>)>, String> {
    let user_id = state.inner.user_id.read().await.clone();
    let Some(user_id) = user_id else {
        return Ok(None);
    };
    let server_address = state
        .inner
        .server_address
        .read()
        .await
        .clone()
        .ok_or_else(|| "Authenticated appearance preference has no server address".to_string())?;
    let dek = state.inner.dek.read().await.clone().ok_or_else(|| {
        "Authenticated appearance preference requires the user preference DEK".to_string()
    })?;

    Ok(Some((
        cfms_core::get_server_hash(&server_address),
        user_id,
        dek,
    )))
}

// ---------------------------------------------------------------------------

/// Call while the caller owns the authentication update guard when mutating identity.
pub(super) async fn ensure_account_storage(state: &AppHandleState) -> Result<(), String> {
    let username = state
        .inner
        .username
        .read()
        .await
        .clone()
        .ok_or("Not logged in")?;
    let user_id = state
        .inner
        .user_id
        .read()
        .await
        .clone()
        .ok_or("Not logged in")?;
    let server = state
        .inner
        .server_address
        .read()
        .await
        .clone()
        .ok_or("No server address")?;
    let key = state
        .inner
        .dek
        .read()
        .await
        .clone()
        .ok_or("Preference DEK is unavailable")?;
    let root = state.app_data_dir.clone();
    tokio::task::spawn_blocking(move || {
        cfms_service::account_storage::migrate(
            &root,
            &cfms_core::get_server_hash(&server),
            &user_id,
            &username,
            &key,
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("CFMS_ACCOUNT_STORAGE_RECOVERY: {e}"))
}
