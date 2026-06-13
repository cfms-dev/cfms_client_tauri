use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::watch;

use cfms_core::constants::KEY_LEN;
use cfms_core::{DownloadPhase, DownloadTaskDto, DownloadTaskStatus, Result, ServiceEvent};

use crate::services::task_persistence;
use crate::state::AppState;

/// Queue check interval.
pub const INTERVAL: Duration = Duration::from_secs(1);

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

#[derive(Clone)]
struct PersistContext {
    dir: PathBuf,
    server_hash: String,
    username: String,
    dek: Option<[u8; KEY_LEN]>,
}

#[derive(Clone)]
pub struct QueueState {
    /// In-memory task map, keyed by `task_id`.
    tasks: Arc<Mutex<HashMap<String, DownloadTaskDto>>>,

    /// Persistence context. `None` until login.
    persist_ctx: Arc<Mutex<Option<PersistContext>>>,
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
            persist_ctx: Arc::new(Mutex::new(None)),
        }
    }

    // ------------------------------------------------------------------
    // Persistence lifecycle
    // ------------------------------------------------------------------

    /// Set up the persistence context and load tasks for the current user.
    pub fn load_for_user(
        &self,
        app_data: &std::path::Path,
        server_hash: &str,
        username: &str,
        dek: Option<&[u8; KEY_LEN]>,
    ) -> Result<usize> {
        // Store persistence context.
        {
            let mut ctx = self.persist_ctx.lock().unwrap();
            *ctx = Some(PersistContext {
                dir: app_data.to_path_buf(),
                server_hash: server_hash.to_string(),
                username: username.to_string(),
                dek: dek.cloned(),
            });
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
    pub fn clear(&self) {
        {
            let mut map = self.tasks.lock().unwrap();
            map.clear();
        }
        {
            let mut ctx = self.persist_ctx.lock().unwrap();
            *ctx = None;
        }
    }

    /// Persist the current task list to the encrypted JSON file.
    fn save(&self) {
        let ctx = self.persist_ctx.lock().unwrap().clone();

        let Some(ctx) = ctx else {
            // Persistence context not set — nothing to save.
            return;
        };

        let tasks: Vec<DownloadTaskDto> = {
            let map = self.tasks.lock().unwrap();
            map.values().cloned().collect()
        };

        if let Err(e) = task_persistence::save(
            &ctx.dir,
            &ctx.server_hash,
            &ctx.username,
            ctx.dek.as_ref(),
            &tasks,
        ) {
            tracing::error!("Failed to persist download tasks: {e}");
        }
    }

    // ------------------------------------------------------------------
    // Read operations
    // ------------------------------------------------------------------

    pub fn get(&self, task_id: &str) -> Option<DownloadTaskDto> {
        let map = self.tasks.lock().unwrap();
        map.get(task_id).cloned()
    }

    pub fn list(&self, status_filter: Option<DownloadTaskStatus>) -> Vec<DownloadTaskDto> {
        let map = self.tasks.lock().unwrap();
        let mut tasks: Vec<DownloadTaskDto> = match status_filter {
            Some(s) => map.values().filter(|t| t.status == s).cloned().collect(),
            None => map.values().cloned().collect(),
        };
        // Sort by priority DESC, then created_at ASC
        tasks.sort_by(|a, b| {
            b.priority
                .cmp(&a.priority)
                .then(a.created_at.cmp(&b.created_at))
        });
        tasks
    }

    pub fn list_by_status(&self, status: DownloadTaskStatus) -> Vec<DownloadTaskDto> {
        self.list(Some(status))
    }

    pub fn count_by_status(&self, status: DownloadTaskStatus) -> u32 {
        let map = self.tasks.lock().unwrap();
        map.values().filter(|t| t.status == status).count() as u32
    }

    pub fn active_count(&self) -> u32 {
        let map = self.tasks.lock().unwrap();
        map.values()
            .filter(|t| ACTIVE_BADGE_STATUSES.contains(&t.status))
            .count() as u32
    }

    pub fn pending_tasks(&self) -> Vec<DownloadTaskDto> {
        let mut tasks = self.list_by_status(DownloadTaskStatus::Pending);
        tasks.sort_by_key(|b| std::cmp::Reverse(b.priority));
        tasks
    }

    // ------------------------------------------------------------------
    // Write operations
    // ------------------------------------------------------------------

    pub fn insert(&self, task: &DownloadTaskDto) -> Result<()> {
        {
            let mut map = self.tasks.lock().unwrap();
            map.insert(task.task_id.clone(), task.clone());
        }
        self.save();
        Ok(())
    }

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

    pub fn update_progress(&self, task_id: &str, params: UpdateProgressParams) -> Result<()> {
        {
            let mut map = self.tasks.lock().unwrap();
            if let Some(t) = map.get_mut(task_id) {
                if matches!(
                    t.status,
                    DownloadTaskStatus::Cancelled
                        | DownloadTaskStatus::Completed
                        | DownloadTaskStatus::Failed
                        | DownloadTaskStatus::Paused
                ) {
                    return Ok(());
                }
                t.status = params.status;
                t.progress = params.progress;
                t.message = Some(params.message.clone());
                if let Some(cb) = params.current_bytes {
                    t.current_bytes = cb;
                }
                if let Some(tb) = params.total_bytes {
                    t.total_bytes = tb;
                }
                if let Some(s) = params.stage {
                    t.stage = s;
                }
            }
        }
        Ok(())
    }

    pub fn mark_started(&self, task_id: &str) -> Result<()> {
        let now = unix_now();
        {
            let mut map = self.tasks.lock().unwrap();
            if let Some(t) = map.get_mut(task_id) {
                if t.status == DownloadTaskStatus::Cancelled {
                    return Ok(());
                }
                t.started_at = Some(now);
                t.status = DownloadTaskStatus::Downloading;
            }
        }
        self.save();
        Ok(())
    }

    pub fn mark_completed(&self, task_id: &str, bytes: u64) -> Result<()> {
        let now = unix_now();
        {
            let mut map = self.tasks.lock().unwrap();
            if let Some(t) = map.get_mut(task_id) {
                if t.status == DownloadTaskStatus::Cancelled {
                    return Ok(());
                }
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

    pub fn mark_failed(&self, task_id: &str, error: &str) -> Result<()> {
        let now = unix_now();
        {
            let mut map = self.tasks.lock().unwrap();
            if let Some(t) = map.get_mut(task_id) {
                if t.status == DownloadTaskStatus::Cancelled {
                    return Ok(());
                }
                t.status = DownloadTaskStatus::Failed;
                t.error = Some(error.to_string());
                t.completed_at = Some(now);
            }
        }
        self.save();
        Ok(())
    }

    pub fn retry_or_fail(&self, task_id: &str, error: &str) -> Result<DownloadTaskStatus> {
        let status = {
            let mut map = self.tasks.lock().unwrap();
            let Some(t) = map.get_mut(task_id) else {
                return Ok(DownloadTaskStatus::Failed);
            };
            if t.status == DownloadTaskStatus::Cancelled {
                return Ok(DownloadTaskStatus::Cancelled);
            }
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

    pub fn promote_scheduled(&self) -> usize {
        let now = unix_now();
        let mut count = 0;
        {
            let mut map = self.tasks.lock().unwrap();
            for t in map.values_mut() {
                if t.status == DownloadTaskStatus::Scheduled
                    && let Some(st) = t.scheduled_time
                    && st <= now
                {
                    t.status = DownloadTaskStatus::Pending;
                    t.scheduled_time = None;
                    count += 1;
                }
            }
        }
        if count > 0 {
            self.save();
        }
        count
    }

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

    pub fn clear_failed(&self) -> usize {
        let count = {
            let mut map = self.tasks.lock().unwrap();
            let before = map.len();
            map.retain(|_, t| {
                t.status != DownloadTaskStatus::Failed && t.status != DownloadTaskStatus::Cancelled
            });
            before - map.len()
        };
        if count > 0 {
            self.save();
        }
        count
    }

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

/// Parameters for updating task progress in a single call.
pub struct UpdateProgressParams {
    pub status: DownloadTaskStatus,
    pub progress: f64,
    pub message: String,
    pub current_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub stage: Option<i32>,
}

// ---------------------------------------------------------------------------
// ActiveRegistry
// ---------------------------------------------------------------------------

struct ActiveDownload {
    cancel_tx: watch::Sender<bool>,
    transfer_conn: Option<cfms_transport::Connection>,
}

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

    fn register(&self, task_id: &str) -> watch::Receiver<bool> {
        let (tx, rx) = watch::channel(false);
        let mut map = self.inner.lock().unwrap();
        map.insert(
            task_id.to_string(),
            ActiveDownload {
                cancel_tx: tx,
                transfer_conn: None,
            },
        );
        rx
    }

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
            let _ = ad.cancel_tx.send(true);
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

pub async fn run(
    state: Arc<AppState>,
    queue: QueueState,
    active: ActiveRegistry,
    mut shutdown_rx: watch::Receiver<bool>,
) {
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

    tracing::info!("DownloadQueueService shutting down…");
    {
        let mut map = active.inner.lock().unwrap();
        for (task_id, ad) in map.iter_mut() {
            let _ = ad.cancel_tx.send(true);
            if let Some(conn) = ad.transfer_conn.take() {
                tokio::spawn(async move { conn.close().await });
            }
            tracing::info!("Cancelled active download: {task_id}");
        }
    }
    tokio::time::sleep(Duration::from_secs(3)).await;
    tracing::info!("DownloadQueueService stopped");
}

async fn tick(state: &Arc<AppState>, queue: &QueueState, active: &ActiveRegistry) {
    let promoted = queue.promote_scheduled();
    if promoted > 0 {
        tracing::debug!("Promoted {promoted} scheduled tasks to pending");
    }

    let max_concurrent = state.download_max_concurrent.load(Ordering::Relaxed).clamp(
        cfms_core::MIN_TASK_CONCURRENCY as usize,
        cfms_core::MAX_TASK_CONCURRENCY as usize,
    );
    let active_count = active.count();
    if active_count >= max_concurrent {
        return;
    }

    let pending = queue.pending_tasks();

    let slots = max_concurrent - active_count;
    for task in pending.into_iter().take(slots) {
        if task.status == DownloadTaskStatus::Cancelled {
            continue;
        }

        let cancel_rx = active.register(&task.task_id);

        if let Err(e) = queue.mark_started(&task.task_id) {
            tracing::error!("Failed to mark task {} as started: {e}", task.task_id);
            active.unregister(&task.task_id);
            continue;
        }

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
                cancel_rx,
            )
            .await;
            active.unregister(&tid);
        });
    }
}

async fn execute_download(
    task_id: String,
    file_path: String,
    state: Arc<AppState>,
    queue: QueueState,
    active: ActiveRegistry,
    mut cancel_rx: watch::Receiver<bool>,
) {
    // Check cancellation before starting.
    if *cancel_rx.borrow() {
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

    let queue_for_progress = queue.clone();
    let state_for_progress = state.clone();
    let cancel_for_progress = cancel_rx.clone();
    let tid = task_id.clone();

    let on_progress = move |phase: DownloadPhase,
                            progress: f64,
                            message: &str,
                            current_bytes: u64,
                            total_bytes: u64| {
        if *cancel_for_progress.borrow() {
            return;
        }

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
            UpdateProgressParams {
                status,
                progress,
                message: message.to_string(),
                current_bytes: cb,
                total_bytes: tb,
                stage: Some(phase as i32),
            },
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

    let result: Option<cfms_core::Result<u64>> = tokio::select! {
        r = cfms_transfer::download::receive(&transfer_conn, &task_id, dest, &on_progress) => {
            Some(r)
        }
        _ = cancel_rx.wait_for(|c| *c) => {
            None
        }
    };

    transfer_conn.close().await;

    if *cancel_rx.borrow() {
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
        return;
    }

    match result {
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

        Some(Err(e)) => {
            if *cancel_rx.borrow() {
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
                    emit_active_count(&queue, &state);
                    tracing::info!("Download {task_id} will be retried: {error_msg}");
                }
                Err(db_err) => {
                    tracing::error!("Failed to update retry state for {task_id}: {db_err}");
                }
            }
        }

        None => {
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

fn download_phase_to_status(phase: DownloadPhase) -> DownloadTaskStatus {
    match phase {
        DownloadPhase::Downloading => DownloadTaskStatus::Downloading,
        DownloadPhase::Decrypting => DownloadTaskStatus::Decrypting,
        DownloadPhase::Cleaning | DownloadPhase::Verifying => DownloadTaskStatus::Verifying,
    }
}

fn phase_to_str(phase: DownloadPhase) -> &'static str {
    match phase {
        DownloadPhase::Downloading => "downloading",
        DownloadPhase::Decrypting => "decrypting",
        DownloadPhase::Cleaning => "cleaning",
        DownloadPhase::Verifying => "verifying",
    }
}

fn emit_active_count(queue: &QueueState, state: &AppState) {
    let count = queue.active_count();
    let _ = state
        .event_tx
        .send(ServiceEvent::ActiveCountChanged { count });
}

async fn create_transfer_connection(
    state: &AppState,
) -> std::result::Result<cfms_transport::Connection, String> {
    let (url, ca_dir, disable_ssl, proxy_addr, force_ipv4, client_cert_path, client_key_path) = {
        let addr = state.server_address.read().await;
        let ca = state.ca_dir.read().await;
        let dse = state.disable_ssl_enforcement.read().await;
        let proxy = state.proxy_addr.read().await;
        let force_ipv4 = state.force_ipv4.read().await;
        let cert = state.client_cert_path.read().await;
        let key = state.client_key_path.read().await;
        (
            addr.clone(),
            ca.clone(),
            *dse,
            proxy.clone(),
            *force_ipv4,
            cert.clone(),
            key.clone(),
        )
    };

    let url = url.ok_or_else(|| "No server address configured".to_string())?;
    let ca_dir = ca_dir.ok_or_else(|| "No CA directory configured".to_string())?;

    let tls_config = cfms_transport::tls::build_config_with_identity(
        &ca_dir,
        disable_ssl,
        client_cert_path.as_deref(),
        client_key_path.as_deref(),
    )
    .map_err(|e| format!("TLS config error: {e}"))?;

    cfms_transport::Connection::connect(&url, tls_config, proxy_addr.as_deref(), force_ipv4)
        .await
        .map_err(|e| format!("Transfer connection failed: {e}"))
}

// ---------------------------------------------------------------------------
// Queue management operations (called from Tauri commands)
// ---------------------------------------------------------------------------

pub fn add_task(queue: &QueueState, task: DownloadTaskDto) -> Result<()> {
    queue.insert(&task)
}

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

pub fn cancel_task(queue: &QueueState, active: &ActiveRegistry, task_id: &str) -> Result<bool> {
    let task = match queue.get(task_id) {
        Some(t) => t,
        None => return Ok(false),
    };
    if task.status.is_terminal() {
        return Ok(false);
    }
    active.cancel(task_id);
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
