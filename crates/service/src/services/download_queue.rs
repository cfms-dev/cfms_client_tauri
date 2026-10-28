use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::watch;

use cfms_core::constants::KEY_LEN;
use cfms_core::{
    DownloadFailureKind, DownloadPhase, DownloadTaskDto, DownloadTaskStatus, Result, ServiceEvent,
};

use crate::sensitive::SecretKey;
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
    dek: Option<SecretKey>,
}

#[derive(Clone)]
pub struct QueueState {
    /// In-memory task map, keyed by `task_id`.
    tasks: Arc<Mutex<HashMap<String, DownloadTaskDto>>>,
    stopped_batches: Arc<Mutex<HashSet<String>>>,

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
            stopped_batches: Arc::new(Mutex::new(HashSet::new())),
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
        // Drop the previous account's tasks and key before attempting a
        // replacement. A failed load must not leave either key resident.
        self.clear();
        let loaded = task_persistence::load(app_data, server_hash, username, dek)?;
        let count = loaded.len();

        *self.persist_ctx.lock().unwrap() = Some(PersistContext {
            dir: app_data.to_path_buf(),
            server_hash: server_hash.to_string(),
            username: username.to_string(),
            dek: dek.map(|value| zeroize::Zeroizing::new(*value)),
        });

        {
            let mut map = self.tasks.lock().unwrap();
            map.clear();
            for t in loaded {
                map.insert(t.task_id.clone(), t);
            }
        }

