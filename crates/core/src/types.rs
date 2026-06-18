//! Shared data structures used across crate boundaries.
//!
//! These types are intentionally plain-old-data structs with `Serialize` /
//! `Deserialize` so they can travel over IPC (Tauri command args/returns) and
//! be persisted to disk.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Server response envelope
// ---------------------------------------------------------------------------

/// Envelope returned by CFMS server REST / RPC endpoints.
///
/// Mirrors the Python [`Response`] dataclass so the Rust client can parse the
/// same JSON shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response<T = serde_json::Value> {
    /// HTTP-like status code (200 = success, 4xx/5xx = error).
    pub code: u16,

    /// Human-readable message from the server.
    pub message: String,

    /// Typed payload.  Use [`serde_json::Value`] when the shape is dynamic.
    pub data: T,

    /// Unix timestamp (seconds) of when the response was generated.
    pub timestamp: f64,
}

// ---------------------------------------------------------------------------
// File metadata
// ---------------------------------------------------------------------------

/// Metadata about a file, received from the server before transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
    /// Expected size of the plaintext file in bytes.
    /// `None` for empty files.
    pub file_size: Option<u64>,

    /// Size of each encrypted chunk in bytes.
    pub chunk_size: u32,

    /// Total number of chunks that will be transferred.
    pub total_chunks: u32,
}

// ---------------------------------------------------------------------------
// Download progress
// ---------------------------------------------------------------------------

/// A progress update emitted during a download operation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct DownloadProgress {
    /// Which phase of the download we are in.
    pub phase: DownloadPhase,
    /// Bytes processed so far (downloaded, decrypted, or verified).
    pub current: u64,
    /// Total bytes expected (`0` when unknown).
    pub total: u64,
}

/// Logical phases of a download, in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum DownloadPhase {
    /// Receiving encrypted chunks from the server.
    Downloading = 0,
    /// Decrypting received chunks and writing to disk.
    Decrypting = 1,
    /// Cleaning up temporary storage.
    Cleaning = 2,
    /// Verifying file integrity.
    Verifying = 3,
}

// ---------------------------------------------------------------------------
// Upload progress
// ---------------------------------------------------------------------------

/// A progress update emitted during an upload operation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct UploadProgress {
    /// Bytes uploaded so far.
    pub current: u64,
    /// Total file size in bytes.
    pub total: u64,
}

// ---------------------------------------------------------------------------
// Download task status & DTO (used by cfms-service and Tauri IPC)
// ---------------------------------------------------------------------------

/// Status of a download task in the persistent queue state machine.
///
/// Mirrors the Python reference `DownloadTaskStatus` enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadTaskStatus {
    /// Waiting to be picked up by the queue processor.
    Pending,
    /// Currently downloading encrypted chunks from the server.
    Downloading,
    /// Paused by the user (can be resumed).
    Paused,
    /// Decrypting received chunks and writing plaintext to disk.
    Decrypting,
    /// Verifying file integrity (size + SHA-256).
    Verifying,
    /// Download completed successfully.
    Completed,
    /// Download failed (retries exhausted or unrecoverable error).
    Failed,
    /// Cancelled by the user.
    Cancelled,
    /// Scheduled for a future time.
    Scheduled,
}

impl DownloadTaskStatus {
    /// Returns `true` if this status represents a terminal state.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }

    /// Returns `true` if the task is currently in flight.
    pub fn is_active(self) -> bool {
        matches!(self, Self::Downloading | Self::Decrypting | Self::Verifying)
    }
}

/// Serializable DTO for a download task, used for IPC with the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTaskDto {
    /// Server-assigned task identifier.
    pub task_id: String,
    /// Server-side file/document ID.
    pub file_id: String,
    /// Human-readable filename.
    pub filename: String,
    /// Local filesystem path where the file will be saved.
    pub file_path: String,
    /// Current status in the state machine.
    pub status: DownloadTaskStatus,
    /// Download progress as a fraction (0.0–1.0).
    pub progress: f64,
    /// Bytes downloaded / processed so far.
    pub current_bytes: u64,
    /// Total expected bytes (0 when unknown).
    pub total_bytes: u64,
    /// Human-readable description of the current step (may be empty).
    pub message: Option<String>,
    /// Error message if the task failed.
    pub error: Option<String>,
    /// Unix timestamp (seconds) when the task was created.
    pub created_at: i64,
    /// Unix timestamp (seconds) when the task started downloading.
    pub started_at: Option<i64>,
    /// Unix timestamp (seconds) when the task reached a terminal state.
    pub completed_at: Option<i64>,
    /// Priority (higher = more urgent). Default 0.
    pub priority: i32,
    /// Number of retry attempts so far.
    pub retry_count: u32,
    /// Maximum retry attempts before marking as Failed.
    pub max_retries: u32,
    /// If set, the task will not start before this Unix timestamp.
    pub scheduled_time: Option<i64>,
    /// Current stage number:
    /// 0=downloading, 1=decrypting, 2=cleaning, 3=verifying, 4=completed.
    pub stage: i32,
    /// Download speed limit in bytes/second (None = unlimited).
    pub bandwidth_limit: Option<i64>,
    /// Bytes downloaded before the last pause (for resume support).
    pub pause_position: Option<u64>,
    /// Whether the server supports pause/resume for this task.
    pub supports_resume: bool,
}

