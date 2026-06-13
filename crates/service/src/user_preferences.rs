//! Per-user preference file persistence.
//!
//! Preferences are scoped by server and username, and are encrypted with the
//! in-memory DEK when one is available. Plain JSON is accepted as a legacy
//! format and migrated to encrypted storage on the next successful load/save.

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

    if cfms_crypto::is_encrypted(&raw) {
        let dek = dek.ok_or_else(|| {
            cfms_core::Error::Other("Encrypted preference file found but DEK is unavailable".into())
        })?;
        let plaintext = cfms_crypto::decrypt_config(&raw, dek).map_err(|e| {
            cfms_core::Error::Other(format!(
                "Failed to decrypt preference file {}: {e}",
                path.display()
            ))
        })?;
        return serde_json::from_slice(&plaintext).map_err(|e| {
            cfms_core::Error::Other(format!(
                "Invalid preference data in {}: {e}",
                path.display()
            ))
        });
    }

    let pref = serde_json::from_slice::<UserPreference>(&raw).unwrap_or_default();
    if let Some(dek) = dek
        && let Err(error) = save(app_data, server_hash, username, Some(dek), &pref)
    {
        tracing::warn!("Failed to migrate plaintext preference file: {error}");
    }

    Ok(pref)
}

/// Save preferences, encrypting when a DEK is available.
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

    let bytes = if let Some(dek) = dek {
        cfms_crypto::encrypt_config(&plaintext, dek).map_err(|e| {
            cfms_core::Error::Other(format!("Failed to encrypt preference file: {e}"))
        })?
    } else {
        if path.exists()
            && let Ok(raw) = std::fs::read(&path)
            && cfms_crypto::is_encrypted(&raw)
        {
            return Ok(());
        }
        plaintext
    };

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
        let preferences = load(temp.path(), SERVER_HASH, USERNAME, Some(&dek())).unwrap();

        assert_eq!(preferences.theme, "light");
        assert!(preferences.favourites.files.is_empty());
        assert!(preferences.favourites.directories.is_empty());
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
    fn plaintext_preferences_are_loaded_and_migrated() {
        let temp = tempfile::tempdir().unwrap();
        let path = file_path(temp.path(), SERVER_HASH, USERNAME);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            br#"{"theme":"light","favourites":{"files":{"doc-2":"Plan.md"},"directories":{}}}"#,
        )
        .unwrap();

        let loaded = load(temp.path(), SERVER_HASH, USERNAME, Some(&dek())).unwrap();
        assert_eq!(
            loaded.favourites.files.get("doc-2").map(String::as_str),
            Some("Plan.md")
        );

        let raw = std::fs::read(path).unwrap();
        assert!(cfms_crypto::is_encrypted(&raw));
    }
}