        tracing::info!("Loaded {count} download tasks");
        Ok(count)
    }

    /// Clear all in-memory tasks and reset the persistence context.
    pub fn clear(&self) {
        self.stopped_batches.lock().unwrap().clear();
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
            ctx.dek.as_ref().map(|dek| &**dek),
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

    /// Clone multiple tasks while acquiring the queue lock only once.
    pub fn get_many(&self, task_ids: &[String]) -> Vec<Option<DownloadTaskDto>> {
        let map = self.tasks.lock().unwrap();
        task_ids.iter().map(|id| map.get(id).cloned()).collect()
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

    fn claim_next_pending(
        &self,
        active: &ActiveRegistry,
    ) -> Option<(DownloadTaskDto, watch::Receiver<bool>)> {
        let now = unix_now();
        let claimed = {
            let mut map = self.tasks.lock().unwrap();
            let next_id = map
                .values()
                .filter(|task| task.status == DownloadTaskStatus::Pending)
                .max_by(|a, b| {
                    a.priority
                        .cmp(&b.priority)
                        .then_with(|| b.created_at.cmp(&a.created_at))
                })
                .map(|task| task.task_id.clone());

            let next_id = next_id?;

            let task = map.get_mut(&next_id)?;
            task.started_at = Some(now);
            task.status = DownloadTaskStatus::Downloading;
            (task.clone(), active.register(&next_id))
        };

        self.save();
        Some(claimed)
    }

    pub fn cancel_many(&self, ids: &[String], include_finished: bool) -> Vec<String> {
        let mut tasks = self.tasks.lock().unwrap();
        let mut accepted = Vec::new();
        for id in ids {
            if let Some(task) = tasks.get_mut(id) {
                if task.status.is_terminal() {
                    if include_finished {
                        accepted.push(id.clone());
                    }
                    continue;
                }
                task.status = DownloadTaskStatus::Cancelled;
                task.completed_at = Some(unix_now());
                accepted.push(id.clone());
            }
        }
        drop(tasks);
        self.save();
        accepted
    }

    // ------------------------------------------------------------------
    // Write operations
    // ------------------------------------------------------------------

    pub fn insert(&self, task: &DownloadTaskDto) -> Result<()> {
        let stopped = self.stopped_batches.lock().unwrap();
        if task
            .batch_id
            .as_ref()
            .is_some_and(|id| stopped.contains(id))
        {
            return Err(cfms_core::Error::Cancelled);
        }
        {
            let mut map = self.tasks.lock().unwrap();
            map.insert(task.task_id.clone(), task.clone());
        }
        drop(stopped);
        self.save();
        Ok(())
    }

    /// Close producer admission before resolving the final batch membership.
    pub fn stop_batches(&self, ids: &[String]) -> Vec<String> {
        let mut stopped = self.stopped_batches.lock().unwrap();
        stopped.extend(ids.iter().cloned());
        self.tasks
            .lock()
            .unwrap()
            .values()
            .filter(|t| {
                t.batch_id.as_ref().is_some_and(|id| ids.contains(id)) && !t.status.is_terminal()
            })
            .map(|t| t.task_id.clone())
            .collect()
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
                        | DownloadTaskStatus::Deleted
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
                if matches!(
                    t.status,
                    DownloadTaskStatus::Cancelled | DownloadTaskStatus::Paused
                ) {
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
                if matches!(
                    t.status,
                    DownloadTaskStatus::Cancelled | DownloadTaskStatus::Paused
                ) {
                    return Ok(());
                }
                t.status = DownloadTaskStatus::Completed;
                t.progress = 1.0;
                t.current_bytes = bytes;
                t.total_bytes = bytes;
                t.stage = 4;
                t.completed_at = Some(now);
                t.pause_position = None;
                t.error = None;
                t.failure_kind = None;
            }
        }
        self.save();
        Ok(())
    }

    pub fn mark_failed(&self, task_id: &str, error: &str) -> Result<()> {
        self.mark_failed_with_kind(task_id, error, None)
    }

    pub fn mark_failed_with_kind(
        &self,
        task_id: &str,
        error: &str,
        failure_kind: Option<DownloadFailureKind>,
    ) -> Result<()> {
        let now = unix_now();
        {
            let mut map = self.tasks.lock().unwrap();
            if let Some(t) = map.get_mut(task_id) {
                if matches!(
                    t.status,
                    DownloadTaskStatus::Cancelled | DownloadTaskStatus::Paused
                ) {
                    return Ok(());
                }
                t.status = DownloadTaskStatus::Failed;
                t.error = Some(error.to_string());
                t.failure_kind = failure_kind;
                t.completed_at = Some(now);
            }
        }
        self.save();
        Ok(())
    }

    pub fn mark_file_deleted(&self, task_id: &str) -> Result<()> {
        self.mark_files_deleted(&[task_id.to_owned()])
    }

    /// Mark multiple completed outputs as deleted and persist the queue once.
    pub fn mark_files_deleted(&self, task_ids: &[String]) -> Result<()> {
        if task_ids.is_empty() {
            return Ok(());
        }

        let mut changed = false;
        {
            let mut map = self.tasks.lock().unwrap();
            for task_id in task_ids {
                if let Some(t) = map.get_mut(task_id)
                    && t.status != DownloadTaskStatus::Deleted
                {
                    t.status = DownloadTaskStatus::Deleted;
                    t.message = None;
                    t.error = None;
                    t.failure_kind = None;
                    changed = true;
                }
            }
        }
        if changed {
            self.save();
        }
        Ok(())
    }

    pub fn retry_or_fail(
        &self,
        task_id: &str,
        error: &str,
        retry_after_seconds: Option<u64>,
    ) -> Result<DownloadTaskStatus> {
        let status = {
            let mut map = self.tasks.lock().unwrap();
            let Some(t) = map.get_mut(task_id) else {
                return Ok(DownloadTaskStatus::Failed);
            };
            if t.status == DownloadTaskStatus::Cancelled {
                return Ok(DownloadTaskStatus::Cancelled);
            }
            if t.status == DownloadTaskStatus::Paused {
                return Ok(DownloadTaskStatus::Paused);
            }
            t.retry_count += 1;
            if t.retry_count > t.max_retries {
                t.status = DownloadTaskStatus::Failed;
                t.error = Some(error.to_string());
                t.failure_kind = None;
                t.completed_at = Some(unix_now());
                DownloadTaskStatus::Failed
            } else {
                let delay = super::retry::retry_delay(t.retry_count as usize, retry_after_seconds)
                    .as_secs()
                    .max(1);
                t.status = DownloadTaskStatus::Scheduled;
                t.scheduled_time = Some(unix_now().saturating_add(delay as i64));
                t.pause_position = Some(t.current_bytes);
                t.error = Some(error.to_string());
                t.failure_kind = None;
                DownloadTaskStatus::Scheduled
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
        let removed_tasks = {
            let mut map = self.tasks.lock().unwrap();
            let removed_tasks = map
                .values()
                .filter(|t| {
                    t.status == DownloadTaskStatus::Completed
                        || t.status == DownloadTaskStatus::Deleted
                        || t.status == DownloadTaskStatus::Cancelled
                })
                .cloned()
                .collect::<Vec<_>>();
            map.retain(|_, t| {
                t.status != DownloadTaskStatus::Completed
                    && t.status != DownloadTaskStatus::Deleted
                    && t.status != DownloadTaskStatus::Cancelled
            });
            removed_tasks
        };
        let count = removed_tasks.len();
        if count > 0 {
            for task in removed_tasks {
                cleanup_resume_state(&task.file_path, &task.task_id);
            }
            self.save();
        }
        count
    }

    pub fn clear_failed(&self) -> usize {
        let removed_tasks = {
            let mut map = self.tasks.lock().unwrap();
            let removed_tasks = map
                .values()
                .filter(|t| {
                    t.status == DownloadTaskStatus::Failed
                        || t.status == DownloadTaskStatus::Cancelled
                })
                .cloned()
                .collect::<Vec<_>>();
            map.retain(|_, t| {
                t.status != DownloadTaskStatus::Failed && t.status != DownloadTaskStatus::Cancelled
            });
            removed_tasks
        };
        let count = removed_tasks.len();
        if count > 0 {
            for task in removed_tasks {
                cleanup_resume_state(&task.file_path, &task.task_id);
            }
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

    /// Remove terminal history entries without touching completed output files.
    pub fn remove_terminal(&self, ids: &[String]) -> (Vec<String>, Vec<(String, String)>) {
        let mut succeeded = Vec::new();
        let mut failed = Vec::new();
        {
            let mut map = self.tasks.lock().unwrap();
            for id in ids {
                match map.get(id) {
                    None => failed.push((id.clone(), "Task not found".into())),
                    Some(task) if !task.status.is_terminal() => failed.push((
                        id.clone(),
                        "Only finished download records can be removed".into(),
                    )),
                    Some(task) => {
                        cleanup_resume_state(&task.file_path, &task.task_id);
                        map.remove(id);
                        succeeded.push(id.clone());
                    }
                }
            }
        }
        if !succeeded.is_empty() {
            self.save();
        }
        (succeeded, failed)
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

    pub fn retry_failed(&self, task_id: &str) -> Result<bool> {
        let retried = {
            let mut map = self.tasks.lock().unwrap();
            let Some(t) = map.get_mut(task_id) else {
                return Ok(false);
            };
            if t.status != DownloadTaskStatus::Failed {
                return Ok(false);
            }

            t.status = DownloadTaskStatus::Pending;
            t.progress = 0.0;
            t.current_bytes = 0;
            t.message = None;
            t.error = None;
            t.failure_kind = None;
            t.started_at = None;
            t.completed_at = None;
            t.retry_count = 0;
            t.scheduled_time = None;
            t.pause_position = None;
            true
        };
        if retried {
            self.save();
        }
        Ok(retried)
    }

    /// Atomically replace one server task identifier while retaining the
    /// logical download's destination, ordering, priority, and batch metadata.
    pub fn replace_server_task(
        &self,
        old_task_id: &str,
        expected_status: DownloadTaskStatus,
        new_task_id: &str,
        supports_resume: bool,
    ) -> Result<Option<DownloadTaskDto>> {
        if new_task_id == old_task_id {
            return Err(cfms_core::Error::Other(
                "Server recreated download with the same unusable task id".into(),
            ));
        }

        let replacement = {
            let mut map = self.tasks.lock().unwrap();
            let Some(existing) = map.get(old_task_id) else {
                return Ok(None);
            };
            if existing.status != expected_status {
                return Ok(None);
            }
            if map.contains_key(new_task_id) {
                return Err(cfms_core::Error::Other(format!(
                    "Server recreated download with duplicate task id {new_task_id}"
                )));
            }

            let mut replacement = existing.clone();
            replacement.task_id = new_task_id.to_string();
            replacement.status = DownloadTaskStatus::Pending;
            replacement.progress = 0.0;
            replacement.current_bytes = 0;
            replacement.total_bytes = 0;
            replacement.message = None;
            replacement.error = None;
            replacement.failure_kind = None;
            replacement.started_at = None;
            replacement.completed_at = None;
            replacement.retry_count = 0;
            replacement.scheduled_time = None;
            replacement.stage = 0;
            replacement.pause_position = None;
            replacement.supports_resume = supports_resume;
            replacement.server_task_recreate_count =
                replacement.server_task_recreate_count.saturating_add(1);

            map.remove(old_task_id);
            map.insert(new_task_id.to_string(), replacement.clone());
            replacement
        };

        cleanup_resume_state(&replacement.file_path, old_task_id);
        self.save();
        Ok(Some(replacement))
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerDownloadTask {
    pub task_id: String,
    pub supports_resume: bool,
}

/// Request a fresh one-shot download task from the authenticated server.
pub async fn request_server_download_task(
    state: &AppState,
    document_id: &str,
) -> Result<ServerDownloadTask> {
    let conn = state
        .conn
        .read()
        .await
        .clone()
        .ok_or_else(|| cfms_core::Error::Connection("Not connected to a server".into()))?;
    let username = state
        .username
        .read()
        .await
        .clone()
        .ok_or_else(|| cfms_core::Error::Auth("Not logged in".into()))?;
    let token = state
        .token
        .read()
        .await
        .clone()
        .ok_or_else(|| cfms_core::Error::Auth("Not logged in".into()))?;

    let response = super::rpc::send_action_request(
        &conn,
        "core.document.get",
        serde_json::json!({ "document_id": document_id }),
        &username,
        token.as_str(),
    )
    .await?;

    if response.code != 200 {
        return Err(server_response_error(&response));
    }

    let task_data = response.data.get("task_data").ok_or_else(|| {
        cfms_core::Error::Protocol("get_document response missing task_data".into())
    })?;
    let task_id = task_data
        .get("task_id")
        .and_then(serde_json::Value::as_str)
        .filter(|task_id| !task_id.trim().is_empty())
        .ok_or_else(|| cfms_core::Error::Protocol("get_document response missing task_id".into()))?
        .to_string();
    let supports_resume = task_data
        .get("supports_resume")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);

    Ok(ServerDownloadTask {
        task_id,
        supports_resume,
    })
}

fn server_response_error(response: &cfms_core::Response) -> cfms_core::Error {
    cfms_core::Error::Server {
        code: u32::from(response.code),
        message: response.message.clone(),
        scope: response
            .data
            .get("scope")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        limit: response
            .data
            .get("limit")
            .and_then(serde_json::Value::as_u64),
        retry_after_seconds: response
            .data
            .get("retry_after_seconds")
            .and_then(serde_json::Value::as_u64),
        task_status: response
            .data
            .get("task_status")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        retryable: response
            .data
            .get("retryable")
            .and_then(serde_json::Value::as_bool),
    }
}

pub fn is_unclaimable_server_task_error(error: &cfms_core::Error) -> bool {
    matches!(
        error,
        cfms_core::Error::Server {
            code: cfms_core::constants::file_task_claim_code::INVALID,
            ..
        }
    )
}

fn should_automatically_recreate_server_task(
    task: Option<&DownloadTaskDto>,
    error: &cfms_core::Error,
) -> bool {
    is_unclaimable_server_task_error(error)
        && task.is_some_and(|task| task.server_task_recreate_count == 0)
}

/// Recreate a server task and replace the local record only if it has not
/// changed state while the network request was in flight.
pub async fn recreate_server_task(
    state: &AppState,
    queue: &QueueState,
    old_task_id: &str,
    expected_status: DownloadTaskStatus,
) -> Result<Option<DownloadTaskDto>> {
    let Some(existing) = queue.get(old_task_id) else {
        return Ok(None);
    };
    if existing.status != expected_status {
        return Ok(None);
    }

    let server_task = request_server_download_task(state, &existing.file_id).await?;
    queue.replace_server_task(
        old_task_id,
        expected_status,
        &server_task.task_id,
        server_task.supports_resume,
    )
}

struct ProgressEventThrottle {
    phase: Option<DownloadPhase>,
    progress: f64,
    last_emit: Option<Instant>,
}

impl ProgressEventThrottle {
    fn new() -> Self {
        Self {
            phase: None,
            progress: -1.0,
            last_emit: None,
        }
    }

    fn should_emit(&mut self, phase: DownloadPhase, progress: f64) -> bool {
        let now = Instant::now();
        let phase_changed = self.phase != Some(phase);
        let progress_delta = (progress - self.progress).abs();
        let elapsed = match self.last_emit {
            Some(last_emit) => now.duration_since(last_emit) >= Duration::from_millis(250),
            None => true,
        };
        let terminal = progress >= 1.0;

        if phase_changed || terminal || progress_delta >= 0.01 || elapsed {
            self.phase = Some(phase);
            self.progress = progress;
            self.last_emit = Some(now);
            return true;
        }

        false
    }
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
    workers: Arc<AtomicUsize>,
}

impl Default for ActiveRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ActiveRegistry {
    pub fn request_cancel(&self, id: &str) {
        self.cancel(id);
    }
    pub fn contains(&self, id: &str) -> bool {
        self.inner.lock().unwrap().contains_key(id)
    }
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            workers: Arc::new(AtomicUsize::new(0)),
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

    /// Cancel every active download and detach its transfer connection.
    pub fn cancel_all(&self) {
        let mut map = self.inner.lock().unwrap();
        for active in map.values_mut() {
            let _ = active.cancel_tx.send(true);
            if let Some(conn) = active.transfer_conn.take() {
                tokio::spawn(async move { conn.close().await });
            }
        }
    }

    fn start_worker(&self) {
        self.workers.fetch_add(1, Ordering::SeqCst);
    }

    fn finish_worker(&self) {
        self.workers.fetch_sub(1, Ordering::SeqCst);
    }

    fn worker_count(&self) -> usize {
        self.workers.load(Ordering::SeqCst)
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

        tick(&state, &queue, &active, &shutdown_rx).await;

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

async fn tick(
    state: &Arc<AppState>,
    queue: &QueueState,
    active: &ActiveRegistry,
    shutdown_rx: &watch::Receiver<bool>,
) {
    let promoted = queue.promote_scheduled();
    if promoted > 0 {
        tracing::debug!("Promoted {promoted} scheduled tasks to pending");
    }

    let max_concurrent = state.download_max_concurrent.load(Ordering::Relaxed).clamp(
        cfms_core::MIN_TASK_CONCURRENCY as usize,
        cfms_core::MAX_TASK_CONCURRENCY as usize,
    );
    let worker_count = active.worker_count();
    if worker_count >= max_concurrent {
        return;
    }

    let pending_count = queue.count_by_status(DownloadTaskStatus::Pending) as usize;
    if pending_count == 0 {
        return;
    }

    let slots = (max_concurrent - worker_count).min(pending_count);
    for _ in 0..slots {
        let state = Arc::clone(state);
        let queue = queue.clone();
        let active = active.clone();
        let shutdown_rx = shutdown_rx.clone();

        active.start_worker();
        tokio::spawn(async move {
            let active_for_finish = active.clone();
            download_worker(state, queue, active, shutdown_rx).await;
            active_for_finish.finish_worker();
        });
    }
}

async fn download_worker(
    state: Arc<AppState>,
    queue: QueueState,
    active: ActiveRegistry,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let mut transfer_conn: Option<cfms_transport::Connection> = None;

    loop {
        if *shutdown_rx.borrow() {
            break;
        }

        let Some((task, cancel_rx)) = queue.claim_next_pending(&active) else {
            break;
        };

        let task_id = task.task_id.clone();
        let file_path = task.file_path.clone();
        emit_task_update(&queue, &state, &task_id);

        if transfer_conn
            .as_ref()
            .is_none_or(cfms_transport::Connection::is_closed)
        {
            if let Some(conn) = transfer_conn.take() {
                conn.close().await;
            }

            match create_transfer_connection(&state).await {
                Ok(conn) => {
                    transfer_conn = Some(conn);
                }
                Err(e) => {
                    let error_message = e.to_string();
                    tracing::error!(
                        "Download {task_id}: failed to create transfer connection: {e}"
                    );
                    let status = if super::retry::is_transient_error(&e) {
                        queue.retry_or_fail(
                            &task_id,
                            &error_message,
                            super::retry::error_retry_after_seconds(&e),
                        )
                    } else {
                        queue
                            .mark_failed(&task_id, &error_message)
                            .map(|_| DownloadTaskStatus::Failed)
                    };
                    emit_task_update(&queue, &state, &task_id);
                    emit_active_count(&queue, &state);
                    if matches!(status, Ok(DownloadTaskStatus::Failed)) {
                        let _ = state.event_tx.send(ServiceEvent::DownloadFailed {
                            task_id: task_id.clone(),
                            error: error_message,
                        });
                    }
                    active.unregister(&task_id);
                    break;
                }
            }
        }

        let conn = transfer_conn
            .as_ref()
            .expect("transfer connection exists after creation")
            .clone();

        let outcome = execute_download(
            task_id.clone(),
            file_path,
            state.clone(),
            queue.clone(),
            active.clone(),
            cancel_rx,
            &conn,
        )
        .await;
        active.unregister(&task_id);

        if (!outcome.reuse_connection || conn.is_closed())
            && let Some(conn) = transfer_conn.take()
        {
            conn.close().await;
        }

        if !outcome.continue_worker {
            break;
        }

        tokio::select! {
            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    break;
                }
            }
            _ = tokio::task::yield_now() => {}
        }
    }

    if let Some(conn) = transfer_conn.take() {
        conn.close().await;
    }
}

#[derive(Clone, Copy)]
struct DownloadOutcome {
    reuse_connection: bool,
    continue_worker: bool,
}

impl DownloadOutcome {
    const fn reusable() -> Self {
        Self {
            reuse_connection: true,
            continue_worker: true,
        }
    }

    const fn discard_and_stop() -> Self {
        Self {
            reuse_connection: false,
            continue_worker: false,
        }
    }
}

async fn execute_download(
    task_id: String,
    file_path: String,
    state: Arc<AppState>,
    queue: QueueState,
    active: ActiveRegistry,
    mut cancel_rx: watch::Receiver<bool>,
    transfer_conn: &cfms_transport::Connection,
) -> DownloadOutcome {
    // Pause and cancellation share the same interruption signal. Preserve the
    // task state selected by pause_task if the worker has not started yet.
    if *cancel_rx.borrow() {
        if queue
            .get(&task_id)
            .is_some_and(|task| task.status == DownloadTaskStatus::Paused)
        {
            tracing::info!("Download paused before worker start: {task_id}");
            return DownloadOutcome::discard_and_stop();
        }
        let _ = queue.update_status(&task_id, DownloadTaskStatus::Cancelled);
        return DownloadOutcome::discard_and_stop();
    }

    active.set_transfer_conn(&task_id, transfer_conn.clone());

    // claim_next_pending already set Downloading. A pause may arrive while the
    // worker is preparing the transfer, so do not overwrite Paused here.
    if *cancel_rx.borrow()
        || queue
            .get(&task_id)
            .is_some_and(|task| task.status == DownloadTaskStatus::Paused)
    {
        if queue
            .get(&task_id)
            .is_some_and(|task| task.status == DownloadTaskStatus::Paused)
        {
            emit_active_count(&queue, &state);
            tracing::info!("Download paused while connecting: {task_id}");
            return DownloadOutcome::discard_and_stop();
        }

        let _ = queue.update_status(&task_id, DownloadTaskStatus::Cancelled);
        emit_active_count(&queue, &state);
        let _ = state.event_tx.send(ServiceEvent::DownloadCancelled {
            task_id: task_id.clone(),
        });
        tracing::info!("Download cancelled while connecting: {task_id}");
        return DownloadOutcome::discard_and_stop();
    }

    // --- Phase 2: DOWNLOADING ---
    emit_active_count(&queue, &state);
    let preferred_chunk_size = state.download_max_chunk_size.load(Ordering::Relaxed).clamp(
        cfms_core::constants::MIN_DOWNLOAD_CHUNK_SIZE as usize,
        cfms_core::constants::MAX_DOWNLOAD_CHUNK_SIZE as usize,
    ) as u32;
    let resume_state = queue.get(&task_id).and_then(|task| {
        task.supports_resume.then(|| {
            let path = resume_state_path(&file_path, &task_id);
            let hint = match cfms_transfer::download::persisted_resume_hint(&path) {
                Ok(hint) => hint,
                Err(error) => {
                    tracing::warn!("Discarding invalid download checkpoint for {task_id}: {error}");
                    cleanup_resume_state(&file_path, &task_id);
                    None
                }
            };
            let offset = hint.map(|hint| hint.offset).unwrap_or(0);
            let max_chunk_size = hint
                .map(|hint| {
                    hint.chunk_size.clamp(
                        cfms_core::constants::MIN_DOWNLOAD_CHUNK_SIZE,
                        cfms_core::constants::MAX_DOWNLOAD_CHUNK_SIZE,
                    )
                })
                .unwrap_or(preferred_chunk_size);
            (path, offset, max_chunk_size)
        })
    });
    let resume_offset = resume_state
        .as_ref()
        .map(|(_, offset, _)| *offset)
        .unwrap_or(0);
    let _ = state.event_tx.send(ServiceEvent::DownloadProgress {
        task_id: task_id.clone(),
        phase: "downloading".into(),
        progress: 0.0,
        message: String::new(),
        current_bytes: resume_offset,
        total_bytes: 0,
    });

    tracing::info!("Download started: {task_id}");

    let queue_for_progress = queue.clone();
    let state_for_progress = state.clone();
    let cancel_for_progress = cancel_rx.clone();
    let tid = task_id.clone();
    let progress_throttle = Arc::new(Mutex::new(ProgressEventThrottle::new()));

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
        if progress_throttle
            .lock()
            .unwrap()
            .should_emit(phase, progress)
        {
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
        }
    };

    let dest = std::path::Path::new(&file_path);

    let result: Option<cfms_core::Result<u64>> =
        if let Some((resume_state_path, resume_offset, max_chunk_size)) = resume_state {
            tokio::select! {
                r = cfms_transfer::download::receive_with_resume(
                    transfer_conn,
                    &task_id,
                    dest,
                    resume_offset,
                    Some(&resume_state_path),
                    max_chunk_size,
                    &on_progress,
                ) => {
                    Some(r)
                }
                _ = cancel_rx.wait_for(|c| *c) => {
                    None
                }
            }
        } else {
            tokio::select! {
                r = cfms_transfer::download::receive(
                    transfer_conn,
                    &task_id,
                    dest,
                    preferred_chunk_size,
                    &on_progress,
                ) => {
                    Some(r)
                }
                _ = cancel_rx.wait_for(|c| *c) => {
                    None
                }
            }
        };

    if *cancel_rx.borrow() {
        if queue
            .get(&task_id)
            .is_some_and(|task| task.status == DownloadTaskStatus::Paused)
        {
            emit_active_count(&queue, &state);
            tracing::info!("Download paused: {task_id}");
            return DownloadOutcome::discard_and_stop();
        }

        if let Err(e) = std::fs::remove_file(&file_path)
            && e.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!("Failed to clean up partial download for {task_id}: {e}");
        }
        cleanup_resume_state(&file_path, &task_id);

        let _ = queue.update_status(&task_id, DownloadTaskStatus::Cancelled);
        emit_active_count(&queue, &state);
        let _ = state.event_tx.send(ServiceEvent::DownloadCancelled {
            task_id: task_id.clone(),
        });
        tracing::info!("Download cancelled: {task_id}");
        return DownloadOutcome::discard_and_stop();
    }

    if queue
        .get(&task_id)
        .is_some_and(|task| task.status == DownloadTaskStatus::Paused)
    {
        emit_active_count(&queue, &state);
        tracing::info!("Download paused after transfer returned: {task_id}");
        return DownloadOutcome::discard_and_stop();
    }

    match result {
        Some(Ok(file_size)) => {
            if let Err(e) = queue.mark_completed(&task_id, file_size) {
                tracing::error!("Failed to mark task {task_id} as completed: {e}");
            }
            emit_task_update(&queue, &state, &task_id);
            emit_active_count(&queue, &state);

            let _ = state.event_tx.send(ServiceEvent::DownloadCompleted {
                task_id: task_id.clone(),
                file_path,
            });

            tracing::info!("Download completed: {task_id} ({file_size} bytes)");
            DownloadOutcome::reusable()
        }

        Some(Err(e)) => {
            if *cancel_rx.borrow() {
                if queue
                    .get(&task_id)
                    .is_some_and(|task| task.status == DownloadTaskStatus::Paused)
                {
                    emit_active_count(&queue, &state);
                    tracing::info!("Download paused after connection close: {task_id}");
                    return DownloadOutcome::discard_and_stop();
                }

                if let Err(rm_err) = std::fs::remove_file(&file_path)
                    && rm_err.kind() != std::io::ErrorKind::NotFound
                {
                    tracing::warn!("Failed to clean up partial download for {task_id}: {rm_err}");
                }
                cleanup_resume_state(&file_path, &task_id);
                let _ = queue.update_status(&task_id, DownloadTaskStatus::Cancelled);
                emit_active_count(&queue, &state);
                let _ = state.event_tx.send(ServiceEvent::DownloadCancelled {
                    task_id: task_id.clone(),
                });
                tracing::info!("Download cancelled (via connection close): {task_id}");
                return DownloadOutcome::discard_and_stop();
            }

            let error_msg = e.to_string();
            tracing::error!("Download {task_id} failed: {error_msg}");

            let recovery_task = queue.get(&task_id);
            let is_unclaimable = is_unclaimable_server_task_error(&e);
            let can_recreate_automatically =
                should_automatically_recreate_server_task(recovery_task.as_ref(), &e);

            if can_recreate_automatically {
                cleanup_resume_state(&file_path, &task_id);
                match recreate_server_task(
                    &state,
                    &queue,
                    &task_id,
                    DownloadTaskStatus::Downloading,
                )
                .await
                {
                    Ok(Some(replacement)) => {
                        let _ = state.event_tx.send(ServiceEvent::DownloadTaskReplaced {
                            old_task_id: task_id.clone(),
                            task: replacement.clone(),
                        });
                        emit_active_count(&queue, &state);
                        tracing::info!(
                            "Recreated unclaimable server download {task_id} as {}",
                            replacement.task_id
                        );
                        return DownloadOutcome::reusable();
                    }
                    Ok(None) => {
                        emit_active_count(&queue, &state);
                        tracing::info!(
                            "Skipped recreation for {task_id} because its state changed"
                        );
                        return DownloadOutcome::discard_and_stop();
                    }
                    Err(recreate_error) => {
                        let recovery_error = format!(
                            "{error_msg}; automatic server task recreation failed: {recreate_error}"
                        );
                        let _ = queue.mark_failed_with_kind(
                            &task_id,
                            &recovery_error,
                            Some(DownloadFailureKind::ServerTaskUnclaimable),
                        );
                        emit_task_update(&queue, &state, &task_id);
                        emit_active_count(&queue, &state);
                        let _ = state.event_tx.send(ServiceEvent::DownloadFailed {
                            task_id: task_id.clone(),
                            error: recovery_error,
                        });
                        return DownloadOutcome::discard_and_stop();
                    }
                }
            }

            let retry_after_seconds = super::retry::is_transient_error(&e)
                .then(|| super::retry::error_retry_after_seconds(&e));

            if retry_after_seconds.is_none() {
                cleanup_resume_state(&file_path, &task_id);
                let failure_kind =
                    is_unclaimable.then_some(DownloadFailureKind::ServerTaskUnclaimable);
                let _ = queue.mark_failed_with_kind(&task_id, &error_msg, failure_kind);
                emit_task_update(&queue, &state, &task_id);
                emit_active_count(&queue, &state);
                let _ = state.event_tx.send(ServiceEvent::DownloadFailed {
                    task_id: task_id.clone(),
                    error: error_msg,
                });
                return DownloadOutcome::discard_and_stop();
            }

            match queue.retry_or_fail(&task_id, &error_msg, retry_after_seconds.flatten()) {
                Ok(DownloadTaskStatus::Failed) => {
                    emit_task_update(&queue, &state, &task_id);
                    emit_active_count(&queue, &state);
                    let _ = state.event_tx.send(ServiceEvent::DownloadFailed {
                        task_id: task_id.clone(),
                        error: error_msg,
                    });
                }
                Ok(_) => {
                    emit_task_update(&queue, &state, &task_id);
                    emit_active_count(&queue, &state);
                    tracing::info!("Download {task_id} will be retried: {error_msg}");
                }
                Err(db_err) => {
                    tracing::error!("Failed to update retry state for {task_id}: {db_err}");
                }
            }
            DownloadOutcome::discard_and_stop()
        }

        None => {
            if let Err(e) = std::fs::remove_file(&file_path)
                && e.kind() != std::io::ErrorKind::NotFound
            {
                tracing::warn!("Failed to clean up partial download for {task_id}: {e}");
            }
            cleanup_resume_state(&file_path, &task_id);

            let _ = queue.update_status(&task_id, DownloadTaskStatus::Cancelled);
            emit_active_count(&queue, &state);
            let _ = state.event_tx.send(ServiceEvent::DownloadCancelled {
                task_id: task_id.clone(),
            });

            tracing::info!("Download cancelled: {task_id}");
            DownloadOutcome::discard_and_stop()
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

fn emit_task_update(queue: &QueueState, state: &AppState, task_id: &str) {
    if let Some(task) = queue.get(task_id) {
        let _ = state
            .event_tx
            .send(ServiceEvent::DownloadTaskUpdated { task });
    }
}

fn resume_state_path(file_path: &str, task_id: &str) -> PathBuf {
    let dest = std::path::Path::new(file_path);
    let filename = format!(".cfms-download-{task_id}.chunks.db");
    dest.parent()
        .map(|parent| parent.join(&filename))
        .unwrap_or_else(|| PathBuf::from(filename))
}

fn cleanup_resume_state(file_path: &str, task_id: &str) {
    let path = resume_state_path(file_path, task_id);
    for candidate in [
        path.clone(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        if let Err(e) = std::fs::remove_file(&candidate)
            && e.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!("Failed to remove download resume state: {e}");
        }
    }
}

async fn create_transfer_connection(
    state: &AppState,
) -> cfms_core::Result<cfms_transport::Connection> {
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

    let url = url.ok_or_else(|| cfms_core::Error::Other("No server address configured".into()))?;
    let ca_dir =
        ca_dir.ok_or_else(|| cfms_core::Error::Other("No CA directory configured".into()))?;

    let tls_config = cfms_transport::tls::build_config_with_identity(
        &ca_dir,
        disable_ssl,
        client_cert_path.as_deref(),
        client_key_path.as_deref(),
    )?;

    cfms_transport::Connection::connect(&url, tls_config, proxy_addr.as_deref(), force_ipv4).await
}

// ---------------------------------------------------------------------------
// Queue management operations (called from Tauri commands)
// ---------------------------------------------------------------------------

pub fn add_task(queue: &QueueState, task: DownloadTaskDto) -> Result<()> {
    queue.insert(&task)
}

pub fn pause_task(queue: &QueueState, active: &ActiveRegistry, task_id: &str) -> Result<bool> {
    let task = match queue.get(task_id) {
        Some(t) => t,
        None => return Ok(false),
    };
    let can_pause_waiting = matches!(
        task.status,
        DownloadTaskStatus::Pending | DownloadTaskStatus::Scheduled
    );
    let can_pause_transfer = task.status == DownloadTaskStatus::Downloading && task.supports_resume;
    if !can_pause_waiting && !can_pause_transfer {
        return Ok(false);
    }
    let pause_pos = task.current_bytes;
    queue.update_status(task_id, DownloadTaskStatus::Paused)?;
    queue.set_pause_position(task_id, pause_pos)?;
    active.cancel(task_id);
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

pub fn retry_failed_task(queue: &QueueState, task_id: &str) -> Result<bool> {
    queue.retry_failed(task_id)
}

pub fn cancel_task(queue: &QueueState, active: &ActiveRegistry, task_id: &str) -> Result<bool> {
    let task = match queue.get(task_id) {
        Some(t) => t,
        None => return Ok(false),
    };
    if task.status.is_terminal() {
        return Ok(false);
    }
    queue.update_status(task_id, DownloadTaskStatus::Cancelled)?;
    active.cancel(task_id);
    cleanup_resume_state(&task.file_path, task_id);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stopping_a_batch_closes_admission_for_in_flight_producer_requests() {
        let queue = QueueState::new();
        let mut first = task("first", DownloadTaskStatus::Pending);
        first.batch_id = Some("batch".into());
        queue.insert(&first).unwrap();
        assert_eq!(queue.stop_batches(&["batch".into()]), vec!["first"]);
        let mut late = task("late", DownloadTaskStatus::Pending);
        late.batch_id = Some("batch".into());
        assert!(matches!(
            queue.insert(&late),
            Err(cfms_core::Error::Cancelled)
        ));
        assert!(queue.get("late").is_none());
        assert_eq!(queue.cancel_many(&["first".into()], true), vec!["first"]);
        let active = ActiveRegistry::new();
        assert!(queue.claim_next_pending(&active).is_none());
        assert_eq!(queue.remove_terminal(&["first".into()]).0, vec!["first"]);
        queue.clear();
        assert!(queue.insert(&late).is_ok());
    }

    fn task(id: &str, status: DownloadTaskStatus) -> DownloadTaskDto {
        DownloadTaskDto {
            task_id: id.into(),
            file_id: format!("file-{id}"),
            filename: format!("{id}.pdf"),
            file_path: format!("downloads/{id}.pdf"),
            status,
            progress: 1.0,
            current_bytes: 10,
            total_bytes: 10,
            message: Some("complete".into()),
            error: None,
            failure_kind: None,
            created_at: 1,
            started_at: Some(1),
            completed_at: Some(2),
            priority: 0,
            retry_count: 0,
            max_retries: 3,
            scheduled_time: None,
            stage: 4,
            bandwidth_limit: None,
            pause_position: None,
            supports_resume: true,
            server_task_recreate_count: 0,
            batch_id: Some("batch-1".into()),
            batch_name: Some("Evidence bundle".into()),
            batch_root_id: None,
            batch_created_at: Some(1),
            batch_estimated_total: Some(2),
        }
    }

    #[test]
    fn batch_file_deletion_reads_and_updates_tasks_together() {
        let queue = QueueState::new();
        queue
            .insert(&task("a", DownloadTaskStatus::Completed))
            .unwrap();
        queue
            .insert(&task("b", DownloadTaskStatus::Completed))
            .unwrap();

        let ids = vec!["b".to_string(), "missing".to_string(), "a".to_string()];
        let found = queue.get_many(&ids);
        assert_eq!(
            found[0].as_ref().map(|task| task.task_id.as_str()),
            Some("b")
        );
        assert!(found[1].is_none());
        assert_eq!(
            found[2].as_ref().map(|task| task.task_id.as_str()),
            Some("a")
        );

        queue.mark_files_deleted(&["a".into(), "b".into()]).unwrap();
        assert_eq!(queue.get("a").unwrap().status, DownloadTaskStatus::Deleted);
        assert_eq!(queue.get("b").unwrap().status, DownloadTaskStatus::Deleted);
        assert_eq!(queue.get("a").unwrap().message, None);
    }

    #[test]
    fn only_protocol_twenty_five_invalid_claims_request_automatic_recreation() {
        let server_error = |code, message: &str| cfms_core::Error::Server {
            code,
            message: message.into(),
            scope: None,
            limit: None,
            retry_after_seconds: None,
            task_status: None,
            retryable: Some(false),
        };
        let task = task("stale", DownloadTaskStatus::Downloading);

        assert!(should_automatically_recreate_server_task(
            Some(&task),
            &server_error(46_000, "Task cannot be claimed"),
        ));
        assert!(should_automatically_recreate_server_task(
            Some(&task),
            &server_error(46_000, "Different localized message"),
        ));
        assert!(!should_automatically_recreate_server_task(
            Some(&task),
            &server_error(400, "Task cannot be claimed"),
        ));
        assert!(!should_automatically_recreate_server_task(
            Some(&task),
            &server_error(46_001, "Task is already in progress"),
        ));

        let mut ungrouped = task.clone();
        ungrouped.batch_id = None;
        assert!(should_automatically_recreate_server_task(
            Some(&ungrouped),
            &server_error(46_000, "Task cannot be claimed"),
        ));

        let mut already_recreated = task;
        already_recreated.server_task_recreate_count = 1;
        assert!(!should_automatically_recreate_server_task(
            Some(&already_recreated),
            &server_error(46_000, "Task cannot be claimed"),
        ));
    }

    #[test]
    fn server_task_replacement_preserves_logical_download_metadata() {
        let queue = QueueState::new();
        let mut original = task("stale", DownloadTaskStatus::Downloading);
        original.progress = 0.75;
        original.current_bytes = 768;
        original.total_bytes = 1024;
        original.retry_count = 2;
        original.error = Some("old failure".into());
        original.failure_kind = Some(DownloadFailureKind::ServerTaskUnclaimable);
        queue.insert(&original).unwrap();

        let replacement = queue
            .replace_server_task("stale", DownloadTaskStatus::Downloading, "fresh", false)
            .unwrap()
            .unwrap();

        assert!(queue.get("stale").is_none());
        assert_eq!(queue.get("fresh").unwrap().task_id, "fresh");
        assert_eq!(replacement.file_id, original.file_id);
        assert_eq!(replacement.file_path, original.file_path);
        assert_eq!(replacement.batch_id, original.batch_id);
        assert_eq!(replacement.batch_created_at, original.batch_created_at);
        assert_eq!(replacement.created_at, original.created_at);
        assert_eq!(replacement.status, DownloadTaskStatus::Pending);
        assert_eq!(replacement.progress, 0.0);
        assert_eq!(replacement.current_bytes, 0);
        assert_eq!(replacement.total_bytes, 0);
        assert_eq!(replacement.retry_count, 0);
        assert_eq!(replacement.failure_kind, None);
        assert_eq!(replacement.server_task_recreate_count, 1);
        assert!(!replacement.supports_resume);
    }

    #[test]
    fn server_task_replacement_does_not_revive_changed_or_duplicate_tasks() {
        let queue = QueueState::new();
        queue
            .insert(&task("cancelled", DownloadTaskStatus::Cancelled))
            .unwrap();
        queue
            .insert(&task("fresh", DownloadTaskStatus::Pending))
            .unwrap();

        assert!(
            queue
                .replace_server_task(
                    "cancelled",
                    DownloadTaskStatus::Downloading,
                    "replacement",
                    true,
                )
                .unwrap()
                .is_none()
        );
        assert!(queue.get("cancelled").is_some());
        assert!(
            queue
                .replace_server_task("cancelled", DownloadTaskStatus::Cancelled, "fresh", true,)
                .is_err()
        );
        assert!(queue.get("cancelled").is_some());
        assert!(queue.get("fresh").is_some());
    }

    #[test]
    fn clear_drops_download_persistence_key_context() {
        let app_data = tempfile::tempdir().unwrap();
        let key = [0xA5; KEY_LEN];
        let queue = QueueState::new();

        queue
            .load_for_user(app_data.path(), "server", "alice", Some(&key))
            .unwrap();
        assert!(
            queue
                .persist_ctx
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .dek
                .is_some()
        );

        queue.clear();
        assert!(queue.persist_ctx.lock().unwrap().is_none());
    }

    #[test]
    fn failed_download_reload_leaves_no_key_context() {
        let app_data = tempfile::tempdir().unwrap();
        let correct_key = [1; KEY_LEN];
        let wrong_key = [2; KEY_LEN];
        task_persistence::save(app_data.path(), "server", "alice", Some(&correct_key), &[])
            .unwrap();
        let queue = QueueState::new();

        assert!(
            queue
                .load_for_user(app_data.path(), "server", "alice", Some(&wrong_key))
                .is_err()
        );
        assert!(queue.persist_ctx.lock().unwrap().is_none());
    }
}
