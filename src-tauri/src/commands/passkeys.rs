#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_passkey_availability<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<AndroidPasskeyAvailability, String> {
    let passkey = app.state::<AndroidPasskey<R>>();
    passkey
        .handle
        .run_mobile_plugin::<AndroidPasskeyAvailability>("isAvailable", serde_json::json!({}))
        .map_err(|e| format!("Failed to query Android passkey availability: {e}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_passkey_availability() -> Result<AndroidPasskeyAvailability, String> {
    Ok(AndroidPasskeyAvailability {
        available: false,
        web_view_web_authn: false,
    })
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_create_passkey<R: Runtime>(
    app: tauri::AppHandle<R>,
    request_json: String,
) -> Result<AndroidPasskeyRegistration, String> {
    let passkey = app.state::<AndroidPasskey<R>>();
    passkey
        .handle
        .run_mobile_plugin::<AndroidPasskeyRegistration>(
            "createPasskey",
            serde_json::json!({ "requestJson": request_json }),
        )
        .map_err(|e| format!("Failed to create Android passkey: {e}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_create_passkey(
    request_json: String,
) -> Result<AndroidPasskeyRegistration, String> {
    let _ = request_json;
    Err("Android passkeys are only available on Android.".to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_get_passkey<R: Runtime>(
    app: tauri::AppHandle<R>,
    request_json: String,
) -> Result<AndroidPasskeyAssertion, String> {
    let passkey = app.state::<AndroidPasskey<R>>();
    passkey
        .handle
        .run_mobile_plugin::<AndroidPasskeyAssertion>(
            "getPasskey",
            serde_json::json!({ "requestJson": request_json }),
        )
        .map_err(|e| format!("Failed to verify Android passkey: {e}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_get_passkey(request_json: String) -> Result<AndroidPasskeyAssertion, String> {
    let _ = request_json;
    Err("Android passkeys are only available on Android.".to_string())
}

// ---------------------------------------------------------------------------
