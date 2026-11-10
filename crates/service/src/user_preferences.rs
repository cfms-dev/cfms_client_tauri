//! Per-user preference file persistence.
//!
//! Preferences are scoped by server and username, and are always encrypted
//! with the in-memory DEK before being written to disk.

use std::path::{Path, PathBuf};

use cfms_core::{Result, UserPreference};

/// Return `{app_data}/user_preferences`.
pub fn dir(app_data: &Path) -> PathBuf {
    app_data.join("user_preferences")
}

/// Return `{app_data}/user_preferences/{server_hash}_{username}.json`.
pub fn file_path(app_data: &Path, server_hash: &str, username: &str) -> PathBuf {
    dir(app_data).join(format!("{server_hash}_{username}.json"))
}

/// Return whether a persisted preference file exists for a user.
pub fn exists(app_data: &Path, server_hash: &str, username: &str) -> bool {
    file_path(app_data, server_hash, username).exists()
}

/// Delete the persisted preference file for a user, if one exists.
pub fn discard(app_data: &Path, server_hash: &str, username: &str) -> Result<()> {
    let path = file_path(app_data, server_hash, username);
    let lock = preference_lock(&path);
    let _guard = lock.lock().unwrap();
    if !path.exists() {
        return Ok(());
    }

    std::fs::remove_file(&path).map_err(|e| {
        cfms_core::Error::Other(format!(
            "Failed to delete preference file {}: {e}",
            path.display()
        ))
    })
}

/// Load preferences for a user, returning defaults when the file is absent.
pub fn load(
    app_data: &Path,
    server_hash: &str,
    username: &str,
    dek: Option<&[u8; cfms_core::constants::KEY_LEN]>,
) -> Result<UserPreference> {
    let path = file_path(app_data, server_hash, username);

    if !path.exists() {
        return Ok(UserPreference::default());
    }

    let raw = std::fs::read(&path).map_err(|e| {
        cfms_core::Error::Other(format!(
            "Failed to read preference file {}: {e}",
            path.display()
        ))
    })?;

    if !cfms_crypto::is_encrypted(&raw) {
        return Err(cfms_core::Error::Other(format!(
            "Preference file {} is not encrypted",
            path.display()
        )));
    }

    let dek = dek.ok_or_else(|| {
        cfms_core::Error::Other("Encrypted preference file found but DEK is unavailable".into())
    })?;
    let plaintext =
        zeroize::Zeroizing::new(cfms_crypto::decrypt_config(&raw, dek).map_err(|e| {
            cfms_core::Error::Other(format!(
                "Failed to decrypt preference file {}: {e}",
                path.display()
            ))
        })?);

    serde_json::from_slice(&plaintext).map_err(|e| {
        cfms_core::Error::Other(format!(
            "Invalid preference data in {}: {e}",
            path.display()
        ))
    })
}

/// Save preferences encrypted with the user's DEK.
pub fn save(
    app_data: &Path,
    server_hash: &str,
    username: &str,
    dek: Option<&[u8; cfms_core::constants::KEY_LEN]>,
    preferences: &UserPreference,
) -> Result<()> {
    let lock = preference_lock(&file_path(app_data, server_hash, username));
    let _guard = lock.lock().unwrap();
    save_unlocked(app_data, server_hash, username, dek, preferences)
}

fn save_unlocked(
    app_data: &Path,
    server_hash: &str,
    username: &str,
    dek: Option<&[u8; cfms_core::constants::KEY_LEN]>,
    preferences: &UserPreference,
) -> Result<()> {
    let path = file_path(app_data, server_hash, username);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            cfms_core::Error::Other(format!(
                "Failed to create preference directory {}: {e}",
                parent.display()
            ))
        })?;
    }

    let plaintext =
        zeroize::Zeroizing::new(serde_json::to_vec(preferences).map_err(|e| {
            cfms_core::Error::Other(format!("Failed to serialize preferences: {e}"))
        })?);

    let dek = dek.ok_or_else(|| {
        cfms_core::Error::Other("Cannot save user preferences without a DEK".into())
    })?;
    let bytes = cfms_crypto::encrypt_config(&plaintext, dek)
        .map_err(|e| cfms_core::Error::Other(format!("Failed to encrypt preference file: {e}")))?;

    use std::io::Write;
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
    file.write_all(&bytes)?;
    file.as_file().sync_all()?;
    file.persist(&path).map_err(|e| {
        cfms_core::Error::Other(format!(
            "Failed to write preference file {}: {e}",
            path.display()
        ))
    })?;
    Ok(())
}

