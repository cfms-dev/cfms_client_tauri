// Mobile platform helpers
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn move_app_to_background<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let lifecycle = app.state::<AndroidAppLifecycle<R>>();
    lifecycle
        .handle
        .run_mobile_plugin::<()>("moveTaskToBack", serde_json::json!({}))
        .map_err(|e| format!("Failed to move app to background: {e}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn move_app_to_background() -> Result<(), String> {
    Err("Moving the app to background is only available on Android.".to_string())
}

// ---------------------------------------------------------------------------
