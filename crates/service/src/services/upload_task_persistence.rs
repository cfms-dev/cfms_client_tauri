//! Encrypted, per-user persistence for upload task metadata.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use cfms_core::constants::KEY_LEN;
use cfms_core::{Result, UploadTaskDto, UploadTaskStatus};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadTaskRecord {
    pub task: UploadTaskDto,
    #[serde(default)]
    pub request: serde_json::Value,
}

type UploadTasksJson = HashMap<String, UploadTaskRecord>;

pub fn file_path(app_data: &Path, server_hash: &str, username: &str) -> PathBuf {
    app_data
        .join("upload_tasks")
        .join(format!("{server_hash}_{username}.json"))
}

pub fn discard(app_data: &Path, server_hash: &str, username: &str) -> Result<()> {
    let path = file_path(app_data, server_hash, username);
    if !path.exists() {
        return Ok(());
    }
    std::fs::remove_file(&path).map_err(|error| {
        cfms_core::Error::Other(format!(
            "Failed to delete upload task file {}: {error}",
            path.display()
        ))
    })
}

pub fn load(
    app_data: &Path,
    server_hash: &str,
    username: &str,
    dek: Option<&[u8; KEY_LEN]>,
) -> Result<Vec<UploadTaskRecord>> {
    let path = file_path(app_data, server_hash, username);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let Some(dek) = dek else {
        tracing::warn!(
            "Upload task file exists but DEK is unavailable: {}",
            path.display()
        );
        return Ok(Vec::new());
    };
    let raw = std::fs::read(&path).map_err(|error| {
        cfms_core::Error::Other(format!(
            "Failed to read upload task file {}: {error}",
            path.display()
        ))
    })?;
    if !cfms_crypto::is_encrypted(&raw) {
        return Err(cfms_core::Error::Other(format!(
            "Upload task file is not encrypted: {}",
            path.display()
        )));
    }
    let plaintext = cfms_crypto::decrypt_config(&raw, dek)?;
    let records: UploadTasksJson = serde_json::from_slice(&plaintext).map_err(|error| {
        cfms_core::Error::Other(format!(
            "Invalid upload task data in {}: {error}",
            path.display()
        ))
    })?;
    Ok(records
        .into_values()
        .map(|mut record| {
            if !record.task.status.is_terminal() {
                record.task.status = UploadTaskStatus::Interrupted;
                record.task.message =
                    Some("Upload was interrupted when the application closed".into());
                record.task.error = None;
                record.task.completed_at = None;
            }
            record.task.source_available = source_available(&record.task.source_path);
            record
        })
        .collect())
}

pub fn save(
    app_data: &Path,
    server_hash: &str,
    username: &str,
    dek: Option<&[u8; KEY_LEN]>,
    records: &[UploadTaskRecord],
) -> Result<()> {
    let dek = dek.ok_or_else(|| {
        cfms_core::Error::Other("Cannot persist upload tasks without a DEK".into())
    })?;
    let records: UploadTasksJson = records
        .iter()
        .cloned()
        .map(|record| (record.task.upload_id.clone(), record))
        .collect();
    let plaintext = serde_json::to_vec(&records).map_err(|error| {
        cfms_core::Error::Other(format!("Failed to serialize upload tasks: {error}"))
    })?;
    let encrypted = cfms_crypto::encrypt_config(&plaintext, dek)?;
    let path = file_path(app_data, server_hash, username);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            cfms_core::Error::Other(format!("Failed to create upload task directory: {error}"))
        })?;
    }
    std::fs::write(&path, encrypted).map_err(|error| {
        cfms_core::Error::Other(format!(
            "Failed to write upload task file {}: {error}",
            path.display()
        ))
    })
}

#[cfg(target_os = "android")]
fn source_available(_path: &str) -> bool {
    false
}

#[cfg(not(target_os = "android"))]
fn source_available(path: &str) -> bool {
    Path::new(path).exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use cfms_core::{UploadTaskKind, UploadTaskStatus};

    fn task(path: &str, status: UploadTaskStatus) -> UploadTaskDto {
        UploadTaskDto {
            upload_id: "upload-1".into(),
            task_id: None,
            file_name: "report.pdf".into(),
            source_path: path.into(),
            kind: UploadTaskKind::File,
            target_parent_id: None,
            status,
            progress: 0.4,
            current_bytes: 4,
            total_bytes: 10,
            message: None,
            error: None,
            created_at: 1,
            updated_at: 2,
            completed_at: None,
            retry_count: 0,
            max_retries: 3,
            source_available: true,
        }
    }

    #[test]
    fn encrypted_round_trip_recovers_in_flight_as_interrupted() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("report.pdf");
        std::fs::write(&source, b"data").unwrap();
        let key = [9u8; KEY_LEN];
        let record = UploadTaskRecord {
            task: task(source.to_str().unwrap(), UploadTaskStatus::Uploading),
            request: serde_json::json!({"kind": "file"}),
        };
        save(dir.path(), "server", "alice", Some(&key), &[record]).unwrap();
        let raw = std::fs::read(file_path(dir.path(), "server", "alice")).unwrap();
        assert!(cfms_crypto::is_encrypted(&raw));
        let loaded = load(dir.path(), "server", "alice", Some(&key)).unwrap();
        assert_eq!(loaded[0].task.status, UploadTaskStatus::Interrupted);
        assert!(loaded[0].task.source_available);
    }

    #[test]
    fn terminal_status_survives_reload() {
        let dir = tempfile::tempdir().unwrap();
        let key = [7u8; KEY_LEN];
        let record = UploadTaskRecord {
            task: task("missing", UploadTaskStatus::Completed),
            request: serde_json::Value::Null,
        };
        save(dir.path(), "server", "alice", Some(&key), &[record]).unwrap();
        let loaded = load(dir.path(), "server", "alice", Some(&key)).unwrap();
        assert_eq!(loaded[0].task.status, UploadTaskStatus::Completed);
    }

    #[test]
    fn upload_history_is_isolated_by_user() {
        let dir = tempfile::tempdir().unwrap();
        let key = [5u8; KEY_LEN];
        let record = UploadTaskRecord {
            task: task("source", UploadTaskStatus::Completed),
            request: serde_json::Value::Null,
        };
        save(dir.path(), "server", "alice", Some(&key), &[record]).unwrap();

        assert_eq!(
            load(dir.path(), "server", "alice", Some(&key))
                .unwrap()
                .len(),
            1
        );
        assert!(
            load(dir.path(), "server", "bob", Some(&key))
                .unwrap()
                .is_empty()
        );
        assert!(
            load(dir.path(), "other-server", "alice", Some(&key))
                .unwrap()
                .is_empty()
        );
    }
}
