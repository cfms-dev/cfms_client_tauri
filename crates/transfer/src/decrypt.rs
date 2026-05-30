//! Streaming decryption of individual file chunks.
//!
//! Each chunk is encrypted with AES-256-GCM.  The nonce is constructed as:
//!
//! ```text
//! nonce = prefix (8 bytes) || chunk_index (4 bytes BE) = 12 bytes (96-bit)
//! ```
//!
//! This scheme ensures that each chunk uses a unique nonce even though the
//! same AES key is used for the entire file.

use cfms_core::Result;
use cfms_core::constants::{KEY_LEN, NONCE_LEN};
use cfms_crypto::aead_open;

/// Decrypt a single file chunk.
///
/// # Arguments
/// - `key` — 256-bit AES key received from the server after all chunks arrive.
/// - `prefix` — 8-byte nonce prefix sent alongside the chunk.
/// - `idx` — zero-based chunk index (used as the last 4 bytes of the nonce).
/// - `ciphertext` — encrypted chunk payload.
/// - `tag` — 16-byte GCM authentication tag for this chunk.
///
/// # Nonce construction
/// The 12-byte GCM nonce is `prefix (8 bytes) || idx.to_be_bytes() (4 bytes)`.
pub fn decrypt_chunk(
    key: &[u8; KEY_LEN],
    prefix: &[u8; 8],
    idx: u32,
    ciphertext: &[u8],
    tag: &[u8; 16],
) -> Result<Vec<u8>> {
    let mut nonce = [0u8; NONCE_LEN];
    nonce[..8].copy_from_slice(prefix);
    nonce[8..].copy_from_slice(&idx.to_be_bytes());

    aead_open(key, &nonce, ciphertext, tag)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cfms_crypto::aead_seal;

    #[test]
    fn roundtrip_single_chunk() {
        let key = [0x77u8; KEY_LEN];
        let prefix = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
        let idx = 42u32;
        let plaintext = b"This is chunk 42";

        // Manually construct the nonce to encrypt.
        let mut nonce = [0u8; NONCE_LEN];
        nonce[..8].copy_from_slice(&prefix);
        nonce[8..].copy_from_slice(&idx.to_be_bytes());

        let (ct, tag) = aead_seal(&key, &nonce, plaintext).unwrap();

        // Decrypt via our function.
        let decrypted = decrypt_chunk(&key, &prefix, idx, &ct, &tag).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn different_indices_produce_different_ciphertexts() {
        let key = [0x88u8; KEY_LEN];
        let prefix = [0xAAu8; 8];
        let plaintext = b"same data";

        let mut nonce0 = [0u8; NONCE_LEN];
        nonce0[..8].copy_from_slice(&prefix);
        nonce0[8..].copy_from_slice(&0u32.to_be_bytes());

        let mut nonce1 = [0u8; NONCE_LEN];
        nonce1[..8].copy_from_slice(&prefix);
        nonce1[8..].copy_from_slice(&1u32.to_be_bytes());

        let (ct0, _) = aead_seal(&key, &nonce0, plaintext).unwrap();
        let (ct1, _) = aead_seal(&key, &nonce1, plaintext).unwrap();

        assert_ne!(ct0, ct1);
    }

    #[test]
    fn wrong_tag_fails() {
        let key = [0x99u8; KEY_LEN];
        let prefix = [0xBBu8; 8];
        let idx = 0;
        let wrong_tag = [0x00u8; 16];

        let result = decrypt_chunk(&key, &prefix, idx, b"data", &wrong_tag);
        assert!(result.is_err());
    }
}
