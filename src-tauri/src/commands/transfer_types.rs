use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct UploadRevisionProgressEvent {
    pub document_id: String,
    pub task_id: String,
    pub current_bytes: u64,
    pub total_bytes: u64,
    pub progress: f64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum UploadConflictStrategy {
    #[default]
    Fail,
    Skip,
    Overwrite,
    KeepBoth,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryFileConflictResolution {
    pub(super) relative_path: String,
    pub(super) conflict_strategy: UploadConflictStrategy,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadEnqueueRequest {
    pub upload_id: String,
    pub file_name: String,
    pub source_path: String,
    pub kind: cfms_core::UploadTaskKind,
    pub target_parent_id: Option<String>,
    pub conflict_strategy: UploadConflictStrategy,
    #[serde(default)]
    pub conflict_resolutions: Vec<DirectoryFileConflictResolution>,
    pub upload_name: Option<String>,
    #[serde(default)]
    pub batch_id: Option<String>,
    #[serde(default)]
    pub batch_name: Option<String>,
    #[serde(default)]
    pub batch_created_at: Option<i64>,
    #[serde(default)]
    pub batch_index: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadBatchResult {
    pub tasks: Vec<cfms_core::UploadTaskDto>,
    pub failed: Vec<BatchActionFailure>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchActionFailure {
    pub id: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchActionResult {
    pub succeeded: Vec<String>,
    pub failed: Vec<BatchActionFailure>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferDirection {
    Download,
    Upload,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferControlAction {
    Pause,
    Resume,
    Cancel,
    Retry,
    CancelAndRemove,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryUploadConflict {
    pub(super) relative_path: String,
    pub(super) name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DirectoryUploadConflictEvent {
    Conflict(DirectoryUploadConflict),
    Finished,
}

#[derive(Debug, Clone, Serialize)]
pub struct UploadProgressEvent {
    pub upload_id: String,
    pub task_id: Option<String>,
    pub file_name: String,
    pub current_bytes: u64,
    pub total_bytes: u64,
    pub progress: f64,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct UploadFileResult {
    pub(super) upload_id: String,
    pub(super) task_id: Option<String>,
    pub(super) document_id: Option<String>,
    pub(super) file_name: String,
    pub(super) skipped: bool,
    pub(super) overwritten: bool,
}

#[derive(Debug)]
pub(super) struct PreparedUploadSource {
    pub(super) path: std::path::PathBuf,
    pub(super) display_name: Option<String>,
    pub(super) cleanup_on_drop: bool,
}

impl Drop for PreparedUploadSource {
    fn drop(&mut self) {
        if self.cleanup_on_drop {
            match std::fs::metadata(&self.path) {
                Ok(metadata) if metadata.is_dir() => {
                    let _ = std::fs::remove_dir_all(&self.path);
                }
                Ok(_) => {
                    let _ = std::fs::remove_file(&self.path);
                }
                Err(_) => {}
            }
        }
    }
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AndroidImportedUploadPath {
    pub(super) path: String,
    pub(super) display_name: String,
}
