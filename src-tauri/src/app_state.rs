//! Native application state and connection-attempt coordination.
#[cfg(target_os = "android")]
use crate::commands;
use cfms_service::runtime::manager::ServiceManager;

use crate::{ActiveUploadRegistry, localization::LocalizationManager, public_key_auth};
use cfms_service::db::settings::SettingsStore;
use cfms_service::state::AppState;
use cfms_service::transfers::download_queue::{ActiveRegistry, QueueState};
use cfms_service::transfers::upload_queue::UploadQueueState;
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};
use tokio::sync::watch;

struct ActiveConnectAttempt {
    id: u64,
    control_tx: watch::Sender<bool>,
}

/// Coordinates the single connection attempt allowed to run at a time.
///
/// A monotonically increasing id prevents a superseded attempt from storing
/// its connection after a newer attempt has started or cancellation won the
/// completion race.
#[derive(Clone, Default)]
pub struct ConnectAttemptRegistry {
    inner: Arc<Mutex<Option<ActiveConnectAttempt>>>,
    next_id: Arc<AtomicU64>,
}

impl ConnectAttemptRegistry {
    pub fn register(&self) -> (u64, watch::Receiver<bool>) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (control_tx, control_rx) = watch::channel(false);
        let mut active = self.inner.lock().unwrap();
        if let Some(previous) = active.replace(ActiveConnectAttempt { id, control_tx }) {
            let _ = previous.control_tx.send(true);
        }
        (id, control_rx)
    }

    pub fn cancel(&self) -> bool {
        let active = self.inner.lock().unwrap();
        active
            .as_ref()
            .is_some_and(|attempt| attempt.control_tx.send(true).is_ok())
    }

    pub fn claim_completion(&self, id: u64) -> bool {
        let mut active = self.inner.lock().unwrap();
        let can_complete = active
            .as_ref()
            .is_some_and(|attempt| attempt.id == id && !*attempt.control_tx.borrow());
        if can_complete {
            active.take();
        }
        can_complete
    }

    pub fn unregister(&self, id: u64) {
        let mut active = self.inner.lock().unwrap();
        if active.as_ref().is_some_and(|attempt| attempt.id == id) {
            active.take();
        }
    }
}

#[cfg(test)]
mod connect_attempt_registry_tests {
    use super::ConnectAttemptRegistry;

    #[test]
    fn cancellation_signals_the_attempt_and_blocks_completion() {
        let registry = ConnectAttemptRegistry::default();
        let (id, cancel_rx) = registry.register();

        assert!(registry.cancel());
        assert!(*cancel_rx.borrow());
        assert!(!registry.claim_completion(id));

        registry.unregister(id);
        assert!(!registry.cancel());
    }

    #[test]
    fn a_new_attempt_supersedes_the_previous_one() {
        let registry = ConnectAttemptRegistry::default();
        let (first_id, first_cancel_rx) = registry.register();
        let (second_id, second_cancel_rx) = registry.register();

        assert!(*first_cancel_rx.borrow());
        assert!(!*second_cancel_rx.borrow());
        assert!(!registry.claim_completion(first_id));
        assert!(registry.claim_completion(second_id));
    }
}

// ---------------------------------------------------------------------------
// Tauri managed state
// ---------------------------------------------------------------------------

/// The shared application state managed by Tauri and accessible from every
/// `#[tauri::command]` via `tauri::State<'_, AppHandleState>`.
pub struct AppHandleState {
    pub public_keys: Arc<public_key_auth::PublicKeyState>,
    /// Shared in-memory application state (auth, DEK, lockdown, events).
    pub inner: Arc<AppState>,

    /// In-memory download task queue.  Tasks are persisted to encrypted JSON
    /// files per-user (see `cfms_service::transfers::task_persistence`).
    pub tasks: QueueState,

    /// Encrypted per-user upload task metadata and recovery records.
    pub upload_tasks: UploadQueueState,

    /// User settings (key-value, SQLite-backed).
    pub settings: SettingsStore,

    /// Registry of active downloads (cancellation flags).
    pub active_downloads: ActiveRegistry,

    /// Registry of active uploads (pause/cancel flags).
    pub active_uploads: ActiveUploadRegistry,

    /// Cancellation state for the connection currently being established.
    pub connect_attempts: ConnectAttemptRegistry,

    /// Backend localization state (Fluent-backed).
    pub localizer: Arc<LocalizationManager>,

    /// Pending application update selected by the most recent updater check.
    pub pending_update: Arc<Mutex<Option<tauri_plugin_updater::Update>>>,

    /// Pending Android APK update selected by the most recent updater check.
    #[cfg(target_os = "android")]
    pub pending_mobile_update: Arc<Mutex<Option<commands::update_types::MobileAppUpdate>>>,

    /// Application data directory (for persistence file paths).
    pub app_data_dir: PathBuf,

    /// Background service manager.  Wrapped in Arc+Mutex so it can be
    /// activated on the async runtime and later shut down.
    pub service_manager: Arc<tokio::sync::Mutex<Option<ServiceManager>>>,
}