// ---------------------------------------------------------------------------
// Service events (pushed from backend → frontend via Tauri emit)
// ---------------------------------------------------------------------------

/// Events emitted by background services and forwarded to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", content = "data")]
pub enum ServiceEvent {
    /// A download's progress has changed.
    DownloadProgress {
        task_id: String,
        phase: String,
        /// Progress as a fraction (0.0–1.0).
        progress: f64,
        /// Human-readable message for the current step.
        message: String,
        /// Bytes processed so far in the current phase.
        current_bytes: u64,
        /// Total bytes expected for the current phase (0 when unknown).
        total_bytes: u64,
    },
    /// A download has completed successfully.
    DownloadCompleted { task_id: String, file_path: String },
    /// A download has failed.
    DownloadFailed { task_id: String, error: String },
    /// A download was cancelled.
    DownloadCancelled { task_id: String },
    /// Server lockdown status changed.
    Lockdown { status: bool },
    /// The primary connection was restored after an unexpected disconnect.
    ConnectionRestored,
    /// The primary connection could not be restored automatically.
    ConnectionLost { error: String },
    /// The authentication token has expired.
    TokenExpired,
    /// A favorites/recent validation cycle completed.
    FavoritesValidationComplete {
        invalid_count: u32,
        invalid_files: Vec<String>,
        invalid_directories: Vec<String>,
        access_denied_files: Vec<String>,
        access_denied_directories: Vec<String>,
    },
    /// The number of active (non-terminal, badge-eligible) download tasks changed.
    ActiveCountChanged { count: u32 },
}

// ---------------------------------------------------------------------------
// Service status (for diagnostics)
// ---------------------------------------------------------------------------

/// Summary status of a single background service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatusInfo {
    /// Service name (e.g. "token_refresh").
    pub name: String,
    /// Whether the service is currently running.
    pub running: bool,
}

// ---------------------------------------------------------------------------
// File scan entry
// ---------------------------------------------------------------------------

/// A single file or directory entry returned by the local disk scanner.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    /// Absolute path to the entry.
    pub path: String,
    /// File size in bytes (0 for directories).
    pub size: u64,
    /// Whether this entry is a directory.
    pub is_dir: bool,
    /// Last modification time as a Unix timestamp (seconds).
    pub modified: Option<i64>,
}

// ---------------------------------------------------------------------------
// Server-side directory / document entries (list_directory response)
// ---------------------------------------------------------------------------

/// A directory/folder entry returned by the server's `list_directory` action.
///
/// Mirrors the folder dicts in the Python reference implementation
/// (`current_directories_data` in [`FileListView`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerDirectoryEntry {
    /// Server-assigned folder ID.
    pub id: String,
    /// Display name of the folder.
    pub name: String,
    /// Creation timestamp (Unix seconds).
    #[serde(default)]
    pub created_time: Option<f64>,
}

/// A document/file entry returned by the server's `list_directory` action.
///
/// Mirrors the document dicts in the Python reference implementation
/// (`current_files_data` in [`FileListView`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerDocumentEntry {
    /// Server-assigned document ID.
    pub id: String,
    /// Display title of the document.
    pub title: String,
    /// File size in bytes, or `None` when the server cannot determine it.
    #[serde(default)]
    pub size: Option<u64>,
    /// Last modification timestamp (Unix seconds).
    #[serde(default)]
    pub last_modified: Option<f64>,
}

/// Metadata returned by the server's `server_info` action.
///
/// Sent immediately after WebSocket connection to establish protocol
/// compatibility and surface server identity / lockdown status before
/// authentication.
///
/// Mirrors the Python reference `server_info_response["data"]` dict.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    /// Human-readable display name of the CFMS server.
    pub server_name: String,
    /// Wire-protocol version the server speaks.
    pub protocol_version: u32,
    /// Whether the server is currently in emergency lockdown mode.
    pub lockdown: bool,
}

/// Response data for the server's `list_directory` action.
///
/// Returned to the frontend as the result of the `list_directory` Tauri command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListDirectoryResponse {
    /// Subdirectories in this directory.
    pub folders: Vec<ServerDirectoryEntry>,
    /// Documents/files in this directory.
    pub documents: Vec<ServerDocumentEntry>,
    /// ID of the parent directory (`None` at the root).
    pub parent_id: Option<String>,
}

// ---------------------------------------------------------------------------
// User preferences (mirrors reference/src/include/classes/preferences.py)
// ---------------------------------------------------------------------------

