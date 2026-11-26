//! Atomic JSON index persistence and server/user-scoped queries for managed keys.
use super::types::{
    ManagedKeyBackend, ManagedKeyRecord, ManagedKeySummary, display_server_address,
};
use serde::Deserialize;
use std::io::Write;
use std::path::{Path, PathBuf};

const INDEX_FILENAME: &str = "managed-auth-keys.json";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredManagedKeyRecord {
    key_id: String,
    backend: ManagedKeyBackend,
    hardware_backed: bool,
    algorithm: String,
    fingerprint: String,
    public_key: String,
    label: Option<String>,
    server_hash: String,
    server_address: String,
    user_id: String,
    #[serde(default)]
    username_hash: Option<String>,
    #[serde(default, rename = "username")]
    legacy_username: Option<String>,
    credential_id: Option<String>,
    created_at: u64,
}

/// Path-scoped persistence store for managed key metadata records.
pub struct ManagedKeyIndex {
    app_data_dir: PathBuf,
}

impl ManagedKeyIndex {
    pub fn new(app_data_dir: impl Into<PathBuf>) -> Self {
        Self {
            app_data_dir: app_data_dir.into(),
        }
    }

    pub fn path(&self) -> PathBuf {
        self.app_data_dir.join(INDEX_FILENAME)
    }

    pub fn read_records(&self) -> Result<Vec<ManagedKeyRecord>, String> {
        let path = self.path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let bytes = std::fs::read(path).map_err(|_| crate::secure_store::UNAVAILABLE)?;
        let stored_records: Vec<StoredManagedKeyRecord> =
            serde_json::from_slice(&bytes).map_err(|_| crate::secure_store::UNAVAILABLE)?;
        let mut needs_migration = false;
        let mut records = Vec::with_capacity(stored_records.len());
        for stored in stored_records {
            if stored.legacy_username.is_some() {
                needs_migration = true;
            }
            let username_hash = match stored.username_hash.filter(|hash| !hash.trim().is_empty()) {
                Some(hash) => hash,
                None => match stored.legacy_username {
                    Some(legacy) => {
                        needs_migration = true;
                        cfms_crypto::hash_username(&legacy)
                    }
                    None => String::new(),
                },
            };
            records.push(ManagedKeyRecord {
                key_id: stored.key_id,
                backend: stored.backend,
                hardware_backed: stored.hardware_backed,
                algorithm: stored.algorithm,
                fingerprint: stored.fingerprint,
                public_key: stored.public_key,
                label: stored.label,
                server_hash: stored.server_hash,
                server_address: stored.server_address,
                user_id: stored.user_id,
                username_hash,
                credential_id: stored.credential_id,
                created_at: stored.created_at,
            });
        }
        if needs_migration && let Err(err) = self.write_records(&records) {
            tracing::warn!("Failed to persist migrated managed auth key index: {err}");
        }
        Ok(records)
    }