fn preference_lock(path: &Path) -> std::sync::Arc<std::sync::Mutex<()>> {
    use std::sync::{Arc, Mutex, OnceLock};
    static LOCKS: OnceLock<Mutex<std::collections::HashMap<PathBuf, Arc<Mutex<()>>>>> =
        OnceLock::new();
    LOCKS
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .entry(path.to_path_buf())
        .or_default()
        .clone()
}

/// Hold the same scope lock across the complete read/modify/encrypt/replace operation.
pub fn update(
    app_data: &Path,
    server_hash: &str,
    username: &str,
    dek: &[u8; cfms_core::constants::KEY_LEN],
    mutate: impl FnOnce(&mut UserPreference) -> std::result::Result<(), String>,
) -> std::result::Result<UserPreference, String> {
    let lock = preference_lock(&file_path(app_data, server_hash, username));
    let _guard = lock.lock().unwrap();
    let mut pref = load(app_data, server_hash, username, Some(dek)).map_err(|e| e.to_string())?;
    mutate(&mut pref)?;
    pref.task_concurrency = pref.task_concurrency.normalized();
    pref.transfer = pref.transfer.normalized();
    save_unlocked(app_data, server_hash, username, Some(dek), &pref).map_err(|e| e.to_string())?;
    Ok(pref)
}

#[derive(Default, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreferencePatch {
    pub appearance: Option<cfms_core::AppearancePreference>,
    pub record_recent_visits: Option<bool>,
    pub use_external_storage: Option<bool>,
    pub external_storage_path: Option<String>,
    pub root_back_button_behavior: Option<String>,
    pub privacy: Option<PrivacyPatch>,
    pub task_concurrency: Option<cfms_core::TaskConcurrencyPreference>,
    pub transfer: Option<cfms_core::TransferPreference>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrivacyPatch {
    pub version: u8,
    pub screenshot_protection_enabled: bool,
}

impl PreferencePatch {
    pub fn apply(self, pref: &mut UserPreference) -> std::result::Result<(), String> {
        if let Some(value) = self.appearance {
            pref.appearance = value;
        }
        if let Some(value) = self.record_recent_visits {
            pref.record_recent_visits = value;
            if !value {
                pref.recent_visits.clear();
            }
        }
        if let Some(value) = self.use_external_storage {
            pref.use_external_storage = value;
        }
        if let Some(value) = self.external_storage_path {
            pref.external_storage_path = value.trim().into();
        }
        if let Some(value) = self.root_back_button_behavior {
            if !["exit", "background"].contains(&value.as_str()) {
                return Err("Invalid root back-button behavior".into());
            }
            pref.root_back_button_behavior = Some(value);
        }
        if let Some(value) = self.privacy {
            if value.version != 1 {
                return Err("Invalid privacy preference version".into());
            }
            pref.privacy = cfms_core::PrivacyPreference {
                version: 1,
                screenshot_protection_enabled: value.screenshot_protection_enabled,
            };
        }
        if let Some(value) = self.task_concurrency {
            pref.task_concurrency = value.normalized();
        }
        if let Some(value) = self.transfer {
            pref.transfer = value.normalized();
        }
        Ok(())
    }
}

#[derive(serde::Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum FilePreferenceMutation {
    Visit {
        record: cfms_core::types::RecentFileRecord,
    },
    RemoveVisit {
        record: cfms_core::types::RecentFileRecord,
    },
    ClearVisits,
    ImportVisits {
        records: Vec<cfms_core::types::RecentFileRecord>,
    },
    Favorite {
        record: cfms_core::types::RecentFileRecord,
        favorite: bool,
    },
    ClearFavorites,
}

