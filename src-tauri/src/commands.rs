//! Tauri IPC commands — the boundary between the frontend Webview and the
//! Rust backend.
//!
//! All commands delegate to [`cfms_service`] types through the Tauri managed
//! state ([`AppHandleState`](super::AppHandleState)).
//!
//! # Security
//!
//! No file I/O or network requests happen in the Webview.  Every sensitive
//! operation goes through these commands, which run on the Rust side.

use cfms_core::constants;
use cfms_core::{
    DownloadTaskDto, DownloadTaskStatus, FileEntry, ListDirectoryResponse, ServiceStatusInfo,
};
use cfms_crypto::dek;
use cfms_service::services::download_queue;
use rand::Rng;
use tauri::Manager;

use crate::AppHandleState;

// ---------------------------------------------------------------------------
// Health / info (existing commands, preserved for backward compat)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

#[tauri::command]
pub fn ping() -> String {
    "pong".into()
}

#[tauri::command]
pub fn protocol_version() -> u32 {
    constants::PROTOCOL_VERSION
}

#[tauri::command]
pub fn crypto_info() -> serde_json::Value {
    serde_json::json!({
        "kdf_iterations": constants::KDF_ITERATIONS,
        "salt_len": constants::SALT_LEN,
        "key_len": constants::KEY_LEN,
        "nonce_len": constants::NONCE_LEN,
        "tag_len": constants::TAG_LEN,
    })
}

// ---------------------------------------------------------------------------
// Service status
// ---------------------------------------------------------------------------

/// Get the status of background services.
#[tauri::command]
pub async fn get_service_status(
    state: tauri::State<'_, AppHandleState>,
) -> Result<Vec<ServiceStatusInfo>, String> {
    // We track services by whether their handles are active.
    // For now, return a static list since all services start together.
    let lockdown = state
        .inner
        .app_lockdown
        .load(std::sync::atomic::Ordering::SeqCst);
    Ok(vec![
        ServiceStatusInfo {
            name: "token_refresh".into(),
            running: state.inner.token.read().await.is_some(),
        },
        ServiceStatusInfo {
            name: "favorites_validation".into(),
            running: true,
        },
        ServiceStatusInfo {
            name: "lockdown_monitor".into(),
            running: true,
        },
        ServiceStatusInfo {
            name: "download_queue".into(),
            running: true,
        },
        ServiceStatusInfo {
            name: "app_lockdown".into(),
            running: lockdown,
        },
    ])
}

// ---------------------------------------------------------------------------
// Download queue commands
// ---------------------------------------------------------------------------

/// Add a download task to the persistent queue.
#[tauri::command]
pub async fn add_download(
    state: tauri::State<'_, AppHandleState>,
    task: DownloadTaskDto,
) -> Result<(), String> {
    state
        .store
        .insert(&task)
        .map_err(|e| format!("Failed to add download: {e}"))
}

/// Get all download tasks, optionally filtered by status.
#[tauri::command]
pub async fn get_download_tasks(
    state: tauri::State<'_, AppHandleState>,
    status_filter: Option<DownloadTaskStatus>,
) -> Result<Vec<DownloadTaskDto>, String> {
    state
        .store
        .list(status_filter)
        .map_err(|e| format!("Failed to list downloads: {e}"))
}

/// Pause an in-progress download.
#[tauri::command]
pub async fn pause_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    download_queue::pause_task(&state.store, &task_id)
        .map_err(|e| format!("Failed to pause download: {e}"))
}

/// Resume a paused download.
#[tauri::command]
pub async fn resume_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    download_queue::resume_task(&state.store, &task_id)
        .map_err(|e| format!("Failed to resume download: {e}"))
}

/// Cancel a download task.
#[tauri::command]
pub async fn cancel_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    download_queue::cancel_task(&state.store, &state.active_downloads, &task_id)
        .map_err(|e| format!("Failed to cancel download: {e}"))
}

/// Clear completed and cancelled tasks.
#[tauri::command]
pub async fn clear_completed_tasks(state: tauri::State<'_, AppHandleState>) -> Result<u32, String> {
    state
        .store
        .clear_completed()
        .map(|n| n as u32)
        .map_err(|e| format!("Failed to clear completed tasks: {e}"))
}

