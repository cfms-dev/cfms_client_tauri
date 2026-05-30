//! SQLite DDL statements and schema migration logic.

/// Current schema version.  Increment this when adding new DDL.
pub const CURRENT_VERSION: u32 = 1;

/// DDL for the initial schema (v1).
pub const SCHEMA_V1: &str = r#"
-- Download task queue (persistent state machine)
CREATE TABLE IF NOT EXISTS download_tasks (
    task_id             TEXT PRIMARY KEY NOT NULL,
    file_id             TEXT NOT NULL,
    filename            TEXT NOT NULL,
    file_path           TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',
    progress            REAL NOT NULL DEFAULT 0.0,
    current_bytes       INTEGER NOT NULL DEFAULT 0,
    total_bytes         INTEGER NOT NULL DEFAULT 0,
    error               TEXT,
    created_at          INTEGER NOT NULL,
    started_at          INTEGER,
    completed_at        INTEGER,
    priority            INTEGER NOT NULL DEFAULT 0,
    retry_count         INTEGER NOT NULL DEFAULT 0,
    max_retries         INTEGER NOT NULL DEFAULT 3,
    scheduled_time      INTEGER,
    pause_position      INTEGER,
    supports_resume     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_download_tasks_status
    ON download_tasks(status);

CREATE INDEX IF NOT EXISTS idx_download_tasks_priority
    ON download_tasks(status, priority DESC);

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
