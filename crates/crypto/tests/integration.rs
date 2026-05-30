//! End-to-end cryptographic integration tests.
//!
//! Tests the full encryption lifecycle from password → KEK → DEK →
//! config encryption, verifying that every step composes correctly.

use cfms_crypto::*;

#[test]
fn full_key_lifecycle() {
    let password = "integration-test-password";

    // 1. Derive KEK from password
    let salt = kdf::generate_salt();
    assert_eq!(salt.len(), cfms_core::constants::SALT_LEN);

    let kek = kdf::derive_kek(password.as_bytes(), &salt);
    assert_eq!(kek.len(), cfms_core::constants::KEY_LEN);

    // 2. Generate DEK
    let dek = dek::generate_dek();
    assert_eq!(dek.len(), cfms_core::constants::KEY_LEN);

    // 3. Encrypt DEK with KEK (produces server-storable JSON)
    let encrypted = dek::encrypt_dek(&dek, password).unwrap();
    assert!(encrypted.contains("pbkdf2_hmac_sha256"));
    assert!(encrypted.contains("\"v\":1"));

    // 4. Decrypt DEK from JSON
    let decrypted_dek = dek::decrypt_dek(&encrypted, password).unwrap();
    assert_eq!(&*dek, &*decrypted_dek);

    // 5. Encrypt config with DEK
    let config_data = b"{\"theme\":\"dark\",\"language\":\"en\"}";
    let encrypted_config = config::encrypt_config(config_data, &dek).unwrap();
    assert!(config::is_encrypted(&encrypted_config));

    // 6. Decrypt config with DEK
    let decrypted_config = config::decrypt_config(&encrypted_config, &dek).unwrap();
    assert_eq!(decrypted_config, config_data);
}

#[test]
fn wrong_password_cannot_decrypt_dek() {
    let password = "alice-strong-password";
    let dek = dek::generate_dek();
    let encrypted = dek::encrypt_dek(&dek, password).unwrap();

    let result = dek::decrypt_dek(&encrypted, "wrong-password");
    assert!(result.is_err());
}

#[test]
fn corrupted_config_rejected() {
    let dek = dek::generate_dek();
    let plaintext = b"sensitive preferences";

    let mut encrypted = config::encrypt_config(plaintext, &dek).unwrap();

    // Corrupt a byte in the ciphertext portion.
    let idx = encrypted.len() - 1;
    encrypted[idx] ^= 0xFF;

    let result = config::decrypt_config(&encrypted, &dek);
    assert!(result.is_err());
}

#[test]
fn different_deks_are_independent() {
    let dek1 = dek::generate_dek();
    let dek2 = dek::generate_dek();

    let plaintext = b"secret data";

    let enc1 = config::encrypt_config(plaintext, &dek1).unwrap();
    let enc2 = config::encrypt_config(plaintext, &dek2).unwrap();

    // Different keys → different ciphertexts (at least, different nonces)
    assert_ne!(enc1, enc2);

    // Cross-decryption should fail.
    assert!(config::decrypt_config(&enc1, &dek2).is_err());
    assert!(config::decrypt_config(&enc2, &dek1).is_err());

    // Own-key decryption should succeed.
    assert_eq!(config::decrypt_config(&enc1, &dek1).unwrap(), plaintext);
    assert_eq!(config::decrypt_config(&enc2, &dek2).unwrap(), plaintext);
}

#[test]
fn encrypted_config_format_has_correct_structure() {
    use cfms_core::constants::{ENCRYPTED_MAGIC, NONCE_LEN, TAG_LEN};

    let dek = dek::generate_dek();
    let plaintext = b"hello";

    let encrypted = config::encrypt_config(plaintext, &dek).unwrap();

    // magic(4) + nonce(12) + tag(16) + ciphertext
    assert_eq!(&encrypted[..4], &ENCRYPTED_MAGIC);
    assert!(encrypted.len() >= 4 + NONCE_LEN + TAG_LEN);
    // ciphertext length matches plaintext length for GCM
    assert_eq!(encrypted.len(), 4 + NONCE_LEN + TAG_LEN + plaintext.len());
}
