//! File transfer integration tests.
//!
//! Tests the chunk storage, decryption, and verification pipeline
//! without requiring a live server connection.

use cfms_crypto::{aead_seal, generate_dek};
use cfms_transfer::*;

/// Simulates a full download → decrypt → verify cycle for a small file.
#[test]
fn simulated_download_cycle() {
    let file_data = b"CFMS test file content for integration testing".to_vec();
    let file_size = file_data.len() as u64;

    // Generate a random AES key (simulates the server delivery).
    let aes_key = generate_dek();

    // Split the file into 3 chunks.
    let chunk_size = 16usize;
    let chunks: Vec<&[u8]> = file_data.chunks(chunk_size).collect();
    let _total_chunks = chunks.len() as u32;

    // --- Phase 1: encrypt and store chunks (simulates server → client) ---
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("chunks.db");
    let store = chunks::ChunkStore::open(&db_path).unwrap();

    for (i, plaintext) in chunks.iter().enumerate() {
        let prefix = [i as u8; 8]; // deterministic prefix for testing

        // Build the 12-byte nonce: prefix || idx_be
        let mut nonce = [0u8; 12];
        nonce[..8].copy_from_slice(&prefix);
        nonce[8..].copy_from_slice(&(i as u32).to_be_bytes());

        let (ct, tag) = aead_seal(&aes_key, &nonce, plaintext).unwrap();

        store.insert(i as u32, &prefix, &tag, &ct).unwrap();
    }

    store.commit().unwrap();

    // --- Phase 2: retrieve and decrypt (simulates post-key-delivery) ---
    let stored_chunks = store.ordered_chunks().unwrap();
    assert_eq!(stored_chunks.len(), chunks.len());

    let mut decrypted = Vec::new();
    for row in &stored_chunks {
        let plain =
            decrypt::decrypt_chunk(&aes_key, &row.prefix, row.idx, &row.data, &row.tag).unwrap();
        decrypted.extend_from_slice(&plain);
    }

    assert_eq!(decrypted, file_data);

    // --- Phase 3: verify ---
    // Write decrypted data to a temporary file for verification.
    let out_path = temp_dir.path().join("output.bin");
    std::fs::write(&out_path, &decrypted).unwrap();

    verify::size_matches(&out_path, file_size).unwrap();

    let hash = verify::compute_sha256(&out_path).unwrap();
    verify::sha256_matches(&out_path, &hash).unwrap();

    // --- Cleanup ---
    store.purge().unwrap();
}

#[test]
fn chunk_store_empty() {
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("empty.db");
    let store = chunks::ChunkStore::open(&db_path).unwrap();

    let chunks = store.ordered_chunks().unwrap();
    assert!(chunks.is_empty());

    store.purge().unwrap();
}

#[test]
fn decrypt_chunk_wrong_prefix_fails() {
    // If we decrypt with a different prefix than what was used during
    // encryption, the authentication tag should fail.
    let key = generate_dek();
    let plaintext = b"sensitive chunk data";

    let prefix_enc = [0x01u8; 8];
    let mut nonce = [0u8; 12];
    nonce[..8].copy_from_slice(&prefix_enc);
    nonce[8..].copy_from_slice(&0u32.to_be_bytes());

    let (ct, tag) = aead_seal(&key, &nonce, plaintext).unwrap();

    // Try decrypting with a different prefix.
    let wrong_prefix = [0x02u8; 8];
    let result = decrypt::decrypt_chunk(&key, &wrong_prefix, 0, &ct, &tag);
    assert!(result.is_err());
}

#[test]
fn size_mismatch_detected() {
    let temp_dir = tempfile::tempdir().unwrap();
    let path = temp_dir.path().join("test.bin");
    std::fs::write(&path, b"12345").unwrap();

    assert!(verify::size_matches(&path, 5).is_ok());
    assert!(verify::size_matches(&path, 100).is_err());
}
