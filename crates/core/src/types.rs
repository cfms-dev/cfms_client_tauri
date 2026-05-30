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
