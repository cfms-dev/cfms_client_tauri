//! Persistent SQLite database layer.
//!
//! Manages the application database — schema migration and user settings
//! key-value storage.  Download task metadata is stored in per-user
//! encrypted JSON files (see [`crate::services::task_persistence`]).

pub mod schema;
pub mod settings;

mod migrate;

pub use migrate::open;

/// Open an ephemeral database with the current schema.
///
/// This is used by the local-data-reset recovery shell so a failed cleanup
/// never opens the surviving on-disk database.
pub fn open_in_memory() -> cfms_core::Result<rusqlite::Connection> {
    let conn = rusqlite::Connection::open_in_memory()
        .map_err(|e| cfms_core::Error::Other(format!("open in-memory database: {e}")))?;
    conn.execute_batch(schema::SCHEMA_V1)
        .map_err(|e| cfms_core::Error::Other(format!("initialize in-memory schema v1: {e}")))?;
    conn.execute_batch(schema::SCHEMA_V2)
        .map_err(|e| cfms_core::Error::Other(format!("initialize in-memory schema v2: {e}")))?;
    Ok(conn)
}
