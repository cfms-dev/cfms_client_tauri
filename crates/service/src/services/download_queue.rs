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
//!
//! # Task storage
//!
//! Task metadata lives in an in-memory `HashMap` and is persisted to an
//! encrypted JSON file (see [`super::task_persistence`]) after every change.
//! Tasks are **not** loaded at app startup — [`QueueState::load_for_user`]
//! must be called after successful login (when the DEK becomes available).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::watch;

use cfms_core::constants::KEY_LEN;
use cfms_core::{DownloadPhase, DownloadTaskDto, DownloadTaskStatus, Result, ServiceEvent};

use crate::services::task_persistence;
use crate::state::AppState;

/// Queue check interval.
pub const INTERVAL: Duration = Duration::from_secs(1);

/// Maximum concurrent downloads.
const MAX_CONCURRENT: usize = 3;

/// Statuses that count toward the navigation badge (non-terminal, actively
/// queued/running).  Mirrors `_ACTIVE_BADGE_STATUSES` in the Python reference.
#[allow(dead_code)]
const ACTIVE_BADGE_STATUSES: &[DownloadTaskStatus] = &[
    DownloadTaskStatus::Pending,
    DownloadTaskStatus::Downloading,
    DownloadTaskStatus::Decrypting,
    DownloadTaskStatus::Verifying,
    DownloadTaskStatus::Scheduled,
];

// ---------------------------------------------------------------------------
// QueueState — shared in-memory task store with JSON persistence
// ---------------------------------------------------------------------------

/// The shared, thread-safe download task queue.
///
/// Tasks are held in memory (matching the Python reference's
/// `self.tasks: Dict[str, DownloadTask]`) and persisted to an encrypted
/// JSON file after every mutation.
///
/// # Lifecycle
///
/// 1. Created at app startup (empty).
/// 2. After login, [`load_for_user`](QueueState::load_for_user) populates it
///    from the encrypted JSON file and stores the persistence context.
/// 3. Every mutation (add, status change, remove) triggers a save.
/// 4. On logout, tasks should be cleared and the context reset.
#[derive(Clone)]
pub struct QueueState {
    /// In-memory task map, keyed by `task_id`.
    tasks: Arc<Mutex<HashMap<String, DownloadTaskDto>>>,

    /// Persistence directory (app data).  `None` until login.
    persist_dir: Arc<Mutex<Option<PathBuf>>>,

    /// Server hash for the current connection.  `None` until login.
    persist_server_hash: Arc<Mutex<Option<String>>>,

    /// Username for the current session.  `None` until login.
    persist_username: Arc<Mutex<Option<String>>>,

    /// Data Encryption Key.  `None` until login.
    persist_dek: Arc<Mutex<Option<[u8; KEY_LEN]>>>,
}

impl Default for QueueState {
    fn default() -> Self {
        Self::new()
    }
}

