//! Database open and migration.

use rusqlite::Connection;
use std::path::Path;

use cfms_core::Result;

use crate::db::schema;

/// Open (or create) the persistent application database at `path`, running
/// any pending schema migrations.
pub fn open(path: &Path) -> Result<Connection> {
    let db = Connection::open(path).map_err(|e| {
        cfms_core::Error::Other(format!("failed to open database at {}: {e}", path.display()))
    })?;

    // Performance / durability pragmas.
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=5000;",
    )
    .map_err(|e| cfms_core::Error::Other(format!("failed to set pragmas: {e}")))?;

    // Run migrations.
    migrate(&db)?;

    Ok(db)
}

/// Apply any pending schema migrations.
fn migrate(db: &Connection) -> Result<()> {
    // Ensure schema_version table exists (it's created in SCHEMA_V1, but we
    // need a fallback for a completely empty database).
    let current: u32 = db
        .query_row(
            "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if current < 1 {
        db.execute_batch(schema::SCHEMA_V1)
            .map_err(|e| cfms_core::Error::Other(format!("schema v1 migration failed: {e}")))?;
    }

    // Future migrations:
    // if current < 2 { db.execute_batch(schema::SCHEMA_V2)?; }

    Ok(())
}
