//! SQLite DDL statements and schema migration logic.
//!
//! The SQLite database only stores `user_settings` (key-value pairs).
//! Download task metadata is persisted in per-user encrypted JSON files
//! (see [`crate::services::task_persistence`]).

/// Current schema version.  Increment this when adding new DDL.
pub const CURRENT_VERSION: u32 = 2;

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

/// Extension installation and signed catalog metadata.
pub const SCHEMA_V2: &str = r#"
CREATE TABLE IF NOT EXISTS extension_installations (
    extension_id       TEXT PRIMARY KEY NOT NULL,
    installed_version  TEXT NOT NULL,
    package_digest     TEXT NOT NULL,
    install_epoch      TEXT NOT NULL,
    state              TEXT NOT NULL,
    installed_at       INTEGER NOT NULL,
    previous_version   TEXT,
    last_error         TEXT
);

CREATE TABLE IF NOT EXISTS extension_catalog_state (
    catalog_url        TEXT PRIMARY KEY NOT NULL,
    etag               TEXT,
    last_success_at    INTEGER,
    signed_catalog     TEXT,
    signature          TEXT
);

CREATE TABLE IF NOT EXISTS extension_package_versions (
    extension_id   TEXT NOT NULL,
    version        TEXT NOT NULL,
    package_digest TEXT NOT NULL,
    installed_at   INTEGER NOT NULL,
    PRIMARY KEY (extension_id, version)
);

INSERT OR IGNORE INTO schema_version (version) VALUES (2);
"#;
