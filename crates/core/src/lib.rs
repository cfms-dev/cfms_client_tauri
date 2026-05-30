//! CFMS Core — shared foundation types, constants, and error handling.
//!
//! This crate has **zero** external dependencies beyond `thiserror` (for the
//! error enum) and `serde` (for data types that cross crate/process
//! boundaries).  It is the single source of truth for protocol constants and
//! the unified [`Error`] type.

#![forbid(unsafe_code)]

pub mod constants;
pub mod error;
pub mod types;

// Re-export the most commonly used items so downstream crates can write
// `cfms_core::Error` instead of `cfms_core::error::Error`.
pub use error::{Error, Result};
pub use types::{DownloadPhase, DownloadProgress, FileMetadata, Response, UploadProgress};
