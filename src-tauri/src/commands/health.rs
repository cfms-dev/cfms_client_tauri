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
            name: "server_push".into(),
            running: true,
        },
        ServiceStatusInfo {
            name: "connection_reconnect".into(),
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

/// Run one immediate favorites/recent-visits validation cycle.
#[tauri::command]
pub async fn validate_file_shortcuts(
    state: tauri::State<'_, AppHandleState>,
) -> Result<cfms_service::services::favorites::ShortcutValidationStatus, String> {
    let status =
        cfms_service::services::favorites::validate_now(&state.inner, &state.app_data_dir).await;

    let _ = state
        .inner
        .event_tx
        .send(ServiceEvent::FavoritesValidationComplete {
            invalid_count: status.invalid_count,
            invalid_files: status.invalid_files.clone(),
            invalid_directories: status.invalid_directories.clone(),
            access_denied_files: status.access_denied_files.clone(),
            access_denied_directories: status.access_denied_directories.clone(),
        });

    Ok(status)
}
