use crate::AppHandleState;
use cfms_core::ServiceEvent;
use cfms_core::constants;

#[tauri::command]
pub fn protocol_version() -> u32 {
    constants::PROTOCOL_VERSION
}

/// Run one immediate favorites/recent-visits validation cycle.
#[tauri::command]
pub async fn validate_file_shortcuts(
    state: tauri::State<'_, AppHandleState>,
) -> Result<cfms_service::files::shortcuts::ShortcutValidationStatus, String> {
    let status =
        cfms_service::files::shortcuts::validate_now(&state.inner, &state.app_data_dir).await;

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
