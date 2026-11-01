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
    migrate::migrate(&conn)?;
    Ok(conn)
}
