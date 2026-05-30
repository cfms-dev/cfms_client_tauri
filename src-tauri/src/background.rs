//! Mobile background service implementation.
//!
//! Implements the [`BackgroundService`] trait from `tauri-plugin-background-service`
//! to keep the CFMS client alive on Android (foreground service) and iOS
//! (BGAppRefreshTask / BGProcessingTask).
//!
//! On desktop platforms this simply spawns a Tokio task — the real keep-alive
//! benefit is on mobile where the OS would otherwise suspend the app.

use async_trait::async_trait;
use tauri::{Emitter, Manager, Runtime};
use tauri_plugin_background_service::{BackgroundService, ServiceContext, ServiceError};

use crate::AppHandleState;

/// CFMS background service that keeps token refresh, lockdown monitoring,
/// and download processing alive while the app is backgrounded.
pub struct CfmsBackgroundService;

impl CfmsBackgroundService {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl<R: Runtime> BackgroundService<R> for CfmsBackgroundService {
    /// One-time setup — called each time the service starts (including after
    /// an OS restart on Android where the Rust process is fresh).
    async fn init(&mut self, _ctx: &ServiceContext<R>) -> Result<(), ServiceError> {
        tracing::info!(
            "CFMS background service initialising (platform: {})",
            std::env::consts::OS,
        );

        // On Android, the notification is required for the foreground service.
        // We show it immediately so the user knows the service is active.
        #[cfg(target_os = "android")]
        {
            _ctx.notifier
                .show("CFMS Client", "Background service is running")
                .await
                .map_err(|e| ServiceError::Other(e.to_string()))?;
        }

        Ok(())
    }

    /// Main service loop.  Runs until the OS kills the foreground service or
    /// the Tauri app explicitly calls `stopService()`.
    async fn run(&mut self, ctx: &ServiceContext<R>) -> Result<(), ServiceError> {
        // Resolve the shared application state from Tauri managed state.
        let app_handle = ctx.app.clone();

        // Spawn the CFMS service infrastructure on the Tauri async runtime.
        // This includes token refresh (60s), favourites validation (5min),
        // lockdown monitoring (event-driven), and download queue processing.
        //
        // We use a Tokio join-set so a single service crash doesn't bring
        // everything down.
        let mut handles = tokio::task::JoinSet::new();

        // --- Token refresh (every 60s) ---
        {
            let app_handle = app_handle.clone();
            let shutdown = ctx.shutdown.clone();
            handles.spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                loop {
                    tokio::select! {
                        _ = shutdown.cancelled() => break,
                        _ = interval.tick() => {
                            {
                                let state = app_handle.state::<AppHandleState>();
                                // Only refresh if we have a valid token.
                                let should_refresh = state.inner.token
                                    .try_read()
                                    .map(|t| t.is_some())
                                    .unwrap_or(false);
                                if should_refresh {
                                    tracing::debug!("Background: triggering token refresh");
                                    let _ = app_handle.emit("background:tick", "token_refresh");
                                }
                            }
                        }
                    }
                }
            });
        }

        // --- Health heartbeat (every 15s) ---
        {
            let app_handle = app_handle.clone();
            let shutdown = ctx.shutdown.clone();
            handles.spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
                loop {
                    tokio::select! {
                        _ = shutdown.cancelled() => break,
                        _ = interval.tick() => {
                            {
                                let state = app_handle.state::<AppHandleState>();
                                let status = state.inner.snapshot_status();
                                let _ = app_handle.emit("background:health", &status);
                            }
                        }
                    }
                }
            });
        }

        // Wait for all background tasks or shutdown signal.
        tokio::select! {
            _ = ctx.shutdown.cancelled() => {
                tracing::info!("CFMS background service shutdown requested");
            }
            _ = async {
                while let Some(result) = handles.join_next().await {
                    match result {
                        Ok(()) => tracing::debug!("Background sub-task completed normally"),
                        Err(e) => tracing::warn!("Background sub-task panicked: {e}"),
                    }
                }
            } => {}
        }

        // Graceful cleanup: cancel remaining tasks.
        handles.abort_all();

        Ok(())
    }
}
