use super::session::get_connection_auth;
use super::shared_helpers::decrypt_preference_dek;
use crate::AppHandleState;
use crate::UploadInterruption;
use tauri::Manager;
use tauri::Runtime;

struct ActiveAccountScope {
    server_hash: String,
    user_id: String,
    account: String,
}

async fn active_account_scope(state: &AppHandleState) -> Result<ActiveAccountScope, String> {
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
        .ok_or("Not connected")?;
    let server_hash = cfms_core::get_server_hash(&server);
    let account = crate::preference_keys::account(&server, &user_id);
    Ok(ActiveAccountScope {
        server_hash,
        user_id,
        account,
    })
}

async fn run_with_preference_vault<R: Runtime, T: Send + 'static>(
    app: &tauri::AppHandle<R>,
    reject_during_reset: bool,
    join_error: &'static str,
    f: impl FnOnce(&tauri::AppHandle<R>) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        let vault = app.state::<crate::preference_keys::PreferenceKeys>();
        let _guard = vault.operation.lock().unwrap();
        if reject_during_reset
            && app
                .state::<crate::local_data_reset::LocalDataResetRuntime>()
                .in_progress
                .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err("publicKey.storageUnavailable".into());
        }
        f(&app)
    })
    .await
    .map_err(|_| join_error)?
}

fn local_encrypted_paths(
    state: &AppHandleState,
    server_hash: &str,
    user_id: &str,
    username: &str,
) -> Vec<std::path::PathBuf> {
    cfms_service::account_storage::encrypted_paths(
        &state.app_data_dir,
        server_hash,
        user_id,
        username,
    )
}

fn verify_local_preference_key(
    paths: &[std::path::PathBuf],
    key: &cfms_service::sensitive::SecretKey,
) -> Result<(), String> {
    for path in paths.iter().filter(|path| path.exists()) {
        let bytes = std::fs::read(path).map_err(|_| "publicKey.migrationFailed")?;
        let plaintext = zeroize::Zeroizing::new(
            cfms_crypto::decrypt_config(&bytes, key).map_err(|_| "publicKey.migrationFailed")?,
        );
        let _verified = cfms_service::sensitive::SensitiveJson::new(
            serde_json::from_slice(&plaintext).map_err(|_| "publicKey.migrationFailed")?,
        );
    }
    Ok(())
}

/// Read or create the device DEK only after GENERAL authentication succeeded.
#[tauri::command]
pub async fn prepare_preference_unlock<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
) -> Result<String, String> {
    let _update = state.inner.auth_update.lock().await;
    let (_, username, _) = get_connection_auth(&state).await?;
    let scope = active_account_scope(&state).await?;
    let paths = local_encrypted_paths(&state, &scope.server_hash, &scope.user_id, &username);
    let account = scope.account;
    let stored =
        run_with_preference_vault(&app, true, "publicKey.storageUnavailable", move |app| {
            if let Some((key, local_only)) = crate::preference_keys::read(app, &account)? {
                verify_local_preference_key(&paths, &key)?;
                return Ok(Some((key, local_only)));
            }
            if paths.iter().any(|path| path.exists()) {
                return Ok(None);
            }
            let key = cfms_crypto::generate_dek();
            crate::preference_keys::save(app, &account, &key, true)?;
            Ok::<_, String>(Some((key, true)))
        })
        .await?;
    if let Some((key, local_only)) = stored {
        *state.inner.dek.write().await = Some(key);
        state
            .inner
            .preference_dek_local_only
            .store(local_only, std::sync::atomic::Ordering::SeqCst);
        Ok("ready".into())
    } else {
        Ok("password_required".into())
    }
}

