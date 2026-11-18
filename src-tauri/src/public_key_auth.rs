//! Native private-key handles and the single in-flight interactive authentication.
use cfms_service::public_key_auth::{self, AuthPrivateKey};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tokio::sync::{oneshot, watch};

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeySource {
    External,
    Managed,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyInfo {
    pub key_ref: String,
    pub filename: String,
    pub algorithm: String,
    pub fingerprint: String,
    pub encrypted: bool,
    pub source: KeySource,
    pub key_id: Option<String>,
    pub hardware_backed: bool,
    pub rescue: bool,
    pub bound_server: Option<String>,
}

#[derive(Clone)]
pub enum SigningKeyHandle {
    External(AuthPrivateKey),
    Managed {
        key_id: String,
        fingerprint: String,
        backend: crate::managed_auth_keys::ManagedKeyBackend,
        rescue: bool,
    },
}

impl SigningKeyHandle {
    pub fn fingerprint(&self) -> Result<String, String> {
        match self {
            Self::External(key) => public_key_auth::fingerprint(key),
            Self::Managed { fingerprint, .. } => Ok(fingerprint.clone()),
        }
    }

    pub fn rescue_key_id(&self) -> Option<&str> {
        match self {
            Self::Managed {
                key_id,
                rescue: true,
                ..
            } => Some(key_id.as_str()),
            _ => None,
        }
    }
}

enum SelectedHandle {
    External(AuthPrivateKey),
    Managed {
        key_id: String,
        fingerprint: String,
        backend: crate::managed_auth_keys::ManagedKeyBackend,
        rescue: bool,
    },
}

struct SelectedKey {
    handle: SelectedHandle,
    selected: Instant,
}
pub struct ActiveAttempt {
    pub id: String,
    pub cancel: watch::Sender<bool>,
    pub reply: Option<(String, oneshot::Sender<SigningKeyHandle>)>,
}
#[derive(Default)]
pub struct PublicKeyState {
    keys: Mutex<HashMap<String, SelectedKey>>,
    pub active: Mutex<Option<ActiveAttempt>>,
}
pub fn random_id() -> String {
    use rand::RngExt;
    hex::encode(rand::rng().random::<[u8; 24]>())
}
impl PublicKeyState {
    pub fn select(&self, bytes: &[u8], filename: String) -> Result<KeyInfo, String> {
        let key = public_key_auth::parse(bytes)?;
        let info = KeyInfo {
            key_ref: random_id(),
            filename,
            algorithm: key.algorithm().to_string(),
            fingerprint: public_key_auth::fingerprint(&key)?,
            encrypted: key.is_encrypted(),
            source: KeySource::External,
            key_id: None,
            hardware_backed: false,
            rescue: false,
            bound_server: None,
        };
        let mut keys = self.keys.lock().unwrap();
        keys.retain(|_, key| key.selected.elapsed() < Duration::from_secs(600));
        keys.insert(
            info.key_ref.clone(),
            SelectedKey {
                handle: SelectedHandle::External(key),
                selected: Instant::now(),
            },
        );
        Ok(info)
    }
    pub fn select_managed(
        &self,
        record: &crate::managed_auth_keys::ManagedKeyRecord,
        current_server_hash: Option<&str>,
    ) -> KeyInfo {
        let rescue = current_server_hash.is_none_or(|hash| hash != record.server_hash);
        let filename = record
            .label
            .clone()
            .filter(|label| !label.trim().is_empty())
            .unwrap_or_else(|| record.algorithm.clone());
        let info = KeyInfo {
            key_ref: random_id(),
            filename,
            algorithm: record.algorithm.clone(),
            fingerprint: record.fingerprint.clone(),
            encrypted: false,
            source: KeySource::Managed,
            key_id: Some(record.key_id.clone()),
            hardware_backed: record.hardware_backed,
            rescue,
            bound_server: Some(record.server_address.clone()),
        };
        let mut keys = self.keys.lock().unwrap();
        keys.retain(|_, key| key.selected.elapsed() < Duration::from_secs(600));
        keys.insert(
            info.key_ref.clone(),
            SelectedKey {
                handle: SelectedHandle::Managed {
                    key_id: record.key_id.clone(),
                    fingerprint: record.fingerprint.clone(),
                    backend: record.backend,
                    rescue,
                },
                selected: Instant::now(),
            },
        );
        info
    }
    pub fn take(&self, key_ref: &str, passphrase: &str) -> Result<SigningKeyHandle, String> {
        let mut keys = self.keys.lock().unwrap();
        keys.retain(|_, key| key.selected.elapsed() < Duration::from_secs(600));
        let key = keys
            .get(key_ref)
            .filter(|key| key.selected.elapsed() < Duration::from_secs(600))
            .ok_or("publicKey.selectAgain")?;
        let handle = match &key.handle {
            SelectedHandle::External(raw) => {
                // Keep the encrypted selection for retry when the passphrase is wrong.
                let decrypted = public_key_auth::unlock(raw.clone(), passphrase)?;
                SigningKeyHandle::External(decrypted)
            }
            SelectedHandle::Managed {
                key_id,
                fingerprint,
                backend,
                rescue,
            } => SigningKeyHandle::Managed {
                key_id: key_id.clone(),
                fingerprint: fingerprint.clone(),
                backend: *backend,
                rescue: *rescue,
            },
        };
        keys.remove(key_ref);
        Ok(handle)
    }
    pub fn release(&self, key_ref: &str) {
        self.keys.lock().unwrap().remove(key_ref);
    }
    pub fn cancel(&self) {
        if let Some(active) = self.active.lock().unwrap().take() {
            let _ = active.cancel.send(true);
        }
        self.keys.lock().unwrap().clear();
    }
    pub fn finish(&self, id: &str) {
        let mut active = self.active.lock().unwrap();
        if active.as_ref().is_some_and(|a| a.id == id) {
            active.take();
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthInteraction {
    Signing,
    SelectKey { interaction_id: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancelling_releases_pending_response_and_keys() {
        let state = PublicKeyState::default();
        let (cancel, rx) = watch::channel(false);
        let (reply, mut reply_rx) = oneshot::channel();
        *state.active.lock().unwrap() = Some(ActiveAttempt {
            id: "a".into(),
            cancel,
            reply: Some(("i".into(), reply)),
        });
        state.cancel();
        assert!(*rx.borrow());
        assert!(reply_rx.try_recv().is_err());
        assert!(state.active.lock().unwrap().is_none());
    }
    #[test]
    fn encrypted_handles_retry_without_exposing_key_material_and_are_consumed_after_unlock() {
        let vectors: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../crates/service/tests/fixtures/auth-keys.json"
        ))
        .unwrap();
        let state = PublicKeyState::default();
        let selected = state
            .select(
                vectors[0]["encrypted_key"].as_str().unwrap().as_bytes(),
                "id_ed25519".into(),
            )
            .unwrap();
        assert!(state.take(&selected.key_ref, "incorrect").is_err());
        assert!(state.take(&selected.key_ref, "test-passphrase").is_ok());
        assert!(state.take(&selected.key_ref, "test-passphrase").is_err());
    }
    #[test]
    fn expired_and_cancelled_selections_are_released() {
        let vectors: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../crates/service/tests/fixtures/auth-keys.json"
        ))
        .unwrap();
        let state = PublicKeyState::default();
        let bytes = vectors[0]["private_key"].as_str().unwrap().as_bytes();
        let selected = state.select(bytes, "key".into()).unwrap();
        state
            .keys
            .lock()
            .unwrap()
            .get_mut(&selected.key_ref)
            .unwrap()
            .selected = Instant::now() - Duration::from_secs(601);
        assert!(state.take(&selected.key_ref, "").is_err());
        assert!(state.keys.lock().unwrap().is_empty());
        let selected = state.select(bytes, "key".into()).unwrap();
        state.cancel();
        assert!(state.take(&selected.key_ref, "").is_err());
    }
}
