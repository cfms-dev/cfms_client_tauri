//! CFMS Client Tauri application entry point.
//!
//! Configures the Tauri runtime, initialises background services, sets up
//! the persistent SQLite database, and registers all IPC commands.

mod background;
mod commands;
mod localization;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};
use tauri_plugin_log::log::LevelFilter;
use tauri_plugin_log::{Target, TargetKind};
use tokio::sync::watch;

use cfms_service::db::settings::SettingsStore;
use cfms_service::service::manager::ServiceManager;
use cfms_service::services::download_queue::{ActiveRegistry, QueueState};
use cfms_service::state::AppState;
use localization::LocalizationManager;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadInterruption {
    Paused,
    Cancelled,
}

struct ActiveUpload {
    control_tx: watch::Sender<Option<UploadInterruption>>,
    transfer_conn: Option<cfms_transport::Connection>,
}

#[derive(Clone, Default)]
pub struct ActiveUploadRegistry {
    inner: Arc<Mutex<HashMap<String, ActiveUpload>>>,
}

impl ActiveUploadRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, upload_id: &str) -> watch::Receiver<Option<UploadInterruption>> {
        let (control_tx, control_rx) = watch::channel(None);
        let mut map = self.inner.lock().unwrap();
        map.insert(
            upload_id.to_string(),
            ActiveUpload {
                control_tx,
                transfer_conn: None,
            },
        );
        control_rx
    }

    pub fn set_transfer_conn(&self, upload_id: &str, conn: cfms_transport::Connection) {
        let mut map = self.inner.lock().unwrap();
        if let Some(active) = map.get_mut(upload_id) {
            active.transfer_conn = Some(conn);
        }
    }

    pub fn unregister(&self, upload_id: &str) {
        let mut map = self.inner.lock().unwrap();
        map.remove(upload_id);
    }

    pub fn interrupt(&self, upload_id: &str, reason: UploadInterruption) -> bool {
        let mut map = self.inner.lock().unwrap();
        if let Some(active) = map.get_mut(upload_id) {
            let _ = active.control_tx.send(Some(reason));
            if let Some(conn) = active.transfer_conn.take() {
                tauri::async_runtime::spawn(async move { conn.close().await });
            }
            true
        } else {
            false
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri managed state
// ---------------------------------------------------------------------------

/// The shared application state managed by Tauri and accessible from every
/// `#[tauri::command]` via `tauri::State<'_, AppHandleState>`.
pub struct AppHandleState {
    /// Shared in-memory application state (auth, DEK, lockdown, events).
    pub inner: Arc<AppState>,

    /// In-memory download task queue.  Tasks are persisted to encrypted JSON
    /// files per-user (see `cfms_service::services::task_persistence`).
    pub tasks: QueueState,

    /// User settings (key-value, SQLite-backed).
    pub settings: SettingsStore,

    /// Registry of active downloads (cancellation flags).
    pub active_downloads: ActiveRegistry,

    /// Registry of active uploads (pause/cancel flags).
    pub active_uploads: ActiveUploadRegistry,

    /// Backend localization state (Fluent-backed).
    pub localizer: Arc<LocalizationManager>,

    /// Pending application update selected by the most recent updater check.
    pub pending_update: Arc<Mutex<Option<tauri_plugin_updater::Update>>>,

    /// Application data directory (for persistence file paths).
    pub app_data_dir: PathBuf,

    /// Background service manager.  Wrapped in Arc+Mutex so it can be
    /// activated on the async runtime and later shut down.
    pub service_manager: Arc<tokio::sync::Mutex<Option<ServiceManager>>>,
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(LevelFilter::Debug)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(updater_plugin())
        .plugin(background_service_plugin())
        .setup(|app| {
            // --- Determine application data directory ---
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| Box::new(std::io::Error::other(e.to_string())))?;
            std::fs::create_dir_all(&app_data_dir)?;

            let db_path = app_data_dir.join("cfms_client.db");
            tracing::info!("Opening database at {}", db_path.display());

            // --- Open persistent database (user_settings only) ---
            let db = cfms_service::db::open(&db_path)
                .map_err(|e| Box::new(std::io::Error::other(format!("Database error: {e}"))))?;

            let state = AppState::new();
            let settings = SettingsStore::new(db);
            let initial_locale = settings
                .get("language")
                .ok()
                .flatten()
                .unwrap_or_else(|| "zh_CN".to_string());
            let localizer = Arc::new(LocalizationManager::new(initial_locale));
            let tasks = QueueState::new();
            let active_downloads = ActiveRegistry::new();
            let active_uploads = ActiveUploadRegistry::new();
            let pending_update = Arc::new(Mutex::new(None));

            // --- Register background services (no Tokio context needed) ---
            // Services are activated later inside a Tauri async runtime block.

            let mut service_manager = ServiceManager::new();

            let s1 = Arc::clone(&state);
            service_manager.register("token_refresh", move |rx| {
                let s = Arc::clone(&s1);
                async move {
                    cfms_service::services::token_refresh::run(s, rx).await;
                }
            });

            let s2 = Arc::clone(&state);
            service_manager.register("favorites_validation", move |rx| {
                let s = Arc::clone(&s2);
                async move {
                    cfms_service::services::favorites::run(s, rx).await;
                }
            });

            let s3 = Arc::clone(&state);
            service_manager.register("lockdown_monitor", move |rx| {
                let s = Arc::clone(&s3);
                async move {
                    cfms_service::services::lockdown::run(s, rx).await;
                }
            });

            let s_reconnect = Arc::clone(&state);
            service_manager.register("connection_reconnect", move |rx| {
                let s = Arc::clone(&s_reconnect);
                async move {
                    cfms_service::services::connection::run(s, rx).await;
                }
            });

            let s4 = Arc::clone(&state);
            let t4 = tasks.clone();
            let a4 = active_downloads.clone();
            service_manager.register("download_queue", move |rx| {
                let s = Arc::clone(&s4);
                let t = t4.clone();
                let a = a4.clone();
                async move {
                    cfms_service::services::download_queue::run(s, t, a, rx).await;
                }
            });

            // --- Wrap service manager in Arc<Mutex<Option<...>>> ---
            // This lets us activate it from the async runtime while also
            // storing it in Tauri managed state for later shutdown.
            let sm: Arc<tokio::sync::Mutex<Option<ServiceManager>>> =
                Arc::new(tokio::sync::Mutex::new(Some(service_manager)));

            // Activate on the Tauri async runtime.
            {
                let sm = Arc::clone(&sm);
                let rt_handle = tauri::async_runtime::handle();
                rt_handle.spawn(async move {
                    if let Some(ref mut mgr) = *sm.lock().await {
                        mgr.activate();
                    }
                });
            }

            // --- Forward ServiceEvents to Tauri frontend ---
            let handle = app.handle().clone();
            let mut event_rx = state.event_tx.subscribe();
            tauri::async_runtime::spawn(async move {
                loop {
                    match event_rx.recv().await {
                        Ok(event) => {
                            let _ = handle.emit("cfms:event", &event);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!("Event broadcast lagged by {n} messages");
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            break;
                        }
                    }
                }
            });

            // --- Register managed state ---
            app.manage(AppHandleState {
                inner: state,
                tasks,
                settings,
                active_downloads,
                active_uploads,
                localizer,
                pending_update,
                app_data_dir: app_data_dir.clone(),
                service_manager: sm,
            });

            tracing::info!("CFMS Client initialized successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::ping,
            commands::protocol_version,
            commands::crypto_info,
            commands::get_service_status,
            commands::check_app_update,
            commands::install_app_update,
            commands::add_download,
            commands::get_download_tasks,
            commands::pause_download,
            commands::resume_download,
            commands::cancel_download,
            commands::clear_completed_tasks,
            commands::clear_failed_tasks,
            commands::scan_directory,
            commands::list_directory,
            commands::get_document,
            commands::get_setting,
            commands::set_setting,
            commands::get_locale,
            commands::set_locale,
            commands::translate_backend,
            commands::get_connection_settings,
            commands::set_connection_settings,
            commands::login,
            commands::change_password,
            commands::logout,
            commands::connect,
            commands::disconnect,
            commands::get_auth_status,
            commands::get_server_state,
            commands::get_2fa_status,
            commands::setup_2fa,
            commands::validate_2fa,
            commands::cancel_2fa_setup,
            commands::disable_2fa,
            commands::delete_download,
            commands::create_directory,
            commands::delete_directory,
            commands::delete_document,
            commands::rename_directory,
            commands::rename_document,
            commands::move_directory,
            commands::move_document,
            commands::get_directory_info,
            commands::get_document_info,
            commands::view_access_entries,
            commands::revoke_access,
            commands::grant_access,
            commands::get_access_rules,
            commands::set_access_rules,
            commands::list_revisions,
            commands::get_revision,
            commands::set_current_revision,
            commands::upload_new_revision,
            commands::upload_document_file,
            commands::upload_directory,
            commands::pause_upload,
            commands::resume_upload,
            commands::cancel_upload,
            commands::search_files,
            commands::list_deleted_items,
            commands::restore_document,
            commands::restore_directory,
            commands::purge_document,
            commands::purge_directory,
            commands::list_users,
            commands::create_user,
            commands::rename_user,
            commands::delete_user,
            commands::get_user_info,
            commands::change_user_groups,
            commands::reset_user_password,
            commands::block_user,
            commands::list_user_blocks,
            commands::unblock_user,
            commands::list_groups,
            commands::create_group,
            commands::rename_group,
            commands::delete_group,
            commands::get_group_info,
            commands::change_group_permissions,
            commands::view_audit_logs,
            commands::get_user_avatar,
            commands::download_avatar,
            commands::check_cached_avatar,
            commands::set_user_avatar,
            commands::load_user_preference,
            commands::save_user_preference,
            commands::reload_tasks_for_user,
        ])
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
