//! Domain types and identifier validation for managed authentication keypairs.
use serde::{Deserialize, Serialize};

pub const SERVICE: &str = "org.crpteam.cfms_client_tauri.auth-keys";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedKeyBackend {
    HardwareTpm,
    HardwareAndroidKeystore,
    OsSecureStore,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedKeyRecord {
    pub key_id: String,
    pub backend: ManagedKeyBackend,
    pub hardware_backed: bool,
    pub algorithm: String,
    pub fingerprint: String,
    pub public_key: String,
    pub label: Option<String>,
    pub server_hash: String,
    pub server_address: String,
    pub user_id: String,
    pub username: String,
    pub credential_id: Option<String>,
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedKeySummary {
    pub key_id: String,
    pub label: Option<String>,
    pub algorithm: String,
    pub fingerprint: String,
    pub hardware_backed: bool,
    pub server_address: String,
    pub username: String,
    pub credential_id: Option<String>,
    pub created_at: u64,
}

impl From<&ManagedKeyRecord> for ManagedKeySummary {
    fn from(record: &ManagedKeyRecord) -> Self {
        Self {
            key_id: record.key_id.clone(),
            label: record.label.clone(),
            algorithm: record.algorithm.clone(),
            fingerprint: record.fingerprint.clone(),
            hardware_backed: record.hardware_backed,
            server_address: record.server_address.clone(),
            username: record.username.clone(),
            credential_id: record.credential_id.clone(),
            created_at: record.created_at,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedKeyInventory {
    pub storage_available: bool,
    pub hardware_backed: bool,
    pub bound_keys: Vec<ManagedKeySummary>,
    pub rescue_keys: Vec<ManagedKeySummary>,
}

pub struct GeneratedManagedKey {
    pub key_id: String,
    pub backend: ManagedKeyBackend,
    pub hardware_backed: bool,
    pub algorithm: String,
    pub public_key: String,
    pub fingerprint: String,
}

/// Normalize server URL for compact display without scheme or trailing slash.
pub fn display_server_address(server_address: &str) -> String {
    let trimmed = server_address.trim();
    let without_scheme = if trimmed.len() >= 6 && trimmed[..6].eq_ignore_ascii_case("wss://") {
        &trimmed[6..]
    } else if trimmed.len() >= 5 && trimmed[..5].eq_ignore_ascii_case("ws://") {
        &trimmed[5..]
    } else {
        trimmed
    };
    without_scheme.trim_end_matches('/').to_string()
}

/// Guard against malformed or injected key identifiers before reaching CNG/Keystore/keyring.
pub fn validate_key_id(key_id: &str) -> Result<(), String> {
    if (8..=128).contains(&key_id.len())
        && key_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        Ok(())
    } else {
        Err("publicKey.selectAgain".into())
    }
}
