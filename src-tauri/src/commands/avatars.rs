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
    username: String,
) -> Result<Option<serde_json::Value>, String> {
    let (conn, auth_username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "get_user_avatar",
        serde_json::json!({"username": username}),
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
/// {app_data}/avatars/{server_hash}/{username_hash}
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
    username: String,
    force_download: Option<bool>,
) -> Result<Option<String>, String> {
    let force = force_download.unwrap_or(false);

    // Extract task_id from task_data.
    let task_id = task_data["task_id"]
        .as_str()
        .ok_or_else(|| "task_data missing task_id".to_string())?;

    // Build cache path: {app_data}/avatars/{server_hash}/{username_hash}
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

    let cache_dir = app_data.join("avatars").join(&server_hash);
    let cache_path = cache_dir.join(&username_hash);

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

    // Get connection for file transfer (separate connection, matching the
    // reference pattern of creating a dedicated connection for avatar download).
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    // Download using the transfer protocol.
    // Progress is silently consumed (avatars are small; the reference does the same).
    let progress = |_phase: cfms_core::DownloadPhase,
                    _progress: f64,
                    _message: &str,
                    _current: u64,
                    _total: u64| {};
    cfms_transfer::download::receive(&conn, task_id, &cache_path, &progress)
        .await
        .map_err(|e| format!("Avatar download failed: {e}"))?;

    if cache_path.exists() {
        let path_str = cache_path.to_string_lossy().into_owned();
        // Store path in app state.
        {
            let mut a = state.inner.avatar_path.write().await;
            *a = Some(path_str.clone());
        }
        Ok(Some(path_str))
    } else {
        Ok(None)
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
    let trimmed = username.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;

    let server_hash = cfms_core::get_server_hash(&server_addr);
    let username_hash = cfms_core::get_username_hash(trimmed);

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
    username: String,
    document_id: String,
) -> Result<bool, String> {
    let (conn, auth_username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "set_user_avatar",
        serde_json::json!({"username": username, "document_id": document_id}),
        &auth_username,
        &token,
    )
    .await?;

    Ok(resp.code == 200)
}

// ---------------------------------------------------------------------------
