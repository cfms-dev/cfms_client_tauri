//! CFMS Transfer — encrypted file upload and download.
//!
//! This crate builds on [`cfms_crypto`] and [`cfms_transport`] to provide:
//!
//! - [`chunks`] — SQLite-backed temporary storage for encrypted chunks.
//! - [`decrypt`] — streaming AES-256-GCM chunk decryption.
//! - [`verify`] — file size and SHA-256 integrity checks.
//! - [`download`] — high-level encrypted file download orchestration.
//! - [`upload`] — high-level file upload with progress tracking.
//!
//! # Download protocol
//!
//! ```text
//! Client                          Server
//!   │── download_file ────────────▶│
//!   │◀── transfer_file (metadata) ─│
//!   │── ready ────────────────────▶│
//!   │◀── encrypted chunks … ──────│
//!   │◀── AES key ─────────────────│
//!   │── (decrypt & verify) ───────│
//! ```
//!
//! # Upload protocol
//!
//! ```text
//! Client                          Server
//!   │── upload_file (metadata) ───▶│
//!   │◀── transfer_file (offset) ──│
//!   │── raw chunks … ─────────────▶│
//!   │◀── confirmation ────────────│
//! ```
//!
//! # Safety
//!
//! This crate allows `unsafe_code` because [`memmap2::Mmap::map`] requires
//! an `unsafe` block (the underlying file could be truncated by another
//! process while mapped).  All `unsafe` usage is confined to [`verify`] and
//! is carefully reviewed.

// The workspace denies unsafe_code, but we need it for memmap.
// Safety: mmap is used only for read-only access to files we own.
#![allow(unsafe_code)]

pub mod chunks;
pub mod decrypt;
pub mod download;
pub mod upload;
pub mod verify;

pub use chunks::ChunkStore;
pub use decrypt::decrypt_chunk;
pub use download::receive;
pub use upload::send;
pub use verify::{compute_sha256, sha256_matches, size_matches};