    pub fn write_records(&self, records: &[ManagedKeyRecord]) -> Result<(), String> {
        let path = self.path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| crate::secure_store::UNAVAILABLE)?;
        }
        let bytes = serde_json::to_vec(records).map_err(|_| crate::secure_store::UNAVAILABLE)?;
        atomic_write_private(&path, &bytes)
    }

    pub fn save_record(&self, record: ManagedKeyRecord) -> Result<(), String> {
        let mut records = self.read_records()?;
        records.retain(|existing| existing.key_id != record.key_id);
        records.push(record);
        self.write_records(&records)
    }

    pub fn find_record(&self, key_id: &str) -> Result<Option<ManagedKeyRecord>, String> {
        Ok(self
            .read_records()?
            .into_iter()
            .find(|record| record.key_id == key_id))
    }

    pub fn rebind_records(
        &self,
        key_ids: &[String],
        new_server_address: &str,
        user_id: Option<&str>,
        username: &str,
    ) -> Result<bool, String> {
        if key_ids.is_empty() {
            return Ok(false);
        }
        let mut records = self.read_records()?;
        let new_hash = cfms_core::get_server_hash(new_server_address);
        let new_display = display_server_address(new_server_address);
        let mut changed = false;
        for record in &mut records {
            if key_ids.iter().any(|id| id == &record.key_id) {
                record.server_hash = new_hash.clone();
                record.server_address = new_display.clone();
                if !username.trim().is_empty() {
                    record.username_hash = cfms_crypto::hash_username(username);
                }
                if let Some(uid) = user_id.filter(|u| !u.is_empty()) {
                    record.user_id = uid.to_string();
                }
                changed = true;
            }
        }
        if changed {
            self.write_records(&records)?;
        }
        Ok(changed)
    }

    pub fn update_label_by_credential_id(
        &self,
        server_hash: &str,
        target_user_id: Option<&str>,
        credential_id: &str,
        label: Option<String>,
    ) -> Result<bool, String> {
        let mut records = self.read_records()?;
        let mut changed = false;
        for record in &mut records {
            if record_matches_credential(record, server_hash, target_user_id, credential_id) {
                record.label = label.clone();
                changed = true;
            }
        }
        if changed {
            self.write_records(&records)?;
        }
        Ok(changed)
    }

    pub fn remove_index_file(&self) -> Result<(), String> {
        let path = self.path();
        if path.exists() {
            std::fs::remove_file(path).map_err(|_| crate::secure_store::UNAVAILABLE)?;
        }
        Ok(())
    }
}

pub fn record_matches_credential(
    record: &ManagedKeyRecord,
    server_hash: &str,
    target_user_id: Option<&str>,
    credential_id: &str,
) -> bool {
    record.server_hash == server_hash
        && record.credential_id.as_deref() == Some(credential_id)
        && target_user_id.is_none_or(|uid| record.user_id == uid)
}

pub fn partition_records_for_server(
    records: &[ManagedKeyRecord],
    current_server_hash: Option<&str>,
    username: Option<&str>,
) -> (Vec<ManagedKeySummary>, Vec<ManagedKeySummary>) {
    let mut bound_keys = Vec::new();
    let mut rescue_keys = Vec::new();
    for record in records {
        let summary = ManagedKeySummary::from_record(record, username);
        if current_server_hash.is_some_and(|hash| hash == record.server_hash) {
            bound_keys.push(summary);
        } else {
            rescue_keys.push(summary);
        }
    }
    (bound_keys, rescue_keys)
}

fn atomic_write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| crate::secure_store::UNAVAILABLE.to_string())?;
    let temp_name = format!(
        ".{}.{}.tmp",
        INDEX_FILENAME,
        crate::public_key_auth::random_id()
    );
    let temp_path = parent.join(temp_name);

    let write_res = (|| -> std::io::Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        replace_file(&temp_path, path)?;
        Ok(())
    })();

    if write_res.is_err() {
        let _ = std::fs::remove_file(&temp_path);
        return Err(crate::secure_store::UNAVAILABLE.into());
    }
    Ok(())
}