impl FilePreferenceMutation {
    pub fn apply(self, pref: &mut UserPreference, now_ms: u64) -> std::result::Result<(), String> {
        fn validate(
            record: &cfms_core::types::RecentFileRecord,
        ) -> std::result::Result<(), String> {
            if !["document", "directory"].contains(&record.object_type.as_str())
                || record.id.is_empty()
            {
                return Err("Invalid file preference record".into());
            }
            Ok(())
        }
        match self {
            Self::Visit { mut record } => {
                validate(&record)?;
                if pref.record_recent_visits {
                    record.visited_at = now_ms;
                    if record.parent_id.as_deref() == Some("/") {
                        record.parent_id = None;
                    }
                    pref.recent_visits.retain(|item| {
                        item.object_type != record.object_type || item.id != record.id
                    });
                    pref.recent_visits.insert(0, record);
                    pref.recent_visits.truncate(10);
                }
            }
            Self::RemoveVisit { record } => pref
                .recent_visits
                .retain(|item| item.object_type != record.object_type || item.id != record.id),
            Self::ClearVisits => pref.recent_visits.clear(),
            Self::ImportVisits { mut records } => {
                for record in &records {
                    validate(record)?;
                }
                if pref.record_recent_visits && pref.recent_visits.is_empty() {
                    records.sort_by_key(|record| std::cmp::Reverse(record.visited_at));
                    let mut seen = std::collections::HashSet::new();
                    records.retain(|record| {
                        seen.insert((record.object_type.clone(), record.id.clone()))
                    });
                    records.truncate(10);
                    pref.recent_visits = records;
                }
            }
            Self::Favorite { record, favorite } => {
                validate(&record)?;
                let target = if record.object_type == "directory" {
                    &mut pref.favourites.directories
                } else {
                    &mut pref.favourites.files
                };
                if favorite {
                    target.insert(record.id, record.name);
                } else {
                    target.remove(&record.id);
                }
            }
            Self::ClearFavorites => pref.favourites = Default::default(),
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_domain_updates_preserve_unrelated_fields() {
        let temp = tempfile::tempdir().unwrap();
        std::thread::scope(|scope| {
            for i in 0..12 {
                let root = temp.path();
                scope.spawn(move || {
                    update(root, "server", "alice", &[7; 32], |pref| {
                        pref.favourites.files.insert(i.to_string(), "name".into());
                        Ok(())
                    })
                    .unwrap();
                });
            }
        });
        assert_eq!(
            load(temp.path(), "server", "alice", Some(&[7; 32]))
                .unwrap()
                .favourites
                .files
                .len(),
            12
        );
    }

    #[test]
    fn rejected_update_does_not_replace_existing_preferences() {
        let temp = tempfile::tempdir().unwrap();
        save(
            temp.path(),
            "s",
            "u",
            Some(&[7; 32]),
            &UserPreference::default(),
        )
        .unwrap();
        let before = std::fs::read(file_path(temp.path(), "s", "u")).unwrap();
        assert!(
            update(temp.path(), "s", "u", &[7; 32], |pref| {
                pref.record_recent_visits = true;
                Err("rejected".into())
            })
            .is_err()
        );
        assert_eq!(
            std::fs::read(file_path(temp.path(), "s", "u")).unwrap(),
            before
        );
    }

    #[test]
    fn visits_are_deduplicated_bounded_and_disabled_by_policy() {
        let mut pref = UserPreference {
            record_recent_visits: true,
            ..Default::default()
        };
        for i in 0..15 {
            let record = cfms_core::types::RecentFileRecord {
                object_type: "document".into(),
                id: (i % 12).to_string(),
                name: "name".into(),
                parent_id: None,
                visited_at: 0,
            };
            FilePreferenceMutation::Visit { record }
                .apply(&mut pref, i)
                .unwrap();
        }
        assert_eq!(pref.recent_visits.len(), 10);
        assert_eq!(pref.recent_visits[0].visited_at, 14);
        PreferencePatch {
            record_recent_visits: Some(false),
            ..Default::default()
        }
        .apply(&mut pref)
        .unwrap();
        assert!(pref.recent_visits.is_empty());
        assert!(
            serde_json::from_value::<PreferencePatch>(serde_json::json!({"app_lock": {}})).is_err()
        );
    }

    const SERVER_HASH: &str = "server";
    const USERNAME: &str = "alice";

    fn dek() -> [u8; cfms_core::constants::KEY_LEN] {
        [7; cfms_core::constants::KEY_LEN]
    }

    #[test]
    fn missing_file_returns_default_preferences() {
        let temp = tempfile::tempdir().unwrap();
        assert!(!exists(temp.path(), SERVER_HASH, USERNAME));

        let preferences = load(temp.path(), SERVER_HASH, USERNAME, Some(&dek())).unwrap();

        assert_eq!(
            preferences.appearance,
            cfms_core::AppearancePreference::default()
        );
        assert!(preferences.favourites.files.is_empty());
        assert!(preferences.favourites.directories.is_empty());
        assert!(preferences.privacy.screenshot_protection_enabled);
    }

    #[test]
    fn encrypted_preferences_roundtrip() {
        let temp = tempfile::tempdir().unwrap();
        let mut preferences = UserPreference::default();
        preferences
            .favourites
            .files
            .insert("doc-1".into(), "Report.pdf".into());

        save(
            temp.path(),
            SERVER_HASH,
            USERNAME,
            Some(&dek()),
            &preferences,
        )
        .unwrap();

        let raw = std::fs::read(file_path(temp.path(), SERVER_HASH, USERNAME)).unwrap();
        assert!(cfms_crypto::is_encrypted(&raw));

        let loaded = load(temp.path(), SERVER_HASH, USERNAME, Some(&dek())).unwrap();
        assert_eq!(
            loaded.favourites.files.get("doc-1").map(String::as_str),
            Some("Report.pdf")
        );
    }

    #[test]
    fn legacy_extension_state_is_ignored_and_removed_only_on_encrypted_save() {
        let temp = tempfile::tempdir().unwrap();
        let mut expected = UserPreference::default();
        expected
            .favourites
            .files
            .insert("doc-1".into(), "Report.pdf".into());
        expected.app_lock = serde_json::json!({ "verifier": "existing-pin-verifier" });
        expected.root_back_button_behavior = Some("background".into());
        expected.privacy.screenshot_protection_enabled = false;
        let expected_json = serde_json::to_value(&expected).unwrap();
        let mut legacy = expected_json.clone();
        legacy["extensions"] = serde_json::json!({
            "org.cfms.example": {
                "enabled": true,
                "install_epoch": "epoch-1",
                "granted_capabilities": ["account.summary.read"],
                "settings": { "view": "compact" }
            }
        });
        let encrypted =
            cfms_crypto::encrypt_config(&serde_json::to_vec(&legacy).unwrap(), &dek()).unwrap();
        let path = file_path(temp.path(), SERVER_HASH, USERNAME);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &encrypted).unwrap();

        let loaded = load(temp.path(), SERVER_HASH, USERNAME, Some(&dek())).unwrap();
        assert_eq!(serde_json::to_value(&loaded).unwrap(), expected_json);
        assert_eq!(std::fs::read(&path).unwrap(), encrypted);

        save(temp.path(), SERVER_HASH, USERNAME, Some(&dek()), &loaded).unwrap();
        let raw = std::fs::read(&path).unwrap();
        assert!(cfms_crypto::is_encrypted(&raw));
        assert!(!String::from_utf8_lossy(&raw).contains("org.cfms.example"));
        let saved: serde_json::Value =
            serde_json::from_slice(&cfms_crypto::decrypt_config(&raw, &dek()).unwrap()).unwrap();
        assert!(saved.get("extensions").is_none());
        assert_eq!(saved, expected_json);
        let reloaded = load(temp.path(), SERVER_HASH, USERNAME, Some(&dek())).unwrap();
        assert_eq!(serde_json::to_value(reloaded).unwrap(), expected_json);
    }

    #[test]
    fn legacy_screenshot_setting_is_ignored() {
        let preferences: UserPreference = serde_json::from_value(serde_json::json!({
            "screenshot_protection_enabled": false
        }))
        .unwrap();

        assert!(preferences.privacy.screenshot_protection_enabled);
    }

    #[test]
    fn incompatible_privacy_setting_uses_fresh_defaults() {
        for privacy in [
            serde_json::json!(false),
            serde_json::json!({ "version": 2, "screenshot_protection_enabled": false }),
            serde_json::json!({ "version": 1, "screenshot_protection_enabled": "false" }),
        ] {
            let preferences: UserPreference = serde_json::from_value(serde_json::json!({
                "privacy": privacy
            }))
            .unwrap();

            assert!(preferences.privacy.screenshot_protection_enabled);
        }
    }

    #[test]
    fn current_privacy_setting_roundtrips() {
        let preferences: UserPreference = serde_json::from_value(serde_json::json!({
            "privacy": {
                "version": cfms_core::PRIVACY_PREFERENCE_VERSION,
                "screenshot_protection_enabled": false
            }
        }))
        .unwrap();

        assert!(!preferences.privacy.screenshot_protection_enabled);
        let serialized = serde_json::to_value(preferences).unwrap();
        assert_eq!(
            serialized["privacy"]["version"],
            cfms_core::PRIVACY_PREFERENCE_VERSION
        );
        assert_eq!(
            serialized["privacy"]["screenshot_protection_enabled"],
            false
        );
    }

    #[test]
    fn plaintext_preferences_are_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let path = file_path(temp.path(), SERVER_HASH, USERNAME);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            br#"{"appearance":{"color_scheme":"light","reduce_motion":"never"},"favourites":{"files":{"doc-2":"Plan.md"},"directories":{}}}"#,
        )
        .unwrap();

