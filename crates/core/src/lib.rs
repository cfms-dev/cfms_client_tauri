//! CFMS Core — shared foundation types, constants, and error handling.
//!
//! Shared protocol records, constants, error categories, revocation evidence,
//! and deterministic cache-key hashing. This foundation never depends on the
//! native shell or the service, transfer, transport, and crypto crates.

#![forbid(unsafe_code)]

use sha2::{Digest, Sha256};

pub mod constants;
pub mod error;
pub mod revocation;
pub use revocation::{RevocationState, RevocationStatus};
pub mod types;

// Re-export the most commonly used items so downstream crates can write
// `cfms_core::Error` instead of `cfms_core::error::Error`.
pub use error::{Error, Result};
pub use types::{
    AppearancePreference, ColorSchemePreference, CursorPage, DEFAULT_TASK_CONCURRENCY,
    DownloadFailureKind, DownloadPhase, DownloadProgress, DownloadTaskDto, DownloadTaskStatus,
    Favourites, FileEntry, FileMetadata, ListDirectoryResponse, MAX_TASK_CONCURRENCY,
    MIN_TASK_CONCURRENCY, NodeLookupResponse, PRIVACY_PREFERENCE_VERSION, PermissionEntry,
    PrivacyPreference, ReduceMotionPreference, Response, Schedule, ScheduleTrigger,
    ScheduledTaskType, ServerDiagnosticDatabase, ServerDiagnosticExtension,
    ServerDiagnosticIdentity, ServerDiagnosticLockdown, ServerDiagnosticProviders,
    ServerDiagnosticRuntime, ServerDiagnosticScheduling, ServerDiagnostics, ServerDirectoryEntry,
    ServerDocumentEntry, ServerInfo, ServerListingItem, ServiceEvent, ServiceStatusInfo,
    TaskConcurrencyPreference, TransferPreference, UploadProgress, UploadTaskDto, UploadTaskKind,
    UploadTaskStatus, UserPreference,
};

// ---------------------------------------------------------------------------
// Hash utilities (mirrors reference/src/include/util/hash.py)
// ---------------------------------------------------------------------------

/// Generate a short hash for a server address, used in cache directory names.
///
/// Mirrors [`get_server_hash`] in the Python reference.
pub fn get_server_hash(server_address: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(server_address.to_lowercase().as_bytes());
    hex::encode(&hasher.finalize()[..8])
}

/// Generate a short hash for a username, used in cache file names.
///
/// Mirrors [`get_username_hash`] in the Python reference.
pub fn get_username_hash(username: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(username.as_bytes());
    hex::encode(&hasher.finalize()[..8])
}
