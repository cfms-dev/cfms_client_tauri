// Mobile platform helpers
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn move_app_to_background<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    move_android_task_to_background(&app)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn exit_app_after_launcher_transition<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    if let Err(err) = move_android_task_to_background_and_wait_for_stop(&app) {
        tracing::warn!("Failed to move app to background before exit: {err}");
        app.exit(0);
        return Ok(());
    }

    app.exit(0);
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn set_android_content_protected<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    let secure_screen = app.state::<AndroidSecureScreen<R>>();
    secure_screen
        .handle
        .run_mobile_plugin::<()>("setSecureScreen", serde_json::json!({ "enabled": enabled }))
        .map_err(|e| format!("Failed to update Android screenshot protection: {e}"))
}

#[cfg(target_os = "android")]
fn move_android_task_to_background<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let lifecycle = app.state::<AndroidAppLifecycle<R>>();
    lifecycle
        .handle
        .run_mobile_plugin::<()>("moveTaskToBack", serde_json::json!({}))
        .map_err(|e| format!("Failed to move app to background: {e}"))
}

#[cfg(target_os = "android")]
fn move_android_task_to_background_and_wait_for_stop<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let lifecycle = app.state::<AndroidAppLifecycle<R>>();
    lifecycle
        .handle
        .run_mobile_plugin::<()>("moveTaskToBackAndWaitForStop", serde_json::json!({}))
        .map_err(|e| format!("Failed to move app to background: {e}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn move_app_to_background() -> Result<(), String> {
    Err("Moving the app to background is only available on Android.".to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn exit_app_after_launcher_transition<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn set_android_content_protected(_enabled: bool) -> Result<(), String> {
    Err("Android screenshot protection is only available on Android.".to_string())
}

// ---------------------------------------------------------------------------
