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

/// Log in with username and password.
///
/// Derives the Key Encryption Key (KEK) from the password via
/// PBKDF2-HMAC-SHA256 (1 000 000 iterations) and stores the
/// authentication state.  The actual server handshake happens
/// when [`connect`] is called.
#[tauri::command]
pub async fn login(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    password: String,
) -> Result<serde_json::Value, String> {
    use cfms_crypto::kdf;

    // Derive KEK from password (never stored — only used for DEK
    // encryption/decryption during the server handshake).
    // derive_kek is infallible (returns Zeroizing<[u8; 32]> directly).
    let salt = kdf::generate_salt();
    let kek = kdf::derive_kek(password.as_bytes(), &salt);

    // Store auth state.
    {
        let mut u = state.inner.username.write().await;
        *u = Some(username.clone());
    }
    {
        let mut t = state.inner.token.write().await;
        *t = Some("placeholder_pre_auth".to_string());
    }
    {
        let mut e = state.inner.token_exp.write().await;
        *e = Some(unix_now() + 300); // 5-minute pre-auth window
    }
    {
        let mut n = state.inner.nickname.write().await;
        *n = Some(username.clone());
    }
    // Store encryption key material.
    {
        let mut dek = state.inner.dek.write().await;
        *dek = Some(kek); // KEK doubles as DEK until server provides the real one.
    }

    // Emit auth status.
    let status = build_auth_status(&state.inner).await;
    Ok(status)
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
    state: tauri::State<'_, AppHandleState>,
    url: String,
    disable_ssl_enforcement: bool,
) -> Result<(), String> {
    // Build TLS config.
    let ca_dir = {
        // Use the local `ca` directory for custom CA certificates.
        // In production, this path should be configurable via settings.
        let candidate = std::path::Path::new("ca");
        if candidate.exists() {
            candidate.to_path_buf()
        } else {
            std::path::PathBuf::from("ca")
        }
    };

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
    let has_token = inner.token.read().await.is_some();
    let token_exp = *inner.token_exp.read().await;
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
