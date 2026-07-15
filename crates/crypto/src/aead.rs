//! AES-256-GCM authenticated encryption primitives.
//!
//! Thin wrappers around the [`aes_gcm`] crate that enforce our exact key /
//! nonce / tag sizes at the type level and convert errors into
//! [`cfms_core::Error`].

use aes_gcm::Aes256Gcm;
use aes_gcm::aead::array::Array;
use aes_gcm::aead::{AeadInOut, KeyInit};
use cfms_core::Result;
use cfms_core::constants::{KEY_LEN, NONCE_LEN, TAG_LEN};
use rand::Rng;

/// Encrypt `plaintext` with AES-256-GCM.
///
/// # Returns
/// `(ciphertext, authentication_tag)` — the ciphertext is the same length as
/// the plaintext and the tag is always [`TAG_LEN`] (16) bytes.
pub fn seal(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    plaintext: &[u8],
) -> Result<(Vec<u8>, [u8; TAG_LEN])> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| cfms_core::Error::Crypto(e.to_string()))?;

    let nonce = Array(*nonce);

    let mut buffer = plaintext.to_vec();
    let tag = cipher
        .encrypt_inout_detached(&nonce, b"", buffer.as_mut_slice().into())
        .map_err(|e| cfms_core::Error::Crypto(e.to_string()))?;

    let mut tag_arr = [0u8; TAG_LEN];
    tag_arr.copy_from_slice(&tag);
    Ok((buffer, tag_arr))
}

/// Decrypt `ciphertext` with AES-256-GCM, verifying `tag`.
///
/// # Returns
/// The plaintext on success, or [`Error::Crypto`] if authentication fails
/// (wrong key, corrupted data, or tampered ciphertext).
pub fn open(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    ciphertext: &[u8],
    tag: &[u8; TAG_LEN],
) -> Result<Vec<u8>> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| cfms_core::Error::Crypto(e.to_string()))?;

    let nonce = Array(*nonce);
    let tag = Array(*tag);

    let mut buffer = ciphertext.to_vec();
    cipher
        .decrypt_inout_detached(&nonce, b"", buffer.as_mut_slice().into(), &tag)
        .map_err(|_| {
            cfms_core::Error::Crypto("authentication failed — wrong key or corrupted data".into())
        })?;
    Ok(buffer)
}

/// Generate a random 96-bit nonce suitable for AES-256-GCM.
pub fn generate_nonce() -> [u8; NONCE_LEN] {
    let mut nonce = [0u8; NONCE_LEN];
    rand::rng().fill_bytes(&mut nonce);
    nonce
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_short_plaintext() {
        let key = [0xAAu8; KEY_LEN];
        let nonce = generate_nonce();
        let plaintext = b"Hello, CFMS!";

        let (ct, tag) = seal(&key, &nonce, plaintext).unwrap();
        let decrypted = open(&key, &nonce, &ct, &tag).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn roundtrip_large_payload() {
        let key = [0xBBu8; KEY_LEN];
        let nonce = generate_nonce();
        let plaintext = vec![0x42u8; 10_000];

        let (ct, tag) = seal(&key, &nonce, &plaintext).unwrap();
        let decrypted = open(&key, &nonce, &ct, &tag).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn wrong_key_returns_error() {
        let key1 = [0x11u8; KEY_LEN];
        let key2 = [0x22u8; KEY_LEN];
        let nonce = generate_nonce();
        let plaintext = b"top secret";

        let (ct, tag) = seal(&key1, &nonce, plaintext).unwrap();
        let result = open(&key2, &nonce, &ct, &tag);
        assert!(result.is_err());
    }

    #[test]
    fn different_keys_produce_different_ciphertexts() {
        let key1 = [0x33u8; KEY_LEN];
        let key2 = [0x44u8; KEY_LEN];
        let nonce = generate_nonce();
        let plaintext = b"test";

        let (ct1, _) = seal(&key1, &nonce, plaintext).unwrap();
        let (ct2, _) = seal(&key2, &nonce, plaintext).unwrap();
        assert_ne!(ct1, ct2);
    }

    #[test]
    fn corrupted_ciphertext_returns_error() {
        let key = [0x44u8; KEY_LEN];
        let nonce = generate_nonce();
        let plaintext = b"integrity check";

        let (mut ct, tag) = seal(&key, &nonce, plaintext).unwrap();
        // Flip a bit
        ct[0] ^= 0x01;
        let result = open(&key, &nonce, &ct, &tag);
        assert!(result.is_err());
    }

    #[test]
    fn empty_plaintext_roundtrip() {
        let key = [0x55u8; KEY_LEN];
        let nonce = generate_nonce();

        let (ct, tag) = seal(&key, &nonce, b"").unwrap();
        assert!(ct.is_empty());

        let decrypted = open(&key, &nonce, &ct, &tag).unwrap();
        assert!(decrypted.is_empty());
    }
}
