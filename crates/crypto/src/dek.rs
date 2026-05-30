//! Data Encryption Key (DEK) lifecycle.
//!
//! Implements the two-layer key architecture:
//!
//! ```text
//! password ──PBKDF2──▶ KEK ──AES-GCM──▶ DEK (encrypted, stored on server)
//!                                         │
//!                                         ▼
//!                              config files (encrypted at rest)
//! ```
//!
//! The DEK is a random 256-bit key.  It is encrypted with a KEK derived from
//! the user's password and the resulting JSON blob is safe to store on the
//! server as `key_content`.  After login, the DEK is decrypted and used to
//! protect local configuration files without re-deriving the KEK.

use base64ct::{Base64, Encoding};
use cfms_core::Result;
use cfms_core::constants::{KDF_ITERATIONS, KEY_LEN, NONCE_LEN, SALT_LEN};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::aead;
use crate::kdf;

// ---------------------------------------------------------------------------
// JSON payload shape
// ---------------------------------------------------------------------------

/// The JSON envelope produced by [`encrypt_dek`] and consumed by [`decrypt_dek`].
#[derive(Debug, Serialize, Deserialize)]
struct DekPayload {
    /// Version of the envelope format (currently `1`).
    v: u8,
    /// Key derivation function identifier.
    kdf: String,
    /// PBKDF2 iteration count.
    iter: u32,
    /// Base64-encoded salt (16 bytes).
    salt: String,
    /// Base64-encoded GCM nonce (12 bytes).
    nonce: String,
    /// Base64-encoded GCM authentication tag (16 bytes).
    tag: String,
    /// Base64-encoded ciphertext (32 bytes — the DEK).
    ct: String,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Generate a new random 256-bit Data Encryption Key.
///
/// The returned key is wrapped in [`Zeroizing`] so its memory is scrubbed
/// automatically when the value goes out of scope.
pub fn generate_dek() -> Zeroizing<[u8; KEY_LEN]> {
    let mut dek = Zeroizing::new([0u8; KEY_LEN]);
    rand::rngs::OsRng.fill_bytes(&mut *dek);
    dek
}

/// Encrypt a DEK with a KEK derived from `password`.
///
/// Returns a compact JSON string suitable for storage as the server-side
/// `key_content` field.  The JSON contains every parameter needed to later
/// decrypt the DEK (KDF, salt, nonce, tag, ciphertext).
pub fn encrypt_dek(dek: &[u8; KEY_LEN], password: &str) -> Result<String> {
    let salt = kdf::generate_salt();
    let kek = kdf::derive_kek(password.as_bytes(), &salt);
    let nonce = aead::generate_nonce();

    let (ct, tag) = aead::seal(&kek, &nonce, dek)?;

    let payload = DekPayload {
        v: 1,
        kdf: "pbkdf2_hmac_sha256".into(),
        iter: KDF_ITERATIONS,
        salt: Base64::encode_string(&salt),
        nonce: Base64::encode_string(&nonce),
        tag: Base64::encode_string(&tag),
        ct: Base64::encode_string(&ct),
    };

    serde_json::to_string(&payload).map_err(|e| cfms_core::Error::Crypto(e.to_string()))
}

/// Decrypt a DEK from the JSON string produced by [`encrypt_dek`].
///
/// # Errors
/// Returns [`Error::Crypto`] if the JSON is malformed, the KDF is
/// unrecognised, or authentication fails (wrong password / corrupted data).
pub fn decrypt_dek(encrypted_json: &str, password: &str) -> Result<Zeroizing<[u8; KEY_LEN]>> {
    let payload: DekPayload = serde_json::from_str(encrypted_json)
        .map_err(|e| cfms_core::Error::Crypto(e.to_string()))?;

    // --- validate envelope ---
    if payload.v != 1 {
        return Err(cfms_core::Error::Crypto(format!(
            "unsupported DEK envelope version: {}",
            payload.v
        )));
    }
    if payload.kdf != "pbkdf2_hmac_sha256" {
        return Err(cfms_core::Error::Crypto(format!(
            "unsupported KDF: {}",
            payload.kdf
        )));
    }
    if payload.iter == 0 {
        return Err(cfms_core::Error::Crypto(
            "invalid iteration count: 0".into(),
        ));
    }

    // --- decode fields ---
    let mut salt = [0u8; SALT_LEN];
    Base64::decode(&payload.salt, &mut salt)
        .map_err(|e| cfms_core::Error::Crypto(format!("invalid salt: {e}")))?;

    let mut nonce = [0u8; NONCE_LEN];
    Base64::decode(&payload.nonce, &mut nonce)
        .map_err(|e| cfms_core::Error::Crypto(format!("invalid nonce: {e}")))?;

    let mut tag = [0u8; 16];
    Base64::decode(&payload.tag, &mut tag)
        .map_err(|e| cfms_core::Error::Crypto(format!("invalid tag: {e}")))?;

    let ct = Base64::decode_vec(&payload.ct)
        .map_err(|e| cfms_core::Error::Crypto(format!("invalid ciphertext: {e}")))?;

    // --- derive KEK and decrypt ---
    // Note: we respect the iteration count from the envelope.
    // In practice it always equals KDF_ITERATIONS, but using the envelope
    // value future-proofs the client if the server ever rotates the count.
    let kek = {
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), &salt, payload.iter, &mut *key);
        key
    };

    let plaintext = aead::open(&kek, &nonce, &ct, &tag)?;

    if plaintext.len() != KEY_LEN {
        return Err(cfms_core::Error::Crypto(format!(
            "decrypted DEK has wrong length: {} (expected {KEY_LEN})",
            plaintext.len()
        )));
    }

    let mut dek = Zeroizing::new([0u8; KEY_LEN]);
    dek.copy_from_slice(&plaintext);
    Ok(dek)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_encrypt_decrypt_dek() {
        let password = "correct-horse-battery-staple";
        let dek = generate_dek();

        let encrypted = encrypt_dek(&dek, password).unwrap();
        let decrypted = decrypt_dek(&encrypted, password).unwrap();

        assert_eq!(&*dek, &*decrypted);
    }

    #[test]
    fn wrong_password_fails() {
        let dek = generate_dek();
        let encrypted = encrypt_dek(&dek, "alice-password").unwrap();

        let result = decrypt_dek(&encrypted, "bob-password");
        assert!(result.is_err());
    }

    #[test]
    fn malformed_json_fails() {
        let result = decrypt_dek("not-valid-json", "password");
        assert!(result.is_err());
    }

    #[test]
    fn wrong_envelope_version_fails() {
        // Manually construct a payload with an unsupported version
        let payload = serde_json::json!({
            "v": 99,
            "kdf": "pbkdf2_hmac_sha256",
            "iter": KDF_ITERATIONS,
            "salt": "AAAA",
            "nonce": "AAAA",
            "tag": "AAAA",
            "ct": "AAAA"
        });
        let result = decrypt_dek(&payload.to_string(), "password");
        assert!(result.is_err());
    }

    #[test]
    fn each_generate_dek_is_unique() {
        let d1 = generate_dek();
        let d2 = generate_dek();
        assert_ne!(&*d1, &*d2);
    }
}
