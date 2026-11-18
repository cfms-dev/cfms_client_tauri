//! Managed authentication keypairs backed by hardware security modules (TPM 2.0 / Android Keystore)
//! with fallback to the OS credential store (`SecretStore`).
use serde::{Deserialize, Serialize};
use std::{path::Path, path::PathBuf, sync::Mutex};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{AppHandle, Runtime};
use zeroize::Zeroizing;

const SERVICE: &str = "org.crpteam.cfms_client_tauri.auth-keys";
const PROBE_ACCOUNT: &str = "__capability_probe__";
const INDEX_FILENAME: &str = "managed-auth-keys.json";

#[derive(Default)]
pub struct ManagedAuthKeys {
    pub operation: Mutex<()>,
}

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

pub fn display_server_address(server_address: &str) -> String {
    server_address
        .trim()
        .trim_start_matches("wss://")
        .trim_start_matches("ws://")
        .trim_end_matches('/')
        .to_string()
}

fn index_path_in(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(INDEX_FILENAME)
}

fn index_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(index_path_in(
        &app.path()
            .app_data_dir()
            .map_err(|_| crate::secure_store::UNAVAILABLE)?,
    ))
}

pub fn read_records_in(app_data_dir: &Path) -> Result<Vec<ManagedKeyRecord>, String> {
    let path = index_path_in(app_data_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(path).map_err(|_| crate::secure_store::UNAVAILABLE)?;
    serde_json::from_slice(&bytes).map_err(|_| crate::secure_store::UNAVAILABLE.into())
}

pub fn write_records_in(app_data_dir: &Path, records: &[ManagedKeyRecord]) -> Result<(), String> {
    let path = index_path_in(app_data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| crate::secure_store::UNAVAILABLE)?;
    }
    let bytes = serde_json::to_vec(records).map_err(|_| crate::secure_store::UNAVAILABLE)?;
    std::fs::write(path, bytes).map_err(|_| crate::secure_store::UNAVAILABLE.into())
}

pub fn read_records<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<ManagedKeyRecord>, String> {
    let path = index_path(app)?;
    read_records_in(path.parent().unwrap())
}

fn write_records<R: Runtime>(
    app: &AppHandle<R>,
    records: &[ManagedKeyRecord],
) -> Result<(), String> {
    let path = index_path(app)?;
    write_records_in(path.parent().unwrap(), records)
}

pub fn partition_records_for_server(
    records: &[ManagedKeyRecord],
    current_server_hash: Option<&str>,
) -> (Vec<ManagedKeySummary>, Vec<ManagedKeySummary>) {
    let mut bound_keys = Vec::new();
    let mut rescue_keys = Vec::new();
    for record in records {
        if current_server_hash.is_some_and(|hash| hash == record.server_hash) {
            bound_keys.push(ManagedKeySummary::from(record));
        } else {
            rescue_keys.push(ManagedKeySummary::from(record));
        }
    }
    (bound_keys, rescue_keys)
}

pub fn probe_capability<R: Runtime>(app: &AppHandle<R>) -> (bool, bool) {
    #[cfg(windows)]
    if windows_tpm::is_available() {
        return (true, true);
    }
    #[cfg(target_os = "android")]
    if android_keystore::is_available(app) {
        return (true, true);
    }
    let store_ok = crate::secure_store::SecretStore::new(app, SERVICE, PROBE_ACCOUNT)
        .read()
        .is_ok();
    (store_ok, false)
}

pub fn list_inventory<R: Runtime>(
    app: &AppHandle<R>,
    current_server: Option<&str>,
) -> Result<ManagedKeyInventory, String> {
    let (storage_available, hardware_backed) = probe_capability(app);
    let records = read_records(app).unwrap_or_default();
    let current_hash = current_server.map(cfms_core::get_server_hash);
    let (bound_keys, rescue_keys) = partition_records_for_server(&records, current_hash.as_deref());
    Ok(ManagedKeyInventory {
        storage_available,
        hardware_backed,
        bound_keys,
        rescue_keys,
    })
}

