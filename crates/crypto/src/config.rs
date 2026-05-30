//! Local configuration file encryption.
//!
//! Provides at-rest protection for configuration files (preferences, download
//! task lists, etc.) using the DEK.  The binary format is:
//!
//! ```text
//! magic (4) | nonce (12) | tag (16) | ciphertext (variable)
//! ```
//!
//! The magic bytes ([`ENCRYPTED_MAGIC`]) serve as both a file-format
//! identifier and a quick check so callers can distinguish plaintext
//! (legacy) files from encrypted ones.

use cfms_core::Result;
use cfms_core::constants::{ENCRYPTED_MAGIC, KEY_LEN, NONCE_LEN, TAG_LEN};

use crate::aead;

/// Encrypt `plaintext` with the given DEK.
///
/// A fresh random nonce is generated on every call so the same plaintext
/// produces different ciphertexts across writes.
pub fn encrypt_config(plaintext: &[u8], dek: &[u8; KEY_LEN]) -> Result<Vec<u8>> {
    let nonce = aead::generate_nonce();

    let (ct, tag) = aead::seal(dek, &nonce, plaintext)?;

    let mut output = Vec::with_capacity(ENCRYPTED_MAGIC.len() + NONCE_LEN + TAG_LEN + ct.len());
    output.extend_from_slice(&ENCRYPTED_MAGIC);
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&tag);
    output.extend_from_slice(&ct);
    Ok(output)
}

/// Decrypt bytes previously produced by [`encrypt_config`].
///
/// # Errors
/// Returns [`Error::Crypto`] if the data does not start with the magic bytes
/// or if authentication fails (wrong key, corrupted data).
pub fn decrypt_config(encrypted: &[u8], dek: &[u8; KEY_LEN]) -> Result<Vec<u8>> {
    let magic_len = ENCRYPTED_MAGIC.len();

    if encrypted.len() < magic_len + NONCE_LEN + TAG_LEN {
        return Err(cfms_core::Error::Crypto(
            "encrypted data too short to contain header".into(),
        ));
    }

    if encrypted[..magic_len] != ENCRYPTED_MAGIC {
        return Err(cfms_core::Error::Crypto(
            "not a valid encrypted config file (magic mismatch)".into(),
        ));
    }

    let nonce: [u8; NONCE_LEN] = encrypted[magic_len..magic_len + NONCE_LEN]
        .try_into()
        .expect("bounds checked above");

    let tag_offset = magic_len + NONCE_LEN;
    let tag: [u8; TAG_LEN] = encrypted[tag_offset..tag_offset + TAG_LEN]
        .try_into()
        .expect("bounds checked above");

    let ct = &encrypted[tag_offset + TAG_LEN..];

    aead::open(dek, &nonce, ct, &tag)
}

/// Returns `true` if `data` starts with the encrypted config magic bytes.
pub fn is_encrypted(data: &[u8]) -> bool {
    data.len() >= ENCRYPTED_MAGIC.len() && data[..ENCRYPTED_MAGIC.len()] == ENCRYPTED_MAGIC
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_dek() -> [u8; KEY_LEN] {
        [0xABu8; KEY_LEN]
    }

    #[test]
    fn roundtrip_small_payload() {
        let dek = make_dek();
        let plaintext = b"{\"theme\":\"dark\"}";

        let encrypted = encrypt_config(plaintext, &dek).unwrap();
        assert!(is_encrypted(&encrypted));

        let decrypted = decrypt_config(&encrypted, &dek).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn roundtrip_large_payload() {
        let dek = make_dek();
        let plaintext = vec![0x42u8; 10_000]; // 10 KB

        let encrypted = encrypt_config(&plaintext, &dek).unwrap();
        let decrypted = decrypt_config(&encrypted, &dek).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn roundtrip_empty_payload() {
        let dek = make_dek();

        let encrypted = encrypt_config(b"", &dek).unwrap();
        let decrypted = decrypt_config(&encrypted, &dek).unwrap();
        assert!(decrypted.is_empty());
    }

    #[test]
    fn wrong_dek_fails() {
        let dek1 = [0x11u8; KEY_LEN];
        let dek2 = [0x22u8; KEY_LEN];

        let encrypted = encrypt_config(b"sensitive data", &dek1).unwrap();
        let result = decrypt_config(&encrypted, &dek2);
        assert!(result.is_err());
    }

    #[test]
    fn is_encrypted_rejects_plain_json() {
        assert!(!is_encrypted(b"{\"key\":\"value\"}"));
        assert!(!is_encrypted(b""));
        assert!(!is_encrypted(b"\xcf\xe5\xce")); // too short
    }

    #[test]
    fn is_encrypted_accepts_valid_magic() {
        let encrypted = encrypt_config(b"test", &make_dek()).unwrap();
        assert!(is_encrypted(&encrypted));
    }

    #[test]
    fn different_nonces_produce_different_ciphertexts() {
        let dek = make_dek();
        let plaintext = b"same data";

        let enc1 = encrypt_config(plaintext, &dek).unwrap();
        let enc2 = encrypt_config(plaintext, &dek).unwrap();

        // The nonce differs, so the ciphertext should differ too.
        assert_ne!(enc1, enc2);

        // Both should decrypt to the same plaintext.
        assert_eq!(decrypt_config(&enc1, &dek).unwrap(), plaintext);
        assert_eq!(decrypt_config(&enc2, &dek).unwrap(), plaintext);
    }
}
