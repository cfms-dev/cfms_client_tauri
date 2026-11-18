//! Windows CNG Platform Key Storage Provider (TPM 2.0) backend for non-exportable P-256 keys.
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

/// Deletes an unconfirmed persisted TPM key on drop unless `commit()` is called.
struct PendingTpmKey(HandleGuard);

impl PendingTpmKey {
    fn handle(&self) -> NCRYPT_KEY_HANDLE {
        self.0.0
    }

    fn commit(mut self) {
        // Release without deleting the persisted key; HandleGuard still frees the handle.
        let handle = self.0.0;
        self.0.0 = 0;
        drop(HandleGuard(handle));
    }
}

impl Drop for PendingTpmKey {
    fn drop(&mut self) {
        if self.0.0 != 0 {
            unsafe {
                if NCryptDeleteKey(self.0.0, NCRYPT_SILENT_FLAG) == 0 {
                    // NCryptDeleteKey frees the key handle upon success.
                    self.0.0 = 0;
                }
            }
        }
    }
}

fn wide_key_name(key_id: &str) -> Vec<u16> {
    format!("cfms_auth_key_{key_id}\0").encode_utf16().collect()
}

fn open_tpm_provider() -> Result<HandleGuard, String> {
    let mut provider: NCRYPT_PROV_HANDLE = 0;
    let status =
        unsafe { NCryptOpenStorageProvider(&mut provider, MS_PLATFORM_KEY_STORAGE_PROVIDER, 0) };
    if status != 0 || provider == 0 {
        return Err(crate::secure_store::UNAVAILABLE.into());
    }
    Ok(HandleGuard(provider))
}

fn open_persisted_key(provider: NCRYPT_PROV_HANDLE, key_id: &str) -> Result<HandleGuard, String> {
    let name = wide_key_name(key_id);
    let mut key: NCRYPT_KEY_HANDLE = 0;
    let status = unsafe { NCryptOpenKey(provider, &mut key, name.as_ptr(), 0, NCRYPT_SILENT_FLAG) };
    if status != 0 || key == 0 {
        return Err("publicKey.storageInvalidated".into());
    }
    Ok(HandleGuard(key))
}

pub fn is_available() -> bool {
    open_tpm_provider().is_ok()
}

pub fn verify_exists(key_id: &str) -> Result<(), String> {
    let provider = open_tpm_provider()?;
    let _key = open_persisted_key(provider.0, key_id)?;
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
            NCRYPT_SILENT_FLAG,
        )
    };
    if status != 0 || key == 0 {
        return Err(crate::secure_store::UNAVAILABLE.into());
    }
    let pending = PendingTpmKey(HandleGuard(key));
    let finalize_status = unsafe { NCryptFinalizeKey(pending.handle(), NCRYPT_SILENT_FLAG) };
    if finalize_status != 0 {
        return Err(crate::secure_store::UNAVAILABLE.into());
    }

    let sec1 = export_sec1_public_point(pending.handle())?;
    let pair = cfms_service::public_key_auth::p256_public_key_from_sec1(&sec1)?;
    pending.commit();
    Ok(pair)
}

fn export_sec1_public_point(key: NCRYPT_KEY_HANDLE) -> Result<[u8; 65], String> {
    let mut blob_len: u32 = 0;
    let size_status = unsafe {
        NCryptExportKey(
            key,
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
        return Err(crate::secure_store::UNAVAILABLE.into());
    }
    let mut blob = vec![0u8; blob_len as usize];
    let mut exported_len: u32 = 0;
    let export_status = unsafe {
        NCryptExportKey(
            key,
            0,
            BCRYPT_ECCPUBLIC_BLOB,
            std::ptr::null(),
            blob.as_mut_ptr(),
            blob_len,
            &mut exported_len,
            NCRYPT_SILENT_FLAG,
        )
    };
    if export_status != 0
        || (exported_len as usize) < header_size + 64
        || blob.len() < header_size + 64
    {
        return Err(crate::secure_store::UNAVAILABLE.into());
    }
    let header = unsafe { std::ptr::read_unaligned(blob.as_ptr() as *const BCRYPT_ECCKEY_BLOB) };
    if header.dwMagic != BCRYPT_ECDSA_PUBLIC_P256_MAGIC || header.cbKey != 32 {
        return Err(crate::secure_store::UNAVAILABLE.into());
    }
    let mut sec1 = [0u8; 65];
    sec1[0] = 0x04;
    sec1[1..65].copy_from_slice(&blob[header_size..header_size + 64]);
    Ok(sec1)
}

pub fn sign_p256(key_id: &str, challenge: &[u8]) -> Result<String, String> {
    let provider = open_tpm_provider()?;
    let key = open_persisted_key(provider.0, key_id)?;
    let digest = cfms_service::public_key_auth::sha256_digest(challenge);
    let mut sig = [0u8; 64];
    let mut written: u32 = 0;
    let sign_status = unsafe {
        NCryptSignHash(
            key.0,
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
    let Ok(mut key) = open_persisted_key(provider.0, key_id) else {
        return Ok(());
    };
    let delete_status = unsafe { NCryptDeleteKey(key.0, NCRYPT_SILENT_FLAG) };
    if delete_status == 0 {
        // NCryptDeleteKey frees the key handle upon success.
        key.0 = 0;
        Ok(())
    } else {
        Err(crate::secure_store::UNAVAILABLE.into())
    }
}