pub fn find_record<R: Runtime>(
    app: &AppHandle<R>,
    key_id: &str,
) -> Result<Option<ManagedKeyRecord>, String> {
    Ok(read_records(app)?
        .into_iter()
        .find(|record| record.key_id == key_id))
}

pub fn verify_key_usable<R: Runtime>(
    app: &AppHandle<R>,
    record: &ManagedKeyRecord,
) -> Result<(), String> {
    match record.backend {
        ManagedKeyBackend::HardwareTpm => {
            #[cfg(windows)]
            {
                windows_tpm::verify_exists(&record.key_id)
            }
            #[cfg(not(windows))]
            {
                Err(crate::secure_store::UNAVAILABLE.into())
            }
        }
        ManagedKeyBackend::HardwareAndroidKeystore => {
            #[cfg(target_os = "android")]
            {
                if android_keystore::is_available(app) {
                    Ok(())
                } else {
                    Err(crate::secure_store::UNAVAILABLE.into())
                }
            }
            #[cfg(not(target_os = "android"))]
            {
                Err(crate::secure_store::UNAVAILABLE.into())
            }
        }
        ManagedKeyBackend::OsSecureStore => {
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
    }
}

pub fn generate_keypair<R: Runtime>(app: &AppHandle<R>) -> Result<GeneratedManagedKey, String> {
    let key_id = crate::public_key_auth::random_id();

    #[cfg(windows)]
    if let Ok((public_key, fingerprint)) = windows_tpm::generate_p256(&key_id) {
        return Ok(GeneratedManagedKey {
            key_id,
            backend: ManagedKeyBackend::HardwareTpm,
            hardware_backed: true,
            algorithm: "ecdsa-sha2-nistp256".into(),
            public_key,
            fingerprint,
        });
    }

    #[cfg(target_os = "android")]
    if let Ok((public_key, fingerprint, hardware_backed)) =
        android_keystore::generate_p256(app, &key_id)
    {
        return Ok(GeneratedManagedKey {
            key_id,
            backend: ManagedKeyBackend::HardwareAndroidKeystore,
            hardware_backed,
            algorithm: "ecdsa-sha2-nistp256".into(),
            public_key,
            fingerprint,
        });
    }

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

pub fn delete_secret_material<R: Runtime>(
    app: &AppHandle<R>,
    key_id: &str,
    backend: ManagedKeyBackend,
) -> Result<(), String> {
    match backend {
        ManagedKeyBackend::HardwareTpm => {
            #[cfg(windows)]
            {
                windows_tpm::delete_key(key_id)
            }
            #[cfg(not(windows))]
            {
                let _ = key_id;
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
        ManagedKeyBackend::OsSecureStore => {
            crate::secure_store::SecretStore::new(app, SERVICE, key_id).delete()
        }
    }
}

pub fn save_record<R: Runtime>(app: &AppHandle<R>, record: ManagedKeyRecord) -> Result<(), String> {
    let mut records = read_records(app)?;
    records.retain(|existing| existing.key_id != record.key_id);
    records.push(record);
    write_records(app, &records)
}

pub fn sign_challenge<R: Runtime>(
    app: &AppHandle<R>,
    key_id: &str,
    backend: ManagedKeyBackend,
    challenge: &[u8],
) -> Result<String, String> {
    match backend {
        ManagedKeyBackend::HardwareTpm => {
            #[cfg(windows)]
            {
                windows_tpm::sign_p256(key_id, challenge)
            }
            #[cfg(not(windows))]
            {
                let _ = (key_id, challenge);
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
        ManagedKeyBackend::OsSecureStore => {
            let raw: Zeroizing<String> =
                crate::secure_store::SecretStore::new(app, SERVICE, key_id)
                    .read()?
                    .ok_or("publicKey.storageInvalidated")?;
            let key = cfms_service::public_key_auth::parse(raw.as_bytes())?;
            cfms_service::public_key_auth::sign(&key, challenge)
        }
    }
}

pub fn rebind_records_in(
    app_data_dir: &Path,
    key_ids: &[String],
    new_server_address: &str,
    user_id: Option<&str>,
    username: &str,
) -> Result<bool, String> {
    if key_ids.is_empty() {
        return Ok(false);
    }
    let mut records = read_records_in(app_data_dir)?;
    let new_hash = cfms_core::get_server_hash(new_server_address);
    let new_display = display_server_address(new_server_address);
    let mut changed = false;
    for record in &mut records {
        if key_ids.iter().any(|id| id == &record.key_id) {
            record.server_hash = new_hash.clone();
            record.server_address = new_display.clone();
            if !username.trim().is_empty() {
                record.username = username.trim().to_string();
            }
            if let Some(uid) = user_id.filter(|u| !u.is_empty()) {
                record.user_id = uid.to_string();
            }
            changed = true;
        }
    }
    if changed {
        write_records_in(app_data_dir, &records)?;
    }
    Ok(changed)
}

pub fn rebind_keys_to_server<R: Runtime>(
    app: &AppHandle<R>,
    key_ids: &[String],
    new_server_address: &str,
    user_id: Option<&str>,
    username: &str,
) -> Result<bool, String> {
    let path = index_path(app)?;
    rebind_records_in(
        path.parent().unwrap(),
        key_ids,
        new_server_address,
        user_id,
        username,
    )
}

pub fn update_label_by_credential_id_in(
    app_data_dir: &Path,
    server_hash: &str,
    credential_id: &str,
    label: Option<String>,
) -> Result<bool, String> {
    let _ = server_hash;
    let mut records = read_records_in(app_data_dir)?;
    let mut changed = false;
    for record in &mut records {
        if record.credential_id.as_deref() == Some(credential_id) {
            record.label = label.clone();
            changed = true;
        }
    }
    if changed {
        write_records_in(app_data_dir, &records)?;
    }
    Ok(changed)
}

pub fn update_label_by_credential_id<R: Runtime>(
    app: &AppHandle<R>,
    server_hash: &str,
    credential_id: &str,
    label: Option<String>,
) -> Result<bool, String> {
    let path = index_path(app)?;
    update_label_by_credential_id_in(path.parent().unwrap(), server_hash, credential_id, label)
}

pub fn delete_by_credential_id<R: Runtime>(
    app: &AppHandle<R>,
    server_hash: &str,
    credential_id: &str,
) -> Result<bool, String> {
    let _ = server_hash;
    let mut records = read_records(app)?;
    let mut removed = Vec::new();
    records.retain(|record| {
        let matches = record.credential_id.as_deref() == Some(credential_id);
        if matches {
            removed.push(record.clone());
        }
        !matches
    });
    if removed.is_empty() {
        return Ok(false);
    }
    for record in &removed {
        let _ = delete_secret_material(app, &record.key_id, record.backend);
    }
    write_records(app, &records)?;
    Ok(true)
}

pub fn clear<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let records = read_records(app)?;
    for record in records {
        delete_secret_material(app, &record.key_id, record.backend)?;
    }
    let path = index_path(app)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|_| crate::secure_store::UNAVAILABLE)?;
    }
    Ok(())
}

#[cfg(target_os = "android")]
mod android_keystore {
    use base64ct::{Base64, Encoding};
    use serde::Deserialize;
    use tauri::{AppHandle, Manager, Runtime};

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SupportResponse {
        available: bool,
        hardware_backed: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GenerateResponse {
        sec1_public_key: String,
        hardware_backed: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SignResponse {
        signature: String,
    }

    pub fn is_available<R: Runtime>(app: &AppHandle<R>) -> bool {
        app.state::<crate::AndroidGithubCredentialPlugin<R>>()
            .handle
            .run_mobile_plugin::<SupportResponse>("checkHardwareAuthSupport", serde_json::json!({}))
            .map(|res| res.available && res.hardware_backed)
            .unwrap_or(false)
    }

    pub fn generate_p256<R: Runtime>(
        app: &AppHandle<R>,
        key_id: &str,
    ) -> Result<(String, String, bool), String> {
        let res = app
            .state::<crate::AndroidGithubCredentialPlugin<R>>()
            .handle
            .run_mobile_plugin::<GenerateResponse>(
                "generateHardwareAuthKey",
                serde_json::json!({ "keyId": key_id }),
            )
            .map_err(|_| crate::secure_store::UNAVAILABLE)?;
        let sec1 = Base64::decode_vec(&res.sec1_public_key).map_err(|_| "publicKey.invalidFile")?;
        let (public_key, fingerprint) =
            match cfms_service::public_key_auth::p256_public_key_from_sec1(&sec1) {
                Ok(pair) => pair,
                Err(err) => {
                    let _ = delete_key(app, key_id);
                    return Err(err);
                }
            };
        Ok((public_key, fingerprint, res.hardware_backed))
    }

    pub fn sign_p256<R: Runtime>(
        app: &AppHandle<R>,
        key_id: &str,
        challenge: &[u8],
    ) -> Result<String, String> {
        let challenge_b64 = Base64::encode_string(challenge);
        let res = app
            .state::<crate::AndroidGithubCredentialPlugin<R>>()
            .handle
            .run_mobile_plugin::<SignResponse>(
                "signHardwareAuthChallenge",
                serde_json::json!({ "keyId": key_id, "challenge": challenge_b64 }),
            )
            .map_err(|_| "publicKey.signingFailed")?;
        let der = Base64::decode_vec(&res.signature).map_err(|_| "publicKey.signingFailed")?;
        cfms_service::public_key_auth::encode_p256_der_signature(&der)
    }

    pub fn delete_key<R: Runtime>(app: &AppHandle<R>, key_id: &str) -> Result<(), String> {
        app.state::<crate::AndroidGithubCredentialPlugin<R>>()
            .handle
            .run_mobile_plugin::<()>(
                "deleteHardwareAuthKey",
                serde_json::json!({ "keyId": key_id }),
            )
            .map_err(|_| crate::secure_store::UNAVAILABLE.into())
    }
}

#[cfg(windows)]
mod windows_tpm {
    use windows_sys::Win32::Security::Cryptography::{
        BCRYPT_ECCKEY_BLOB, BCRYPT_ECCPUBLIC_BLOB, BCRYPT_ECDSA_P256_ALGORITHM,
        BCRYPT_ECDSA_PUBLIC_P256_MAGIC, MS_PLATFORM_KEY_STORAGE_PROVIDER, NCRYPT_HANDLE,
        NCRYPT_KEY_HANDLE, NCRYPT_PROV_HANDLE, NCRYPT_SILENT_FLAG, NCryptCreatePersistedKey,
        NCryptDeleteKey, NCryptExportKey, NCryptFinalizeKey, NCryptFreeObject, NCryptOpenKey,
        NCryptOpenStorageProvider, NCryptSignHash,
    };

    struct HandleGuard(NCRYPT_HANDLE);
    impl Drop for HandleGuard {
        fn drop(&mut self) {
            if self.0 != 0 {
                unsafe {
                    let _ = NCryptFreeObject(self.0);
                }
            }
        }
    }

    fn wide_key_name(key_id: &str) -> Vec<u16> {
        format!("cfms_auth_key_{key_id}\0").encode_utf16().collect()
    }

    fn open_tpm_provider() -> Result<HandleGuard, String> {
        let mut provider: NCRYPT_PROV_HANDLE = 0;
        let status = unsafe {
            NCryptOpenStorageProvider(&mut provider, MS_PLATFORM_KEY_STORAGE_PROVIDER, 0)
        };
        if status != 0 || provider == 0 {
            return Err(crate::secure_store::UNAVAILABLE.into());
        }
        Ok(HandleGuard(provider))
    }

    pub fn is_available() -> bool {
        open_tpm_provider().is_ok()
    }

    pub fn verify_exists(key_id: &str) -> Result<(), String> {
        let provider = open_tpm_provider()?;
        let name = wide_key_name(key_id);
        let mut key: NCRYPT_KEY_HANDLE = 0;
        let status =
            unsafe { NCryptOpenKey(provider.0, &mut key, name.as_ptr(), 0, NCRYPT_SILENT_FLAG) };
        if status != 0 || key == 0 {
            return Err("publicKey.storageInvalidated".into());
        }
        let _guard = HandleGuard(key);
        Ok(())
    }

    pub fn generate_p256(key_id: &str) -> Result<(String, String), String> {
        let provider = open_tpm_provider()?;
        let name = wide_key_name(key_id);
        let mut key: NCRYPT_KEY_HANDLE = 0;
        let status = unsafe {
            NCryptCreatePersistedKey(
                provider.0,
                &mut key,
                BCRYPT_ECDSA_P256_ALGORITHM,
                name.as_ptr(),
                0,
                0,
            )
        };
        if status != 0 || key == 0 {
            return Err(crate::secure_store::UNAVAILABLE.into());
        }
        let mut key_guard = HandleGuard(key);
        let finalize_status = unsafe { NCryptFinalizeKey(key_guard.0, NCRYPT_SILENT_FLAG) };
        if finalize_status != 0 {
            return Err(crate::secure_store::UNAVAILABLE.into());
        }

        let mut blob_len: u32 = 0;
        let size_status = unsafe {
            NCryptExportKey(
                key_guard.0,
                0,
                BCRYPT_ECCPUBLIC_BLOB,
                std::ptr::null(),
                std::ptr::null_mut(),
                0,
                &mut blob_len,
                NCRYPT_SILENT_FLAG,
            )
        };
        let header_size = std::mem::size_of::<BCRYPT_ECCKEY_BLOB>();
        if size_status != 0 || (blob_len as usize) < header_size + 64 {
            unsafe {
                if NCryptDeleteKey(key_guard.0, NCRYPT_SILENT_FLAG) == 0 {
                    key_guard.0 = 0;
                }
            }
            return Err(crate::secure_store::UNAVAILABLE.into());
        }
        let mut blob = vec![0u8; blob_len as usize];
        let export_status = unsafe {
            NCryptExportKey(
                key_guard.0,
                0,
                BCRYPT_ECCPUBLIC_BLOB,
                std::ptr::null(),
                blob.as_mut_ptr(),
                blob_len,
                &mut blob_len,
                NCRYPT_SILENT_FLAG,
            )
        };
        if export_status != 0 {
            unsafe {
                if NCryptDeleteKey(key_guard.0, NCRYPT_SILENT_FLAG) == 0 {
                    key_guard.0 = 0;
                }
            }
            return Err(crate::secure_store::UNAVAILABLE.into());
        }
        let header = unsafe { &*(blob.as_ptr() as *const BCRYPT_ECCKEY_BLOB) };
        if header.dwMagic != BCRYPT_ECDSA_PUBLIC_P256_MAGIC || header.cbKey != 32 {
            unsafe {
                if NCryptDeleteKey(key_guard.0, NCRYPT_SILENT_FLAG) == 0 {
                    key_guard.0 = 0;
                }
            }
            return Err(crate::secure_store::UNAVAILABLE.into());
        }
        let mut sec1 = [0u8; 65];
        sec1[0] = 0x04;
        sec1[1..65].copy_from_slice(&blob[header_size..header_size + 64]);
        match cfms_service::public_key_auth::p256_public_key_from_sec1(&sec1) {
            Ok(pair) => Ok(pair),
            Err(err) => {
                unsafe {
                    if NCryptDeleteKey(key_guard.0, NCRYPT_SILENT_FLAG) == 0 {
                        key_guard.0 = 0;
                    }
                }
                Err(err)
            }
        }
    }

    pub fn sign_p256(key_id: &str, challenge: &[u8]) -> Result<String, String> {
        let provider = open_tpm_provider()?;
        let name = wide_key_name(key_id);
        let mut key: NCRYPT_KEY_HANDLE = 0;
        let status =
            unsafe { NCryptOpenKey(provider.0, &mut key, name.as_ptr(), 0, NCRYPT_SILENT_FLAG) };
        if status != 0 || key == 0 {
            return Err("publicKey.storageInvalidated".into());
        }
        let key_guard = HandleGuard(key);
        let digest = cfms_service::public_key_auth::sha256_digest(challenge);
        let mut sig = [0u8; 64];
        let mut written: u32 = 0;
        let sign_status = unsafe {
            NCryptSignHash(
                key_guard.0,
                std::ptr::null(),
                digest.as_ptr(),
                digest.len() as u32,
                sig.as_mut_ptr(),
                sig.len() as u32,
                &mut written,
                NCRYPT_SILENT_FLAG,
            )
        };
        if sign_status != 0 || written != 64 {
            return Err("publicKey.signingFailed".into());
        }
        cfms_service::public_key_auth::encode_p256_raw_signature(&sig)
    }

    pub fn delete_key(key_id: &str) -> Result<(), String> {
        let Ok(provider) = open_tpm_provider() else {
            return Ok(());
        };
        let name = wide_key_name(key_id);
        let mut key: NCRYPT_KEY_HANDLE = 0;
        let status =
            unsafe { NCryptOpenKey(provider.0, &mut key, name.as_ptr(), 0, NCRYPT_SILENT_FLAG) };
        if status != 0 || key == 0 {
            return Ok(());
        }
        let mut key_guard = HandleGuard(key);
        let delete_status = unsafe { NCryptDeleteKey(key_guard.0, NCRYPT_SILENT_FLAG) };
        if delete_status == 0 {
            // NCryptDeleteKey frees the key handle upon success.
            key_guard.0 = 0;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            username: username.into(),
            credential_id: Some(format!("cred-{key_id}")),
            created_at: 1_700_000_000,
        }
    }

    #[test]
    fn partitions_bound_and_rescue_keys_by_server_hash_and_rebinds_on_rescue_success() {
        let dir = tempfile::tempdir().unwrap();
        let records = vec![
            sample_record("k1", "wss://alpha.example.com:443", "alice"),
            sample_record("k2", "wss://beta.example.com:5104", "bob"),
        ];
        write_records_in(dir.path(), &records).unwrap();

        let loaded = read_records_in(dir.path()).unwrap();
        let alpha_hash = cfms_core::get_server_hash("wss://alpha.example.com:443");
        let (bound, rescue) = partition_records_for_server(&loaded, Some(&alpha_hash));
        assert_eq!(bound.len(), 1);
        assert_eq!(bound[0].key_id, "k1");
        assert_eq!(rescue.len(), 1);
        assert_eq!(rescue[0].key_id, "k2");
        assert_eq!(rescue[0].server_address, "beta.example.com:5104");

        // Simulate rescue login with k2 on alpha.example.com:443
        let rebound = rebind_records_in(
            dir.path(),
            &["k2".to_string()],
            "wss://alpha.example.com:443",
            Some("uid-alice-new"),
            "alice",
        )
        .unwrap();
        assert!(rebound);

        let after = read_records_in(dir.path()).unwrap();
        let (bound_after, rescue_after) = partition_records_for_server(&after, Some(&alpha_hash));
        assert_eq!(bound_after.len(), 2);
        assert!(rescue_after.is_empty());
    }

    #[test]
    fn updates_label_by_server_and_credential_id() {
        let dir = tempfile::tempdir().unwrap();
        let records = vec![sample_record("k1", "wss://alpha.example.com:443", "alice")];
        write_records_in(dir.path(), &records).unwrap();
        let alpha_hash = cfms_core::get_server_hash("wss://alpha.example.com:443");
        assert!(
            update_label_by_credential_id_in(
                dir.path(),
                &alpha_hash,
                "cred-k1",
                Some("Renamed Key".into()),
            )
            .unwrap()
        );
        let updated = read_records_in(dir.path()).unwrap();
        assert_eq!(updated[0].label.as_deref(), Some("Renamed Key"));
    }
}
