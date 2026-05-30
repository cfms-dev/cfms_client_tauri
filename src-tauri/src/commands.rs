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