/// Clear failed tasks. Returns count removed.
#[tauri::command]
pub async fn clear_failed_tasks(state: tauri::State<'_, AppHandleState>) -> Result<u32, String> {
    state
        .store
        .clear_failed()
        .map(|n| n as u32)
        .map_err(|e| format!("Failed to clear failed tasks: {e}"))
}

/// Delete a download task from the database and remove its file from disk.
///
/// Removes the task from the persistent store and deletes the associated file
/// if it exists on the filesystem. Accepts task_id as a string for simpler
/// frontend integration.
#[tauri::command]
pub async fn delete_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    // Look up the task to get its file_path for filesystem cleanup.
    if let Ok(Some(task)) = state.store.get(&task_id) {
        // Try to delete the file from disk (best-effort, don't fail if missing).
        let path = std::path::Path::new(&task.file_path);
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }

    // Remove from the persistent store.
    state
        .store
        .delete(&task_id)
        .map_err(|e| format!("Failed to delete download: {e}"))?;

    Ok(true)
}

// ---------------------------------------------------------------------------
// Server-side directory & document operations
// ---------------------------------------------------------------------------

/// Create a new directory on the CFMS server.
///
/// Mirrors [`create_directory`] from the Python reference (`create.py`).
#[tauri::command]
pub async fn create_directory(
    state: tauri::State<'_, AppHandleState>,
    parent_id: Option<String>,
    name: String,
    exists_ok: Option<bool>,
) -> Result<String, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "create_directory",
        serde_json::json!({"parent_id": parent_id, "name": name, "exists_ok": exists_ok.unwrap_or(false)}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    let id = resp.data["id"]
        .as_str()
        .ok_or_else(|| "Server response missing id".to_string())?
        .to_string();

    Ok(id)
}

/// Delete a directory on the CFMS server.
///
/// Mirrors `delete_directory` from the Python reference (`batch_operations.py`).
#[tauri::command]
pub async fn delete_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: String,
) -> Result<bool, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "delete_directory",
        serde_json::json!({"folder_id": folder_id}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    Ok(true)
}

