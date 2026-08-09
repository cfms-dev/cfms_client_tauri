//! Persistent upload task metadata. Transfer execution remains session-bound.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use cfms_core::constants::KEY_LEN;
use cfms_core::{Result, UploadTaskDto, UploadTaskStatus};

use super::upload_task_persistence::{self, UploadTaskRecord};

#[derive(Clone)]
struct PersistContext {
    dir: PathBuf,
    server_hash: String,
    username: String,
    dek: Option<[u8; KEY_LEN]>,
}

#[derive(Clone, Default)]
pub struct UploadQueueState {
    records: Arc<Mutex<HashMap<String, UploadTaskRecord>>>,
    persist_ctx: Arc<Mutex<Option<PersistContext>>>,
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
        *self.persist_ctx.lock().unwrap() = Some(PersistContext {
            dir: app_data.to_path_buf(),
            server_hash: server_hash.to_string(),
            username: username.to_string(),
            dek: dek.cloned(),
        });
        let loaded = upload_task_persistence::load(app_data, server_hash, username, dek)?;
        let count = loaded.len();
        *self.records.lock().unwrap() = loaded
            .into_iter()
            .map(|record| (record.task.upload_id.clone(), record))
            .collect();
        self.save();
        Ok(count)
    }

    pub fn clear(&self) {
        self.records.lock().unwrap().clear();
        *self.persist_ctx.lock().unwrap() = None;
    }

    pub fn insert(&self, task: UploadTaskDto, request: serde_json::Value) -> Result<()> {
        self.records
            .lock()
            .unwrap()
            .insert(task.upload_id.clone(), UploadTaskRecord { task, request });
        self.save();
        Ok(())
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
            record.task.status = status;
            record.task.message = Some(message.to_string());
            record.task.updated_at = unix_now();
            record.task.completed_at = status.is_terminal().then_some(record.task.updated_at);
            true
        };
        if changed {
            self.save();
        }
        Ok(changed)
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
            record.task.progress = 0.0;
            record.task.current_bytes = 0;
            record.task.message = None;
            record.task.error = None;
            record.task.completed_at = None;
            record.task.updated_at = unix_now();
            record.task.retry_count = record.task.retry_count.saturating_add(1);
            true
        };
        if changed {
            self.save();
        }
        Ok(changed)
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
            if let Some(task_id) = task_id {
                record.task.task_id = Some(task_id.to_string());
            }
            if record.task.kind == cfms_core::UploadTaskKind::File {
                record.task.file_name = file_name.to_string();
            } else if let Some(message) = message.as_deref() {
                record.task.message = Some(format!("{file_name} · {message}"));
            }
            record.task.status = status;
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
                    Some(record) if !record.task.status.is_terminal() => failed.push((
                        id.clone(),
                        "Only finished upload records can be removed".into(),
                    )),
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
        let Some(ctx) = self.persist_ctx.lock().unwrap().clone() else {
            return;
        };
        let records: Vec<_> = self.records.lock().unwrap().values().cloned().collect();
        if let Err(error) = upload_task_persistence::save(
            &ctx.dir,
            &ctx.server_hash,
            &ctx.username,
            ctx.dek.as_ref(),
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
}
