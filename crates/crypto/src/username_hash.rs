//! Salted, stretched, domain-separated irreversible username digests for managed auth keys.
use base64ct::{Base64Unpadded, Encoding};
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::kdf::generate_salt;
use crate::pin::equal;

const VERSION: &str = "v1";
const ALGORITHM: &str = "pbkdf2-sha256";
const DOMAIN_SEPARATOR: &[u8] = b"cfms.managed_auth_key.username.v1\0";
pub const USERNAME_HASH_ITERATIONS: u32 = 30_000;
const MIN_ITERATIONS: u32 = 1;
const MAX_ITERATIONS: u32 = 2_000_000;
const SALT_LEN: usize = 16;
const DIGEST_LEN: usize = 32;

fn derive_digest(
    normalized_username: &str,
    salt: &[u8],
    iterations: u32,
) -> Zeroizing<[u8; DIGEST_LEN]> {
    let mut domain_salt = Zeroizing::new(Vec::with_capacity(DOMAIN_SEPARATOR.len() + salt.len()));
    domain_salt.extend_from_slice(DOMAIN_SEPARATOR);
    domain_salt.extend_from_slice(salt);
    let mut output = Zeroizing::new([0u8; DIGEST_LEN]);
    pbkdf2_hmac::<Sha256>(
        normalized_username.as_bytes(),
        &domain_salt,
        iterations,
        &mut *output,
    );
    output
}

/// Derive a salted, stretched, irreversible digest string for a username.
pub fn hash_username(username: &str) -> String {
    let normalized = username.trim();
    if normalized.is_empty() {
        return String::new();
    }
    let salt = generate_salt();
    let digest = derive_digest(normalized, &salt, USERNAME_HASH_ITERATIONS);
    let salt_b64 = Base64Unpadded::encode_string(&salt);
    let digest_b64 = Base64Unpadded::encode_string(&*digest);
    format!("{VERSION}${ALGORITHM}${USERNAME_HASH_ITERATIONS}${salt_b64}${digest_b64}")
}

/// Verify whether `candidate` matches `stored_hash` in constant time.
pub fn verify_username(stored_hash: &str, candidate: &str) -> bool {
    let normalized = candidate.trim();
    if normalized.is_empty() || stored_hash.is_empty() {
        return false;
    }
    let mut parts = stored_hash.split('$');
    let (Some(version), Some(algorithm), Some(iter_str), Some(salt_b64), Some(digest_b64), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return false;
    };
    if version != VERSION || algorithm != ALGORITHM {
        return false;
    }
    let Ok(iterations) = iter_str.parse::<u32>() else {
        return false;
    };
    if !(MIN_ITERATIONS..=MAX_ITERATIONS).contains(&iterations) {
        return false;
    }
    let Ok(salt) = Base64Unpadded::decode_vec(salt_b64) else {
        return false;
    };
    if salt.len() != SALT_LEN {
        return false;
    }
    let Ok(expected_vec) = Base64Unpadded::decode_vec(digest_b64) else {
        return false;
    };
    let Ok(expected) = <[u8; DIGEST_LEN]>::try_from(expected_vec.as_slice()) else {
        return false;
    };
    let actual = derive_digest(normalized, &salt, iterations);
    equal(&actual, &expected)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_are_salted_irreversible_and_omit_plaintext() {
        let h1 = hash_username("alice");
        let h2 = hash_username("alice");
        assert_ne!(h1, h2);
        assert!(!h1.contains("alice"));
        assert!(!h2.contains("alice"));
        assert!(h1.starts_with("v1$pbkdf2-sha256$30000$"));
        assert!(verify_username(&h1, "alice"));
        assert!(verify_username(&h2, "alice"));
    }

    #[test]
    fn verification_trims_whitespace_and_rejects_mismatches() {
        let hash = hash_username("  alice  ");
        assert!(verify_username(&hash, "alice"));
        assert!(verify_username(&hash, "  alice\t"));
        assert!(!verify_username(&hash, "Alice"));
        assert!(!verify_username(&hash, "bob"));
        assert!(!verify_username(&hash, ""));
        assert!(!verify_username(&hash, "   "));
        assert!(hash_username("   ").is_empty());
        assert!(!verify_username("", "alice"));
    }

    #[test]
    fn malformed_and_out_of_bounds_hashes_fail_closed() {
        let valid = hash_username("alice");
        let parts: Vec<&str> = valid.split('$').collect();
        assert_eq!(parts.len(), 5);

        assert!(!verify_username("alice", "alice"));
        assert!(!verify_username(
            &format!("v2${}${}${}${}", parts[1], parts[2], parts[3], parts[4]),
            "alice"
        ));
        assert!(!verify_username(
            &format!("{}$sha256${}${}${}", parts[0], parts[2], parts[3], parts[4]),
            "alice"
        ));
        assert!(!verify_username(
            &format!("{}${}$0${}${}", parts[0], parts[1], parts[3], parts[4]),
            "alice"
        ));
        assert!(!verify_username(
            &format!(
                "{}${}$2000001${}${}",
                parts[0], parts[1], parts[3], parts[4]
            ),
            "alice"
        ));
        assert!(!verify_username(
            &format!("{}${}${}$AAAA${}", parts[0], parts[1], parts[2], parts[4]),
            "alice"
        ));
        assert!(!verify_username(
            &format!("{}${}${}${}$AAAA", parts[0], parts[1], parts[2], parts[3]),
            "alice"
        ));
        assert!(!verify_username(&format!("{valid}$extra"), "alice"));
    }
}
