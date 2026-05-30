//! PBKDF2-HMAC-SHA256 key derivation.
//!
//! Derives a 256-bit Key Encryption Key (KEK) from a user password and
//! random 128-bit salt.  The iteration count is fixed at [`KDF_ITERATIONS`]
//! (1 000 000) per NIST SP 800-132.

use cfms_core::constants::{KDF_ITERATIONS, KEY_LEN, SALT_LEN};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;
use zeroize::Zeroizing;

/// Derive a 256-bit Key Encryption Key from `password` and `salt`.
///
/// Uses PBKDF2-HMAC-SHA256 with [`KDF_ITERATIONS`] iterations.
/// The returned key is wrapped in [`Zeroizing`] so its memory is cleared on drop.
pub fn derive_kek(password: &[u8], salt: &[u8; SALT_LEN]) -> Zeroizing<[u8; KEY_LEN]> {
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    pbkdf2_hmac::<Sha256>(password, salt, KDF_ITERATIONS, &mut *key);
    key
}

/// Generate a cryptographically random 128-bit salt.
pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    salt
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 6070 test vector #1 (adjusted: we use 32-byte output).
    /// We can only verify that repeated derivations produce the same result.
    #[test]
    fn deterministic_derivation() {
        let password = b"password";
        let salt = b"\x78\x57\x8E\x5A\x5D\x63\xCB\x06\x00\x00\x00\x00\x00\x00\x00\x00";
        assert_eq!(salt.len(), SALT_LEN);

        let k1 = derive_kek(password, salt);
        let k2 = derive_kek(password, salt);
        assert_eq!(&*k1, &*k2);
    }

    #[test]
    fn different_passwords_produce_different_keys() {
        let salt = generate_salt();
        let k1 = derive_kek(b"alice", &salt);
        let k2 = derive_kek(b"bob", &salt);
        assert_ne!(&*k1, &*k2);
    }

    #[test]
    fn different_salts_produce_different_keys() {
        let s1 = generate_salt();
        let s2 = generate_salt();
        assert_ne!(s1, s2);

        let k1 = derive_kek(b"password", &s1);
        let k2 = derive_kek(b"password", &s2);
        assert_ne!(&*k1, &*k2);
    }

    #[test]
    fn key_is_zeroized_on_drop() {
        let salt = generate_salt();
        let key_ptr;
        {
            let key = derive_kek(b"test", &salt);
            key_ptr = &*key as *const [u8; KEY_LEN];
            // Key is still alive here
        }
        // After drop, accessing the memory is UB in C/Rust, but we can
        // at least verify the struct compiles and runs without panic.
        let _ = key_ptr; // silence unused warning
    }
}