        let result = load(temp.path(), SERVER_HASH, USERNAME, Some(&dek()));
        assert!(result.is_err());
    }

    #[test]
    fn encrypted_preferences_require_dek() {
        let temp = tempfile::tempdir().unwrap();
        let preferences = UserPreference::default();

        save(
            temp.path(),
            SERVER_HASH,
            USERNAME,
            Some(&dek()),
            &preferences,
        )
        .unwrap();

        let result = load(temp.path(), SERVER_HASH, USERNAME, None);
        assert!(result.is_err());
    }

    #[test]
    fn wrong_dek_fails_to_load_preferences() {
        let temp = tempfile::tempdir().unwrap();
        let preferences = UserPreference::default();
        let wrong_dek = [9; cfms_core::constants::KEY_LEN];

        save(
            temp.path(),
            SERVER_HASH,
            USERNAME,
            Some(&dek()),
            &preferences,
        )
        .unwrap();

        let result = load(temp.path(), SERVER_HASH, USERNAME, Some(&wrong_dek));
        assert!(result.is_err());
    }

    #[test]
    fn save_without_dek_fails() {
        let temp = tempfile::tempdir().unwrap();
        let preferences = UserPreference::default();

        let result = save(temp.path(), SERVER_HASH, USERNAME, None, &preferences);
        assert!(result.is_err());
        assert!(!file_path(temp.path(), SERVER_HASH, USERNAME).exists());
    }

    #[test]
    fn discard_removes_preference_file() {
        let temp = tempfile::tempdir().unwrap();
        let preferences = UserPreference::default();
        let path = file_path(temp.path(), SERVER_HASH, USERNAME);

        save(
            temp.path(),
            SERVER_HASH,
            USERNAME,
            Some(&dek()),
            &preferences,
        )
        .unwrap();
        assert!(exists(temp.path(), SERVER_HASH, USERNAME));
        assert!(path.exists());

        discard(temp.path(), SERVER_HASH, USERNAME).unwrap();
        assert!(!exists(temp.path(), SERVER_HASH, USERNAME));
        assert!(!path.exists());
        assert!(discard(temp.path(), SERVER_HASH, USERNAME).is_ok());
    }
}