/// Per-user application preferences, persisted as an encrypted file on disk.
///
/// Mirrors the Python [`UserPreference`] dataclass. The local preference file
/// is always encrypted at rest with AES-256-GCM and requires the user's DEK.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPreference {
    /// UI theme (`"light"` or `"dark"`).
    #[serde(default = "default_theme")]
    pub theme: String,

    /// Favourite files and directories for quick access.
    #[serde(default)]
    pub favourites: Favourites,

    /// Recently visited files and directories for quick access from the home page.
    #[serde(default)]
    pub recent_visits: Vec<RecentFileRecord>,

    /// Whether file and directory opens should be recorded in recent visits.
    #[serde(default = "default_record_recent_visits")]
    pub record_recent_visits: bool,

    /// Whether to use an external storage location for downloads.
    #[serde(default)]
    pub use_external_storage: bool,

    /// Filesystem path for external storage (meaningful only when
    /// `use_external_storage` is `true`).
    #[serde(default)]
    pub external_storage_path: String,

    /// Per-user app-lock settings. Stored here so PIN verifier material and
    /// platform credential metadata are encrypted with the user preference DEK.
    #[serde(default)]
    pub app_lock: serde_json::Value,

    /// Per-user Android root back-button behavior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_back_button_behavior: Option<String>,

    /// Whether the native window should block screenshots and screen recording
    /// during an authenticated session. Forced sensitive flows ignore this.
    #[serde(default = "default_screenshot_protection_enabled")]
    pub screenshot_protection_enabled: bool,

    /// Per-user task scheduling limits for upload/download queues.
    #[serde(default)]
    pub task_concurrency: TaskConcurrencyPreference,
}

impl Default for UserPreference {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            favourites: Favourites::default(),
            recent_visits: Vec::new(),
            record_recent_visits: default_record_recent_visits(),
            use_external_storage: false,
            external_storage_path: String::new(),
            app_lock: serde_json::Value::Null,
            root_back_button_behavior: None,
            screenshot_protection_enabled: default_screenshot_protection_enabled(),
            task_concurrency: TaskConcurrencyPreference::default(),
        }
    }
}

fn default_theme() -> String {
    "light".to_string()
}

fn default_record_recent_visits() -> bool {
    false
}

fn default_screenshot_protection_enabled() -> bool {
    true
}

pub const MIN_TASK_CONCURRENCY: u8 = 1;
pub const DEFAULT_TASK_CONCURRENCY: u8 = 3;
pub const MAX_TASK_CONCURRENCY: u8 = 8;

/// Upload/download concurrency limits stored in user preferences.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TaskConcurrencyPreference {
    #[serde(default = "default_task_concurrency")]
    pub max_downloads: u8,

    #[serde(default = "default_task_concurrency")]
    pub max_uploads: u8,
}

impl Default for TaskConcurrencyPreference {
    fn default() -> Self {
        Self {
            max_downloads: DEFAULT_TASK_CONCURRENCY,
            max_uploads: DEFAULT_TASK_CONCURRENCY,
        }
    }
}

impl TaskConcurrencyPreference {
    pub fn normalized(self) -> Self {
        Self {
            max_downloads: normalize_task_concurrency(self.max_downloads),
            max_uploads: normalize_task_concurrency(self.max_uploads),
        }
    }
}

pub fn normalize_task_concurrency(value: u8) -> u8 {
    value.clamp(MIN_TASK_CONCURRENCY, MAX_TASK_CONCURRENCY)
}

fn default_task_concurrency() -> u8 {
    DEFAULT_TASK_CONCURRENCY
}

/// Bookmarked files and directories.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Favourites {
    /// Map of file path → label.
    #[serde(default)]
    pub files: std::collections::HashMap<String, String>,
    /// Map of directory path → label.
    #[serde(default)]
    pub directories: std::collections::HashMap<String, String>,
}

/// A recently visited file or directory stored in the per-user preference file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFileRecord {
    /// Server object type: "document" or "directory".
    #[serde(rename = "type")]
    pub object_type: String,
    /// Server-side object ID.
    pub id: String,
    /// Display name captured when the item was visited.
    pub name: String,
    /// Parent directory, if known.
    #[serde(default, alias = "parent_id")]
    pub parent_id: Option<String>,
    /// Visit timestamp in milliseconds since Unix epoch.
    #[serde(default, alias = "visited_at")]
    pub visited_at: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_directory_preserves_unknown_document_size() {
        let raw = r#"{
            "folders": [],
            "documents": [
                {
                    "id": "with-null-size",
                    "title": "Null size",
                    "size": null,
                    "last_modified": null
                },
                {
                    "id": "without-size",
                    "title": "Missing size",
                    "last_modified": 1710000000.0
                },
                {
                    "id": "with-size",
                    "title": "Known size",
                    "size": 4096,
                    "last_modified": 1710000001.0
                },
                {
                    "id": "with-zero-size",
                    "title": "Zero size",
                    "size": 0,
                    "last_modified": 1710000002.0
                }
            ],
            "parent_id": null
        }"#;

        let parsed: ListDirectoryResponse = serde_json::from_str(raw).unwrap();

        assert_eq!(parsed.documents[0].size, None);
        assert_eq!(parsed.documents[1].size, None);
        assert_eq!(parsed.documents[2].size, Some(4096));
        assert_eq!(parsed.documents[3].size, Some(0));
    }
}
