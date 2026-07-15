//! User settings DAO — key-value operations on the `user_settings` table.
//!
//! This is a lightweight wrapper around the SQLite connection, used only
//! for application settings (appearance, language, connection, etc.). Download task
//! metadata is stored separately in encrypted JSON files.

use rusqlite::{Connection, params};
use std::sync::{Arc, Mutex};

use cfms_core::Result;

const APPEARANCE_KEY: &str = "appearance";

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

    /// Load application-wide appearance settings used while signed out.
    pub fn get_appearance(&self) -> Result<cfms_core::AppearancePreference> {
        let Some(raw) = self.get(APPEARANCE_KEY)? else {
            return Ok(cfms_core::AppearancePreference::default());
        };
        serde_json::from_str(&raw)
            .map_err(|e| cfms_core::Error::Other(format!("Invalid global appearance setting: {e}")))
    }

    /// Persist application-wide appearance settings in the existing settings store.
    pub fn set_appearance(&self, appearance: &cfms_core::AppearancePreference) -> Result<()> {
        let encoded = serde_json::to_string(appearance).map_err(|e| {
            cfms_core::Error::Other(format!("Failed to encode global appearance setting: {e}"))
        })?;
        self.set(APPEARANCE_KEY, &encoded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cfms_core::{AppearancePreference, ColorSchemePreference, ReduceMotionPreference};

    fn store() -> SettingsStore {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(crate::db::schema::SCHEMA_V1).unwrap();
        SettingsStore::new(db)
    }

    #[test]
    fn missing_appearance_uses_defaults() {
        assert_eq!(
            store().get_appearance().unwrap(),
            AppearancePreference::default()
        );
    }

    #[test]
    fn appearance_roundtrips_in_global_settings() {
        let store = store();
        let appearance = AppearancePreference {
            color_scheme: ColorSchemePreference::Dark,
            reduce_motion: ReduceMotionPreference::Always,
        };
        store.set_appearance(&appearance).unwrap();
        assert_eq!(store.get_appearance().unwrap(), appearance);
    }
}
