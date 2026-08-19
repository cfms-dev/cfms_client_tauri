//! Protocol-level constants shared across all crates.
//!
//! These values MUST match the CFMS server protocol specification.
//! Changing any of them without a protocol version bump will break
//! compatibility with the server.

// ---------------------------------------------------------------------------
// Protocol version
// ---------------------------------------------------------------------------
/// Exact wire-protocol version required by this client.
pub const PROTOCOL_VERSION: u32 = 23;

/// Oldest wire-protocol version supported by this client.
pub const MIN_SUPPORTED_PROTOCOL_VERSION: u32 = PROTOCOL_VERSION;

/// Newest wire-protocol version supported by this client.
pub const MAX_SUPPORTED_PROTOCOL_VERSION: u32 = PROTOCOL_VERSION;

/// Return whether a server wire-protocol version is compatible with this client.
pub const fn is_supported_protocol_version(version: u32) -> bool {
    version == PROTOCOL_VERSION
}

// ---------------------------------------------------------------------------
// Cryptographic parameters
// ---------------------------------------------------------------------------

/// PBKDF2-HMAC-SHA256 iteration count.
///
/// NIST SP 800-132 recommends *at minimum* 1 000 000 iterations for PBKDF2
/// when used with SHA-256.  This value MUST NOT be lowered.
pub const KDF_ITERATIONS: u32 = 1_000_000;

/// Salt length for PBKDF2 (128 bits).
pub const SALT_LEN: usize = 16;

/// Symmetric key length for AES-256 (256 bits / 32 bytes).
pub const KEY_LEN: usize = 32;

/// GCM nonce length (96 bits / 12 bytes) — the recommended size per NIST.
pub const NONCE_LEN: usize = 12;

/// GCM authentication tag length (128 bits / 16 bytes).
pub const TAG_LEN: usize = 16;

// ---------------------------------------------------------------------------
// Encrypted config file format
// ---------------------------------------------------------------------------

/// Magic bytes that identify a config file encrypted by this library.
///
/// Starts with non-ASCII bytes that are extremely unlikely to appear at the
/// beginning of a plain JSON (UTF-8) file.
pub const ENCRYPTED_MAGIC: [u8; 4] = [0xcf, 0xe5, 0xce, 0x01];

// ---------------------------------------------------------------------------
// Frame protocol
// ---------------------------------------------------------------------------

/// Frame header size on the wire: 4 bytes `frame_id` (BE) + 1 byte `frame_type`.
pub const FRAME_HEADER_LEN: usize = 5;

/// Prefix length used when constructing chunk nonces (8 bytes + 4 bytes index = 12).
pub const CHUNK_NONCE_PREFIX_LEN: usize = 8;

// ---------------------------------------------------------------------------
// Transfer limits
// ---------------------------------------------------------------------------

pub const MIN_DOWNLOAD_CHUNK_SIZE: u32 = 16 * 1024;
pub const DEFAULT_DOWNLOAD_CHUNK_SIZE: u32 = 64 * 1024;
pub const MAX_DOWNLOAD_CHUNK_SIZE: u32 = 2 * 1024 * 1024;
pub const DOWNLOAD_CHUNK_SIZE_OPTIONS: [u32; 8] = [
    16 * 1024,
    32 * 1024,
    64 * 1024,
    128 * 1024,
    256 * 1024,
    512 * 1024,
    1024 * 1024,
    2 * 1024 * 1024,
];

#[cfg(test)]
mod tests {
    use super::{
        MAX_SUPPORTED_PROTOCOL_VERSION, MIN_SUPPORTED_PROTOCOL_VERSION,
        is_supported_protocol_version,
    };

    #[test]
    fn accepts_every_supported_protocol_version() {
        assert!(is_supported_protocol_version(
            MIN_SUPPORTED_PROTOCOL_VERSION
        ));
        assert!(is_supported_protocol_version(
            MAX_SUPPORTED_PROTOCOL_VERSION
        ));
    }

    #[test]
    fn rejects_protocol_versions_outside_the_supported_range() {
        assert!(!is_supported_protocol_version(
            MIN_SUPPORTED_PROTOCOL_VERSION - 1
        ));
        assert!(!is_supported_protocol_version(
            MAX_SUPPORTED_PROTOCOL_VERSION + 1
        ));
    }

    #[test]
    fn supports_only_protocol_twenty_three() {
        assert!(is_supported_protocol_version(23));
        assert!(!is_supported_protocol_version(22));
        assert!(!is_supported_protocol_version(24));
    }
}