impl QueueState {
    /// Create an empty queue with no persistence context.
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
            persist_dir: Arc::new(Mutex::new(None)),
            persist_server_hash: Arc::new(Mutex::new(None)),
            persist_username: Arc::new(Mutex::new(None)),
            persist_dek: Arc::new(Mutex::new(None)),
        }
    }

    // ------------------------------------------------------------------
    // Persistence lifecycle
    // ------------------------------------------------------------------

    /// Set up the persistence context and load tasks for the current user.
    ///
    /// Must be called after successful login.  Performs crash recovery:
    /// tasks that were `downloading`/`decrypting` are reset to `pending`.
    ///
    /// Returns the number of tasks loaded.
    pub fn load_for_user(
        &self,
        app_data: &std::path::Path,
        server_hash: &str,
        username: &str,
        dek: Option<&[u8; KEY_LEN]>,
    ) -> Result<usize> {
        // Store persistence context.
        {
            let mut d = self.persist_dir.lock().unwrap();
            *d = Some(app_data.to_path_buf());
        }
        {
            let mut h = self.persist_server_hash.lock().unwrap();
            *h = Some(server_hash.to_string());
        }
        {
            let mut u = self.persist_username.lock().unwrap();
            *u = Some(username.to_string());
        }
        {
            let mut k = self.persist_dek.lock().unwrap();
            *k = dek.cloned();
        }

        // Load from disk.
        let loaded = task_persistence::load(app_data, server_hash, username, dek)?;
        let count = loaded.len();

        {
            let mut map = self.tasks.lock().unwrap();
            map.clear();
            for t in loaded {
                map.insert(t.task_id.clone(), t);
            }
        }

        tracing::info!("Loaded {count} download tasks for user {username} on server {server_hash}");
        Ok(count)
    }

    /// Clear all in-memory tasks and reset the persistence context.
    ///
    /// Called on logout so the queue is empty for the next user.
    pub fn clear(&self) {
        {
            let mut map = self.tasks.lock().unwrap();
            map.clear();
        }
        {
            let mut d = self.persist_dir.lock().unwrap();
            *d = None;
        }
        {
            let mut h = self.persist_server_hash.lock().unwrap();
            *h = None;
        }
        {
            let mut u = self.persist_username.lock().unwrap();
            *u = None;
        }
        {
            let mut k = self.persist_dek.lock().unwrap();
            *k = None;
        }
    }

    /// Persist the current task list to the encrypted JSON file.
    ///
    /// This is called automatically after every mutation.  It is a no-op
    /// if the persistence context hasn't been set (i.e. before login).
    fn save(&self) {
        let (dir, hash, user, dek) = {
            let d = self.persist_dir.lock().unwrap();
            let h = self.persist_server_hash.lock().unwrap();
            let u = self.persist_username.lock().unwrap();
            let k = self.persist_dek.lock().unwrap();
            (d.clone(), h.clone(), u.clone(), *k)
        };

        let (Some(dir), Some(hash), Some(user)) = (dir, hash, user) else {
            // Persistence context not set — nothing to save.
            return;
        };

        let tasks: Vec<DownloadTaskDto> = {
            let map = self.tasks.lock().unwrap();
            map.values().cloned().collect()
        };

        if let Err(e) = task_persistence::save(&dir, &hash, &user, dek.as_ref(), &tasks) {
            tracing::error!("Failed to persist download tasks: {e}");
        }
    }

    // ------------------------------------------------------------------
    // Read operations
    // ------------------------------------------------------------------

    /// Get a single task by ID.
    pub fn get(&self, task_id: &str) -> Option<DownloadTaskDto> {
        let map = self.tasks.lock().unwrap();
        map.get(task_id).cloned()
    }

    /// Get all tasks, optionally filtered by status.
    pub fn list(&self, status_filter: Option<DownloadTaskStatus>) -> Vec<DownloadTaskDto> {
        let map = self.tasks.lock().unwrap();
        let mut tasks: Vec<DownloadTaskDto> = match status_filter {
            Some(s) => map.values().filter(|t| t.status == s).cloned().collect(),
            None => map.values().cloned().collect(),
        };
        // Sort by priority DESC, then created_at ASC (like the old SQLite query).
        tasks.sort_by(|a, b| {
            b.priority
                .cmp(&a.priority)
                .then(a.created_at.cmp(&b.created_at))
        });
        tasks
    }

    /// Get all tasks with a specific status.
    pub fn list_by_status(&self, status: DownloadTaskStatus) -> Vec<DownloadTaskDto> {
        self.list(Some(status))
    }

    /// Count tasks with a given status.
    pub fn count_by_status(&self, status: DownloadTaskStatus) -> u32 {
        let map = self.tasks.lock().unwrap();
        map.values().filter(|t| t.status == status).count() as u32
    }

    /// Count tasks in active-badge statuses.
    pub fn active_count(&self) -> u32 {
        let map = self.tasks.lock().unwrap();
        map.values()
            .filter(|t| ACTIVE_BADGE_STATUSES.contains(&t.status))
            .count() as u32
    }

    /// Get all PENDING tasks ordered by priority descending.
    pub fn pending_tasks(&self) -> Vec<DownloadTaskDto> {
        let mut tasks = self.list_by_status(DownloadTaskStatus::Pending);
        tasks.sort_by(|a, b| b.priority.cmp(&a.priority));
        tasks
    }

    // ------------------------------------------------------------------
    // Write operations
    // ------------------------------------------------------------------

    /// Insert a new download task.
    pub fn insert(&self, task: &DownloadTaskDto) -> Result<()> {
        {
            let mut map = self.tasks.lock().unwrap();
            map.insert(task.task_id.clone(), task.clone());
        }
        self.save();
        Ok(())
    }

    /// Update the status of a task.
    pub fn update_status(&self, task_id: &str, status: DownloadTaskStatus) -> Result<()> {
        {
            let mut map = self.tasks.lock().unwrap();
            if let Some(t) = map.get_mut(task_id) {
                t.status = status;
            }
        }
        self.save();
        Ok(())
    }

    /// Update progress fields for an in-flight task.
    pub fn update_progress(
        &self,
        task_id: &str,
        status: DownloadTaskStatus,
        progress: f64,
        message: &str,
        current_bytes: Option<u64>,
        total_bytes: Option<u64>,
        stage: Option<i32>,
    ) -> Result<()> {
        {
            let mut map = self.tasks.lock().unwrap();
            if let Some(t) = map.get_mut(task_id) {
                t.status = status;
                t.progress = progress;
                t.message = Some(message.to_string());
                if let Some(cb) = current_bytes {
                    t.current_bytes = cb;
                }
                if let Some(tb) = total_bytes {
                    t.total_bytes = tb;
                }
                if let Some(s) = stage {
                    t.stage = s;
                }
            }
        }
        // Don't save on every progress update — too frequent.  The save-on-change
        // pattern (on terminal states and explicit mutations) is sufficient.
        Ok(())
    }

    /// Mark a task as started (called when download begins).
    pub fn mark_started(&self, task_id: &str) -> Result<()> {
        let now = unix_now();
        {
            let mut map = self.tasks.lock().unwrap();
            if let Some(t) = map.get_mut(task_id) {
                t.started_at = Some(now);
                t.status = DownloadTaskStatus::Downloading;
            }
        }
        self.save();
        Ok(())
    }

    /// Mark a task as completed successfully.
    pub fn mark_completed(&self, task_id: &str, bytes: u64) -> Result<()> {
        let now = unix_now();
        {
            let mut map = self.tasks.lock().unwrap();
            if let Some(t) = map.get_mut(task_id) {
                t.status = DownloadTaskStatus::Completed;
                t.progress = 1.0;
                t.current_bytes = bytes;
                t.total_bytes = bytes;
                t.stage = 4;
                t.completed_at = Some(now);
            }
        }
        self.save();
        Ok(())
    }

    /// Mark a task as failed with an error message.
    pub fn mark_failed(&self, task_id: &str, error: &str) -> Result<()> {
        let now = unix_now();
        {
            let mut map = self.tasks.lock().unwrap();
            if let Some(t) = map.get_mut(task_id) {
                t.status = DownloadTaskStatus::Failed;
                t.error = Some(error.to_string());
                t.completed_at = Some(now);
            }
        }
        self.save();
        Ok(())
    }

    /// Increment retry count and reset to pending (or fail if exhausted).
    pub fn retry_or_fail(&self, task_id: &str, error: &str) -> Result<DownloadTaskStatus> {
        let status = {
            let mut map = self.tasks.lock().unwrap();
            let Some(t) = map.get_mut(task_id) else {
                return Ok(DownloadTaskStatus::Failed);
            };
            t.retry_count += 1;
            if t.retry_count > t.max_retries {
                t.status = DownloadTaskStatus::Failed;
                t.error = Some(error.to_string());
                t.completed_at = Some(unix_now());
                DownloadTaskStatus::Failed
            } else {
                t.status = DownloadTaskStatus::Pending;
                t.error = Some(error.to_string());
                DownloadTaskStatus::Pending
            }
        };
        self.save();
        Ok(status)
    }

    /// Promote all SCHEDULED tasks whose scheduled_time has passed to PENDING.
    /// Returns the number of tasks moved.
    pub fn promote_scheduled(&self) -> usize {
        let now = unix_now();
        let mut count = 0;
        {
            let mut map = self.tasks.lock().unwrap();
            for t in map.values_mut() {
                if t.status == DownloadTaskStatus::Scheduled {
                    if let Some(st) = t.scheduled_time {
                        if st <= now {
                            t.status = DownloadTaskStatus::Pending;
                            t.scheduled_time = None;
                            count += 1;
                        }
                    }
                }
            }
        }
        if count > 0 {
            self.save();
        }
        count
    }

    /// Clear tasks with terminal statuses. Returns count removed.
    pub fn clear_completed(&self) -> usize {
        let count = {
            let mut map = self.tasks.lock().unwrap();
            let before = map.len();
            map.retain(|_, t| {
                t.status != DownloadTaskStatus::Completed
                    && t.status != DownloadTaskStatus::Cancelled
            });
            before - map.len()
        };
        if count > 0 {
            self.save();
        }
        count
    }

    /// Clear failed tasks. Returns count removed.
    pub fn clear_failed(&self) -> usize {
        let count = {
            let mut map = self.tasks.lock().unwrap();
            let before = map.len();
            map.retain(|_, t| t.status != DownloadTaskStatus::Failed);
            before - map.len()
        };
        if count > 0 {
            self.save();
        }
        count
    }

    /// Delete a task by ID. Returns true if the task existed.
    pub fn delete(&self, task_id: &str) -> bool {
        let existed = {
            let mut map = self.tasks.lock().unwrap();
            map.remove(task_id).is_some()
        };
        if existed {
            self.save();
        }
        existed
    }

    /// Set the pause_position for a task.
    pub fn set_pause_position(&self, task_id: &str, position: u64) -> Result<()> {
        {
            let mut map = self.tasks.lock().unwrap();
            if let Some(t) = map.get_mut(task_id) {
                t.pause_position = Some(position);
            }
        }
        self.save();
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// ActiveRegistry
// ---------------------------------------------------------------------------

/// Tracks an active download's cancellation state and dedicated transfer
/// connection.  When the download is cancelled, the connection is closed
/// immediately — this is the *only* reliable way to abort an in-flight
/// WebSocket transfer without tearing down the command connection.
struct ActiveDownload {
    /// Set to `true` to request cancellation.
    cancel_flag: Arc<AtomicBool>,
    /// Dedicated transfer connection for this download.  `None` until the
    /// connection is established inside [`execute_download`].
    transfer_conn: Option<cfms_transport::Connection>,
}

/// Shared registry of active downloads (keyed by task_id).
///
/// Tracks cancellation flags for in-flight downloads so that external
/// callers (e.g. Tauri commands) can request cancellation.
#[derive(Clone)]
pub struct ActiveRegistry {
    inner: Arc<Mutex<HashMap<String, ActiveDownload>>>,
}

impl Default for ActiveRegistry {
    fn default() -> Self {
        Self::new()
    }
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
                transfer_conn: None,
            },
        );
        flag
    }

    /// Store the dedicated transfer connection for an active download so
    /// that [`cancel`](Self::cancel) can close it immediately.
    fn set_transfer_conn(&self, task_id: &str, conn: cfms_transport::Connection) {
        let mut map = self.inner.lock().unwrap();
        if let Some(ad) = map.get_mut(task_id) {
            ad.transfer_conn = Some(conn);
        }
    }

    fn unregister(&self, task_id: &str) {
        let mut map = self.inner.lock().unwrap();
        map.remove(task_id);
    }

    fn cancel(&self, task_id: &str) -> bool {
        let mut map = self.inner.lock().unwrap();
        if let Some(ad) = map.get_mut(task_id) {
            ad.cancel_flag.store(true, Ordering::SeqCst);
            // Immediately close the dedicated transfer connection so the
            // in-flight download's `recv()` returns `None` without waiting
            // for the cooperative cancellation poll to notice the flag.
            if let Some(conn) = ad.transfer_conn.take() {
                tokio::spawn(async move { conn.close().await });
            }
            true
        } else {
            false
        }
    }

    fn count(&self) -> usize {
        self.inner.lock().unwrap().len()
    }
}

