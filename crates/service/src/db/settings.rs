//! User settings DAO — key-value operations on the `user_settings` table.
//!
//! This is a lightweight wrapper around the SQLite connection, used only
//! for application settings (theme, disclaimer, etc.).  Download task
//! metadata is stored separately in encrypted JSON files.

use rusqlite::{Connection, params};
use std::sync::{Arc, Mutex};

use cfms_core::Result;

/// A thread-safe, cloneable handle for user settings persistence.
#[derive(Clone)]
pub struct SettingsStore {
    db: Arc<Mutex<Connection>>,
}

impl SettingsStore {
    /// Create a new `SettingsStore` from an open database connection.
    pub fn new(db: Connection) -> Self {
        Self {
            db: Arc::new(Mutex::new(db)),
        }
    }

    /// Store a user setting (upsert).
    pub fn set(&self, key: &str, value: &str) -> Result<()> {
        let db = self.db.lock().unwrap();
        db.execute(
            "INSERT INTO user_settings (key, value) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| cfms_core::Error::Other(format!("set_setting: {e}")))?;
        Ok(())
    }

    /// Retrieve a user setting.
    pub fn get(&self, key: &str) -> Result<Option<String>> {
        let db = self.db.lock().unwrap();
        let result: std::result::Result<String, _> = db.query_row(
            "SELECT value FROM user_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        );
        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(cfms_core::Error::Other(format!("get_setting: {e}"))),
        }
    }
}
