//! CFMS Client Tauri application entry point.
//!
//! Configures the Tauri runtime, initialises background services, sets up
//! the persistent SQLite database, and registers all IPC commands.

mod background;
mod commands;

use std::sync::Arc;

use tauri::{Emitter, Manager};

use cfms_service::db::tasks::TaskStore;
use cfms_service::service::manager::ServiceManager;
use cfms_service::services::download_queue::ActiveRegistry;
use cfms_service::state::AppState;

// ---------------------------------------------------------------------------
// Tauri managed state
// ---------------------------------------------------------------------------

/// The shared application state managed by Tauri and accessible from every
/// `#[tauri::command]` via `tauri::State<'_, AppHandleState>`.
pub struct AppHandleState {
    /// Shared in-memory application state (auth, DEK, lockdown, events).
    pub inner: Arc<AppState>,

    /// Persistent download task store (SQLite).
    pub store: TaskStore,

    /// Registry of active downloads (cancellation flags).
    pub active_downloads: ActiveRegistry,

    /// Background service manager.  Wrapped in Arc+Mutex so it can be
    /// activated on the async runtime and later shut down.
    pub service_manager: Arc<tokio::sync::Mutex<Option<ServiceManager>>>,
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_background_service::init_with_service(
            background::CfmsBackgroundService::new,
        ))
        .setup(|app| {
            // --- Determine application data directory ---
            let app_data_dir = app.path().app_data_dir().map_err(|e| {
                Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
            })?;
            std::fs::create_dir_all(&app_data_dir)?;

            let db_path = app_data_dir.join("cfms_client.db");
            tracing::info!("Opening database at {}", db_path.display());

            // --- Open persistent database ---
            let db = cfms_service::db::open(&db_path).map_err(|e| {
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("Database error: {e}"),
                ))
            })?;

            let state = AppState::new();
            let store = TaskStore::new(db);
            let active_downloads = ActiveRegistry::new();

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

            let s4 = Arc::clone(&state);
            let st4 = store.clone();
            service_manager.register("download_queue", move |rx| {
                let s = Arc::clone(&s4);
                let st = st4.clone();
                async move {
                    cfms_service::services::download_queue::run(s, st, rx).await;
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
                store,
                active_downloads,
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
            commands::login,
            commands::logout,
            commands::connect,
            commands::disconnect,
            commands::get_auth_status,
            commands::delete_download,
            commands::create_directory,
            commands::delete_directory,
            commands::delete_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