// ---------------------------------------------------------------------------
// Main service loop
// ---------------------------------------------------------------------------

/// Run the download queue processing loop.
///
/// The service starts immediately at app launch but will have no tasks to
/// process until [`QueueState::load_for_user`] is called after login.
pub async fn run(
    state: Arc<AppState>,
    queue: QueueState,
    active: ActiveRegistry,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    // Note: we do NOT call reset_in_flight here — tasks aren't loaded yet.
    // Crash recovery happens in QueueState::load_for_user() after login.

    loop {
        if *shutdown_rx.borrow() {
            break;
        }

        tick(&state, &queue, &active).await;

        tokio::select! {
            _ = tokio::time::sleep(INTERVAL) => {},
            _ = shutdown_rx.changed() => { break; }
        }
    }

    // Shutdown: request cancellation of all active downloads and close their
    // transfer connections immediately.
    tracing::info!("DownloadQueueService shutting down…");
    {
        let mut map = active.inner.lock().unwrap();
        for (task_id, ad) in map.iter_mut() {
            ad.cancel_flag.store(true, Ordering::SeqCst);
            if let Some(conn) = ad.transfer_conn.take() {
                tokio::spawn(async move { conn.close().await });
            }
            tracing::info!("Cancelled active download: {task_id}");
        }
    }
    // Give active downloads a brief window to finish.
    tokio::time::sleep(Duration::from_secs(3)).await;
    tracing::info!("DownloadQueueService stopped");
}

