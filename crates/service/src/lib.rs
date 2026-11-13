//! CFMS Service — background services, persistent state, and local
//! filesystem scanning.
//!
//! This crate sits between the low-level libraries ([`cfms_core`],
//! [`cfms_crypto`], [`cfms_transport`], [`cfms_transfer`]) and the Tauri
//! application binary.  It provides:
//!
//! - [`state`] — shared in-memory application state (auth, DEK, lockdown).
//! - [`db`] — persistent SQLite storage for download tasks and user settings.
//! - [`runtime`] — lifecycle management for background Tokio tasks.
//! - [`authentication`], [`connection`], [`files`], [`transfers`] — business services.
//! - [`rpc`] — authenticated request encoding and typed response decoding.
//! - [`session`] — frontend-safe session snapshots, without tokens or keys.
//! - [`scan`] — parallel local filesystem scanner using the `ignore` crate.

#![forbid(unsafe_code)]

pub mod account_storage;
pub mod app_lock;
pub mod authentication;
pub mod connection;
pub mod db;
pub mod files;
pub mod public_key_auth;
pub mod rpc;
pub mod runtime;
pub mod scan;
pub mod sensitive;

pub mod session;
pub mod state;
#[cfg(test)]
mod test_rpc;
pub mod transfers;
pub mod user_preferences;
