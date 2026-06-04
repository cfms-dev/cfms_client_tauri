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
    DownloadTaskDto, DownloadTaskStatus, FileEntry, ListDirectoryResponse, ServerInfo,
    ServiceStatusInfo, UserPreference,
};
use cfms_crypto::{config as crypto_config, dek};
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
        .tasks
        .insert(&task)
        .map_err(|e| format!("Failed to add download: {e}"))
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
    download_queue::pause_task(&state.tasks, &task_id)
        .map_err(|e| format!("Failed to pause download: {e}"))
}

/// Resume a paused download.
#[tauri::command]
pub async fn resume_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    download_queue::resume_task(&state.tasks, &task_id)
        .map_err(|e| format!("Failed to resume download: {e}"))
}

/// Cancel a download task.
#[tauri::command]
pub async fn cancel_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    download_queue::cancel_task(&state.tasks, &state.active_downloads, &task_id)
        .map_err(|e| format!("Failed to cancel download: {e}"))
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
    }

    // Remove from the in-memory queue.
    state.tasks.delete(&task_id);

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
        message: None,
        error: None,
        created_at: now,
        started_at: None,
        completed_at: None,
        priority: 0,
        retry_count: 0,
        max_retries: 3,
        scheduled_time: None,
        stage: 0,
        bandwidth_limit: None,
        pause_position: None,
        supports_resume: false,
    };

    // Persist the download task so the download queue service picks it up.
    state
        .tasks
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
        .settings
        .get(&key)
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
        .settings
        .set(&key, &value)
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

            // Load download tasks for this user.
            // This must happen AFTER DEK setup — the task file is encrypted
            // and requires the DEK to decrypt.
            {
                let server_addr = {
                    let a = state.inner.server_address.read().await;
                    a.clone().unwrap_or_default()
                };
                let server_hash = cfms_core::get_server_hash(&server_addr);
                let dek = {
                    let d = state.inner.dek.read().await;
                    d.clone()
                };
                if let Err(e) = state.tasks.load_for_user(
                    &state.app_data_dir,
                    &server_hash,
                    &username,
                    dek.as_deref(),
                ) {
                    tracing::warn!("Failed to load download tasks after login: {e}");
                }
            }

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
                "requires_2fa": true,
                "2fa_method": method,
            }))
        }

        // --- Password must be changed before login ---
        //
        // Mirrors the Python reference which shows a PasswdUserDialog for
        // codes 4001 / 4002.
        //
        // The frontend should surface a password-change prompt — we include
        // the server's message so the user knows why.
        4001 | 4002 => Err(format!(
            "Password must be changed before login: {}",
            response.message
        )),

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
        let mut a = state.inner.avatar_path.write().await;
        *u = None;
        *t = None;
        *e = None;
        *n = None;
        p.clear();
        g.clear();
        *d = None;
        *a = None;
    }

    // Clear the in-memory download task queue so next user starts fresh.
    state.tasks.clear();
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

