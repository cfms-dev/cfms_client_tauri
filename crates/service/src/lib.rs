//! CFMS Service — background services, persistent state, and local
//! filesystem scanning.
//!
//! This crate sits between the low-level libraries ([`cfms_core`],
//! [`cfms_crypto`], [`cfms_transport`], [`cfms_transfer`]) and the Tauri
//! application binary.  It provides:
//!
//! - [`state`] — shared in-memory application state (auth, DEK, lockdown).
//! - [`db`] — persistent SQLite storage for download tasks and user settings.
//! - [`service`] — service manager for spawning and shutting down background
//!   Tokio tasks.
//! - [`services`] — individual background service implementations:
//!   token refresh, favorites validation, lockdown monitor, download queue.
//! - [`scan`] — parallel local filesystem scanner using the `ignore` crate.

#![forbid(unsafe_code)]

pub mod db;
pub mod extensions;
pub mod scan;
pub mod service;
pub mod services;
pub mod state;
pub mod user_preferences;