/// One processing tick.
async fn tick(state: &Arc<AppState>, queue: &QueueState, active: &ActiveRegistry) {
    // 1. Promote scheduled tasks whose time has come.
    let promoted = queue.promote_scheduled();
    if promoted > 0 {
        tracing::debug!("Promoted {promoted} scheduled tasks to pending");
    }

    // 2. Check available slots.
    let active_count = active.count();
    if active_count >= MAX_CONCURRENT {
        return;
    }

    // 3. Get pending tasks (already sorted by priority DESC).
    let pending = queue.pending_tasks();

    // 4. Start new downloads up to the concurrency limit.
    let slots = MAX_CONCURRENT - active_count;
    for task in pending.into_iter().take(slots) {
        // Skip if this task was cancelled between ticks.
        if task.status == DownloadTaskStatus::Cancelled {
            continue;
        }

        let cancel_flag = active.register(&task.task_id);

        // Mark as downloading.
        if let Err(e) = queue.mark_started(&task.task_id) {
            tracing::error!("Failed to mark task {} as started: {e}", task.task_id);
            active.unregister(&task.task_id);
            continue;
        }

        // Spawn the download as an independent Tokio task.
        let state = Arc::clone(state);
        let queue = queue.clone();
        let active = active.clone();
        let task_id = task.task_id.clone();
        let file_path = task.file_path.clone();

        tokio::spawn(async move {
            let tid = task_id.clone();
            execute_download(
                tid.clone(),
                file_path,
                state,
                queue,
                active.clone(),
                cancel_flag,
            )
            .await;
            active.unregister(&tid);
        });
    }
}

