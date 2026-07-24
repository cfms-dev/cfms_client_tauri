//! Protocol-level constants shared across all crates.
//!
//! These values MUST match the CFMS server protocol specification.
//! Changing any of them without a protocol version bump will break
//! compatibility with the server.

// ---------------------------------------------------------------------------
// Protocol version
// ---------------------------------------------------------------------------
/// Current wire-protocol version.  Server and client negotiate based on this.
pub const PROTOCOL_VERSION: u32 = 17;

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