/// Establish a WSS connection to the CFMS server and perform the initial
/// `server_info` handshake.
///
/// Uses the TLS configuration from [`cfms_transport::tls::build_config`]
/// with the local CA certificate store.  When `disable_ssl_enforcement`
/// is `true`, certificate verification is skipped (insecure).
///
/// # Post-connect handshake
///
/// After the WebSocket is established this command immediately sends a
/// `server_info` request to:
///
/// 1. Validate protocol-version compatibility between client and server.
/// 2. Surface the server's display name and lockdown status.
///
/// If the server's protocol version is *higher* than the client's the
/// connection is torn down and an error is returned — the frontend
/// should direct the user to update the client.
///
/// If the server's protocol version is *lower* the connection is also
/// closed — the server is too old and the client cannot downgrade.
///
/// # Returns
///
/// [`ServerInfo`] on success: `{ server_name, protocol_version, lockdown }`.
///
/// # Reference
///
/// Mirrors `ConnectFormController.action_connect` in
/// `reference/src/include/controllers/connect.py`.
#[tauri::command]
pub async fn connect(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    url: String,
    disable_ssl_enforcement: bool,
) -> Result<serde_json::Value, String> {
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

    // --- Post-connect handshake: request server_info ---
    //
    // This request is sent *without* authentication (username / token are
    // empty) because we haven't logged in yet — exactly matching the Python
    // reference which passes `username=None, token=None` in `_request()`.
    let server_info: ServerInfo = {
        let random_bytes: [u8; 16] = rand::thread_rng().r#gen();
        let nonce = hex::encode(random_bytes);

        let request = serde_json::json!({
            "action": "server_info",
            "data": {},
            "username": null,
            "token": null,
            "timestamp": unix_now(),
            "nonce": nonce,
        });

        let request_bytes = serde_json::to_vec(&request)
            .map_err(|e| format!("Failed to encode server_info request: {e}"))?;

        let mut stream = conn
            .create_stream()
            .await
            .map_err(|e| format!("Failed to create stream for server_info: {e}"))?;

        stream
            .send(&conn, request_bytes)
            .await
            .map_err(|e| format!("Failed to send server_info request: {e}"))?;

        let response_bytes = stream
            .recv()
            .await
            .ok_or_else(|| "Connection closed before server_info response".to_string())?;

        let response: cfms_core::Response = serde_json::from_slice(&response_bytes)
            .map_err(|e| format!("Invalid server_info response: {e}"))?;

        if response.code != 200 {
            // Connection is useless without server_info — tear it down.
            // Use close() directly (not spawn) so conn is consumed cleanly.
            conn.close().await;
            return Err(format!(
                "Server returned {} from server_info: {}",
                response.code, response.message
            ));
        }

        serde_json::from_value(response.data)
            .map_err(|e| format!("Invalid server_info data: {e}"))?
    };

    // --- Protocol version compatibility check ---
    //
    // Mirrors the Python reference's protocol-version gate in
    // `ConnectFormController.action_connect`.
    let client_protocol = cfms_core::constants::PROTOCOL_VERSION;

    if server_info.protocol_version != client_protocol {
        // Tear down — cannot communicate with this server.
        conn.close().await;

        if server_info.protocol_version > client_protocol {
            return Err(format!(
                "server_update_required:{}:{}",
                server_info.protocol_version, client_protocol
            ));
        } else {
            return Err(format!(
                "server_too_old:{}:{}",
                server_info.protocol_version, client_protocol
            ));
        }
    }

    // --- Store connection state ---
    {
        let mut c = state.inner.conn.write().await;
        *c = Some(conn);
    }
    {
        let mut addr = state.inner.server_address.write().await;
        *addr = Some(url.clone());
    }
    {
        let mut name = state.inner.server_name.write().await;
        *name = Some(server_info.server_name.clone());
    }
    {
        let mut pv = state.inner.server_protocol_version.write().await;
        *pv = Some(server_info.protocol_version);
    }
    // Apply initial lockdown status from server_info.
    // The lockdown_monitor background service will also fire Lockdown events
    // for dynamic changes, but this covers the static case during connect.
    {
        let mut dse = state.inner.disable_ssl_enforcement.write().await;
        *dse = disable_ssl_enforcement;
    }
    // Store the CA directory path so that dedicated transfer connections
    // can rebuild their TLS config on demand.
    {
        let mut ca = state.inner.ca_dir.write().await;
        *ca = Some(ca_dir);
    }
    state
        .inner
        .app_lockdown
        .store(server_info.lockdown, std::sync::atomic::Ordering::SeqCst);

    tracing::info!(
        "Connected to {url} — server={}, protocol={}, lockdown={}",
        server_info.server_name,
        server_info.protocol_version,
        server_info.lockdown,
    );

    Ok(serde_json::json!({
        "server_name": server_info.server_name,
        "protocol_version": server_info.protocol_version,
        "lockdown": server_info.lockdown,
    }))
}

