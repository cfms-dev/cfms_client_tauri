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

use cfms_core::{DownloadTaskStatus, ServiceEvent};

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

    // --- Phase 1: DOWNLOADING ---
    let _ = store.update_status(&task_id, DownloadTaskStatus::Downloading);
    let _ = state.event_tx.send(ServiceEvent::DownloadProgress {
        task_id: task_id.clone(),
        phase: "downloading".into(),
        current: 0,
        total: 0,
    });

    // For now, the actual download logic is a placeholder.  The full
    // implementation in Phase 3 will:
    // 1. Get a connection from state.conn
    // 2. Call cfms_transfer::download::receive() with progress callback
    // 3. The progress callback updates the DB and emits events

    tracing::info!("Download started: {task_id} → {file_path}");

    // Simulate: check cancellation, then complete.
    // In the full implementation, this is replaced with the actual
    // cfms_transfer::download::receive() call.
    let success = simulate_download(&task_id, &state, &cancel_flag).await;

    if !success {
        // Download was cancelled.
        let _ = store.update_status(&task_id, DownloadTaskStatus::Cancelled);
        let _ = state.event_tx.send(ServiceEvent::DownloadCancelled {
            task_id: task_id.clone(),
        });
        return;
    }

    // --- Phase 2: COMPLETED ---
    if let Err(e) = store.mark_completed(&task_id, 0) {
        tracing::error!("Failed to mark task {task_id} as completed: {e}");
    }

    let _ = state.event_tx.send(ServiceEvent::DownloadCompleted {
        task_id: task_id.clone(),
        file_path,
    });

    tracing::info!("Download completed: {task_id}");
}

/// Placeholder: simulate a download with progress updates and cancellation
/// checks.  This will be replaced with the real `cfms_transfer` call in
/// a future Phase.
async fn simulate_download(
    task_id: &str,
    state: &AppState,
    cancel_flag: &AtomicBool,
) -> bool {
    let total: u64 = 100 * 1024 * 1024; // simulate 100 MiB
    let chunks: u64 = 10;
    let chunk_size: u64 = total / chunks;

    for i in 0..chunks {
        // Check cancellation before each chunk.
        if cancel_flag.load(Ordering::SeqCst) {
            tracing::info!("Download {task_id} cancelled at chunk {i}/{chunks}");
            return false;
        }

        let current = (i + 1) * chunk_size;
        let _ = state.event_tx.send(ServiceEvent::DownloadProgress {
            task_id: task_id.to_string(),
            phase: "downloading".into(),
            current,
            total,
        });

        // Simulate I/O work.
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    true
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