/// One-time migration: decrypt and validate without uploading or rewrapping any server key.
#[tauri::command]
pub async fn unlock_preference_dek<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    password: String,
) -> Result<(), String> {
    let password = zeroize::Zeroizing::new(password);
    let _update = state.inner.auth_update.lock().await;
    let (_, username, _) = get_connection_auth(&state).await?;
    let scope = active_account_scope(&state).await?;
    let encrypted = state
        .inner
        .server_preference_dek
        .read()
        .await
        .clone()
        .ok_or("publicKey.missingRecoveryKey")?;
    let key = decrypt_preference_dek(&encrypted, &password)
        .await
        .map_err(|_| "publicKey.migrationFailed")?;
    let paths = local_encrypted_paths(&state, &scope.server_hash, &scope.user_id, &username);
    let account = scope.account;
    let key = run_with_preference_vault(&app, true, "publicKey.storageUnavailable", move |app| {
        verify_local_preference_key(&paths, &key)?;
        crate::preference_keys::save(app, &account, &key, false)?;
        Ok::<_, String>(key)
    })
    .await?;
    *state.inner.dek.write().await = Some(key);
    state
        .inner
        .preference_dek_local_only
        .store(false, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

pub(super) fn discard_encrypted_account_files(
    app_data: &std::path::Path,
    server_hash: &str,
    user_id: &str,
) -> cfms_core::Result<()> {
    cfms_service::user_preferences::discard(app_data, server_hash, user_id)?;
    cfms_service::transfers::task_persistence::discard(app_data, server_hash, user_id)?;
    cfms_service::transfers::upload_task_persistence::discard(app_data, server_hash, user_id)
}

/// Start fresh after authenticated users explicitly discard data they cannot unlock.
/// The replacement key stays on this device; server recovery keys are untouched.
#[tauri::command]
pub async fn discard_locked_preference_data<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
) -> Result<(), String> {
    let _update = state.inner.auth_update.lock().await;
    let (_, _, _) = get_connection_auth(&state).await?;
    let scope = active_account_scope(&state).await?;
    let app_data = state.app_data_dir.clone();
    let key = run_with_preference_vault(&app, true, "publicKey.discardFailed", move |app| {
        cfms_service::account_storage::finish_legacy_import(
            &app_data,
            &scope.server_hash,
            &scope.user_id,
        )?;
        discard_encrypted_account_files(&app_data, &scope.server_hash, &scope.user_id)
            .map_err(|_| "publicKey.discardFailed")?;
        let key = cfms_crypto::generate_dek();
        crate::preference_keys::save(app, &scope.account, &key, true)?;
        Ok::<_, String>(key)
    })
    .await?;
    state.tasks.clear();
    state
        .active_uploads
        .interrupt_all(UploadInterruption::Cancelled);
    state.upload_tasks.clear();
    *state.inner.dek.write().await = Some(key);
    state
        .inner
        .preference_dek_local_only
        .store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

pub(super) async fn cache_current_preference_key<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppHandleState,
) -> Result<(), String> {
    let Some(key) = state.inner.dek.read().await.clone() else {
        return Ok(());
    };
    let account = active_account_scope(state).await?.account;
    let local_only = state
        .inner
        .preference_dek_local_only
        .load(std::sync::atomic::Ordering::SeqCst);
    run_with_preference_vault(app, true, "publicKey.storageUnavailable", move |app| {
        crate::preference_keys::save(app, &account, &key, local_only)
    })
    .await
}

pub(super) async fn restore_cached_preference_key<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppHandleState,
) -> Result<bool, String> {
    let (_, username, _) = get_connection_auth(state).await?;
    let scope = active_account_scope(state).await?;
    let paths = local_encrypted_paths(state, &scope.server_hash, &scope.user_id, &username);
    let account = scope.account;
    let stored =
        run_with_preference_vault(app, false, "publicKey.storageUnavailable", move |app| {
            let record = crate::preference_keys::read(app, &account)?;
            if let Some((key, _)) = &record {
                verify_local_preference_key(&paths, key)?;
            }
            Ok::<_, String>(record)
        })
        .await?;
    if let Some((key, local_only)) = stored {
        *state.inner.dek.write().await = Some(key);
        state
            .inner
            .preference_dek_local_only
            .store(local_only, std::sync::atomic::Ordering::SeqCst);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod preference_migration_tests {
    use super::*;
    #[test]
    fn discard_is_scoped_to_the_current_account_and_preserves_downloaded_files() {
        let root = tempfile::tempdir().unwrap();
        let paths_for = |server: &str, user: &str| {
            vec![
                cfms_service::user_preferences::file_path(root.path(), server, user),
                cfms_service::transfers::task_persistence::file_path(root.path(), server, user),
                cfms_service::transfers::upload_task_persistence::file_path(
                    root.path(),
                    server,
                    user,
                ),
            ]
        };
        let target = paths_for("server-a", "alice");
        let preserved: Vec<_> = paths_for("server-a", "bob")
            .into_iter()
            .chain(paths_for("server-b", "alice"))
            .chain([root.path().join("downloaded.txt")])
            .collect();
        for path in target.iter().chain(&preserved) {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"unreadable data").unwrap();
        }
        discard_encrypted_account_files(root.path(), "server-a", "alice").unwrap();
        assert!(target.iter().all(|path| !path.exists()));
        for path in &preserved {
            assert_eq!(std::fs::read(path).unwrap(), b"unreadable data");
        }
        // Retrying after a partial failure or a completed cleanup is safe.
        discard_encrypted_account_files(root.path(), "server-a", "alice").unwrap();
    }

    #[test]
    fn validates_all_three_encrypted_files_without_mutating_any_of_them() {
        let root = tempfile::tempdir().unwrap();
        let key = cfms_crypto::generate_dek();
        let other = cfms_crypto::generate_dek();
        let paths: Vec<_> = ["preferences", "downloads", "uploads"]
            .map(|name| root.path().join(name))
            .into();
        for path in &paths {
            std::fs::write(path, cfms_crypto::encrypt_config(b"{}", &key).unwrap()).unwrap();
        }
        assert!(verify_local_preference_key(&paths, &key).is_ok());
        assert!(verify_local_preference_key(&paths, &other).is_err());
        let corrupt = cfms_crypto::encrypt_config(b"{}", &other).unwrap();
        std::fs::write(&paths[2], &corrupt).unwrap();
        assert!(verify_local_preference_key(&paths, &key).is_err());
        assert_eq!(std::fs::read(&paths[2]).unwrap(), corrupt);
    }
}
