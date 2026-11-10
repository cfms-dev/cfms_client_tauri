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
mod preference_keys;
mod public_key_auth;
mod secure_store;
mod window_backdrop;

#[cfg(target_os = "android")]
use tauri::Runtime;

mod upload_runtime;
pub use upload_runtime::{ActiveUploadRegistry, UploadInterruption};

#[cfg(target_os = "android")]
pub struct AndroidApkInstaller<R: Runtime> {
    pub handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
pub struct AndroidFileOpener<R: Runtime> {
    pub handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
pub struct AndroidUploadFileImporter<R: Runtime> {
    pub handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
pub struct AndroidPasskey<R: Runtime> {
    pub handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
pub struct AndroidAppLifecycle<R: Runtime> {
    pub handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
pub struct AndroidSecureScreen<R: Runtime> {
    pub handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
pub struct AndroidUpdateNotification<R: Runtime> {
    pub handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
pub struct AndroidGithubCredentialPlugin<R: Runtime> {
    pub handle: tauri::plugin::PluginHandle<R>,
}

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

#[cfg(target_os = "android")]
fn apk_installer_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    const PLUGIN_IDENTIFIER: &str = "org.crpteam.cfms_client_tauri";

    tauri::plugin::Builder::new("apk-installer")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "ApkInstallerPlugin")?;
            app.manage(AndroidApkInstaller { handle });
            Ok(())
        })
        .build()
}

#[cfg(not(target_os = "android"))]
fn apk_installer_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("apk-installer-noop").build()
}

#[cfg(target_os = "android")]
fn file_opener_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    const PLUGIN_IDENTIFIER: &str = "org.crpteam.cfms_client_tauri";

    tauri::plugin::Builder::new("file-opener")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "FileOpenerPlugin")?;
            app.manage(AndroidFileOpener { handle });
            Ok(())
        })
        .build()
}

#[cfg(not(target_os = "android"))]
fn file_opener_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("file-opener-noop").build()
}

#[cfg(target_os = "android")]
fn upload_file_importer_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    const PLUGIN_IDENTIFIER: &str = "org.crpteam.cfms_client_tauri";

    tauri::plugin::Builder::new("upload-file-importer")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin(PLUGIN_IDENTIFIER, "UploadFileImporterPlugin")?;
            app.manage(AndroidUploadFileImporter { handle });
            Ok(())
        })
        .build()
}

#[cfg(not(target_os = "android"))]
fn upload_file_importer_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("upload-file-importer-noop").build()
}

#[cfg(target_os = "android")]
fn android_passkey_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    const PLUGIN_IDENTIFIER: &str = "org.crpteam.cfms_client_tauri";

    tauri::plugin::Builder::new("android-passkey")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "AndroidPasskeyPlugin")?;
            app.manage(AndroidPasskey { handle });
            Ok(())
        })
        .build()
}

#[cfg(not(target_os = "android"))]
fn android_passkey_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("android-passkey-noop").build()
}

#[cfg(target_os = "android")]
fn android_app_lifecycle_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    const PLUGIN_IDENTIFIER: &str = "org.crpteam.cfms_client_tauri";

    tauri::plugin::Builder::new("android-app-lifecycle")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin(PLUGIN_IDENTIFIER, "AndroidAppLifecyclePlugin")?;
            app.manage(AndroidAppLifecycle { handle });
            Ok(())
        })
        .build()
}

#[cfg(not(target_os = "android"))]
fn android_app_lifecycle_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("android-app-lifecycle-noop").build()
}

#[cfg(target_os = "android")]
fn android_secure_screen_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    const PLUGIN_IDENTIFIER: &str = "org.crpteam.cfms_client_tauri";

    tauri::plugin::Builder::new("android-secure-screen")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin(PLUGIN_IDENTIFIER, "AndroidSecureScreenPlugin")?;
            app.manage(AndroidSecureScreen { handle });
            Ok(())
        })
        .build()
}

#[cfg(not(target_os = "android"))]
fn android_secure_screen_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("android-secure-screen-noop").build()
}

#[cfg(target_os = "android")]
fn android_update_notification_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    const PLUGIN_IDENTIFIER: &str = "org.crpteam.cfms_client_tauri";

    tauri::plugin::Builder::new("android-update-notification")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin(PLUGIN_IDENTIFIER, "UpdateNotificationPlugin")?;
            app.manage(AndroidUpdateNotification { handle });
            Ok(())
        })
        .build()
}

#[cfg(not(target_os = "android"))]
fn android_update_notification_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("android-update-notification-noop").build()
}

#[cfg(target_os = "android")]
fn android_github_credential_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    const PLUGIN_IDENTIFIER: &str = "org.crpteam.cfms_client_tauri";

    tauri::plugin::Builder::new("android-github-credential")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin(PLUGIN_IDENTIFIER, "AndroidGithubCredentialPlugin")?;
            app.manage(AndroidGithubCredentialPlugin { handle });
            Ok(())
        })
        .build()
}

#[cfg(not(target_os = "android"))]
fn android_github_credential_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("android-github-credential-noop").build()
}
