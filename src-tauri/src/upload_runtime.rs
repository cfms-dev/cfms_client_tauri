//! Session-bound upload workers. UI refreshes never own worker lifetimes.
use std::collections::HashMap;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};
use tokio::sync::{Notify, watch};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadInterruption {
    Paused,
    Cancelled,
}

struct ActiveUpload {
    control: watch::Sender<Option<UploadInterruption>>,
    connection: Option<cfms_transport::Connection>,
    generation: u64,
    run_id: u64,
    occupied: bool,
}

#[derive(Clone, Default)]
pub struct ActiveUploadRegistry {
    inner: Arc<Mutex<HashMap<String, ActiveUpload>>>,
    pub changed: Arc<Notify>,
    next_run: Arc<AtomicU64>,
}

impl ActiveUploadRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &self,
        id: &str,
        generation: u64,
    ) -> watch::Receiver<Option<UploadInterruption>> {
        let (control, receiver) = watch::channel(None);
        self.inner.lock().unwrap().insert(
            id.into(),
            ActiveUpload {
                control,
                connection: None,
                generation,
                occupied: true,
                run_id: self.next_run.fetch_add(1, Ordering::SeqCst) + 1,
            },
        );
        receiver
    }

    pub fn subscribe(&self, id: &str) -> Option<watch::Receiver<Option<UploadInterruption>>> {
        self.inner
            .lock()
            .unwrap()
            .get(id)
            .map(|a| a.control.subscribe())
    }

    pub fn generation(&self, id: &str) -> Option<u64> {
        self.inner.lock().unwrap().get(id).map(|a| a.generation)
    }

    pub fn run_id(&self, id: &str) -> Option<u64> {
        self.inner.lock().unwrap().get(id).map(|a| a.run_id)
    }

    pub fn occupied(&self) -> usize {
        self.inner
            .lock()
            .unwrap()
            .values()
            .filter(|a| a.occupied)
            .count()
    }

    pub fn is_parked(&self, id: &str) -> bool {
        self.inner
            .lock()
            .unwrap()
            .get(id)
            .is_some_and(|a| !a.occupied)
    }

    /// Called by the worker at a safe checkpoint, not by the pause button.
    pub fn park(&self, id: &str) {
        if let Some(active) = self.inner.lock().unwrap().get_mut(id) {
            active.occupied = false;
        }
        self.changed.notify_one();
    }

    /// Only the scheduler may admit a parked worker back to a transfer slot.
    pub fn resume(&self, id: &str) -> bool {
        let mut entries = self.inner.lock().unwrap();
        let Some(active) = entries.get_mut(id) else {
            return false;
        };
        if active.occupied || *active.control.borrow() != Some(UploadInterruption::Paused) {
            return false;
        }
        active.occupied = true;
        active.control.send(None).is_ok()
    }

    pub fn set_transfer_conn(&self, id: &str, connection: cfms_transport::Connection) {
        if let Some(active) = self.inner.lock().unwrap().get_mut(id) {
            active.connection = Some(connection);
        }
    }

    pub fn clear_transfer_conn(&self, id: &str) {
        if let Some(active) = self.inner.lock().unwrap().get_mut(id) {
            active.connection = None;
        }
    }

    pub fn unregister(&self, id: &str) {
        let removed = self.inner.lock().unwrap().remove(id);
        if let Some(connection) = removed.and_then(|a| a.connection) {
            tauri::async_runtime::spawn(async move {
                let _ = tokio::time::timeout(std::time::Duration::from_secs(5), connection.close())
                    .await;
            });
        }
        self.changed.notify_one();
    }

    pub fn interrupt(&self, id: &str, reason: UploadInterruption) -> bool {
        let mut entries = self.inner.lock().unwrap();
        let Some(active) = entries.get_mut(id) else {
            return false;
        };
        // Cancellation is irreversible for an execution, even if Pause races it.
        if *active.control.borrow() == Some(UploadInterruption::Cancelled) {
            return true;
        }
        let _ = active.control.send(Some(reason));
        if let Some(connection) = active.connection.take() {
            tauri::async_runtime::spawn(async move {
                let _ = tokio::time::timeout(std::time::Duration::from_secs(5), connection.close())
                    .await;
            });
        }
        self.changed.notify_one();
        true
    }

    pub fn interrupt_all(&self, reason: UploadInterruption) {
        let ids: Vec<_> = self.inner.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.interrupt(&id, reason);
        }
    }
}