/// Delete a document on the CFMS server.
///
/// Mirrors `delete_document` from the Python reference (`batch_operations.py`).
#[tauri::command]
pub async fn delete_document(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
) -> Result<bool, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "delete_document",
        serde_json::json!({"document_id": document_id}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    Ok(true)
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

/// Scan a local directory recursively with parallel traversal.
#[tauri::command]
pub async fn scan_directory(
    path: String,
    pattern: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    let p = std::path::Path::new(&path);
    cfms_service::scan::scan_directory(p, pattern.as_deref())
        .map_err(|e| format!("Scan failed: {e}"))
}

// ---------------------------------------------------------------------------
// Server-side file browsing (mirrors reference/src/include/ui/util/path.py)
// ---------------------------------------------------------------------------

/// List a directory on the CFMS server.
///
/// Sends the `list_directory` action over the active WSS connection.
/// Pass `folder_id = None` to list the root directory.
///
/// Returns a [`ListDirectoryResponse`] containing sub-folders, documents,
/// and the parent folder ID.
#[tauri::command]
pub async fn list_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: Option<String>,
) -> Result<ListDirectoryResponse, String> {
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    let username = {
        let u = state.inner.username.read().await;
        u.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let token = {
        let t = state.inner.token.read().await;
        t.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let resp = send_action_request(
        &conn,
        "list_directory",
        serde_json::json!({"folder_id": folder_id}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    let data: ListDirectoryResponse = serde_json::from_value(resp.data)
        .map_err(|e| format!("Invalid list_directory response: {e}"))?;

    Ok(data)
}

/// Request a document download from the CFMS server.
///
/// Sends the `get_document` action, receives a download task from the server,
/// and adds it to the persistent download queue.
///
/// Mirrors [`get_document`] from the Python reference (`path.py`).
#[tauri::command]
pub async fn get_document(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    filename: String,
) -> Result<serde_json::Value, String> {
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    let username = {
        let u = state.inner.username.read().await;
        u.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let token = {
        let t = state.inner.token.read().await;
        t.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let resp = send_action_request(
        &conn,
        "get_document",
        serde_json::json!({"document_id": document_id}),
        &username,
        &token,
    )
    .await?;

    // Handle 403 (Access Denied)
    if resp.code == 403 {
        return Err(format!("Access denied: {}", resp.message));
    }

    // Handle 404 (Not Found)
    if resp.code == 404 {
        return Err("Document not found on server".to_string());
    }

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    // Extract task data from the server response.
    let task_data = &resp.data["task_data"];
    let task_id = task_data["task_id"]
        .as_str()
        .ok_or_else(|| "Server response missing task_id".to_string())?
        .to_string();
    let _start_time = task_data["start_time"].as_f64().unwrap_or(0.0);
    let _end_time = task_data["end_time"].as_f64().unwrap_or(0.0);

    // Build a local download path.  Use the Tauri download directory when
    // available; otherwise fall back to the app data directory.
    let download_root = app_handle
        .path()
        .resolve("downloads", tauri::path::BaseDirectory::Download)
        .unwrap_or_else(|_| {
            app_handle
                .path()
                .resolve("downloads", tauri::path::BaseDirectory::AppData)
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
        });

    // Ensure the download directory exists.
    let _ = std::fs::create_dir_all(&download_root);

    let file_path = download_root.join(&filename);
    let now = unix_now();

    let task = DownloadTaskDto {
        task_id: task_id.clone(),
        file_id: document_id.clone(),
        filename: filename.clone(),
        file_path: file_path.to_string_lossy().into_owned(),
        status: DownloadTaskStatus::Pending,
        progress: 0.0,
        current_bytes: 0,
        total_bytes: 0,
        error: None,
        created_at: now,
        started_at: None,
        completed_at: None,
        priority: 0,
        retry_count: 0,
        max_retries: 3,
        scheduled_time: None,
    };

    // Persist the download task so the download queue service picks it up.
    state
        .store
        .insert(&task)
        .map_err(|e| format!("Failed to add download: {e}"))?;

    Ok(serde_json::json!({
        "task_id": task_id,
        "file_id": document_id,
        "filename": filename,
        "file_path": task.file_path,
    }))
}

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------

/// Read a user setting.
#[tauri::command]
pub async fn get_setting(
    state: tauri::State<'_, AppHandleState>,
    key: String,
) -> Result<Option<String>, String> {
    state
        .store
        .get_setting(&key)
        .map_err(|e| format!("Failed to read setting: {e}"))
}

/// Write a user setting.
#[tauri::command]
pub async fn set_setting(
    state: tauri::State<'_, AppHandleState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state
        .store
        .set_setting(&key, &value)
        .map_err(|e| format!("Failed to write setting: {e}"))
}

// ---------------------------------------------------------------------------
// Authentication & Connection
// ---------------------------------------------------------------------------

/// Log in with username and password (and optional 2FA token).
///
/// Sends a login request over the established WSS connection to the
/// CFMS server.  The server may:
///
/// - Accept the login (code 200) — auth state is stored.
/// - Request 2FA verification (code 202) — caller must re-invoke with
///   `twofa_token`.
/// - Reject the login (any other code) — an error is returned.
///
/// The Data Encryption Key (DEK) is set up after successful
/// authentication — either decrypted from the server-returned
/// `preference_dek` or generated fresh and uploaded (first login).
#[tauri::command]
pub async fn login(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    password: String,
    twofa_token: Option<String>,
) -> Result<serde_json::Value, String> {
    // --- Obtain the active connection ---
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    // --- Build login request payload ---
    let mut request = serde_json::json!({
        "action": "login",
        "data": {
            "username": &username,
            "password": &password,
        },
    });
    if let Some(ref token) = twofa_token {
        request["data"]["2fa_token"] = serde_json::Value::String(token.clone());
    }

    // --- Send login request over a client stream ---
    let mut stream = conn
        .create_stream()
        .await
        .map_err(|e| format!("Failed to create stream: {e}"))?;

    let request_bytes =
        serde_json::to_vec(&request).map_err(|e| format!("Failed to encode login request: {e}"))?;

    stream
        .send(&conn, request_bytes)
        .await
        .map_err(|e| format!("Failed to send login request: {e}"))?;

    // --- Read response ---
    let response_bytes = stream
        .recv()
        .await
        .ok_or_else(|| "Connection closed before login response".to_string())?;

    let response: cfms_core::Response = serde_json::from_slice(&response_bytes)
        .map_err(|e| format!("Invalid login response from server: {e}"))?;

    tracing::info!(
        "Login response: code={}, message={}",
        response.code,
        response.message
    );

    match response.code {
        // --- Success (no 2FA) ---
        200 => {
            let data = &response.data;

            // Extract token early — needed for the DEK setup calls below.
            let token = data["token"]
                .as_str()
                .ok_or_else(|| "Server did not return a token".to_string())?
                .to_string();

            // Store auth state from server response.
            {
                let mut u = state.inner.username.write().await;
                *u = Some(username.clone());
            }
            {
                let mut t = state.inner.token.write().await;
                *t = Some(token.clone());
            }
            {
                let exp = data["exp"].as_i64().unwrap_or(unix_now() + 3600);
                let mut e = state.inner.token_exp.write().await;
                *e = Some(exp);
            }
            {
                let nickname = data["nickname"].as_str().unwrap_or(&username).to_string();
                let mut n = state.inner.nickname.write().await;
                *n = Some(nickname);
            }
            {
                let perms: Vec<String> = data["permissions"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                let mut p = state.inner.permissions.write().await;
                *p = perms;
            }
            {
                let grps: Vec<String> = data["groups"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                let mut g = state.inner.groups.write().await;
                *g = grps;
            }
            // Clear any pending 2FA flag.
            state
                .inner
                .pending_2fa
                .store(false, std::sync::atomic::Ordering::SeqCst);

            // Set up Data Encryption Key (best-effort, non-fatal).
            // The DEK is either decrypted from the server-returned
            // preference_dek, or generated fresh and uploaded (first login
            // with keyring support).
            let _ = setup_dek(&state.inner, data, &password, &username, &token, &conn).await;

            let status = build_auth_status(&state.inner).await;
            Ok(status)
        }

        // --- 2FA required ---
        202 => {
            // Mark 2FA as pending so auth status polls don't report as
            // authenticated until 2FA is completed.
            state
                .inner
                .pending_2fa
                .store(true, std::sync::atomic::Ordering::SeqCst);

            // Store partial auth state so the frontend can re-submit with 2FA.
            // No DEK setup here — the real token isn't available yet.
            // DEK setup happens when the frontend re-invokes login with
            // twofa_token and the server returns 200.
            {
                let mut u = state.inner.username.write().await;
                *u = Some(username.clone());
            }
            {
                // Store a placeholder token to indicate partial auth.
                let mut t = state.inner.token.write().await;
                *t = Some("pending_2fa".to_string());
            }
            {
                let mut e = state.inner.token_exp.write().await;
                *e = Some(unix_now() + 300); // 5-minute 2FA window
            }
            {
                let mut n = state.inner.nickname.write().await;
                *n = Some(username.clone());
            }
            {
                let mut p = state.inner.permissions.write().await;
                p.clear();
            }
            {
                let mut g = state.inner.groups.write().await;
                g.clear();
            }

            let method = response
                .data
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("totp")
                .to_string();

            Ok(serde_json::json!({
                "username": &username,
                "nickname": &username,
                "has_token": false,
                "token_exp": null,
                "permissions": [],
                "groups": [],
                "connected": true,
                "server_address": *state.inner.server_address.read().await,
                "lockdown": state.inner.app_lockdown.load(std::sync::atomic::Ordering::SeqCst),
                "requires_2fa": true,
                "2fa_method": method,
            }))
        }

        // --- Server-side error ---
        other => Err(format!("Login failed: ({}) {}", other, response.message)),
    }
}

/// Log out and clear all authentication state.
#[tauri::command]
pub async fn logout(state: tauri::State<'_, AppHandleState>) -> Result<(), String> {
    // Clear auth fields.
    {
        let mut u = state.inner.username.write().await;
        let mut t = state.inner.token.write().await;
        let mut e = state.inner.token_exp.write().await;
        let mut n = state.inner.nickname.write().await;
        let mut p = state.inner.permissions.write().await;
        let mut g = state.inner.groups.write().await;
        let mut d = state.inner.dek.write().await;
        *u = None;
        *t = None;
        *e = None;
        *n = None;
        p.clear();
        g.clear();
        *d = None;
    }
    state
        .inner
        .pending_2fa
        .store(false, std::sync::atomic::Ordering::SeqCst);

    // Close the connection if one is open.
    {
        let mut conn = state.inner.conn.write().await;
        if let Some(c) = conn.take() {
            // Spawn so we don't block the command on close handshake.
            tokio::spawn(async move { c.close().await });
        }
    }

    Ok(())
}

/// Establish a WSS connection to the CFMS server.
///
/// Uses the TLS configuration from [`cfms_transport::tls::build_config`]
/// with the local CA certificate store.  When `disable_ssl_enforcement`
/// is `true`, certificate verification is skipped (insecure).
#[tauri::command]
pub async fn connect(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    url: String,
    disable_ssl_enforcement: bool,
) -> Result<(), String> {
    // Resolve the CA certificate directory via Tauri's resource resolver.
    // In development this points to <project>/src-tauri/ca/.
    // In production this points to the bundled resource directory.
    let ca_dir = app_handle
        .path()
        .resolve("ca", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Cannot resolve CA directory: {e}"))?;

    let tls_config = cfms_transport::tls::build_config(&ca_dir, disable_ssl_enforcement)
        .map_err(|e| format!("TLS config error: {e}"))?;

    // Establish connection.
    let conn = cfms_transport::Connection::connect(&url, tls_config, None)
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    // Store connection and server address.
    {
        let mut c = state.inner.conn.write().await;
        *c = Some(conn);
    }
    {
        let mut addr = state.inner.server_address.write().await;
        *addr = Some(url.clone());
    }

    tracing::info!("Connected to {url}");
    Ok(())
}

/// Close the WSS connection.
#[tauri::command]
pub async fn disconnect(state: tauri::State<'_, AppHandleState>) -> Result<(), String> {
    let conn = {
        let mut c = state.inner.conn.write().await;
        c.take()
    };

    if let Some(conn) = conn {
        // Spawn to avoid blocking the command.
        tokio::spawn(async move { conn.close().await });
    }

    {
        let mut addr = state.inner.server_address.write().await;
        *addr = None;
    }

    tracing::info!("Disconnected");
    Ok(())
}

/// Get the current authentication and connection status.
#[tauri::command]
pub async fn get_auth_status(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    Ok(build_auth_status(&state.inner).await)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Convenience helper: extract (connection, username, token) from app state.
async fn get_connection_auth(
    state: &AppHandleState,
) -> Result<(cfms_transport::Connection, String, String), String> {
    let conn = state
        .inner
        .conn
        .read()
        .await
        .clone()
        .ok_or_else(|| "Not connected to a server".to_string())?;
    let username = state
        .inner
        .username
        .read()
        .await
        .clone()
        .ok_or_else(|| "Not logged in".to_string())?;
    let token = state
        .inner
        .token
        .read()
        .await
        .clone()
        .ok_or_else(|| "Not logged in".to_string())?;
    Ok((conn, username, token))
}

/// Build a JSON auth-status payload for the frontend.
async fn build_auth_status(inner: &cfms_service::state::AppState) -> serde_json::Value {
    let username = inner.username.read().await.clone();
    let nickname = inner.nickname.read().await.clone();
    let pending_2fa = inner.pending_2fa.load(std::sync::atomic::Ordering::SeqCst);
    // When 2FA is pending, the token is a placeholder — don't report as
    // authenticated.
    let has_token = !pending_2fa && inner.token.read().await.is_some();
    let token_exp = if pending_2fa {
        None
    } else {
        *inner.token_exp.read().await
    };
    let permissions = inner.permissions.read().await.clone();
    let groups = inner.groups.read().await.clone();
    let connected = inner.conn.read().await.is_some();
    let server_address = inner.server_address.read().await.clone();
    let lockdown = inner.app_lockdown.load(std::sync::atomic::Ordering::SeqCst);

    serde_json::json!({
        "username": username,
        "nickname": nickname,
        "has_token": has_token,
        "token_exp": token_exp,
        "permissions": permissions,
        "groups": groups,
        "connected": connected,
        "server_address": server_address,
        "lockdown": lockdown,
    })
}

/// Current Unix timestamp in seconds.
fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
// DEK setup helpers
// ---------------------------------------------------------------------------

/// Send an action request over the connection and return the parsed response.
///
/// Creates a short-lived stream, sends the JSON payload, reads the response,
/// and closes the stream with a conclusion frame.
async fn send_action_request(
    conn: &cfms_transport::Connection,
    action: &str,
    data: serde_json::Value,
    username: &str,
    token: &str,
) -> Result<cfms_core::Response, String> {
    let random_bytes: [u8; 16] = rand::thread_rng().gen();
    let nonce = hex::encode(random_bytes);

    let request = serde_json::json!({
        "action": action,
        "data": data,
        "username": username,
        "token": token,
        "timestamp": unix_now(),
        "nonce": nonce,
    });

    let request_bytes = serde_json::to_vec(&request)
        .map_err(|e| format!("Failed to encode {action} request: {e}"))?;

    let mut stream = conn
        .create_stream()
        .await
        .map_err(|e| format!("Failed to create stream for {action}: {e}"))?;

    stream
        .send(conn, request_bytes)
        .await
        .map_err(|e| format!("Failed to send {action} request: {e}"))?;

    let response_bytes = stream
        .recv()
        .await
        .ok_or_else(|| format!("Connection closed before {action} response"))?;

    serde_json::from_slice::<cfms_core::Response>(&response_bytes)
        .map_err(|e| format!("Invalid {action} response: {e}"))
}

/// Set up the Data Encryption Key after a successful login.
///
/// Mirrors [`_setup_dek`] from the Python reference implementation:
///
/// 1. If the server returned a `preference_dek`, decrypt its `key_content`
///    with the password-derived KEK to recover the DEK.
/// 2. Otherwise, generate a new random DEK, encrypt it, upload it to the
///    server's keyring (`upload_user_key`), and register it as the
///    preference DEK (`set_user_preference_dek`).
///
/// Failures are logged but **not** propagated — DEK setup is best-effort;
/// the user can still log in without encrypted configuration support.
async fn setup_dek(
    inner: &cfms_service::state::AppState,
    login_data: &serde_json::Value,
    password: &str,
    username: &str,
    token: &str,
    conn: &cfms_transport::Connection,
) {
    if password.is_empty() {
        return;
    }

    let result: Result<(), String> = async {
        if let Some(preference_dek) = login_data.get("preference_dek") {
            // --- Server already has an encrypted DEK — decrypt it. ---
            let key_content = preference_dek["key_content"]
                .as_str()
                .ok_or_else(|| "preference_dek missing key_content".to_string())?;

            let decrypted = dek::decrypt_dek(key_content, password)
                .map_err(|e| format!("DEK decryption failed: {e}"))?;

            let mut d = inner.dek.write().await;
            *d = Some(decrypted);
        } else {
            // --- First login with keyring support — generate and upload. ---
            let new_dek = dek::generate_dek();
            let encrypted = dek::encrypt_dek(&new_dek, password)
                .map_err(|e| format!("DEK encryption failed: {e}"))?;

            // Upload the encrypted DEK to the server's keyring.
            let upload_resp = send_action_request(
                conn,
                "upload_user_key",
                serde_json::json!({"content": encrypted, "label": "preference_dek"}),
                username,
                token,
            )
            .await?;

            if upload_resp.code != 200 {
                return Err(format!(
                    "upload_user_key returned {}: {}",
                    upload_resp.code, upload_resp.message
                ));
            }

            let key_id = upload_resp.data["id"]
                .as_str()
                .ok_or_else(|| "upload_user_key response missing id".to_string())?
                .to_string();

            // Register it as the preference DEK for future logins.
            let set_resp = send_action_request(
                conn,
                "set_user_preference_dek",
                serde_json::json!({"id": key_id}),
                username,
                token,
            )
            .await?;

            if set_resp.code != 200 {
                return Err(format!(
                    "set_user_preference_dek returned {}: {}",
                    set_resp.code, set_resp.message
                ));
            }

            // Store the DEK in memory.
            let mut d = inner.dek.write().await;
            *d = Some(new_dek);
        }
        Ok(())
    }
    .await;

    if let Err(e) = result {
        // Non-fatal: encryption is best-effort; login still succeeds.
        tracing::warn!("DEK setup failed (config will not be encrypted this session): {e}");
    }
}
