//! Process-local directory discovery and queue production. The durable queue owns transfers.
use super::download_queue::QueueState;
use crate::{
    rpc::{ActionFailure, SessionIdentity, action_once_guarded},
    state::AppState,
};
use cfms_core::{DownloadTaskDto, ServiceEvent};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::sync::watch;

#[derive(Clone, Deserialize)]
pub struct DownloadSelection {
    pub id: String,
    pub name: String,
    pub kind: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadBatchSnapshot {
    pub batch_id: String,
    pub batch_name: String,
    pub batch_root_id: Option<String>,
    pub batch_created_at: i64,
    pub phase: String,
    pub paused: bool,
    pub discovered: usize,
    pub queued: usize,
    pub failed: usize,
    pub rate_limited: usize,
    pub rate_limit_waiting: bool,
    pub finished: bool,
    pub error: Option<String>,
}
#[derive(Clone, Copy, Default)]
struct Control {
    paused: bool,
    stopped: bool,
}
struct Batch {
    identity: SessionIdentity,
    snapshot: Mutex<DownloadBatchSnapshot>,
    control: watch::Sender<Control>,
    done: watch::Sender<bool>,
}
#[derive(Default)]
pub struct DownloadBatchRegistry {
    batches: Mutex<HashMap<String, Arc<Batch>>>,
}

impl DownloadBatchRegistry {
    pub async fn start(
        state: Arc<AppState>,
        queue: QueueState,
        root: PathBuf,
        selection: Vec<DownloadSelection>,
        name: String,
        root_id: Option<String>,
    ) -> Result<DownloadBatchSnapshot, String> {
        if selection.is_empty()
            || selection
                .iter()
                .any(|v| v.id.is_empty() || !["directory", "document"].contains(&v.kind.as_str()))
        {
            return Err("Invalid download selection".into());
        }
        let identity = SessionIdentity::capture(&state).await?;
        let id = format!("download-batch:{:032x}", rand::random::<u128>());
        let snapshot = DownloadBatchSnapshot {
            batch_id: id.clone(),
            batch_name: name,
            batch_root_id: root_id,
            batch_created_at: crate::authentication::unix_now() as i64,
            phase: "collecting".into(),
            paused: false,
            discovered: 0,
            queued: 0,
            failed: 0,
            rate_limited: 0,
            rate_limit_waiting: false,
            finished: false,
            error: None,
        };
        let (control, _) = watch::channel(Control::default());
        let (done, _) = watch::channel(false);
        let batch = Arc::new(Batch {
            identity,
            snapshot: Mutex::new(snapshot.clone()),
            control,
            done,
        });
        state
            .download_batches
            .batches
            .lock()
            .unwrap()
            .retain(|_, b| !*b.done.borrow());
        state
            .download_batches
            .batches
            .lock()
            .unwrap()
            .insert(id, batch.clone());
        tokio::spawn(async move {
            let result = produce(&state, &queue, &root, &selection, &batch).await;
            {
                let mut snapshot = batch.snapshot.lock().unwrap();
                snapshot.finished = true;
                snapshot.paused = false;
                snapshot.error = result.err();
            }
            batch.done.send_replace(true);
            if batch.identity.ensure_current(&state).await.is_ok() {
                let snapshot = batch.snapshot.lock().unwrap().clone();
                let _ = state.event_tx.send(ServiceEvent::DownloadBatchFinished {
                    queued: snapshot.queued as u32,
                    failed: snapshot.failed as u32,
                    rate_limited: snapshot.rate_limited as u32,
                    stopped: batch.control.borrow().stopped,
                });
            }
            notify(&state);
        });
        Ok(snapshot)
    }
    pub async fn snapshots(&self, state: &AppState) -> Vec<DownloadBatchSnapshot> {
        let Ok(identity) = SessionIdentity::capture(state).await else {
            return vec![];
        };
        self.batches
            .lock()
            .unwrap()
            .values()
            .filter(|b| b.identity == identity)
            .map(|b| b.snapshot.lock().unwrap().clone())
            .collect()
    }
    pub fn control(&self, ids: &[String], action: &str) {
        let batches = self.batches.lock().unwrap();
        for id in ids {
            if let Some(batch) = batches.get(id) {
                batch.control.send_modify(|c| match action {
                    "pause" => c.paused = true,
                    "resume" => c.paused = false,
                    "cancel" | "cancel_and_remove" => {
                        c.stopped = true;
                        c.paused = false;
                    }
                    _ => {}
                });
                batch.snapshot.lock().unwrap().paused = batch.control.borrow().paused;
            }
        }
    }
    pub fn stop_all(&self) {
        for batch in self.batches.lock().unwrap().values() {
            batch.control.send_modify(|c| {
                c.stopped = true;
                c.paused = false;
            });
        }
    }
    pub async fn wait_all_stopped(&self) {
        let ids = self
            .batches
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        if let Err(error) = self.wait_stopped(&ids).await {
            tracing::warn!("{error}");
        }
    }
    pub async fn wait_stopped(&self, ids: &[String]) -> Result<(), String> {
        let batches: Vec<_> = {
            let map = self.batches.lock().unwrap();
            ids.iter().filter_map(|id| map.get(id).cloned()).collect()
        };
        for batch in batches {
            let mut done = batch.done.subscribe();
            if !*done.borrow() {
                tokio::time::timeout(std::time::Duration::from_secs(35), done.wait_for(|v| *v))
                    .await
                    .map_err(|_| "Download producer did not stop")?
                    .map_err(|_| "Download producer stopped unexpectedly")?;
            }
        }
        Ok(())
    }
}

fn notify(state: &AppState) {
    let _ = state.event_tx.send(ServiceEvent::DownloadBatchesChanged);
}
async fn ready(state: &AppState, batch: &Batch) -> Result<(), String> {
    let mut control = batch.control.subscribe();
    loop {
        batch.identity.ensure_current(state).await?;
        let value = *control.borrow_and_update();
        if value.stopped {
            return Err("Folder download queueing stopped".into());
        }
        if !value.paused {
            return Ok(());
        }
        control
            .changed()
            .await
            .map_err(|_| "Download control closed")?;
    }
}
async fn request(
    state: &AppState,
    batch: &Batch,
    action: &str,
    data: serde_json::Value,
) -> Result<serde_json::Value, ActionFailure> {
    for attempt in 0..=super::retry::MAX_BACKGROUND_RETRIES {
        ready(state, batch).await.map_err(ActionFailure::local)?;
        match action_once_guarded(state, &batch.identity, action, data.clone(), || {
            ready(state, batch)
        })
        .await
        {
            Ok(value) => return Ok(value),
            Err(error) if error.transient() && attempt < super::retry::MAX_BACKGROUND_RETRIES => {
                batch.snapshot.lock().unwrap().rate_limit_waiting = true;
                notify(state);
                let delay = super::retry::retry_delay(attempt + 1, error.retry_after());
                let deadline = tokio::time::Instant::now() + delay;
                while tokio::time::Instant::now() < deadline {
                    ready(state, batch).await.map_err(ActionFailure::local)?;
                    tokio::time::sleep(
                        std::time::Duration::from_millis(100)
                            .min(deadline.saturating_duration_since(tokio::time::Instant::now())),
                    )
                    .await;
                }
                batch.snapshot.lock().unwrap().rate_limit_waiting = false;
            }
            Err(error) => return Err(error),
        }
    }
    unreachable!()
}

async fn produce(
    state: &AppState,
    queue: &QueueState,
    root: &std::path::Path,
    selection: &[DownloadSelection],
    batch: &Batch,
) -> Result<(), String> {
    let mut folders = Vec::new();
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    for entry in selection {
        let name = crate::files::download_paths::sanitize_name(&entry.name);
        if entry.kind == "directory" {
            folders.push((entry.id.clone(), name));
        } else if seen.insert(("document".to_string(), entry.id.clone())) {
            items.push((entry.id.clone(), name));
        }
    }
    while let Some((id, path)) = folders.pop() {
        if !seen.insert(("directory".into(), id.clone())) {
            continue;
        }
        ready(state, batch).await?;
        if let Err(error) = crate::files::download_paths::prepare_directory(root, &path) {
            record_failure(state, batch, &ActionFailure::local(error));
            continue;
        }
        let mut cursor: Option<String> = None;
        let mut cursors = HashSet::new();
        loop {
            let response = request(state, batch, "core.directory.list", serde_json::json!({"folder_id": id, "cursor": cursor, "page_size": crate::files::SERVER_CURSOR_PAGE_SIZE})).await;
            let response = match response {
                Ok(value) => value,
                Err(error) => {
                    ready(state, batch).await?;
                    record_failure(state, batch, &error);
                    break;
                }
            };
            let page = match crate::files::parse_listing_page_dto(response) {
                Ok(page) => page,
                Err(error) => {
                    record_failure(state, batch, &ActionFailure::local(error));
                    break;
                }
            };
            for doc in page.documents {
                if seen.insert(("document".into(), doc.id.clone())) {
                    items.push((
                        doc.id,
                        format!(
                            "{path}/{}",
                            crate::files::download_paths::sanitize_name(&doc.title)
                        ),
                    ));
                }
            }
            for folder in page.folders {
                folders.push((
                    folder.id,
                    format!(
                        "{path}/{}",
                        crate::files::download_paths::sanitize_name(&folder.name)
                    ),
                ));
            }
            batch.snapshot.lock().unwrap().discovered = items.len();
            notify(state);
            if !page.has_more {
                break;
            }
            cursor = page.next_cursor;
            if !cursors.insert(cursor.clone()) {
                record_failure(
                    state,
                    batch,
                    &ActionFailure::local("Directory returned a repeated cursor"),
                );
                break;
            }
        }
    }
    {
        let mut s = batch.snapshot.lock().unwrap();
        s.discovered = items.len();
        s.phase = "queueing".into();
    }
    notify(state);
    for (id, filename) in items {
        ready(state, batch).await?;
        let destination = match crate::files::download_paths::prepare_file(root, &filename) {
            Ok(path) => path,
            Err(error) => {
                record_failure(state, batch, &ActionFailure::local(error));
                continue;
            }
        };
        let raw = match request(
            state,
            batch,
            "core.document.get",
            serde_json::json!({"document_id": id}),
        )
        .await
        {
            Ok(raw) => raw,
            Err(error) => {
                ready(state, batch).await?;
                record_failure(state, batch, &error);
                continue;
            }
        };
        ready(state, batch).await?;
        let metadata = batch.snapshot.lock().unwrap().clone();
        let mut task = match super::download_task::from_response(&raw, id, destination) {
            Ok(task) => task,
            Err(error) => {
                record_failure(state, batch, &ActionFailure::local(error));
                continue;
            }
        };
        task.batch_id = Some(metadata.batch_id);
        task.batch_name = Some(metadata.batch_name);
        task.batch_root_id = metadata.batch_root_id;
        task.batch_created_at = Some(metadata.batch_created_at);
        task.batch_estimated_total = Some((metadata.queued + 1) as u32);
        // Keep control admission and queue insertion in one synchronous critical section.
        let admission = loop {
            ready(state, batch).await?;
            let _auth = state.auth_update.lock().await;
            if state
                .auth_generation
                .load(std::sync::atomic::Ordering::SeqCst)
                != batch.identity.generation
            {
                return Err("Download session changed".into());
            }
            match admit(queue, batch, &task) {
                Ok(true) => break Ok(()),
                Ok(false) => continue,
                Err(error) => break Err(error),
            }
        };
        if let Err(error) = admission {
            ready(state, batch).await?;
            record_failure(state, batch, &ActionFailure::local(error));
            continue;
        }
        batch.snapshot.lock().unwrap().queued += 1;
        let _ = state
            .event_tx
            .send(ServiceEvent::DownloadTaskUpdated { task });
        let _ = state.event_tx.send(ServiceEvent::ActiveCountChanged {
            count: queue.active_count(),
        });
        notify(state);
    }
    Ok(())
}
fn admit(queue: &QueueState, batch: &Batch, task: &DownloadTaskDto) -> Result<bool, String> {
    let control = batch.control.borrow();
    if control.stopped {
        return Err("Download batch stopped before admission".into());
    }
    if control.paused {
        return Ok(false);
    }
    queue.insert(task).map_err(|e| e.to_string())?;
    Ok(true)
}

fn record_failure(state: &AppState, batch: &Batch, error: &ActionFailure) {
    let mut s = batch.snapshot.lock().unwrap();
    s.failed += 1;
    if error.status == Some(429) {
        s.rate_limited += 1;
    }
    s.error = Some(error.to_string());
    drop(s);
    notify(state);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_rpc::{Peer, page};
    use serde_json::json;

    async fn finish(state: &AppState, id: &str) -> DownloadBatchSnapshot {
        let mut events = state.event_tx.subscribe();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let snapshot = state
                    .download_batches
                    .snapshots(state)
                    .await
                    .into_iter()
                    .find(|b| b.batch_id == id)
                    .unwrap();
                if snapshot.finished {
                    return snapshot;
                }
                events.recv().await.unwrap();
            }
        })
        .await
        .unwrap()
    }
    #[tokio::test]
    async fn discovers_all_pages_preserves_empty_directories_and_queues_native_tasks() {
        let peer = Peer::new(|request| {
            Some((
                200,
                match request["action"].as_str().unwrap() {
                    "core.directory.list"
                        if request["data"]["folder_id"] == "root"
                            && request["data"]["cursor"].is_null() =>
                    {
                        page(
                            json!([{"type":"directory","id":"empty","name":"Empty"}]),
                            Some("next"),
                        )
                    }
                    "core.directory.list" if request["data"]["folder_id"] == "root" => page(
                        json!([{"type":"document","id":"doc","title":"Report: one.txt"}]),
                        None,
                    ),
                    "core.directory.list" => page(json!([]), None),
                    "core.document.get" => {
                        json!({"task_data":{"task_id":"task", "supports_resume":true}})
                    }
                    _ => panic!("Unexpected request: {request}"),
                },
            ))
        })
        .await;
        let root = tempfile::tempdir().unwrap();
        let queue = QueueState::new();
        let batch = DownloadBatchRegistry::start(
            peer.state.clone(),
            queue.clone(),
            root.path().into(),
            vec![DownloadSelection {
                id: "root".into(),
                name: "Root".into(),
                kind: "directory".into(),
            }],
            "Root".into(),
            None,
        )
        .await
        .unwrap();
        let result = finish(&peer.state, &batch.batch_id).await;
        assert_eq!((result.discovered, result.queued, result.failed), (1, 1, 0));
        assert!(root.path().join("Root/Empty").is_dir());
        let tasks = queue.list(None);
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].filename, "Report one.txt");
        assert_eq!(tasks[0].batch_id.as_deref(), Some(batch.batch_id.as_str()));
        assert_eq!(tasks[0].batch_estimated_total, Some(1));
        assert!(tasks[0].supports_resume);
    }
    #[tokio::test]
    async fn paused_discovery_can_be_cancelled_without_sending_any_request() {
        let peer = Peer::new(|_| panic!("Paused producer must not send")).await;
        let root = tempfile::tempdir().unwrap();
        let queue = QueueState::new();
        let batch = DownloadBatchRegistry::start(
            peer.state.clone(),
            queue.clone(),
            root.path().into(),
            vec![DownloadSelection {
                id: "doc".into(),
                name: "File".into(),
                kind: "document".into(),
            }],
            "Root".into(),
            None,
        )
        .await
        .unwrap();
        peer.state
            .download_batches
            .control(std::slice::from_ref(&batch.batch_id), "pause");
        peer.state
            .download_batches
            .control(std::slice::from_ref(&batch.batch_id), "cancel");
        peer.state
            .download_batches
            .wait_stopped(std::slice::from_ref(&batch.batch_id))
            .await
            .unwrap();
        assert!(queue.list(None).is_empty());
        assert!(peer.requests.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn partial_directory_denial_does_not_discard_other_selected_documents() {
        let peer = Peer::new(|request| {
            Some(if request["action"] == "core.directory.list" {
                (403, json!({}))
            } else {
                (200, json!({"task_data":{"task_id":"task"}}))
            })
        })
        .await;
        let root = tempfile::tempdir().unwrap();
        let queue = QueueState::new();
        let selection = vec![
            DownloadSelection {
                id: "folder".into(),
                name: "Denied".into(),
                kind: "directory".into(),
            },
            DownloadSelection {
                id: "doc".into(),
                name: "File".into(),
                kind: "document".into(),
            },
        ];
        let batch = DownloadBatchRegistry::start(
            peer.state.clone(),
            queue.clone(),
            root.path().into(),
            selection,
            "Mixed".into(),
            None,
        )
        .await
        .unwrap();
        let result = finish(&peer.state, &batch.batch_id).await;
        assert_eq!((result.queued, result.failed), (1, 1));
        assert_eq!(queue.list(None).len(), 1);
    }
    #[tokio::test]
    async fn cancelled_in_flight_task_creation_cannot_enter_the_queue() {
        let gate = Arc::new(tokio::sync::Notify::new());
        let peer = Peer::gated(
            |_| Some((200, json!({"task_data":{"task_id":"late"}}))),
            gate.clone(),
        )
        .await;
        let root = tempfile::tempdir().unwrap();
        let queue = QueueState::new();
        let batch = DownloadBatchRegistry::start(
            peer.state.clone(),
            queue.clone(),
            root.path().into(),
            vec![DownloadSelection {
                id: "doc".into(),
                name: "File".into(),
                kind: "document".into(),
            }],
            "Root".into(),
            None,
        )
        .await
        .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), peer.received.notified())
            .await
            .unwrap();
        peer.state
            .download_batches
            .control(std::slice::from_ref(&batch.batch_id), "cancel");
        queue.stop_batches(std::slice::from_ref(&batch.batch_id));
        gate.notify_one();
        peer.state
            .download_batches
            .wait_stopped(std::slice::from_ref(&batch.batch_id))
            .await
            .unwrap();
        assert!(queue.list(None).is_empty());
        assert_eq!(peer.requests.lock().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn a_late_old_account_response_cannot_admit_a_download_into_the_new_session() {
        let gate = Arc::new(tokio::sync::Notify::new());
        let peer = Peer::gated(
            |_| Some((200, json!({"task_data":{"task_id":"old"}}))),
            gate.clone(),
        )
        .await;
        let root = tempfile::tempdir().unwrap();
        let queue = QueueState::new();
        let batch = DownloadBatchRegistry::start(
            peer.state.clone(),
            queue.clone(),
            root.path().into(),
            vec![DownloadSelection {
                id: "doc".into(),
                name: "File".into(),
                kind: "document".into(),
            }],
            "Root".into(),
            None,
        )
        .await
        .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), peer.received.notified())
            .await
            .unwrap();
        peer.state.clear_auth().await;
        *peer.state.username.write().await = Some("bob".into());
        gate.notify_one();
        peer.state
            .download_batches
            .wait_stopped(std::slice::from_ref(&batch.batch_id))
            .await
            .unwrap();
        assert!(queue.list(None).is_empty());
        assert!(
            peer.state
                .download_batches
                .snapshots(&peer.state)
                .await
                .is_empty()
        );
    }
}