pub struct UploadWorkerGuard(pub ActiveUploadRegistry, pub String);
impl Drop for UploadWorkerGuard {
    fn drop(&mut self) {
        self.0.unregister(&self.1);
    }
}

pub async fn wait_for_stopped(
    mut ids: Vec<String>,
    timeout: std::time::Duration,
    active: impl Fn(&str) -> bool,
) -> (Vec<String>, Vec<String>) {
    let deadline = tokio::time::Instant::now() + timeout;
    let mut stopped = Vec::new();
    loop {
        ids.retain(|id| {
            if active(id) {
                true
            } else {
                stopped.push(id.clone());
                false
            }
        });
        if ids.is_empty() || tokio::time::Instant::now() >= deadline {
            return (stopped, ids);
        }
        tokio::time::sleep(
            std::time::Duration::from_millis(25)
                .min(deadline.saturating_duration_since(tokio::time::Instant::now())),
        )
        .await;
    }
}

pub struct UploadAdmission {
    pub id: String,
    pub generation: u64,
    pub control: Option<watch::Receiver<Option<UploadInterruption>>>,
}

/// One scheduler pass, shared by production and deterministic lifecycle tests.
pub fn admit_uploads(
    queue: &cfms_service::services::upload_queue::UploadQueueState,
    registry: &ActiveUploadRegistry,
    limit: usize,
) -> Vec<UploadAdmission> {
    use cfms_core::UploadTaskStatus as Status;
    let generation = queue.generation();
    let mut pending = queue.list();
    pending.sort_by_key(|t| (t.queue_order, t.created_at, t.batch_index));
    let mut admitted = Vec::new();
    for task in pending {
        if task.status != Status::Pending || registry.occupied() >= limit.clamp(1, 8) {
            continue;
        }
        let id = task.upload_id;
        if let Some(previous) = registry.generation(&id) {
            if previous != generation {
                registry.interrupt(&id, UploadInterruption::Cancelled);
                continue;
            }
            if !registry.is_parked(&id) || !queue.claim(&id) {
                continue;
            }
            if registry.resume(&id) {
                admitted.push(UploadAdmission {
                    id,
                    generation,
                    control: None,
                });
            } else {
                let _ = queue.set_status(&id, Status::Paused, "Upload paused");
            }
            continue;
        }
        let control = registry.register(&id, generation);
        if !queue.claim(&id) {
            registry.unregister(&id);
            continue;
        }
        admitted.push(UploadAdmission {
            id,
            generation,
            control: Some(control),
        });
    }
    admitted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_retried_task_has_a_distinct_execution_token() {
        let registry = ActiveUploadRegistry::new();
        let _first = registry.register("file", 1);
        let previous = registry.run_id("file");
        registry.unregister("file");
        let _retry = registry.register("file", 1);
        assert_ne!(registry.run_id("file"), previous);
        assert_eq!(registry.generation("file"), Some(1));
    }

    #[tokio::test]
    async fn stop_confirmation_returns_only_idle_ids_and_preserves_timeouts() {
        let registry = ActiveUploadRegistry::new();
        let _receiver = registry.register("still-running", 1);
        let (stopped, timed_out) = wait_for_stopped(
            vec!["finished".into(), "still-running".into()],
            std::time::Duration::ZERO,
            |id| registry.subscribe(id).is_some(),
        )
        .await;
        assert_eq!(stopped, vec!["finished"]);
        assert_eq!(timed_out, vec!["still-running"]);
        registry.unregister("still-running");
        let (stopped, timed_out) =
            wait_for_stopped(timed_out, std::time::Duration::from_secs(10), |_| false).await;
        assert_eq!(stopped, vec!["still-running"]);
        assert!(timed_out.is_empty());
    }

    fn queued(id: &str) -> cfms_core::UploadTaskDto {
        serde_json::from_value(serde_json::json!({
            "upload_id": id, "file_name": id, "source_path": id, "kind": "file",
            "status": "pending", "progress": 0.0, "current_bytes": 0, "total_bytes": 10,
            "created_at": 1, "updated_at": 1, "retry_count": 0, "max_retries": 3, "source_available": true,
        })).unwrap()
    }

    #[test]
    fn sixty_seven_uploads_drain_at_three_slots_without_any_ui_callback() {
        use cfms_core::UploadTaskStatus as Status;
        let queue = cfms_service::services::upload_queue::UploadQueueState::new();
        queue
            .insert_many(
                (0..67)
                    .map(|i| (queued(&format!("file-{i}")), serde_json::Value::Null))
                    .collect(),
            )
            .unwrap();
        let registry = ActiveUploadRegistry::new();
        let mut completed = Vec::new();
        while completed.len() < 67 {
            let admitted = admit_uploads(&queue, &registry, 3);
            assert!(!admitted.is_empty(), "queue stopped with pending files");
            assert!(registry.occupied() <= 3);
            for admission in admitted {
                let _worker = UploadWorkerGuard(registry.clone(), admission.id.clone());
                assert_eq!(admission.id, format!("file-{}", completed.len()));
                queue
                    .set_status(&admission.id, Status::Completed, "Complete")
                    .unwrap();
                completed.push(admission.id);
            }
        }
        assert_eq!(registry.occupied(), 0);
        assert!(queue.list().iter().all(|t| t.status == Status::Completed));
    }

    #[test]
    fn a_parked_upload_is_re_admitted_without_creating_a_second_worker() {
        use cfms_core::UploadTaskStatus as Status;
        let queue = cfms_service::services::upload_queue::UploadQueueState::new();
        for id in ["a", "b", "c"] {
            queue.insert(queued(id), serde_json::Value::Null).unwrap();
        }
        let registry = ActiveUploadRegistry::new();
        let initial = admit_uploads(&queue, &registry, 1);
        assert_eq!(initial[0].id, "a");
        registry.interrupt("a", UploadInterruption::Paused);
        queue.set_status("a", Status::Paused, "Paused").unwrap();
        registry.park("a");
        assert_eq!(admit_uploads(&queue, &registry, 1)[0].id, "b");
        queue.set_status("a", Status::Pending, "Waiting").unwrap();
        assert!(admit_uploads(&queue, &registry, 1).is_empty());
        registry.unregister("b");
        queue.set_status("b", Status::Failed, "Failed").unwrap();
        let resumed = admit_uploads(&queue, &registry, 1);
        assert_eq!(resumed[0].id, "a");
        assert!(resumed[0].control.is_none());
        assert_eq!(registry.occupied(), 1);
        // Increasing the limit admits c; lowering it never interrupts a worker.
        assert_eq!(admit_uploads(&queue, &registry, 2)[0].id, "c");
        assert!(admit_uploads(&queue, &registry, 1).is_empty());
        assert_eq!(registry.occupied(), 2);
    }

    #[test]
    fn cancelling_a_batch_prevents_queued_members_from_starting() {
        let queue = cfms_service::services::upload_queue::UploadQueueState::new();
        let ids: Vec<_> = (0..67).map(|i| format!("file-{i}")).collect();
        queue
            .insert_many(
                ids.iter()
                    .map(|id| (queued(id), serde_json::Value::Null))
                    .collect(),
            )
            .unwrap();
        assert_eq!(queue.cancel_many(&ids, true).len(), 67);
        assert!(admit_uploads(&queue, &ActiveUploadRegistry::new(), 3).is_empty());
        assert_eq!(queue.remove_terminal(&ids).0.len(), 67);
        queue.update_progress(
            "file-0",
            None,
            "file-0",
            10,
            10,
            cfms_core::UploadTaskStatus::Uploading,
            None,
        );
        assert!(queue.list().is_empty());
    }

    #[test]
    fn parking_releases_a_slot_and_resume_requires_admission() {
        let registry = ActiveUploadRegistry::new();
        let receiver = registry.register("file", 1);
        assert_eq!(registry.occupied(), 1);
        registry.interrupt("file", UploadInterruption::Paused);
        assert_eq!(registry.occupied(), 1);
        registry.park("file");
        assert_eq!(registry.occupied(), 0);
        assert!(registry.resume("file"));
        assert_eq!(*receiver.borrow(), None);
        assert_eq!(registry.occupied(), 1);
    }

    #[test]
    fn cancellation_cannot_be_overridden_and_drop_releases_slot() {
        let registry = ActiveUploadRegistry::new();
        let receiver = registry.register("file", 2);
        let guard = UploadWorkerGuard(registry.clone(), "file".into());
        registry.interrupt("file", UploadInterruption::Cancelled);
        registry.interrupt("file", UploadInterruption::Paused);
        assert_eq!(*receiver.borrow(), Some(UploadInterruption::Cancelled));
        assert!(!registry.resume("file"));
        drop(guard);
        assert_eq!(registry.occupied(), 0);
        assert!(registry.subscribe("file").is_none());
    }
}
