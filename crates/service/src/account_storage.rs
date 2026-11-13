//! Stable account storage and one-time import of authenticated legacy data.

use cfms_core::constants::KEY_LEN;
use std::path::{Path, PathBuf};

static IMPORT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn marker(app_data: &Path, server_hash: &str, user_id: &str) -> PathBuf {
    file_path(app_data, "user_preferences", server_hash, user_id).with_extension("imported")
}

/// Also used after explicitly discarding inaccessible data; unknown legacy files stay intact.
pub fn finish_legacy_import(
    app_data: &Path,
    server_hash: &str,
    user_id: &str,
) -> Result<(), String> {
    let path = marker(app_data, server_hash, user_id);
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn file_path(app_data: &Path, kind: &str, server_hash: &str, user_id: &str) -> PathBuf {
    app_data
        .join(kind)
        .join("accounts")
        .join(server_hash)
        .join(format!("{}.json", cfms_core::get_username_hash(user_id)))
}

pub fn legacy_path(
    app_data: &Path,
    kind: &str,
    server_hash: &str,
    username: &str,
) -> Option<PathBuf> {
    if username.contains(['/', '\\', ':']) {
        return None;
    }
    Some(
        app_data
            .join(kind)
            .join(format!("{server_hash}_{username}.json")),
    )
}

pub fn encrypted_paths(
    app_data: &Path,
    server_hash: &str,
    user_id: &str,
    username: &str,
) -> Vec<PathBuf> {
    ["user_preferences", "download_tasks", "upload_tasks"]
        .into_iter()
        .map(|kind| {
            let current = file_path(app_data, kind, server_hash, user_id);
            if current.exists() || marker(app_data, server_hash, user_id).exists() {
                current
            } else {
                legacy_path(app_data, kind, server_hash, username).unwrap_or(current)
            }
        })
        .collect()
}

/// Validate every source before publishing any file. Existing UUID data wins.
pub fn migrate(
    app_data: &Path,
    server_hash: &str,
    user_id: &str,
    username: &str,
    dek: &[u8; KEY_LEN],
) -> Result<(), String> {
    use std::io::Write;
    let _guard = IMPORT_LOCK.lock().unwrap();
    if marker(app_data, server_hash, user_id).exists() {
        return Ok(());
    }
    let mut imports = Vec::new();
    for kind in ["user_preferences", "download_tasks", "upload_tasks"] {
        let target = file_path(app_data, kind, server_hash, user_id);
        if target.exists() {
            continue;
        }
        let Some(source) = legacy_path(app_data, kind, server_hash, username) else {
            continue;
        };
        if !source.exists() {
            continue;
        }
        let raw = std::fs::read(&source).map_err(|e| e.to_string())?;
        let plain = zeroize::Zeroizing::new(
            cfms_crypto::decrypt_config(&raw, dek).map_err(|e| e.to_string())?,
        );
        let shape = crate::sensitive::SensitiveJson::new(
            serde_json::from_slice(&plain).map_err(|e| e.to_string())?,
        );
        if !shape.as_value().is_object() {
            return Err("Invalid account data: expected a JSON object".into());
        }
        match kind {
            "user_preferences" => {
                serde_json::from_slice::<cfms_core::UserPreference>(&plain)
                    .map_err(|e| e.to_string())?;
            }
            "download_tasks" => {
                super::transfers::task_persistence::validate(&plain)?;
            }
            _ => {
                super::transfers::upload_task_persistence::validate(&plain)?;
            }
        }
        imports.push((source, target, raw));
    }
    for (source, target, raw) in imports {
        let parent = target.parent().unwrap();
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        temporary.write_all(&raw).map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        match temporary.persist_noclobber(&target) {
            Ok(_) => std::fs::remove_file(source).map_err(|e| e.to_string())?,
            Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    finish_legacy_import(app_data, server_hash, user_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_data_or_failed_writes_keep_the_original_files() {
        let dir = tempfile::tempdir().unwrap();
        let key = [9; KEY_LEN];
        let source = legacy_path(dir.path(), "user_preferences", "server", "alice").unwrap();
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
        std::fs::write(&source, cfms_crypto::encrypt_config(b"[]", &key).unwrap()).unwrap();
        assert!(migrate(dir.path(), "server", "uuid-a", "alice", &key).is_err());
        assert!(source.exists());
        let plain = serde_json::to_vec(&cfms_core::UserPreference::default()).unwrap();
        std::fs::write(&source, cfms_crypto::encrypt_config(&plain, &key).unwrap()).unwrap();
        std::fs::write(
            dir.path().join("user_preferences").join("accounts"),
            b"blocking file",
        )
        .unwrap();
        assert!(migrate(dir.path(), "server", "uuid-a", "alice", &key).is_err());
        assert!(source.exists());
        assert!(!marker(dir.path(), "server", "uuid-a").exists());
    }

    #[test]
    fn explicitly_skipping_unowned_legacy_files_prevents_repeated_imports() {
        let dir = tempfile::tempdir().unwrap();
        let source = legacy_path(dir.path(), "download_tasks", "server", "alice").unwrap();
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
        std::fs::write(&source, b"unowned data").unwrap();
        finish_legacy_import(dir.path(), "server", "uuid-b").unwrap();
        migrate(dir.path(), "server", "uuid-b", "alice", &[1; KEY_LEN]).unwrap();
        assert!(source.exists());
        assert!(!encrypted_paths(dir.path(), "server", "uuid-b", "alice").contains(&source));
    }
    #[test]
    fn imports_once_and_preserves_uuid_data_across_renames() {
        let dir = tempfile::tempdir().unwrap();
        let key = [7; KEY_LEN];
        let source = legacy_path(dir.path(), "user_preferences", "server", "alice").unwrap();
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
        let bytes = serde_json::to_vec(&cfms_core::UserPreference::default()).unwrap();
        std::fs::write(&source, cfms_crypto::encrypt_config(&bytes, &key).unwrap()).unwrap();
        migrate(dir.path(), "server", "uuid-a", "alice", &key).unwrap();
        assert!(!source.exists());
        let target = file_path(dir.path(), "user_preferences", "server", "uuid-a");
        let before = std::fs::read(&target).unwrap();
        migrate(dir.path(), "server", "uuid-a", "new name", &key).unwrap();
        assert_eq!(before, std::fs::read(&target).unwrap());
        assert!(!file_path(dir.path(), "user_preferences", "server", "uuid-b").exists());
    }
    #[test]
    fn invalid_key_retains_source_and_existing_target_wins() {
        let dir = tempfile::tempdir().unwrap();
        let source = legacy_path(dir.path(), "user_preferences", "server", "alice").unwrap();
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
        std::fs::write(
            &source,
            cfms_crypto::encrypt_config(b"{}", &[1; KEY_LEN]).unwrap(),
        )
        .unwrap();
        assert!(migrate(dir.path(), "server", "uuid-b", "alice", &[2; KEY_LEN]).is_err());
        assert!(source.exists());
        let target = file_path(dir.path(), "user_preferences", "server", "uuid-b");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"existing").unwrap();
        migrate(dir.path(), "server", "uuid-b", "alice", &[2; KEY_LEN]).unwrap();
        assert_eq!(std::fs::read(target).unwrap(), b"existing");
        assert!(source.exists());
    }
}
