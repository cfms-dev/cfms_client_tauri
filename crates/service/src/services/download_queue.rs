//! Download queue service — processes the persistent download task queue.
//!
//! Runs every 1 second.  On each tick it:
//!
//! 1. Promotes SCHEDULED tasks whose scheduled_time has elapsed to PENDING.
//! 2. Starts new downloads up to `max_concurrent`.
//! 3. Downloads are spawned as independent Tokio tasks that report progress
//!    via the event broadcast channel.
//!
//! # State machine
//!
//! ```text
//! PENDING ──► DOWNLOADING ──► DECRYPTING ──► VERIFYING ──► COMPLETED
//!    ▲            │               │               │
//!    │            ▼               ▼               ▼
//!    └── (retry)  FAILED         FAILED          FAILED
//!    │
//! PAUSED ──► PENDING (on resume)
//!
//! Any non-terminal state ──► CANCELLED
//! SCHEDULED ──► PENDING (when scheduled_time elapses)
//! ```

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::watch;

use cfms_core::{DownloadPhase, DownloadTaskStatus, ServiceEvent};

use crate::db::tasks::TaskStore;
use crate::state::AppState;

/// Queue check interval.
pub const INTERVAL: Duration = Duration::from_secs(1);

/// Maximum concurrent downloads.
const MAX_CONCURRENT: usize = 3;

/// Tracks an active download's cancellation state.
struct ActiveDownload {
    /// Set to `true` to request cancellation.
    cancel_flag: Arc<AtomicBool>,
}

/// Shared registry of active downloads (keyed by task_id).
///
/// Tracks cancellation flags for in-flight downloads so that external
/// callers (e.g. Tauri commands) can request cancellation.
#[derive(Clone)]
pub struct ActiveRegistry {
    inner: Arc<Mutex<HashMap<String, ActiveDownload>>>,
}

impl ActiveRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn register(&self, task_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        let mut map = self.inner.lock().unwrap();
        map.insert(
            task_id.to_string(),
            ActiveDownload {
                cancel_flag: flag.clone(),
            },
        );
        flag
    }

    fn unregister(&self, task_id: &str) {
        let mut map = self.inner.lock().unwrap();
        map.remove(task_id);
    }

    fn cancel(&self, task_id: &str) -> bool {
        let map = self.inner.lock().unwrap();
        if let Some(ad) = map.get(task_id) {
            ad.cancel_flag.store(true, Ordering::SeqCst);
            true
        } else {
            false
        }
    }

    fn count(&self) -> usize {
        self.inner.lock().unwrap().len()
    }
}

/// Run the download queue processing loop.
pub async fn run(
    state: Arc<AppState>,
    store: TaskStore,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    // Crash recovery: reset tasks that were in-flight when the app exited.
    match store.reset_in_flight() {
        Ok(n) if n > 0 => tracing::info!("Reset {n} in-flight download tasks to pending"),
        Err(e) => tracing::error!("Failed to reset in-flight tasks: {e}"),
        _ => {}
    }

    let active = ActiveRegistry::new();

    loop {
        if *shutdown_rx.borrow() {
            break;
        }

        tick(&state, &store, &active).await;

        tokio::select! {
            _ = tokio::time::sleep(INTERVAL) => {},
            _ = shutdown_rx.changed() => { break; }
        }
    }

    // Shutdown: request cancellation of all active downloads.
    tracing::info!("DownloadQueueService shutting down…");
    {
        let map = active.inner.lock().unwrap();
        for (task_id, ad) in map.iter() {
            ad.cancel_flag.store(true, Ordering::SeqCst);
            tracing::info!("Cancelled active download: {task_id}");
        }
    }
    // Give active downloads a brief window to finish.
    tokio::time::sleep(Duration::from_secs(3)).await;
    tracing::info!("DownloadQueueService stopped");
}

