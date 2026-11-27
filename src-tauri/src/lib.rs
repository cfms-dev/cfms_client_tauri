//! CFMS Client Tauri application entry point.
//!
//! Configures the Tauri runtime, initialises background services, sets up
//! the persistent SQLite database, and registers all IPC commands.

#![allow(clippy::items_after_test_module)]
#![allow(clippy::too_many_arguments)] // Tauri command signatures mirror the IPC contract.

mod app_state;
#[cfg(any(target_os = "android", target_os = "ios"))]
mod background;
mod bootstrap;
mod commands;
pub use app_state::{AppHandleState, ConnectAttemptRegistry};
mod github_credentials;
mod local_data_reset;
mod localization;
mod managed_auth_keys;
mod preference_keys;
mod public_key_auth;
mod secure_store;
mod window_backdrop;

#[cfg(target_os = "android")]
use tauri::Manager;
#[cfg(target_os = "android")]
use tauri::Runtime;

mod upload_runtime;
pub use upload_runtime::{ActiveUploadRegistry, UploadInterruption};

#[cfg(target_os = "android")]
const ANDROID_PLUGIN_IDENTIFIER: &str = "org.crpteam.cfms_client_tauri";

macro_rules! android_plugin {
    ($struct_name:ident, $fn_name:ident, $plugin_name:literal, $noop_name:literal, $class_name:literal) => {
        #[cfg(target_os = "android")]
        pub struct $struct_name<R: Runtime> {
            pub handle: tauri::plugin::PluginHandle<R>,
        }

        #[cfg(target_os = "android")]
        fn $fn_name<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
            tauri::plugin::Builder::new($plugin_name)
                .setup(|app, api| {
                    let handle =
                        api.register_android_plugin(ANDROID_PLUGIN_IDENTIFIER, $class_name)?;
                    app.manage($struct_name { handle });
                    Ok(())
                })
                .build()
        }

        #[cfg(not(target_os = "android"))]
        fn $fn_name<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
            tauri::plugin::Builder::new($noop_name).build()
        }
    };
}

android_plugin!(
    AndroidApkInstaller,
    apk_installer_plugin,
    "apk-installer",
    "apk-installer-noop",
    "ApkInstallerPlugin"
);
android_plugin!(
    AndroidFileOpener,
    file_opener_plugin,
    "file-opener",
    "file-opener-noop",
    "FileOpenerPlugin"
);
android_plugin!(
    AndroidUploadFileImporter,
    upload_file_importer_plugin,
    "upload-file-importer",
    "upload-file-importer-noop",
    "UploadFileImporterPlugin"
);
android_plugin!(
    AndroidPasskey,
    android_passkey_plugin,
    "android-passkey",
    "android-passkey-noop",
    "AndroidPasskeyPlugin"
);
android_plugin!(
    AndroidAppLifecycle,
    android_app_lifecycle_plugin,
    "android-app-lifecycle",
    "android-app-lifecycle-noop",
    "AndroidAppLifecyclePlugin"
);
android_plugin!(
    AndroidSecureScreen,
    android_secure_screen_plugin,
    "android-secure-screen",
    "android-secure-screen-noop",
    "AndroidSecureScreenPlugin"
);
android_plugin!(
    AndroidUpdateNotification,
    android_update_notification_plugin,
    "android-update-notification",
    "android-update-notification-noop",
    "UpdateNotificationPlugin"
);
android_plugin!(
    AndroidGithubCredentialPlugin,
    android_github_credential_plugin,
    "android-github-credential",
    "android-github-credential-noop",
    "AndroidGithubCredentialPlugin"
);
android_plugin!(
    AndroidAuthKeyPlugin,
    android_auth_key_plugin,
    "android-auth-key",
    "android-auth-key-noop",
    "AndroidAuthKeyPlugin"
);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

#[cfg(all(target_os = "linux", not(debug_assertions)))]
fn apply_process_memory_hardening() {
    // Release clients do not need same-user ptrace or core-dump diagnostics.
    // Administrators can still inspect the process; this is not an anti-dump claim.
    nix::sys::prctl::set_dumpable(false)
        .expect("failed to disable Linux process dumpability for release build");
}

#[cfg(any(not(target_os = "linux"), debug_assertions))]
fn apply_process_memory_hardening() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    apply_process_memory_hardening();
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    tauri::Builder::default()
        .plugin(biometric_plugin())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(updater_plugin())
        .plugin(apk_installer_plugin())
        .plugin(file_opener_plugin())
        .plugin(upload_file_importer_plugin())
        .plugin(android_passkey_plugin())
        .plugin(android_app_lifecycle_plugin())
        .plugin(android_secure_screen_plugin())
        .plugin(android_update_notification_plugin())
        .plugin(android_github_credential_plugin())
        .plugin(android_auth_key_plugin())
        .plugin(background_service_plugin())
        .setup(bootstrap::setup)
        .invoke_handler(commands::registry::handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Returns the background-service Tauri plugin appropriate for this platform.
///
/// On mobile (Android / iOS) the real `tauri-plugin-background-service` plugin
/// is used: it creates a foreground service that prevents the OS from
/// suspending the process while CFMS tasks are running.
///
/// On desktop the plugin is not needed, so a lightweight no-op plugin is
/// returned instead.
#[cfg(any(target_os = "android", target_os = "ios"))]
fn background_service_plugin<R: tauri::Runtime>()
-> tauri::plugin::TauriPlugin<R, tauri_plugin_background_service::PluginConfig> {
    tauri_plugin_background_service::init_with_service(background::CfmsBackgroundService::new)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn background_service_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("background-service-noop").build()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn updater_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R, tauri_plugin_updater::Config>
{
    tauri_plugin_updater::Builder::new().build()
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn updater_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("updater-noop").build()
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn biometric_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_biometric::init()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn biometric_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("biometric-noop").build()
}
