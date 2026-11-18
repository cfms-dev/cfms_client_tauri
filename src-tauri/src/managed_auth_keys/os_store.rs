//! Software OS credential store (`SecretStore`) backend for managed Ed25519 keys.
use super::types::{GeneratedManagedKey, ManagedKeyBackend, ManagedKeyRecord, SERVICE};
use tauri::{AppHandle, Runtime};
use zeroize::Zeroizing;

const PROBE_ACCOUNT: &str = "__capability_probe__";

pub fn is_available<R: Runtime>(app: &AppHandle<R>) -> bool {
    crate::secure_store::SecretStore::new(app, SERVICE, PROBE_ACCOUNT)
        .read()
        .is_ok()
}

pub fn verify_exists<R: Runtime>(
    app: &AppHandle<R>,
    record: &ManagedKeyRecord,
) -> Result<(), String> {
    let raw = crate::secure_store::SecretStore::new(app, SERVICE, &record.key_id)
        .read()?
        .ok_or("publicKey.storageInvalidated")?;
    let key = cfms_service::public_key_auth::parse(raw.as_bytes())?;
    let fp = cfms_service::public_key_auth::fingerprint(&key)?;
    if fp != record.fingerprint {
        return Err("publicKey.storageInvalidated".into());
    }
    Ok(())
}

pub fn generate_ed25519<R: Runtime>(
    app: &AppHandle<R>,
    key_id: String,
) -> Result<GeneratedManagedKey, String> {
    let (private_key, public_key, fingerprint) = cfms_service::public_key_auth::generate_ed25519()?;
    let openssh_pem = cfms_service::public_key_auth::encode_openssh_private_key(&private_key)?;
    crate::secure_store::SecretStore::new(app, SERVICE, &key_id).save(&openssh_pem)?;
    Ok(GeneratedManagedKey {
        key_id,
        backend: ManagedKeyBackend::OsSecureStore,
        hardware_backed: false,
        algorithm: "ssh-ed25519".into(),
        public_key,
        fingerprint,
    })
}

pub fn sign_challenge<R: Runtime>(
    app: &AppHandle<R>,
    key_id: &str,
    challenge: &[u8],
) -> Result<String, String> {
    let raw: Zeroizing<String> = crate::secure_store::SecretStore::new(app, SERVICE, key_id)
        .read()?
        .ok_or("publicKey.storageInvalidated")?;
    let key = cfms_service::public_key_auth::parse(raw.as_bytes())?;
    cfms_service::public_key_auth::sign(&key, challenge)
}

pub fn delete_key<R: Runtime>(app: &AppHandle<R>, key_id: &str) -> Result<(), String> {
    crate::secure_store::SecretStore::new(app, SERVICE, key_id).delete()
}
