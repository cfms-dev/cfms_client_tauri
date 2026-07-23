//! Database open and migration.

use rusqlite::Connection;
use std::path::Path;

use cfms_core::Result;

use crate::db::schema;

/// Open (or create) the persistent application database at `path`, running
/// any pending schema migrations.
pub fn open(path: &Path) -> Result<Connection> {
    let db = Connection::open(path).map_err(|e| {
        cfms_core::Error::Other(format!(
            "failed to open database at {}: {e}",
            path.display()
        ))
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

    if current < 2 {
        db.execute_batch(schema::SCHEMA_V2)
            .map_err(|e| cfms_core::Error::Other(format!("schema v2 migration failed: {e}")))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_database_reaches_current_schema() {
        let temp = tempfile::tempdir().unwrap();
        let db = open(&temp.path().join("client.db")).unwrap();
        let version: u32 = db
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, schema::CURRENT_VERSION);
        let table_count: u32 = db
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'extension_installations'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 1);
    }

    #[test]
    fn version_one_database_migrates_without_losing_settings() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("client.db");
        let db = Connection::open(&path).unwrap();
        db.execute_batch(schema::SCHEMA_V1).unwrap();
        db.execute(
            "INSERT INTO user_settings (key, value) VALUES ('language', 'zh_CN')",
            [],
        )
        .unwrap();
        drop(db);

        let db = open(&path).unwrap();
        let language: String = db
            .query_row(
                "SELECT value FROM user_settings WHERE key = 'language'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(language, "zh_CN");
        let version: u32 = db
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 2);
    }
}
