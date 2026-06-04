//! SQLite DDL statements and schema migration logic.
//!
//! The SQLite database only stores `user_settings` (key-value pairs).
//! Download task metadata is persisted in per-user encrypted JSON files
//! (see [`crate::services::task_persistence`]).

/// Current schema version.  Increment this when adding new DDL.
pub const CURRENT_VERSION: u32 = 1;

/// DDL for the initial schema (v1).
///
/// Only contains `user_settings` — download tasks are stored in
/// encrypted JSON files per-user (see `task_persistence` module).
pub const SCHEMA_V1: &str = r#"
-- User settings (key-value, values are JSON-encoded)
CREATE TABLE IF NOT EXISTS user_settings (
    key     TEXT PRIMARY KEY NOT NULL,
    value   TEXT NOT NULL
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY NOT NULL
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);
"#;
