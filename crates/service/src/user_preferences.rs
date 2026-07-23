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
    let plaintext = cfms_crypto::decrypt_config(&raw, dek).map_err(|e| {
        cfms_core::Error::Other(format!(
            "Failed to decrypt preference file {}: {e}",
            path.display()
        ))
    })?;

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
    let path = file_path(app_data, server_hash, username);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            cfms_core::Error::Other(format!(
                "Failed to create preference directory {}: {e}",
                parent.display()
            ))
        })?;
    }

    let plaintext = serde_json::to_vec(preferences)
        .map_err(|e| cfms_core::Error::Other(format!("Failed to serialize preferences: {e}")))?;

    let dek = dek.ok_or_else(|| {
        cfms_core::Error::Other("Cannot save user preferences without a DEK".into())
    })?;
    let bytes = cfms_crypto::encrypt_config(&plaintext, dek)
        .map_err(|e| cfms_core::Error::Other(format!("Failed to encrypt preference file: {e}")))?;

    std::fs::write(&path, bytes).map_err(|e| {
        cfms_core::Error::Other(format!(
            "Failed to write preference file {}: {e}",
            path.display()
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn extension_activation_roundtrips_inside_encrypted_preferences() {
        let temp = tempfile::tempdir().unwrap();
        let mut preferences = UserPreference::default();
        preferences.extensions.insert(
            "org.cfms.example".into(),
            cfms_core::ExtensionPreference {
                enabled: true,
                install_epoch: "epoch-1".into(),
                granted_capabilities: vec!["account.summary.read".into()],
                settings: serde_json::json!({ "view": "compact" }),
            },
        );
        save(
            temp.path(),
            SERVER_HASH,
            USERNAME,
            Some(&dek()),
            &preferences,
        )
        .unwrap();

        let loaded = load(temp.path(), SERVER_HASH, USERNAME, Some(&dek())).unwrap();
        assert_eq!(loaded.extensions, preferences.extensions);
        let raw = std::fs::read(file_path(temp.path(), SERVER_HASH, USERNAME)).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("org.cfms.example"));
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
