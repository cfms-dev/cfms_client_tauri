use super::server_actions::server_action_bool;
use super::session::get_connection_auth;
use super::shared_helpers::format_transport_error;
use super::shared_helpers::send_action_request;
use super::transfer_helpers::create_transfer_connection;
use crate::AppHandleState;
use tauri::Manager;

pub(super) fn update_username_index(
    app_data: &std::path::Path,
    server: &str,
    old: &str,
    new: &str,
    avatar: Option<&str>,
) {
    if old == new {
        return;
    }
    let index = app_data
        .join("avatars")
        .join(cfms_core::get_server_hash(server));
    let old_path = index.join(cfms_core::get_username_hash(old));
    if old_path.is_file() {
        let _ = std::fs::remove_file(old_path);
    }
    if let Some(avatar) = avatar {
        if std::fs::create_dir_all(&index).is_ok() {
            let _ = std::fs::copy(avatar, index.join(cfms_core::get_username_hash(new)));
        }
    }
}

// Avatar commands (mirrors reference/src/include/util/avatar.py)
// ---------------------------------------------------------------------------

/// Get the avatar task data for a specific user from the server.
///
/// Sends `get_user_avatar` over the active WSS connection.  Returns the
/// `task_data` dict on success (code 200), `null` if the user has no avatar
/// (code 404), or `null` on any other error.
///
/// Mirrors [`get_user_avatar`] in the Python reference.
#[tauri::command]
pub async fn get_user_avatar(
    state: tauri::State<'_, AppHandleState>,
    user_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let (conn, auth_username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "core.user.avatar.get",
        serde_json::json!({"user_id": user_id}),
        &auth_username,
        &token,
    )
    .await?;

    match resp.code {
        200 => Ok(resp.data.get("task_data").cloned()),
        404 => Ok(None),
        _ => Ok(None),
    }
}

/// Download an avatar file from the server and cache it locally.
///
/// Uses the file transfer protocol (`cfms_transfer::download::receive`) to
/// fetch the avatar and caches it at:
///
/// ```text
/// {app_data}/avatars/accounts/{server_hash}/{user_id_hash}
/// ```
///
/// If the file already exists in the cache and `force_download` is `false`,
/// the cached path is returned immediately.
///
/// Mirrors [`download_avatar_file`] in the Python reference.
#[tauri::command]
pub async fn download_avatar(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    task_data: serde_json::Value,
    user_id: String,
    username: String,
    force_download: Option<bool>,
) -> Result<Option<String>, String> {
    let force = force_download.unwrap_or(false);

    // Extract task_id from task_data.
    let task_id = task_data["task_id"]
        .as_str()
        .ok_or_else(|| "task_data missing task_id".to_string())?;

    // Account UUID owns the cached image; username indexes are only login previews.
    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;
    let auth_generation = state
        .inner
        .auth_generation
        .load(std::sync::atomic::Ordering::SeqCst);

    let server_hash = cfms_core::get_server_hash(&server_addr);
    let username_hash = cfms_core::get_username_hash(&username);

    let app_data = app_handle
        .path()
        .resolve("", tauri::path::BaseDirectory::AppData)
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;

    let cache_dir = app_data.join("avatars").join("accounts").join(&server_hash);
    let cache_path = cache_dir.join(cfms_core::get_username_hash(&user_id));

    // Return cached path early if it exists (and not forcing re-download).
    if !force && cache_path.exists() {
        return Ok(Some(cache_path.to_string_lossy().into_owned()));
    }

    // Ensure cache directory exists.
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create avatar cache dir: {e}"))?;

    // Remove stale cache file on force download.
    if force && cache_path.exists() {
        let _ = std::fs::remove_file(&cache_path);
    }

    let conn = create_transfer_connection(&state.inner)
        .await
        .map_err(|error| format_transport_error(&error))?;

    // Download using the transfer protocol.
    // Progress is silently consumed (avatars are small; the reference does the same).
    let progress = |_phase: cfms_core::DownloadPhase,
                    _progress: f64,
                    _message: &str,
                    _current: u64,
                    _total: u64| {};
    let max_chunk_size = state
        .inner
        .download_max_chunk_size
        .load(std::sync::atomic::Ordering::Relaxed) as u32;
    let result =
        cfms_transfer::download::receive(&conn, task_id, &cache_path, max_chunk_size, &progress)
            .await
            .map_err(|e| format!("Avatar download failed: {e}"));
    conn.close().await;
    result?;

    if cache_path.exists() {
        let index_dir = app_data.join("avatars").join(&server_hash);
        std::fs::create_dir_all(&index_dir).map_err(|e| e.to_string())?;
        std::fs::copy(&cache_path, index_dir.join(&username_hash)).map_err(|e| e.to_string())?;
        let path_str = cache_path.to_string_lossy().into_owned();
        update_current_avatar(
            &state.inner,
            &user_id,
            &server_addr,
            auth_generation,
            &path_str,
        )
        .await;
        Ok(Some(path_str))
    } else {
        Ok(None)
    }
}

