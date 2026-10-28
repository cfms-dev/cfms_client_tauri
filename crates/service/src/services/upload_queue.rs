//! Persistent upload task metadata. Transfer execution remains session-bound.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};

use cfms_core::constants::KEY_LEN;
use cfms_core::{Result, UploadTaskDto, UploadTaskStatus};

use super::upload_task_persistence::{self, UploadTaskRecord};
use crate::sensitive::SecretKey;

#[derive(Clone)]
struct PersistContext {
    dir: PathBuf,
    server_hash: String,
    username: String,
    dek: Option<SecretKey>,
}

#[derive(Clone, Default)]
pub struct UploadQueueState {
    records: Arc<Mutex<HashMap<String, UploadTaskRecord>>>,
    persist_ctx: Arc<Mutex<Option<PersistContext>>>,
    persistence_lock: Arc<Mutex<()>>,
    generation: Arc<AtomicU64>,
    sequence: Arc<AtomicU64>,
}

impl UploadQueueState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn load_for_user(
        &self,
        app_data: &std::path::Path,
        server_hash: &str,
        username: &str,
        dek: Option<&[u8; KEY_LEN]>,
    ) -> Result<usize> {
        self.clear();
        let loaded = upload_task_persistence::load(app_data, server_hash, username, dek)?;
        self.sequence.fetch_max(
            loaded
                .iter()
                .map(|r| r.task.revision.max(r.task.queue_order))
                .max()
                .unwrap_or(0),
            Ordering::SeqCst,
        );
        let count = loaded.len();
        *self.persist_ctx.lock().unwrap() = Some(PersistContext {
            dir: app_data.to_path_buf(),
            server_hash: server_hash.to_string(),
            username: username.to_string(),
            dek: dek.map(|value| zeroize::Zeroizing::new(*value)),
        });
        *self.records.lock().unwrap() = loaded
            .into_iter()
            .map(|record| (record.task.upload_id.clone(), record))
            .collect();
        self.save();
        Ok(count)
    }

    pub fn clear(&self) {
        let _save = self.persistence_lock.lock().unwrap();
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.records.lock().unwrap().clear();
        *self.persist_ctx.lock().unwrap() = None;
    }

    pub fn insert(&self, task: UploadTaskDto, request: serde_json::Value) -> Result<()> {
        self.insert_many(vec![(task, request)])?;
        Ok(())
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    pub fn get(&self, id: &str) -> Option<UploadTaskDto> {
        self.records.lock().unwrap().get(id).map(|r| r.task.clone())
    }

    /// Commit a batch before making any of its members available to workers.
    pub fn insert_many(&self, tasks: Vec<(UploadTaskDto, serde_json::Value)>) -> Result<()> {
        let _save = self.persistence_lock.lock().unwrap();
        let mut records = self.records.lock().unwrap();
        let mut staged = records.clone();
        for (mut task, request) in tasks {
            if staged.contains_key(&task.upload_id) {
                continue;
            }
            task.queue_order = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
            task.revision = task.queue_order;
            staged.insert(task.upload_id.clone(), UploadTaskRecord { task, request });
        }
        if let Some(ctx) = self.persist_ctx.lock().unwrap().as_ref() {
            upload_task_persistence::save(
                &ctx.dir,
                &ctx.server_hash,
                &ctx.username,
                ctx.dek.as_ref().map(|dek| &**dek),
                &staged.values().cloned().collect::<Vec<_>>(),
            )?;
        }
        *records = staged;
        Ok(())
    }

    /// Atomic claim prevents pause/cancel and the scheduler from racing.
    pub fn claim(&self, id: &str) -> bool {
        let mut records = self.records.lock().unwrap();
        let Some(record) = records.get_mut(id) else {
            return false;
        };
        if record.task.status != UploadTaskStatus::Pending {
            return false;
        }
        record.task.status = UploadTaskStatus::Uploading;
        record.task.revision = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        drop(records);
        self.save();
        true
    }

    pub fn cancel_many(&self, ids: &[String], include_finished: bool) -> Vec<String> {
        let mut records = self.records.lock().unwrap();
        let mut accepted = Vec::new();
        for id in ids {
            if let Some(record) = records.get_mut(id) {
                if record.task.status.is_terminal() {
                    if include_finished {
                        accepted.push(id.clone());
                    }
                    continue;
                }
                record.task.status = UploadTaskStatus::Cancelled;
                record.task.revision = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
                record.task.updated_at = unix_now();
                record.task.completed_at = Some(record.task.updated_at);
                record.task.message = Some("Upload cancelled".into());
                accepted.push(id.clone());
            }
        }
        drop(records);
        self.save();
        accepted
    }

    pub fn list(&self) -> Vec<UploadTaskDto> {
        let mut tasks: Vec<_> = self
            .records
            .lock()
            .unwrap()
            .values()
            .map(|record| record.task.clone())
            .collect();
        tasks.sort_by_key(|task| std::cmp::Reverse(task.created_at));
        tasks
    }

    pub fn retry_request(&self, upload_id: &str) -> Option<serde_json::Value> {
        self.records
            .lock()
            .unwrap()
            .get(upload_id)
            .map(|record| record.request.clone())
    }

    pub fn replace_retry_source(
        &self,
        upload_id: &str,
        source_path: &str,
        request: serde_json::Value,
    ) -> Result<bool> {
        let changed = {
            let mut records = self.records.lock().unwrap();
            let Some(record) = records.get_mut(upload_id) else {
                return Ok(false);
            };
            record.task.source_path = source_path.to_string();
            record.task.source_available = true;
            record.task.updated_at = unix_now();
            record.request = request;
            true
        };
        if changed {
            self.save();
        }
        Ok(changed)
    }

    pub fn set_status(
        &self,
        upload_id: &str,
        status: UploadTaskStatus,
        message: &str,
    ) -> Result<bool> {
        let changed = {
            let mut records = self.records.lock().unwrap();
            let Some(record) = records.get_mut(upload_id) else {
                return Ok(false);
            };
            if record.task.status.is_terminal() {
                return Ok(false);
            }
            let available = match status {
                UploadTaskStatus::Paused => matches!(
                    record.task.status,
                    UploadTaskStatus::Pending
                        | UploadTaskStatus::Uploading
                        | UploadTaskStatus::Paused
                ),
                UploadTaskStatus::Pending => record.task.status == UploadTaskStatus::Paused,
                _ => true,
            };
            if !available {
                return Ok(false);
            }
            record.task.status = status;
            record.task.revision = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
            record.task.message = Some(message.to_string());
            record.task.error = (status == UploadTaskStatus::Failed).then(|| message.to_string());
            record.task.updated_at = unix_now();
            record.task.completed_at = status.is_terminal().then_some(record.task.updated_at);
            true
        };
        if changed {
            self.save();
        }
        Ok(changed)
    }

    /// Mark a successfully returned directory upload as complete.
    ///
    /// File uploads reach a terminal state through their transfer progress
    /// events. An empty directory has no file transfer to produce that event,
    /// so the directory command must explicitly close its queue record.
    /// Returning `true` also for an already-completed directory lets the
    /// caller publish one final directory-level event after a multi-file run.
    pub fn finish_directory(&self, upload_id: &str, message: &str) -> Result<bool> {
        let now = unix_now();
        let (succeeded, changed) = {
            let mut records = self.records.lock().unwrap();
            let Some(record) = records.get_mut(upload_id) else {
                return Ok(false);
            };
            if record.task.kind != cfms_core::UploadTaskKind::Directory {
                return Ok(false);
            }
            if record.task.status == UploadTaskStatus::Completed {
                (true, false)
            } else if record.task.status.is_terminal() {
                (false, false)
            } else {
                record.task.status = UploadTaskStatus::Completed;
                record.task.revision = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
                record.task.progress = 1.0;
                record.task.current_bytes = record.task.total_bytes;
                record.task.message = Some(message.to_string());
                record.task.error = None;
                record.task.updated_at = now;
                record.task.completed_at = Some(now);
                (true, true)
            }
        };
        if changed {
            self.save();
        }
        Ok(succeeded)
    }

    pub fn mark_pending(&self, upload_id: &str) -> Result<bool> {
        let changed = {
            let mut records = self.records.lock().unwrap();
            let Some(record) = records.get_mut(upload_id) else {
                return Ok(false);
            };
            if !matches!(
                record.task.status,
                UploadTaskStatus::Interrupted | UploadTaskStatus::Failed
            ) || !record.task.source_available
            {
                return Ok(false);
            }
            record.task.status = UploadTaskStatus::Pending;
            record.task.revision = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
            record.task.progress = 0.0;
            record.task.current_bytes = 0;
            record.task.message = None;
            record.task.error = None;
            record.task.completed_at = None;
            record.task.updated_at = unix_now();
            record.task.retry_count = 0;
            record.task.queue_order = record.task.revision;
            true
        };
        if changed {
            self.save();
        }
        Ok(changed)
    }

    pub fn note_retry(&self, id: &str, attempt: u32) {
        if let Some(record) = self.records.lock().unwrap().get_mut(id) {
            if !record.task.status.is_terminal() {
                record.task.retry_count = attempt;
                record.task.revision = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_progress(
        &self,
        upload_id: &str,
        task_id: Option<&str>,
        file_name: &str,
        current_bytes: u64,
        total_bytes: u64,
        status: UploadTaskStatus,
        message: Option<String>,
    ) {
        let now = unix_now();
        let mut should_save = status != UploadTaskStatus::Uploading;
        {
            let mut records = self.records.lock().unwrap();
            let Some(record) = records.get_mut(upload_id) else {
                return;
            };
            if record.task.status.is_terminal() {
                return;
            }
            if (record.task.status == UploadTaskStatus::Paused
                && status == UploadTaskStatus::Uploading)
                || (record.task.status == UploadTaskStatus::Pending
                    && matches!(
                        status,
                        UploadTaskStatus::Paused | UploadTaskStatus::Uploading
                    ))
            {
                return;
            }
            if let Some(task_id) = task_id {
                record.task.task_id = Some(task_id.to_string());
            }
            if record.task.kind == cfms_core::UploadTaskKind::File {
                record.task.file_name = file_name.to_string();
            } else if let Some(message) = message.as_deref() {
                record.task.message = Some(format!("{file_name} · {message}"));
            }
            // A child file finishing does not finish its containing directory.
            let status = if record.task.kind == cfms_core::UploadTaskKind::Directory
                && matches!(
                    status,
                    UploadTaskStatus::Completed | UploadTaskStatus::Skipped
                ) {
                UploadTaskStatus::Uploading
            } else {
                status
            };
            record.task.status = status;
            record.task.revision = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
            if current_bytes > 0 {
                record.task.current_bytes = current_bytes;
            }
            if total_bytes > 0 {
                record.task.total_bytes = total_bytes;
            }
            let next_progress = if total_bytes > 0 {
                current_bytes as f64 / total_bytes as f64
            } else if status == UploadTaskStatus::Completed {
                1.0
            } else {
                record.task.progress
            };
            should_save |= (next_progress - record.task.progress).abs() >= 0.02;
            record.task.progress = next_progress;
            if record.task.kind == cfms_core::UploadTaskKind::File {
                record.task.message = message.clone();
            }
            record.task.error = if status == UploadTaskStatus::Failed {
                message
            } else {
                None
            };
            record.task.updated_at = now;
            record.task.completed_at = status.is_terminal().then_some(now);
        }
        if should_save {
            self.save();
        }
    }

    pub fn remove_terminal(&self, ids: &[String]) -> (Vec<String>, Vec<(String, String)>) {
        let mut succeeded = Vec::new();
        let mut failed = Vec::new();
        {
            let mut records = self.records.lock().unwrap();
            for id in ids {
                match records.get(id) {
                    None => failed.push((id.clone(), "Task not found".into())),
                    Some(record)
                        if !record.task.status.is_terminal()
                            && record.task.status != UploadTaskStatus::Interrupted =>
                    {
                        failed.push((
                            id.clone(),
                            "Only finished upload records can be removed".into(),
                        ))
                    }
                    Some(_) => {
                        records.remove(id);
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

    fn save(&self) {
        let _save = self.persistence_lock.lock().unwrap();
        let Some(ctx) = self.persist_ctx.lock().unwrap().clone() else {
            return;
        };
        let records: Vec<_> = self.records.lock().unwrap().values().cloned().collect();
        if let Err(error) = upload_task_persistence::save(
            &ctx.dir,
            &ctx.server_hash,
            &ctx.username,
            ctx.dek.as_ref().map(|dek| &**dek),
            &records,
        ) {
            tracing::error!("Failed to persist upload tasks: {error}");
        }
    }
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use cfms_core::UploadTaskKind;

    #[test]
    fn child_completion_preserves_directory_lifetime_and_total_bytes() {
        let queue = UploadQueueState::new();
        let mut directory = task("directory", "source", UploadTaskStatus::Pending);
        directory.kind = UploadTaskKind::Directory;
        queue.insert(directory, serde_json::Value::Null).unwrap();
        assert!(queue.claim("directory"));
        queue.update_progress(
            "directory",
            Some("child"),
            "child.bin",
            25,
            100,
            UploadTaskStatus::Completed,
            None,
        );
        let directory = queue.get("directory").unwrap();
        assert_eq!(directory.status, UploadTaskStatus::Uploading);
        assert_eq!(directory.file_name, "directory.bin");
        assert_eq!(directory.progress, 0.25);
        queue.finish_directory("directory", "Complete").unwrap();
        let completed = queue.get("directory").unwrap();
        assert_eq!(completed.status, UploadTaskStatus::Completed);
        assert_eq!(completed.current_bytes, 100);
        assert_eq!(completed.total_bytes, 100);
        assert!(completed.revision > directory.revision);
    }

    #[test]
    fn interrupted_records_can_be_removed_and_late_progress_cannot_restore_them() {
        let queue = UploadQueueState::new();
        queue
            .insert(
                task("interrupted", "source", UploadTaskStatus::Interrupted),
                serde_json::Value::Null,
            )
            .unwrap();
        assert_eq!(
            queue.remove_terminal(&["interrupted".into()]).0,
            vec!["interrupted"]
        );
        queue.update_progress(
            "interrupted",
            None,
            "source",
            100,
            100,
            UploadTaskStatus::Completed,
            None,
        );
        assert!(queue.list().is_empty());
    }

    #[test]
    fn removed_batch_stays_removed_after_encrypted_reload() {
        let dir = tempfile::tempdir().unwrap();
        let key = [11; KEY_LEN];
        let queue = UploadQueueState::new();
        queue
            .load_for_user(dir.path(), "server", "alice", Some(&key))
            .unwrap();
        let mut item = task("batch-file", "source", UploadTaskStatus::Pending);
        item.batch_id = Some("batch".into());
        item.batch_name = Some("Documents".into());
        item.batch_index = 4;
        queue.insert(item, serde_json::Value::Null).unwrap();
        queue
            .load_for_user(dir.path(), "server", "alice", Some(&key))
            .unwrap();
        let interrupted = queue.get("batch-file").unwrap();
        assert_eq!(interrupted.status, UploadTaskStatus::Interrupted);
        assert_eq!(interrupted.batch_id.as_deref(), Some("batch"));
        assert_eq!(interrupted.batch_index, 4);
        queue.remove_terminal(&["batch-file".into()]);
        queue
            .load_for_user(dir.path(), "server", "alice", Some(&key))
            .unwrap();
        assert!(queue.list().is_empty());
    }

    #[test]
    fn a_failed_batch_commit_does_not_admit_unpersisted_work() {
        let dir = tempfile::tempdir().unwrap();
        let queue = UploadQueueState::new();
        queue
            .load_for_user(dir.path(), "server", "alice", None)
            .unwrap();
        assert!(
            queue
                .insert(
                    task("file", "source", UploadTaskStatus::Pending),
                    serde_json::Value::Null
                )
                .is_err()
        );
        assert!(queue.list().is_empty());
    }

    fn task(id: &str, source_path: &str, status: UploadTaskStatus) -> UploadTaskDto {
        UploadTaskDto {
            upload_id: id.into(),
            task_id: None,
            file_name: format!("{id}.bin"),
            source_path: source_path.into(),
            kind: UploadTaskKind::File,
            target_parent_id: None,
            status,
            progress: 0.0,
            current_bytes: 0,
            total_bytes: 0,
            message: None,
            error: None,
            created_at: 1,
            updated_at: 1,
            completed_at: status.is_terminal().then_some(1),
            retry_count: 0,
            max_retries: 3,
            source_available: true,
            batch_id: None,
            batch_name: None,
            batch_created_at: None,
            batch_index: 0,
            queue_order: 0,
            revision: 0,
        }
    }

    #[test]
    fn removing_upload_history_keeps_sources_and_returns_partial_failures() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.bin");
        std::fs::write(&source, b"source data").unwrap();
        let queue = UploadQueueState::new();
        queue
            .insert(
                task(
                    "finished",
                    source.to_str().unwrap(),
                    UploadTaskStatus::Completed,
                ),
                serde_json::Value::Null,
            )
            .unwrap();
        queue
            .insert(
                task(
                    "active",
                    source.to_str().unwrap(),
                    UploadTaskStatus::Pending,
                ),
                serde_json::Value::Null,
            )
            .unwrap();

        let (succeeded, failed) = queue.remove_terminal(&["finished".into(), "active".into()]);

        assert_eq!(succeeded, vec!["finished"]);
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].0, "active");
        assert!(
            source.exists(),
            "removing upload history must not delete the source"
        );
        assert_eq!(queue.list().len(), 1);
        assert_eq!(queue.list()[0].upload_id, "active");
    }

    #[test]
    fn finishing_an_empty_directory_closes_its_queue_record() {
        let app_data = tempfile::tempdir().unwrap();
        let source = app_data.path().join("empty");
        std::fs::create_dir(&source).unwrap();
        let key = [11u8; KEY_LEN];
        let queue = UploadQueueState::new();
        queue
            .load_for_user(app_data.path(), "server", "alice", Some(&key))
            .unwrap();
        let mut directory = task(
            "empty-directory",
            source.to_str().unwrap(),
            UploadTaskStatus::Pending,
        );
        directory.kind = UploadTaskKind::Directory;
        directory.file_name = "empty".into();
        queue.insert(directory, serde_json::Value::Null).unwrap();

        assert!(
            queue
                .finish_directory("empty-directory", "Upload completed")
                .unwrap()
        );

        let finished = queue.list().pop().unwrap();
        assert_eq!(finished.status, UploadTaskStatus::Completed);
        assert_eq!(finished.progress, 1.0);
        assert_eq!(finished.current_bytes, 0);
        assert_eq!(finished.total_bytes, 0);
        assert_eq!(finished.message.as_deref(), Some("Upload completed"));
        assert!(finished.completed_at.is_some());

        let reloaded = UploadQueueState::new();
        reloaded
            .load_for_user(app_data.path(), "server", "alice", Some(&key))
            .unwrap();
        assert_eq!(reloaded.list()[0].status, UploadTaskStatus::Completed);
    }

    #[test]
    fn finishing_a_directory_does_not_overwrite_a_terminal_failure() {
        let queue = UploadQueueState::new();
        let mut directory = task("cancelled-directory", "empty", UploadTaskStatus::Cancelled);
        directory.kind = UploadTaskKind::Directory;
        queue.insert(directory, serde_json::Value::Null).unwrap();

        assert!(
            !queue
                .finish_directory("cancelled-directory", "Upload completed")
                .unwrap()
        );
        assert_eq!(queue.list()[0].status, UploadTaskStatus::Cancelled);
    }

    #[test]
    fn clear_drops_upload_persistence_key_context() {
        let app_data = tempfile::tempdir().unwrap();
        let key = [0x5A; KEY_LEN];
        let queue = UploadQueueState::new();

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
    fn failed_upload_reload_leaves_no_key_context() {
        let app_data = tempfile::tempdir().unwrap();
        let correct_key = [3; KEY_LEN];
        let wrong_key = [4; KEY_LEN];
        upload_task_persistence::save(app_data.path(), "server", "alice", Some(&correct_key), &[])
            .unwrap();
        let queue = UploadQueueState::new();

        assert!(
            queue
                .load_for_user(app_data.path(), "server", "alice", Some(&wrong_key))
                .is_err()
        );
        assert!(queue.persist_ctx.lock().unwrap().is_none());
    }
}
