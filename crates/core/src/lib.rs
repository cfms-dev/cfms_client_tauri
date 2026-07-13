//! CFMS Core — shared foundation types, constants, and error handling.
//!
//! This crate has **zero** external dependencies beyond `thiserror` (for the
//! error enum) and `serde` (for data types that cross crate/process
//! boundaries).  It is the single source of truth for protocol constants and
//! the unified [`Error`] type.

#![forbid(unsafe_code)]

use sha2::{Digest, Sha256};

pub mod constants;
pub mod error;
pub mod types;

// Re-export the most commonly used items so downstream crates can write
// `cfms_core::Error` instead of `cfms_core::error::Error`.
pub use error::{Error, Result};
pub use types::{
    CursorPage, DEFAULT_TASK_CONCURRENCY, DownloadPhase, DownloadProgress, DownloadTaskDto,
    DownloadTaskStatus, Favourites, FileEntry, FileMetadata, ListDirectoryResponse,
    MAX_TASK_CONCURRENCY, MIN_TASK_CONCURRENCY, PRIVACY_PREFERENCE_VERSION, PrivacyPreference,
    Response, ServerDirectoryEntry, ServerDocumentEntry, ServerInfo, ServerListingItem,
    ServiceEvent, ServiceStatusInfo, TaskConcurrencyPreference, UploadProgress, UserPreference,
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
    hasher.update(username.trim().as_bytes());
    hex::encode(&hasher.finalize()[..8])
}