/// One processing tick.
async fn tick(state: &Arc<AppState>, store: &TaskStore, active: &ActiveRegistry) {
    // 1. Promote scheduled tasks whose time has come.
    if let Err(e) = store.promote_scheduled() {
        tracing::error!("Failed to promote scheduled tasks: {e}");
    }

    // 2. Check available slots.
    let active_count = active.count();
    if active_count >= MAX_CONCURRENT {
        return;
    }

    // 3. Get pending tasks (already sorted by priority DESC).
    let pending = match store.pending_tasks() {
        Ok(tasks) => tasks,
        Err(e) => {
            tracing::error!("Failed to list pending tasks: {e}");
            return;
        }
    };

    // 4. Start new downloads up to the concurrency limit.
    let slots = MAX_CONCURRENT - active_count;
    for task in pending.into_iter().take(slots) {
        // Skip if this task was cancelled between ticks.
        if task.status == DownloadTaskStatus::Cancelled {
            continue;
        }

        let cancel_flag = active.register(&task.task_id);

        // Mark as downloading in the DB.
        if let Err(e) = store.mark_started(&task.task_id) {
            tracing::error!("Failed to mark task {} as started: {e}", task.task_id);
            active.unregister(&task.task_id);
            continue;
        }

        // Spawn the download as an independent Tokio task.
        let state = Arc::clone(state);
        let store = store.clone();
        let active = active.clone();
        let task_id = task.task_id.clone();
        let file_path = task.file_path.clone();

        tokio::spawn(async move {
            let tid = task_id.clone();
            execute_download(tid.clone(), file_path, state, store, cancel_flag).await;
            active.unregister(&tid);
        });
    }
}

/// Execute a single download from start to finish.
///
/// This function drives the download through the state machine, reporting
/// progress and persisting status changes to the database.
///
/// Mirrors the Python reference [`DownloadManagerService._download_task`]
/// found in `reference/src/include/classes/services/download.py`.
async fn execute_download(
    task_id: String,
    file_path: String,
    state: Arc<AppState>,
    store: TaskStore,
    cancel_flag: Arc<AtomicBool>,
) {
    // Check cancellation before starting.
    if cancel_flag.load(Ordering::SeqCst) {
        let _ = store.update_status(&task_id, DownloadTaskStatus::Cancelled);
        return;
    }

    // --- Phase 1: Obtain a connection ---
    //
    // The Python reference creates a fresh connection per download via
    // `get_connection()`.  In the Rust client we reuse the shared multiplexed
    // connection stored in `AppState.conn` — each download opens its own
    // virtual stream through `Connection::create_stream()`.
    let conn = {
        let guard = state.conn.read().await;
        match guard.as_ref() {
            Some(c) => c.clone(),
            None => {
                tracing::error!("Download {task_id}: no active connection");
                let _ = store.mark_failed(&task_id, "No active connection to server");
                let _ = state.event_tx.send(ServiceEvent::DownloadFailed {
                    task_id: task_id.clone(),
                    error: "No active connection to server".into(),
                });
                return;
            }
        }
    };

    // --- Phase 2: DOWNLOADING ---
    let _ = store.update_status(&task_id, DownloadTaskStatus::Downloading);
    let _ = state.event_tx.send(ServiceEvent::DownloadProgress {
        task_id: task_id.clone(),
        phase: "downloading".into(),
        current: 0,
        total: 0,
    });

    tracing::info!("Download started: {task_id} → {file_path}");

    // Progress callback invoked by `cfms_transfer::download::receive()` at
    // each stage.  Updates the database and emits events so the frontend can
    // show a real-time progress bar and the current phase label.
    let store_for_progress = store.clone();
    let state_for_progress = state.clone();
    let tid = task_id.clone();

    let on_progress = move |phase: DownloadPhase, current: u64, total: u64| {
        let status = download_phase_to_status(phase);
        let _ = store_for_progress.update_progress(&tid, status, current, total);
        let _ = state_for_progress.event_tx.send(ServiceEvent::DownloadProgress {
            task_id: tid.clone(),
            phase: phase_to_str(phase).to_string(),
            current,
            total,
        });
    };

    let dest = std::path::Path::new(&file_path);

    // Race the actual download against the cancellation flag so the user can
    // abort an in-progress transfer without waiting for the current chunk.
    let result: Option<cfms_core::Result<()>> = tokio::select! {
        r = cfms_transfer::download::receive(&conn, &task_id, dest, &on_progress) => {
            Some(r)
        }
        _ = wait_for_cancellation(cancel_flag.clone()) => {
            None
        }
    };

    match result {
        // --- Success ---
        Some(Ok(())) => {
            if let Err(e) = store.mark_completed(&task_id, 0) {
                tracing::error!("Failed to mark task {task_id} as completed: {e}");
            }

            let _ = state.event_tx.send(ServiceEvent::DownloadCompleted {
                task_id: task_id.clone(),
                file_path,
            });

            tracing::info!("Download completed: {task_id}");
        }

        // --- Error (retry or fail) ---
        Some(Err(e)) => {
            let error_msg = e.to_string();
            tracing::error!("Download {task_id} failed: {error_msg}");

            match store.retry_or_fail(&task_id, &error_msg) {
                Ok(DownloadTaskStatus::Failed) => {
                    let _ = state.event_tx.send(ServiceEvent::DownloadFailed {
                        task_id: task_id.clone(),
                        error: error_msg,
                    });
                }
                Ok(_) => {
                    // Task was reset to Pending for a retry on the next tick.
                    tracing::info!("Download {task_id} will be retried: {error_msg}");
                }
                Err(db_err) => {
                    tracing::error!(
                        "Failed to update retry state for {task_id}: {db_err}"
                    );
                }
            }
        }

        // --- Cancelled (select! raced to the cancel signal) ---
        None => {
            // Clean up the partial destination file if one was created.
            if let Err(e) = std::fs::remove_file(&file_path) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!("Failed to clean up partial file {file_path}: {e}");
                }
            }

            let _ = store.update_status(&task_id, DownloadTaskStatus::Cancelled);
            let _ = state.event_tx.send(ServiceEvent::DownloadCancelled {
                task_id: task_id.clone(),
            });

            tracing::info!("Download cancelled: {task_id}");
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Map a [`DownloadPhase`] to the corresponding [`DownloadTaskStatus`].
///
/// The Python reference maps:
/// - stage 0 (Downloading) → `DownloadTaskStatus.DOWNLOADING`
/// - stage 1 (Decrypting) → `DownloadTaskStatus.DECRYPTING`
/// - stage 2 (Cleaning)  → `DownloadTaskStatus.VERIFYING`
/// - stage 3 (Verifying) → `DownloadTaskStatus.VERIFYING`
fn download_phase_to_status(phase: DownloadPhase) -> DownloadTaskStatus {
    match phase {
        DownloadPhase::Downloading => DownloadTaskStatus::Downloading,
        DownloadPhase::Decrypting => DownloadTaskStatus::Decrypting,
        DownloadPhase::Cleaning | DownloadPhase::Verifying => DownloadTaskStatus::Verifying,
    }
}

/// Human-readable label for a download phase (used in frontend progress events).
fn phase_to_str(phase: DownloadPhase) -> &'static str {
    match phase {
        DownloadPhase::Downloading => "downloading",
        DownloadPhase::Decrypting => "decrypting",
        DownloadPhase::Cleaning => "cleaning",
        DownloadPhase::Verifying => "verifying",
    }
}

