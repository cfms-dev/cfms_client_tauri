//! Construct native state, background services, and the main window.
use crate::commands;
use crate::{
    ActiveUploadRegistry, AppHandleState, ConnectAttemptRegistry, localization::LocalizationManager,
};
use crate::{github_credentials, local_data_reset, preference_keys, public_key_auth};
use cfms_service::db::settings::SettingsStore;
use cfms_service::runtime::manager::ServiceManager;
use cfms_service::state::AppState;
use cfms_service::transfers::download_queue::{ActiveRegistry, QueueState};
use cfms_service::transfers::upload_queue::UploadQueueState;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_log::log::LevelFilter;
use tauri_plugin_log::{Target, TargetKind};

pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // The main WebView is deliberately configured with `create: false`.
    // A scheduled reset must run before WebView2 opens (and locks) its
    // data directory, and before the database or file logger is opened.
    // Recovery mode deliberately avoids the persistent services too.
    let reset_marker_path = local_data_reset::marker_path(app.handle())
        .map_err(|e| Box::new(std::io::Error::other(e)))?;
    let reset_status = local_data_reset::complete_pending_reset(app.handle(), &reset_marker_path);
    let reset_recovery_mode = reset_status.pending;
    app.manage(local_data_reset::LocalDataResetRuntime::new(
        reset_marker_path,
        reset_status,
    ));
    let github_credentials = github_credentials::GithubCredentialState::new(app.handle());
    if reset_recovery_mode {
        github_credentials.begin_reset();
    }
    app.manage(github_credentials);
    app.manage(preference_keys::PreferenceKeys::default());

    let mut log_targets = Vec::new();
    if cfg!(debug_assertions) {
        log_targets.push(Target::new(TargetKind::Stdout));
        log_targets.push(Target::new(TargetKind::Webview));
    }
    if !reset_recovery_mode {
        log_targets.push(Target::new(TargetKind::LogDir { file_name: None }));
    }
    if log_targets.is_empty() {
        log_targets.push(Target::new(TargetKind::Stdout));
    }
    let log_level = if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    };
    app.handle().plugin(
        tauri_plugin_log::Builder::new()
            .level(log_level)
            .targets(log_targets)
            .build(),
    )?;

    // --- Determine application data directory ---
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| Box::new(std::io::Error::other(e.to_string())))?;
    std::fs::create_dir_all(&app_data_dir)?;

    let db_path = app_data_dir.join("cfms_client.db");
    tracing::debug!("Opening application database");

    // --- Open persistent database (user_settings only) ---
    let db = if reset_recovery_mode {
        cfms_service::db::open_in_memory()
    } else {
        cfms_service::db::open(&db_path)
    }
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
    let upload_tasks = UploadQueueState::new();
    let active_downloads = ActiveRegistry::new();
    let active_uploads = ActiveUploadRegistry::new();
    let pending_update = Arc::new(Mutex::new(None));
    #[cfg(target_os = "android")]
    let pending_mobile_update = Arc::new(Mutex::new(None));

    // --- Register background services (no Tokio context needed) ---
    // Services are activated later inside a Tauri async runtime block.

    let mut service_manager = ServiceManager::new();

    if !reset_recovery_mode {
        let s1 = Arc::clone(&state);
        service_manager.register("token_refresh", move |rx| {
            let s = Arc::clone(&s1);
            async move {
                cfms_service::authentication::token_refresh::run(s, rx).await;
            }
        });

        let s2 = Arc::clone(&state);
        let prefs_app_data_dir = app_data_dir.clone();
        service_manager.register("favorites_validation", move |rx| {
            let s = Arc::clone(&s2);
            let app_data_dir = prefs_app_data_dir.clone();
            async move {
                cfms_service::files::shortcuts::run(s, app_data_dir, rx).await;
            }
        });

        let s3 = Arc::clone(&state);
        service_manager.register("server_push", move |rx| {
            let s = Arc::clone(&s3);
            async move {
                cfms_service::connection::server_push::run(s, rx).await;
            }
        });

        let s_reconnect = Arc::clone(&state);
        service_manager.register("connection_reconnect", move |rx| {
            let s = Arc::clone(&s_reconnect);
            async move {
                cfms_service::connection::run(s, rx).await;
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
                cfms_service::transfers::download_queue::run(s, t, a, rx).await;
            }
        });
    }

    // --- Wrap service manager in Arc<Mutex<Option<...>>> ---
    // This lets us activate it from the async runtime while also
    // storing it in Tauri managed state for later shutdown.
    let sm: Arc<tokio::sync::Mutex<Option<ServiceManager>>> =
        Arc::new(tokio::sync::Mutex::new(Some(service_manager)));

    // Activate on the Tauri async runtime.
    if !reset_recovery_mode {
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
        public_keys: Arc::new(public_key_auth::PublicKeyState::default()),
        inner: state,
        tasks,
        upload_tasks,
        settings,
        active_downloads,
        active_uploads,
        connect_attempts: ConnectAttemptRegistry::default(),
        localizer,
        pending_update,
        #[cfg(target_os = "android")]
        pending_mobile_update,
        app_data_dir: app_data_dir.clone(),
        service_manager: sm,
    });

    if !reset_recovery_mode {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(commands::upload_tasks::run_upload_queue(handle));
    }

    let main_window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "main")
        .cloned()
        .ok_or_else(|| std::io::Error::other("Main window configuration is missing"))?;
    let main_window = tauri::WebviewWindowBuilder::from_config(app.handle(), &main_window_config)?;
    #[cfg(target_os = "windows")]
    let main_window = main_window.transparent(true);
    main_window.build()?;

    tracing::info!("CFMS Client initialized successfully");
    Ok(())
}