/// Execute a single download from start to finish.
///
/// This function drives the download through the state machine, reporting
/// progress and persisting status changes.
///
/// # Transfer connection
///
/// Each download establishes its own dedicated WebSocket connection so that
/// cancelling a transfer can immediately tear down the connection without
/// affecting the command channel or other concurrent downloads.
///
/// Mirrors the Python reference [`DownloadManagerService._download_task`]
/// found in `reference/src/include/classes/services/download.py`.
async fn execute_download(
    task_id: String,
    file_path: String,
    state: Arc<AppState>,
    queue: QueueState,
    active: ActiveRegistry,
    cancel_flag: Arc<AtomicBool>,
) {
    // Check cancellation before starting.
    if cancel_flag.load(Ordering::SeqCst) {
        let _ = queue.update_status(&task_id, DownloadTaskStatus::Cancelled);
        return;
    }

    // --- Phase 1: Establish a dedicated transfer connection ---
    let transfer_conn = match create_transfer_connection(&state).await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Download {task_id}: failed to create transfer connection: {e}");
            let _ = queue.mark_failed(&task_id, &e);
            let _ = state.event_tx.send(ServiceEvent::DownloadFailed {
                task_id: task_id.clone(),
                error: e,
            });
            return;
        }
    };

    // Register the connection so cancellation can close it immediately.
    active.set_transfer_conn(&task_id, transfer_conn.clone());

    // --- Phase 2: DOWNLOADING ---
    let _ = queue.update_status(&task_id, DownloadTaskStatus::Downloading);
    emit_active_count(&queue, &state);
    let _ = state.event_tx.send(ServiceEvent::DownloadProgress {
        task_id: task_id.clone(),
        phase: "downloading".into(),
        progress: 0.0,
        message: String::new(),
        current_bytes: 0,
        total_bytes: 0,
    });

    tracing::info!("Download started: {task_id} → {file_path}");

    // Progress callback.
    let queue_for_progress = queue.clone();
    let state_for_progress = state.clone();
    let tid = task_id.clone();

    let on_progress = move |phase: DownloadPhase,
                            progress: f64,
                            message: &str,
                            current_bytes: u64,
                            total_bytes: u64| {
        let status = download_phase_to_status(phase);
        let cb = if current_bytes > 0 || total_bytes > 0 {
            Some(current_bytes)
        } else {
            None
        };
        let tb = if total_bytes > 0 {
            Some(total_bytes)
        } else {
            None
        };
        let _ = queue_for_progress.update_progress(
            &tid,
            status,
            progress,
            message,
            cb,
            tb,
            Some(phase as i32),
        );
        let _ = state_for_progress
            .event_tx
            .send(ServiceEvent::DownloadProgress {
                task_id: tid.clone(),
                phase: phase_to_str(phase).to_string(),
                progress,
                message: message.to_string(),
                current_bytes,
                total_bytes,
            });
    };

    let dest = std::path::Path::new(&file_path);

    // Race the actual download against the cancellation flag.
    let result: Option<cfms_core::Result<u64>> = tokio::select! {
        r = cfms_transfer::download::receive(&transfer_conn, &task_id, dest, &on_progress) => {
            Some(r)
        }
        _ = wait_for_cancellation(cancel_flag.clone()) => {
            None
        }
    };

    // Always close the transfer connection when done (it may already have
    // been closed by the cancellation path — `close()` is idempotent).
    transfer_conn.close().await;

    match result {
        // --- Success ---
        Some(Ok(file_size)) => {
            if let Err(e) = queue.mark_completed(&task_id, file_size) {
                tracing::error!("Failed to mark task {task_id} as completed: {e}");
            }
            emit_active_count(&queue, &state);

            let _ = state.event_tx.send(ServiceEvent::DownloadCompleted {
                task_id: task_id.clone(),
                file_path,
            });

            tracing::info!("Download completed: {task_id} ({file_size} bytes)");
        }

        // --- Error (retry or fail) ---
        Some(Err(e)) => {
            // If the cancel flag is set, the connection was closed by the
            // cancellation path — treat this as a clean cancellation, not
            // a download error.
            if cancel_flag.load(Ordering::SeqCst) {
                if let Err(rm_err) = std::fs::remove_file(&file_path)
                    && rm_err.kind() != std::io::ErrorKind::NotFound
                {
                    tracing::warn!("Failed to clean up partial file {file_path}: {rm_err}");
                }
                let _ = queue.update_status(&task_id, DownloadTaskStatus::Cancelled);
                emit_active_count(&queue, &state);
                let _ = state.event_tx.send(ServiceEvent::DownloadCancelled {
                    task_id: task_id.clone(),
                });
                tracing::info!("Download cancelled (via connection close): {task_id}");
                return;
            }

            let error_msg = e.to_string();
            tracing::error!("Download {task_id} failed: {error_msg}");

            match queue.retry_or_fail(&task_id, &error_msg) {
                Ok(DownloadTaskStatus::Failed) => {
                    emit_active_count(&queue, &state);
                    let _ = state.event_tx.send(ServiceEvent::DownloadFailed {
                        task_id: task_id.clone(),
                        error: error_msg,
                    });
                }
                Ok(_) => {
                    // Task was reset to Pending for a retry on the next tick.
                    emit_active_count(&queue, &state);
                    tracing::info!("Download {task_id} will be retried: {error_msg}");
                }
                Err(db_err) => {
                    tracing::error!("Failed to update retry state for {task_id}: {db_err}");
                }
            }
        }

        // --- Cancelled (select! raced to the cancel signal) ---
        None => {
            // Clean up the partial destination file if one was created.
            if let Err(e) = std::fs::remove_file(&file_path)
                && e.kind() != std::io::ErrorKind::NotFound
            {
                tracing::warn!("Failed to clean up partial file {file_path}: {e}");
            }

            let _ = queue.update_status(&task_id, DownloadTaskStatus::Cancelled);
            emit_active_count(&queue, &state);
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
fn download_phase_to_status(phase: DownloadPhase) -> DownloadTaskStatus {
    match phase {
        DownloadPhase::Downloading => DownloadTaskStatus::Downloading,
        DownloadPhase::Decrypting => DownloadTaskStatus::Decrypting,
        DownloadPhase::Cleaning | DownloadPhase::Verifying => DownloadTaskStatus::Verifying,
        DownloadPhase::Completed => DownloadTaskStatus::Completed,
    }
}

/// Human-readable label for a download phase (used in frontend progress events).
fn phase_to_str(phase: DownloadPhase) -> &'static str {
    match phase {
        DownloadPhase::Downloading => "downloading",
        DownloadPhase::Decrypting => "decrypting",
        DownloadPhase::Cleaning => "cleaning",
        DownloadPhase::Verifying => "verifying",
        DownloadPhase::Completed => "completed",
    }
}

/// Emit an [`ServiceEvent::ActiveCountChanged`] event if the badge-eligible
/// task count has changed since the last emission.
fn emit_active_count(queue: &QueueState, state: &AppState) {
    let count = queue.active_count();
    let _ = state
        .event_tx
        .send(ServiceEvent::ActiveCountChanged { count });
}

/// Returns when the cancellation flag is set to `true`.
async fn wait_for_cancellation(flag: Arc<AtomicBool>) {
    loop {
        if flag.load(Ordering::SeqCst) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// Establish a dedicated WebSocket connection for a single file transfer.
///
/// This creates a *separate* connection from the command channel so that
/// cancelling a transfer can immediately tear down its connection without
/// disrupting commands, server-push events, or other concurrent transfers.
async fn create_transfer_connection(
    state: &AppState,
) -> std::result::Result<cfms_transport::Connection, String> {
    let (url, ca_dir, disable_ssl) = {
        let addr = state.server_address.read().await;
        let ca = state.ca_dir.read().await;
        let dse = state.disable_ssl_enforcement.read().await;
        (addr.clone(), ca.clone(), *dse)
    };

    let url = url.ok_or_else(|| "No server address configured".to_string())?;
    let ca_dir = ca_dir.ok_or_else(|| "No CA directory configured".to_string())?;

    let tls_config = cfms_transport::tls::build_config(&ca_dir, disable_ssl)
        .map_err(|e| format!("TLS config error: {e}"))?;

    cfms_transport::Connection::connect(&url, tls_config, None)
        .await
        .map_err(|e| format!("Transfer connection failed: {e}"))
}

// ---------------------------------------------------------------------------
// Queue management operations (called from Tauri commands)
// ---------------------------------------------------------------------------

/// Add a new task to the download queue.
pub fn add_task(queue: &QueueState, task: DownloadTaskDto) -> Result<()> {
    queue.insert(&task)
}

/// Pause a download task.
///
/// Mirrors [`DownloadManagerService.pause_task`] in the Python reference.
/// Only tasks with `supports_resume` enabled and in DOWNLOADING or PENDING
/// status can be paused.
pub fn pause_task(queue: &QueueState, task_id: &str) -> Result<bool> {
    let task = match queue.get(task_id) {
        Some(t) => t,
        None => return Ok(false),
    };
    if !task.supports_resume {
        return Ok(false);
    }
    if task.status != DownloadTaskStatus::Downloading && task.status != DownloadTaskStatus::Pending
    {
        return Ok(false);
    }
    let pause_pos = task.current_bytes;
    queue.update_status(task_id, DownloadTaskStatus::Paused)?;
    queue.set_pause_position(task_id, pause_pos)?;
    Ok(true)
}

/// Resume a paused download task.
pub fn resume_task(queue: &QueueState, task_id: &str) -> Result<bool> {
    let task = match queue.get(task_id) {
        Some(t) => t,
        None => return Ok(false),
    };
    if task.status != DownloadTaskStatus::Paused {
        return Ok(false);
    }
    queue.update_status(task_id, DownloadTaskStatus::Pending)?;
    Ok(true)
}

/// Cancel a download task.
///
/// Mirrors [`DownloadManagerService.cancel_task`] in the Python reference.
/// Tasks in any non-terminal state (including SCHEDULED) can be cancelled.
pub fn cancel_task(queue: &QueueState, active: &ActiveRegistry, task_id: &str) -> Result<bool> {
    let task = match queue.get(task_id) {
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
    queue.update_status(task_id, DownloadTaskStatus::Cancelled)?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// Unix timestamp helper
// ---------------------------------------------------------------------------

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
