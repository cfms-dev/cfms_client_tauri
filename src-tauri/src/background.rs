//! Background service implementation for mobile platforms.
//!
//! Implements the [`BackgroundService`] trait from `tauri-plugin-background-service`
//! to keep the CFMS client alive on Android (foreground service) and iOS
//! (BGAppRefreshTask / BGProcessingTask).
//!
//! ## What runs here vs. what runs in `lib.rs`
//!
//! `lib.rs::setup()` creates a [`ServiceManager`] and activates it on the Tauri
//! async runtime.  Those Tokio tasks keep running as long as the *process* is
//! alive.  On desktop that is always true; on mobile the OS can suspend or
//! outright kill the process when the app backgrounds.
//!
//! This module owns the [`BackgroundService`] hook that prevents that
//! suspension on mobile: while [`CfmsBackgroundService::run`] is active the
//! platform keeps the process in the foreground-service state.  Additionally,
//! `run` re-derives any lightweight periodic work that must survive a cold
//! OS-restart of the background service (where `lib.rs::setup()` may have run
//! again without a visible UI).

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tauri::{Emitter, Manager, Runtime};
use tauri_plugin_background_service::{BackgroundService, ServiceContext, ServiceError};
use tokio::task::JoinSet;

use crate::AppHandleState;

/// Interval between token liveness heartbeat ticks inside the background service.
const TOKEN_CHECK_INTERVAL: Duration = Duration::from_secs(60);

/// Foreground-service wrapper that keeps CFMS background tasks alive on mobile.
pub struct CfmsBackgroundService;

impl CfmsBackgroundService {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl<R: Runtime> BackgroundService<R> for CfmsBackgroundService {
    /// One-time setup — called each time the service starts (including after
    /// an OS-restart on Android where the Rust process is fresh).
    async fn init(&mut self, _ctx: &ServiceContext<R>) -> Result<(), ServiceError> {
        tracing::info!(
            "CFMS background service initialising (platform: {})",
            std::env::consts::OS,
        );

        // On Android a persistent foreground notification is required immediately.
        #[cfg(target_os = "android")]
        {
            _ctx.notifier
                .show("CFMS Client", "Background service is running")
                .await
                .map_err(|e| ServiceError::Other(e.to_string()))?;
        }

        Ok(())
    }

    /// Main service loop — keeps the platform foreground service alive and
    /// spawns lightweight watchdog tasks for the duration.
    ///
    /// The heavy lifting (token refresh, download queue, lockdown monitor) is
    /// owned by the [`ServiceManager`] started in `lib.rs`.  This method
    /// ensures the platform does not suspend those tasks by holding the
    /// foreground-service lock, and adds a periodic heartbeat that is cheap to
    /// re-create when the process was cold-started for this service.
    async fn run(&mut self, ctx: &ServiceContext<R>) -> Result<(), ServiceError> {
        tracing::info!("CFMS background service running");

        let app_handle = ctx.app.clone();
        let shutdown = ctx.shutdown.clone();

        let mut handles: JoinSet<()> = JoinSet::new();

        // --- Token liveness heartbeat (every 60 s) ---
        //
        // The actual token refresh logic lives in
        // `crates/service/src/services/token_refresh.rs` (Rust-native, no
        // frontend round-trip needed).  This task emits a lightweight
        // `background:tick` event so the frontend can re-validate auth state
        // after returning from background (e.g. re-fetch server state).
        {
            let app_handle = app_handle.clone();
            let shutdown = shutdown.clone();
            handles.spawn(async move {
                let mut interval = tokio::time::interval(TOKEN_CHECK_INTERVAL);
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

                loop {
                    tokio::select! {
                        _ = shutdown.cancelled() => break,
                        _ = interval.tick() => {
                            let state = app_handle.state::<AppHandleState>();

                            // Only heartbeat when a session is active.
                            let has_token = state
                                .inner
                                .token
                                .try_read()
                                .map(|t| t.is_some())
                                .unwrap_or(false);

                            if has_token {
                                tracing::debug!(
                                    "Background: triggering token refresh heartbeat"
                                );
                                let _ = app_handle.emit("background:tick", "token_refresh");
                            }
                        }
                    }
                }
            });
        }

        // --- Ensure ServiceManager is activated (cold-start guard) ---
        //
        // On a cold OS-restart the async `activate()` spawned in lib.rs may not
        // have fired yet.  Nudge it here so the heavy services start even in
        // that edge case.
        {
            let state = app_handle.state::<AppHandleState>();
            let sm = Arc::clone(&state.service_manager);
            handles.spawn(async move {
                let mut guard = sm.lock().await;
                if let Some(ref mut mgr) = *guard {
                    if !mgr.is_active() {
                        tracing::info!(
                            "Background: activating ServiceManager (cold-start path)"
                        );
                        mgr.activate();
                    }
                }
            });
        }

        // Hold the foreground-service lock until shutdown is requested.
        shutdown.cancelled().await;
        tracing::info!("CFMS background service: shutdown requested — stopping watchdog tasks");
        handles.abort_all();
        while handles.join_next().await.is_some() {}

        tracing::info!("CFMS background service stopped");
        Ok(())
    }
}