/// Returns when the cancellation flag is set to `true`.
///
/// Polls periodically so the runtime can still make progress on other tasks
/// while waiting for a cancellation signal.
async fn wait_for_cancellation(flag: Arc<AtomicBool>) {
    loop {
        if flag.load(Ordering::SeqCst) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

// ---------------------------------------------------------------------------
// Queue management operations (called from Tauri commands)
// ---------------------------------------------------------------------------

/// Add a new task to the download queue.
pub fn add_task(store: &TaskStore, task: cfms_core::DownloadTaskDto) -> cfms_core::Result<()> {
    store.insert(&task)
}

/// Pause a download task.
pub fn pause_task(store: &TaskStore, task_id: &str) -> cfms_core::Result<bool> {
    let task = match store.get(task_id)? {
        Some(t) => t,
        None => return Ok(false),
    };
    if !task.status.is_active() {
        return Ok(false);
    }
    store.update_status(task_id, DownloadTaskStatus::Paused)?;
    Ok(true)
}

/// Resume a paused download task.
pub fn resume_task(store: &TaskStore, task_id: &str) -> cfms_core::Result<bool> {
    let task = match store.get(task_id)? {
        Some(t) => t,
        None => return Ok(false),
    };
    if task.status != DownloadTaskStatus::Paused {
        return Ok(false);
    }
    store.update_status(task_id, DownloadTaskStatus::Pending)?;
    Ok(true)
}

/// Cancel a download task.
pub fn cancel_task(
    store: &TaskStore,
    active: &ActiveRegistry,
    task_id: &str,
) -> cfms_core::Result<bool> {
    let task = match store.get(task_id)? {
        Some(t) => t,
        None => return Ok(false),
    };
    if task.status.is_terminal() {
        return Ok(false);
    }
    // If the task is currently active, set the cancellation flag.
    if task.status.is_active() {
        active.cancel(task_id);
    }
    store.update_status(task_id, DownloadTaskStatus::Cancelled)?;
    Ok(true)
}
