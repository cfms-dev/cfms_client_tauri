//! Managed authentication keypairs backed by hardware security modules (TPM 2.0 / Android Keystore)
//! with fallback to the OS credential store (`SecretStore`).
#[cfg(target_os = "android")]
mod android_keystore;
mod os_store;
mod store;
mod types;
#[cfg(windows)]
mod windows_tpm;

use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

pub use store::ManagedKeyIndex;
pub use types::{
    GeneratedManagedKey, ManagedKeyBackend, ManagedKeyInventory, ManagedKeyRecord,
    display_server_address, validate_key_id,
};

#[derive(Default)]
pub struct ManagedAuthKeys {
    pub operation: Mutex<()>,
}

fn app_index<R: Runtime>(app: &AppHandle<R>) -> Result<ManagedKeyIndex, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| crate::secure_store::UNAVAILABLE)?;
    Ok(ManagedKeyIndex::new(app_data_dir))
}

pub fn probe_capability<R: Runtime>(app: &AppHandle<R>) -> (bool, bool) {
    #[cfg(windows)]
    if windows_tpm::is_available() {
        return (true, true);
    }
    #[cfg(target_os = "android")]
    {
        let (available, hardware_backed) = android_keystore::probe_support(app);
        if available {
            return (true, hardware_backed);
        }
    }
    (os_store::is_available(app), false)
}

pub fn load_records_and_capability<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(bool, bool, Vec<ManagedKeyRecord>), String> {
    let (storage_available, hardware_backed) = probe_capability(app);
    let records = match app_index(app)?.read_records() {
        Ok(records) => records,
        Err(err) => {
            tracing::warn!("Failed to read managed auth key index: {err}");
            Vec::new()
        }
    };
    Ok((storage_available, hardware_backed, records))
}

pub fn build_inventory(
    storage_available: bool,
    hardware_backed: bool,
    records: &[ManagedKeyRecord],
    current_server: Option<&str>,
    username: Option<&str>,
) -> ManagedKeyInventory {
    let current_hash = current_server.map(cfms_core::get_server_hash);
    let (bound_keys, rescue_keys) =
        store::partition_records_for_server(records, current_hash.as_deref(), username);
    ManagedKeyInventory {
        storage_available,
        hardware_backed,
        bound_keys,
        rescue_keys,
    }
}

pub fn migrate_legacy_index<R: Runtime>(app: &AppHandle<R>) {
    let Ok(index) = app_index(app) else {
        return;
    };
    if !index.path().exists() {
        return;
    }
    if let Err(err) = index.read_records() {
        tracing::warn!("Failed to migrate managed auth key index: {err}");
    }
}

pub fn find_record<R: Runtime>(
    app: &AppHandle<R>,
    key_id: &str,
) -> Result<Option<ManagedKeyRecord>, String> {
    validate_key_id(key_id)?;
    app_index(app)?.find_record(key_id)
}

pub fn verify_key_usable<R: Runtime>(
    app: &AppHandle<R>,
    record: &ManagedKeyRecord,
) -> Result<(), String> {
    validate_key_id(&record.key_id)?;
    match record.backend {
        ManagedKeyBackend::HardwareTpm => {
            #[cfg(windows)]
            {
                windows_tpm::verify_exists(&record.key_id)
            }
            #[cfg(not(windows))]
            {
                let _ = app;
                Err(crate::secure_store::UNAVAILABLE.into())
            }
        }
        ManagedKeyBackend::HardwareAndroidKeystore => {
            #[cfg(target_os = "android")]
            {
                android_keystore::verify_exists(app, &record.key_id)
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = app;
                Err(crate::secure_store::UNAVAILABLE.into())
            }
        }
        ManagedKeyBackend::OsSecureStore => os_store::verify_exists(app, record),
    }
}

pub fn generate_keypair<R: Runtime>(app: &AppHandle<R>) -> Result<GeneratedManagedKey, String> {
    let key_id = crate::public_key_auth::random_id();
    validate_key_id(&key_id)?;

    #[cfg(windows)]
    match windows_tpm::generate_p256(&key_id) {
        Ok((public_key, fingerprint)) => {
            return Ok(GeneratedManagedKey {
                key_id,
                backend: ManagedKeyBackend::HardwareTpm,
                hardware_backed: true,
                algorithm: "ecdsa-sha2-nistp256".into(),
                public_key,
                fingerprint,
            });
        }
        Err(err) => {
            tracing::warn!(
                "Windows TPM P-256 key generation failed, falling back to OS secure store: {err}"
            );
        }
    }

    #[cfg(target_os = "android")]
    match android_keystore::generate_p256(app, &key_id) {
        Ok((public_key, fingerprint, hardware_backed)) => {
            return Ok(GeneratedManagedKey {
                key_id,
                backend: ManagedKeyBackend::HardwareAndroidKeystore,
                hardware_backed,
                algorithm: "ecdsa-sha2-nistp256".into(),
                public_key,
                fingerprint,
            });
        }
        Err(err) => {
            tracing::warn!(
                "Android Keystore P-256 key generation failed, falling back to OS secure store: {err}"
            );
        }
    }

    os_store::generate_ed25519(app, key_id)
}

