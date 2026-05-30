use cfms_core::constants;

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Standard greet command.
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Health-check ping command.
#[tauri::command]
fn ping() -> String {
    "pong".into()
}

/// Expose the protocol version to the frontend.
#[tauri::command]
fn protocol_version() -> u32 {
    constants::PROTOCOL_VERSION
}

/// Expose crypto constants for debugging / diagnostics.
#[tauri::command]
fn crypto_info() -> serde_json::Value {
    serde_json::json!({
        "kdf_iterations": constants::KDF_ITERATIONS,
        "salt_len": constants::SALT_LEN,
        "key_len": constants::KEY_LEN,
        "nonce_len": constants::NONCE_LEN,
        "tag_len": constants::TAG_LEN,
    })
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            ping,
            protocol_version,
            crypto_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