fn replace_file(temp_path: &Path, target_path: &Path) -> std::io::Result<()> {
    match std::fs::rename(temp_path, target_path) {
        Ok(()) => Ok(()),
        #[cfg(windows)]
        Err(_) if target_path.exists() => {
            std::fs::remove_file(target_path)?;
            std::fs::rename(temp_path, target_path)
        }
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::managed_auth_keys::types::{ManagedKeyBackend, validate_key_id};

    fn sample_record(key_id: &str, server: &str, username: &str) -> ManagedKeyRecord {
        ManagedKeyRecord {
            key_id: key_id.into(),
            backend: ManagedKeyBackend::OsSecureStore,
            hardware_backed: false,
            algorithm: "ssh-ed25519".into(),
            fingerprint: format!("fp-{key_id}"),
            public_key: format!("ssh-ed25519 AAAA-{key_id}"),
            label: Some(format!("Key {key_id}")),
            server_hash: cfms_core::get_server_hash(server),
            server_address: display_server_address(server),
            user_id: format!("uid-{username}"),
            username_hash: cfms_crypto::hash_username(username),
            credential_id: Some(format!("cred-{key_id}")),
            created_at: 1_700_000_000,
        }
    }

    #[test]
    fn partitions_bound_and_rescue_keys_by_server_hash_and_rebinds_on_rescue_success() {
        let dir = tempfile::tempdir().unwrap();
        let store = ManagedKeyIndex::new(dir.path());
        let mut r1 = sample_record("k1_valid_id", "wss://alpha.example.com:443", "alice");
        r1.user_id = "00000000-0000-4000-8000-000000000001".into();
        let mut r2 = sample_record("k2_valid_id", "wss://beta.example.com:5104", "bob");
        r2.user_id = "00000000-0000-4000-8000-000000000002".into();
        let records = vec![r1, r2];
        store.write_records(&records).unwrap();

        let raw_json = std::fs::read_to_string(store.path()).unwrap();
        assert!(!raw_json.contains("\"username\""));
        assert!(!raw_json.contains("alice"));
        assert!(!raw_json.contains("bob"));

        let loaded = store.read_records().unwrap();
        let alpha_hash = cfms_core::get_server_hash("wss://alpha.example.com:443");
        let (bound, rescue) =
            partition_records_for_server(&loaded, Some(&alpha_hash), Some("alice"));
        assert_eq!(bound.len(), 1);
        assert_eq!(bound[0].key_id, "k1_valid_id");
        assert!(bound[0].username_matches);
        assert_eq!(rescue.len(), 1);
        assert_eq!(rescue[0].key_id, "k2_valid_id");
        assert!(!rescue[0].username_matches);
        assert_eq!(rescue[0].server_address, "beta.example.com:5104");

        let (bound_none, rescue_none) =
            partition_records_for_server(&loaded, Some(&alpha_hash), None);
        assert!(!bound_none[0].username_matches);
        assert!(!rescue_none[0].username_matches);

        let rebound = store
            .rebind_records(
                &["k2_valid_id".to_string()],
                "wss://alpha.example.com:443",
                Some("00000000-0000-4000-8000-000000000003"),
                "alice",
            )
            .unwrap();
        assert!(rebound);

        let after_rebind_json = std::fs::read_to_string(store.path()).unwrap();
        assert!(!after_rebind_json.contains("alice"));
        assert!(!after_rebind_json.contains("\"username\""));

        let after = store.read_records().unwrap();
        let (bound_after, rescue_after) =
            partition_records_for_server(&after, Some(&alpha_hash), Some("alice"));
        assert_eq!(bound_after.len(), 2);
        assert!(bound_after.iter().all(|summary| summary.username_matches));
        assert!(rescue_after.is_empty());
        let moved = after.iter().find(|r| r.key_id == "k2_valid_id").unwrap();
        assert_eq!(moved.user_id, "00000000-0000-4000-8000-000000000003");
        assert!(cfms_crypto::verify_username(&moved.username_hash, "alice"));
        assert!(!cfms_crypto::verify_username(&moved.username_hash, "bob"));
    }

    #[test]
    fn migrates_legacy_plaintext_username_records_and_strips_plaintext_from_disk() {
        let dir = tempfile::tempdir().unwrap();
        let store = ManagedKeyIndex::new(dir.path());
        let legacy_json = serde_json::json!([
            {
                "keyId": "legacy_key_01",
                "backend": "os_secure_store",
                "hardwareBacked": false,
                "algorithm": "ssh-ed25519",
                "fingerprint": "fp-legacy",
                "publicKey": "ssh-ed25519 AAAA",
                "label": "Legacy Key",
                "serverHash": cfms_core::get_server_hash("wss://alpha.example.com:443"),
                "serverAddress": "alpha.example.com:443",
                "userId": "00000000-0000-4000-8000-000000000001",
                "username": "alice",
                "credentialId": "cred-legacy",
                "createdAt": 1700000000u64
            },
            {
                "keyId": "mixed_key_02",
                "backend": "os_secure_store",
                "hardwareBacked": false,
                "algorithm": "ssh-ed25519",
                "fingerprint": "fp-mixed",
                "publicKey": "ssh-ed25519 BBBB",
                "label": "Mixed Key",
                "serverHash": cfms_core::get_server_hash("wss://alpha.example.com:443"),
                "serverAddress": "alpha.example.com:443",
                "userId": "00000000-0000-4000-8000-000000000002",
                "username": "bob",
                "usernameHash": cfms_crypto::hash_username("bob"),
                "credentialId": "cred-mixed",
                "createdAt": 1700000001u64
            }
        ]);
        std::fs::write(store.path(), serde_json::to_vec(&legacy_json).unwrap()).unwrap();

        let migrated = store.read_records().unwrap();
        assert_eq!(migrated.len(), 2);
        assert!(cfms_crypto::verify_username(
            &migrated[0].username_hash,
            "alice"
        ));
        assert!(!cfms_crypto::verify_username(
            &migrated[0].username_hash,
            "bob"
        ));
        assert!(cfms_crypto::verify_username(
            &migrated[1].username_hash,
            "bob"
        ));
        assert!(!cfms_crypto::verify_username(
            &migrated[1].username_hash,
            "alice"
        ));

        let rewritten = std::fs::read_to_string(store.path()).unwrap();
        assert!(!rewritten.contains("\"username\""));
        assert!(!rewritten.contains("alice"));
        assert!(!rewritten.contains("bob"));
        assert!(rewritten.contains("\"usernameHash\""));
    }

    #[test]
    fn updates_label_only_when_server_hash_and_user_match_even_on_credential_id_collision() {
        let dir = tempfile::tempdir().unwrap();
        let store = ManagedKeyIndex::new(dir.path());
        let mut rec_alpha = sample_record("k_alpha_1", "wss://alpha.example.com:443", "alice");
        rec_alpha.credential_id = Some("shared-cred-1".into());
        let mut rec_beta = sample_record("k_beta_1", "wss://beta.example.com:443", "alice");
        rec_beta.credential_id = Some("shared-cred-1".into());
        let mut rec_bob = sample_record("k_alpha_2", "wss://alpha.example.com:443", "bob");
        rec_bob.credential_id = Some("shared-cred-1".into());
        store
            .write_records(&[rec_alpha, rec_beta, rec_bob])
            .unwrap();

        let alpha_hash = cfms_core::get_server_hash("wss://alpha.example.com:443");
        let gamma_hash = cfms_core::get_server_hash("wss://gamma.example.com:443");

        assert!(
            !store
                .update_label_by_credential_id(
                    &gamma_hash,
                    None,
                    "shared-cred-1",
                    Some("Hijack".into())
                )
                .unwrap()
        );
        assert!(
            store
                .update_label_by_credential_id(
                    &alpha_hash,
                    Some("uid-alice"),
                    "shared-cred-1",
                    Some("Renamed Alpha".into()),
                )
                .unwrap()
        );

        let updated = store.read_records().unwrap();
        assert_eq!(
            updated
                .iter()
                .find(|r| r.key_id == "k_alpha_1")
                .unwrap()
                .label
                .as_deref(),
            Some("Renamed Alpha")
        );
        assert_eq!(
            updated
                .iter()
                .find(|r| r.key_id == "k_beta_1")
                .unwrap()
                .label
                .as_deref(),
            Some("Key k_beta_1")
        );
        assert_eq!(
            updated
                .iter()
                .find(|r| r.key_id == "k_alpha_2")
                .unwrap()
                .label
                .as_deref(),
            Some("Key k_alpha_2")
        );
    }

    #[test]
    fn validates_key_ids_and_normalizes_display_addresses() {
        assert!(validate_key_id("0123456789abcdef").is_ok());
        assert!(validate_key_id("../escape").is_err());
        assert!(validate_key_id("short").is_err());
        assert!(validate_key_id("bad space id").is_err());
        assert_eq!(
            display_server_address("WSS://Example.COM:443/"),
            "Example.COM:443"
        );
    }
}
