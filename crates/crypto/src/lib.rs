//! CFMS Crypto — cryptographic primitives for the CFMS client.
//!
//! This crate provides:
//!
//! - [`kdf`] — PBKDF2-HMAC-SHA256 key derivation (password → KEK).
//! - [`aead`] — AES-256-GCM authenticated encryption primitives.
//! - [`dek`] — Data Encryption Key lifecycle (generate, encrypt, decrypt).
//! - [`config`] — Local config file encryption at rest.
//!
//! # Security
//!
//! - All key material is wrapped in [`zeroize::Zeroizing`] for automatic
//!   memory scrubbing on drop.
//! - `#![forbid(unsafe_code)]` is enforced crate-wide.
//! - Randomness is sourced from the cryptographically secure thread RNG via
//!   [`rand::rng`].

#![forbid(unsafe_code)]

pub mod aead;
pub mod config;
pub mod dek;
pub mod kdf;

// Re-exports for convenience.
pub use aead::{open as aead_open, seal as aead_seal};
pub use config::{decrypt_config, encrypt_config, is_encrypted};
pub use dek::{decrypt_dek, encrypt_dek, generate_dek};
pub use kdf::{derive_kek, generate_salt};