pub fn delete_secret_material<R: Runtime>(
    app: &AppHandle<R>,
    key_id: &str,
    backend: ManagedKeyBackend,
) -> Result<(), String> {
    validate_key_id(key_id)?;
    match backend {
        ManagedKeyBackend::HardwareTpm => {
            #[cfg(windows)]
            {
                windows_tpm::delete_key(key_id)
            }
            #[cfg(not(windows))]
            {
                let _ = (app, key_id);
                Ok(())
            }
        }
        ManagedKeyBackend::HardwareAndroidKeystore => {
            #[cfg(target_os = "android")]
            {
                android_keystore::delete_key(app, key_id)
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, key_id);
                Ok(())
            }
        }
        ManagedKeyBackend::OsSecureStore => os_store::delete_key(app, key_id),
    }
}

pub fn save_record<R: Runtime>(app: &AppHandle<R>, record: ManagedKeyRecord) -> Result<(), String> {
    validate_key_id(&record.key_id)?;
    app_index(app)?.save_record(record)
}

pub fn sign_challenge<R: Runtime>(
    app: &AppHandle<R>,
    key_id: &str,
    backend: ManagedKeyBackend,
    challenge: &[u8],
) -> Result<String, String> {
    validate_key_id(key_id)?;
    match backend {
        ManagedKeyBackend::HardwareTpm => {
            #[cfg(windows)]
            {
                windows_tpm::sign_p256(key_id, challenge)
            }
            #[cfg(not(windows))]
            {
                let _ = (app, key_id, challenge);
                Err("publicKey.signingFailed".into())
            }
        }
        ManagedKeyBackend::HardwareAndroidKeystore => {
            #[cfg(target_os = "android")]
            {
                android_keystore::sign_p256(app, key_id, challenge)
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, key_id, challenge);
                Err("publicKey.signingFailed".into())
            }
        }
        ManagedKeyBackend::OsSecureStore => os_store::sign_challenge(app, key_id, challenge),
    }
}

pub fn rebind_keys_to_server<R: Runtime>(
    app: &AppHandle<R>,
    key_ids: &[String],
    new_server_address: &str,
    user_id: Option<&str>,
    username: &str,
) -> Result<bool, String> {
    app_index(app)?.rebind_records(key_ids, new_server_address, user_id, username)
}

pub fn update_label_by_credential_id<R: Runtime>(
    app: &AppHandle<R>,
    server_hash: &str,
    target_user_id: Option<&str>,
    credential_id: &str,
    label: Option<String>,
) -> Result<bool, String> {
    app_index(app)?.update_label_by_credential_id(server_hash, target_user_id, credential_id, label)
}

pub fn delete_by_credential_id<R: Runtime>(
    app: &AppHandle<R>,
    server_hash: &str,
    target_user_id: Option<&str>,
    credential_id: &str,
) -> Result<bool, String> {
    let index = app_index(app)?;
    let records = index.read_records()?;
    let mut kept = Vec::with_capacity(records.len());
    let mut removed_any = false;
    let mut first_error = None;

    for record in records {
        if store::record_matches_credential(&record, server_hash, target_user_id, credential_id) {
            if let Err(err) = delete_secret_material(app, &record.key_id, record.backend) {
                tracing::warn!(
                    "Failed to delete secret material for managed key {}: {err}",
                    record.key_id
                );
                if first_error.is_none() {
                    first_error = Some(err);
                }
                kept.push(record);
            } else {
                removed_any = true;
            }
        } else {
            kept.push(record);
        }
    }

    if removed_any {
        index.write_records(&kept)?;
    }
    if let Some(err) = first_error {
        return Err(err);
    }
    Ok(removed_any)
}

pub fn clear<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let index = app_index(app)?;
    let records = match index.read_records() {
        Ok(records) => records,
        Err(err) => {
            tracing::warn!(
                "Managed auth key index was unreadable during reset; removing index: {err}"
            );
            return index.remove_index_file();
        }
    };
    let mut remaining = Vec::new();
    let mut first_error = None;
    for record in records {
        if let Err(err) = delete_secret_material(app, &record.key_id, record.backend) {
            if first_error.is_none() {
                first_error = Some(err);
            }
            remaining.push(record);
        }
    }
    if let Some(err) = first_error {
        let _ = index.write_records(&remaining);
        return Err(err);
    }
    index.remove_index_file()
}
