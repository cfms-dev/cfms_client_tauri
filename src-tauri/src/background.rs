//! Mobile background service implementation.
//!
//! Implements the [`BackgroundService`] trait from `tauri-plugin-background-service`
//! to keep the CFMS client alive on Android (foreground service) and iOS
//! (BGAppRefreshTask / BGProcessingTask).
//!
//! On desktop platforms this simply spawns a Tokio task — the real keep-alive
//! benefit is on mobile where the OS would otherwise suspend the app.

use async_trait::async_trait;
use tauri::Runtime;
use tauri_plugin_background_service::{BackgroundService, ServiceContext, ServiceError};

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

    /// Main service loop. Runs until the OS kills the foreground service or
    /// the Tauri app explicitly calls `stopService()`.
    ///
    /// The actual CFMS workers are owned by `ServiceManager` in `lib.rs`.
    /// This plugin hook only keeps the mobile foreground/background service
    /// alive so the existing runtime tasks can continue to make progress.
    async fn run(&mut self, ctx: &ServiceContext<R>) -> Result<(), ServiceError> {
        tracing::info!("CFMS background service running");
        ctx.shutdown.cancelled().await;
        tracing::info!("CFMS background service shutdown requested");
        Ok(())
    }
}
