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
use cfms_core::{DownloadTaskDto, DownloadTaskStatus, FileEntry, ServiceStatusInfo};
use cfms_service::services::download_queue;
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
    let lockdown = state.inner.app_lockdown.load(std::sync::atomic::Ordering::SeqCst);
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
pub async fn clear_completed_tasks(
    state: tauri::State<'_, AppHandleState>,
) -> Result<u32, String> {
    state
        .store
        .clear_completed()
        .map(|n| n as u32)
        .map_err(|e| format!("Failed to clear completed tasks: {e}"))
}

/// Clear failed tasks.
#[tauri::command]
pub async fn clear_failed_tasks(
    state: tauri::State<'_, AppHandleState>,
) -> Result<u32, String> {
    state
        .store
        .clear_failed()
        .map(|n| n as u32)
        .map_err(|e| format!("Failed to clear failed tasks: {e}"))
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
/// The Key Encryption Key (KEK) is derived from the password via
/// PBKDF2-HMAC-SHA256 (1 000 000 iterations).
#[tauri::command]
pub async fn login(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    password: String,
    twofa_token: Option<String>,
) -> Result<serde_json::Value, String> {
    use cfms_crypto::kdf;

    // --- Obtain the active connection ---
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    // --- Build login request payload ---
    let mut request = serde_json::json!({
        "action": "login",
        "username": &username,
        "password": &password,
    });
    if let Some(ref token) = twofa_token {
        request["2fa_token"] = serde_json::Value::String(token.clone());
    }

    // --- Send login request over a client stream ---
    let mut stream = conn
        .create_stream()
        .await
        .map_err(|e| format!("Failed to create stream: {e}"))?;

    let request_bytes = serde_json::to_vec(&request)
        .map_err(|e| format!("Failed to encode login request: {e}"))?;

    stream
        .send(&conn, request_bytes)
        .await
        .map_err(|e| format!("Failed to send login request: {e}"))?;

    // --- Read response ---
    let response_bytes = stream
        .recv()
        .await
        .ok_or_else(|| "Connection closed before login response".to_string())?;

    // Send conclusion frame to close the stream.
    let _ = stream.send_final(&conn, vec![]).await;

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

            // Derive KEK from password.
            let salt = kdf::generate_salt();
            let kek = kdf::derive_kek(password.as_bytes(), &salt);

            // Store auth state from server response.
            {
                let mut u = state.inner.username.write().await;
                *u = Some(username.clone());
            }
            {
                let token = data["token"]
                    .as_str()
                    .ok_or_else(|| "Server did not return a token".to_string())?
                    .to_string();
                let mut t = state.inner.token.write().await;
                *t = Some(token);
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

            // Store encryption key material.
            {
                let mut dek = state.inner.dek.write().await;
                *dek = Some(kek);
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
            let salt = kdf::generate_salt();
            let kek = kdf::derive_kek(password.as_bytes(), &salt);

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
                let mut dek = state.inner.dek.write().await;
                *dek = Some(kek);
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
        other => Err(format!(
            "Login failed: ({}) {}",
            other, response.message
        )),
    }
}

/// Log out and clear all authentication state.
#[tauri::command]
pub async fn logout(
    state: tauri::State<'_, AppHandleState>,
) -> Result<(), String> {
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
pub async fn disconnect(
    state: tauri::State<'_, AppHandleState>,
) -> Result<(), String> {
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