/// Close the WSS connection and clear all server metadata.
///
/// Resets the connection, address, server name, protocol version, and
/// lockdown flag so the frontend reflects a clean disconnected state.
///
/// Auth state is **not** cleared here — call [`logout`] separately if
/// you also need to purge credentials.
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

    // Clear all server metadata.
    {
        let mut addr = state.inner.server_address.write().await;
        *addr = None;
    }
    {
        let mut name = state.inner.server_name.write().await;
        *name = None;
    }
    {
        let mut pv = state.inner.server_protocol_version.write().await;
        *pv = None;
    }
    state
        .inner
        .app_lockdown
        .store(false, std::sync::atomic::Ordering::SeqCst);
    {
        let mut ca = state.inner.ca_dir.write().await;
        *ca = None;
    }

    tracing::info!("Disconnected");
    Ok(())
}

/// Get the current authentication status (username, token, permissions, etc.).
#[tauri::command]
pub async fn get_auth_status(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    Ok(build_auth_status(&state.inner).await)
}

/// Get the current server-connection state (connected, address, lockdown).
#[tauri::command]
pub async fn get_server_state(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    Ok(build_server_state(&state.inner).await)
}

// ---------------------------------------------------------------------------
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
    app_handle: tauri::AppHandle,
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
    let pref_dir = get_user_prefs_dir(&app_handle)?;
    let pref_path = pref_dir.join(format!("{}_{}.json", server_hash, username));

    if !pref_path.exists() {
        return serde_json::to_value(UserPreference::default())
            .map_err(|e| format!("Serialization error: {e}"));
    }

    let raw =
        std::fs::read(&pref_path).map_err(|e| format!("Failed to read preference file: {e}"))?;

    let dek = {
        let d = state.inner.dek.read().await;
        d.clone()
    };

    if crypto_config::is_encrypted(&raw) {
        let dek =
            dek.ok_or_else(|| "Encrypted config file found but DEK is not available".to_string())?;
        let plaintext = crypto_config::decrypt_config(&raw, &dek)
            .map_err(|e| format!("Failed to decrypt preference file: {e}"))?;
        let pref: UserPreference = serde_json::from_slice(&plaintext)
            .map_err(|e| format!("Invalid preference data: {e}"))?;
        Ok(serde_json::to_value(pref).map_err(|e| format!("Serialization error: {e}"))?)
    } else {
        // Plaintext (legacy) — parse and migrate to encrypted.
        let pref: UserPreference = serde_json::from_slice(&raw).unwrap_or_default();
        // Migrate to encrypted format when DEK is available.
        if let Some(ref dek) = dek {
            let plaintext =
                serde_json::to_vec(&pref).map_err(|e| format!("Serialization error: {e}"))?;
            let encrypted = crypto_config::encrypt_config(&plaintext, dek)
                .map_err(|e| format!("Failed to encrypt preference file: {e}"))?;
            // Best-effort write — don't fail if we can't migrate.
            let _ = std::fs::write(&pref_path, &encrypted);
        }
        Ok(serde_json::to_value(pref).map_err(|e| format!("Serialization error: {e}"))?)
    }
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
    app_handle: tauri::AppHandle,
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
    let pref_dir = get_user_prefs_dir(&app_handle)?;
    let pref_path = pref_dir.join(format!("{}_{}.json", server_hash, username));

    // Ensure the directory exists.
    std::fs::create_dir_all(&pref_dir).map_err(|e| format!("Failed to create prefs dir: {e}"))?;

    let plaintext =
        serde_json::to_vec(&preferences).map_err(|e| format!("Serialization error: {e}"))?;

    let dek = {
        let d = state.inner.dek.read().await;
        d.clone()
    };

    if let Some(ref dek) = dek {
        let encrypted = crypto_config::encrypt_config(&plaintext, dek)
            .map_err(|e| format!("Failed to encrypt preference file: {e}"))?;
        std::fs::write(&pref_path, &encrypted)
            .map_err(|e| format!("Failed to write preference file: {e}"))?;
    } else {
        // Don't overwrite an existing encrypted file when no DEK is available.
        if pref_path.exists()
            && let Ok(raw) = std::fs::read(&pref_path)
            && crypto_config::is_encrypted(&raw)
        {
            return Ok(()); // Leave the encrypted file untouched.
        }
        std::fs::write(&pref_path, &plaintext)
            .map_err(|e| format!("Failed to write preference file: {e}"))?;
    }

    Ok(())
}