/// A preview may download another user's avatar; only the original login may
/// publish its own avatar back into the authentication snapshot.
async fn update_current_avatar(
    state: &cfms_service::state::AppState,
    user_id: &str,
    server_address: &str,
    auth_generation: u64,
    path: &str,
) {
    let _update = state.auth_update.lock().await;
    if state
        .auth_generation
        .load(std::sync::atomic::Ordering::SeqCst)
        != auth_generation
        || state.user_id.read().await.as_deref() != Some(user_id)
        || state.server_address.read().await.as_deref() != Some(server_address)
    {
        return;
    }
    *state.avatar_path.write().await = Some(path.to_string());
}

#[cfg(test)]
mod avatar_preview_tests {
    use super::*;

    #[test]
    fn renaming_updates_only_the_username_index_and_preserves_the_uuid_image() {
        let root = tempfile::tempdir().unwrap();
        let canonical = root
            .path()
            .join("avatars")
            .join("accounts")
            .join("uuid-image");
        std::fs::create_dir_all(canonical.parent().unwrap()).unwrap();
        std::fs::write(&canonical, b"avatar").unwrap();
        let index = root
            .path()
            .join("avatars")
            .join(cfms_core::get_server_hash("server"));
        std::fs::create_dir_all(&index).unwrap();
        let old = index.join(cfms_core::get_username_hash("alice"));
        std::fs::copy(&canonical, &old).unwrap();
        update_username_index(
            root.path(),
            "server",
            "alice",
            " alice ",
            canonical.to_str(),
        );
        assert!(!old.exists());
        assert_eq!(std::fs::read(&canonical).unwrap(), b"avatar");
        assert_eq!(
            std::fs::read(index.join(cfms_core::get_username_hash(" alice "))).unwrap(),
            b"avatar"
        );
    }

    #[tokio::test]
    async fn preview_downloads_never_replace_another_users_avatar_or_a_new_session() {
        let state = cfms_service::state::AppState::new();
        *state.username.write().await = Some("admin".into());
        *state.user_id.write().await = Some("admin".into());
        *state.server_address.write().await = Some("server-a".into());
        *state.avatar_path.write().await = Some("admin.png".into());
        update_current_avatar(&state, "alice", "server-a", 0, "alice.png").await;
        update_current_avatar(&state, "admin", "server-b", 0, "other-server.png").await;
        state
            .auth_generation
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        update_current_avatar(&state, "admin", "server-a", 0, "old-session.png").await;
        assert_eq!(state.avatar_path.read().await.as_deref(), Some("admin.png"));
        update_current_avatar(&state, "admin", "server-a", 1, "updated.png").await;
        assert_eq!(
            state.avatar_path.read().await.as_deref(),
            Some("updated.png")
        );
        state.clear_auth().await;
        update_current_avatar(&state, "admin", "server-a", 1, "late.png").await;
        assert!(state.avatar_path.read().await.is_none());
    }
}

/// Check whether a cached avatar exists locally for a username on the current server.
///
/// Computes the same cache path as [`download_avatar`] and returns it if the
/// file exists, or `null` otherwise.  This is called reactively as the user
/// types a username on the login page, so they see their avatar before logging
/// in — matching [`AvatarPreviewContainer.update_preview`] in the Python
/// reference.
///
/// ```text
/// Cache path: {app_data}/avatars/{server_hash}/{username_hash}
/// ```
#[tauri::command]
pub async fn check_cached_avatar(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    username: String,
) -> Result<Option<String>, String> {
    if username.is_empty() {
        return Ok(None);
    }

    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;

    let server_hash = cfms_core::get_server_hash(&server_addr);
    let username_hash = cfms_core::get_username_hash(&username);

    let app_data = app_handle
        .path()
        .resolve("", tauri::path::BaseDirectory::AppData)
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;

    let cache_path = app_data
        .join("avatars")
        .join(&server_hash)
        .join(&username_hash);

    if cache_path.exists() {
        Ok(Some(cache_path.to_string_lossy().into_owned()))
    } else {
        Ok(None)
    }
}

/// Set a user's avatar to a specific document ID on the server.
///
/// Mirrors [`set_user_avatar`] in the Python reference.
#[tauri::command]
pub async fn set_user_avatar(
    state: tauri::State<'_, AppHandleState>,
    user_id: String,
    document_id: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "core.user.avatar.set",
        serde_json::json!({"user_id": user_id, "document_id": document_id}),
    )
    .await
}

// ---------------------------------------------------------------------------