/// Resolve the user preferences directory from the app data path.
fn get_user_prefs_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle
        .path()
        .resolve("user_preferences", tauri::path::BaseDirectory::AppData)
        .map_err(|e| format!("Cannot resolve user prefs dir: {e}"))
}

// ---------------------------------------------------------------------------
// Download task reload (mirrors reference/src/include/classes/services/download.py)
// ---------------------------------------------------------------------------

/// Reload download tasks for the current user.
///
/// Loads tasks from the per-user encrypted JSON file into the in-memory queue.
/// Must be called after login (when username, server_address, and DEK are set).
///
/// Mirrors [`reload_tasks_for_user`] in the Python reference.
#[tauri::command]
pub async fn reload_tasks_for_user(
    state: tauri::State<'_, AppHandleState>,
) -> Result<usize, String> {
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

    let count = state
        .tasks
        .load_for_user(&state.app_data_dir, &server_hash, &username, dek.as_deref())
        .map_err(|e| format!("Failed to load download tasks: {e}"))?;

    tracing::info!("Reloaded {count} download tasks for user {username}");
    Ok(count)
}

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

/// Build a JSON auth-status payload (auth fields only — no server state).
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

    let mut status = serde_json::json!({
        "username": username,
        "nickname": nickname,
        "has_token": has_token,
        "token_exp": token_exp,
        "permissions": permissions,
        "groups": groups,
        "avatar_path": inner.avatar_path.read().await.clone(),
    });

    if pending_2fa {
        status["requires_2fa"] = serde_json::Value::Bool(true);
        status["2fa_method"] = serde_json::Value::String("totp".to_string());
    }

    status
}

/// Build a JSON server-state payload (connection fields only — no auth data).
async fn build_server_state(inner: &cfms_service::state::AppState) -> serde_json::Value {
    let connected = inner.conn.read().await.is_some();
    let server_address = inner.server_address.read().await.clone();
    let server_name = inner.server_name.read().await.clone();
    let protocol_version = inner.server_protocol_version.read().await;
    let lockdown = inner.app_lockdown.load(std::sync::atomic::Ordering::SeqCst);

    serde_json::json!({
        "connected": connected,
        "server_address": server_address,
        "server_name": server_name,
        "protocol_version": *protocol_version,
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
    let random_bytes: [u8; 16] = rand::thread_rng().r#gen();
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

            let decrypted = {
                let kc = key_content.to_owned();
                let pw = password.to_owned();
                tokio::task::spawn_blocking(move || {
                    dek::decrypt_dek(&kc, &pw).map_err(|e| format!("DEK decryption failed: {e}"))
                })
                .await
                .map_err(|e| format!("DEK decryption task panicked: {e}"))?
            }?;

            let mut d = inner.dek.write().await;
            *d = Some(decrypted);
        } else {
            // --- First login with keyring support — generate and upload. ---
            let new_dek = dek::generate_dek();
            let encrypted = {
                let pw = password.to_owned();
                let dk = *new_dek; // copy out of Zeroizing
                tokio::task::spawn_blocking(move || {
                    dek::encrypt_dek(&dk, &pw).map_err(|e| format!("DEK encryption failed: {e}"))
                })
                .await
                .map_err(|e| format!("DEK encryption task panicked: {e}"))?
            }?;

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
