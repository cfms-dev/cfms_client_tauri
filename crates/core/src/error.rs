//! Unified error type for the entire CFMS client.

use std::result;

/// The single error type used across all crates.
///
/// Each variant represents a category of failure.  The `String` payloads are
/// intentionally owned so errors can cross crate boundaries without lifetime
/// complications.  Call-sites that have more structured data should format it
/// into a clear human-readable message.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A cryptographic operation failed (encryption, decryption, KDF, etc.).
    #[error("cryptographic operation failed: {0}")]
    Crypto(String),

    /// A connection could not be established or was lost.
    #[error("connection failed: {0}")]
    Connection(String),

    /// The remote peer violated the wire protocol.
    #[error("protocol violation: {0}")]
    Protocol(String),

    /// Authentication failed (wrong password, expired token, etc.).
    #[error("authentication failed: {0}")]
    Auth(String),

    /// The server rejected an otherwise valid request.
    ///
    /// Keeping the status code structured lets callers distinguish a terminal
    /// task rejection from a transient transport failure.
    #[error("server rejected request ({code}): {message}")]
    Server { code: u32, message: String },

    /// A wrapped [`std::io::Error`].
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// The operation was cancelled by the user.
    #[error("task cancelled")]
    Cancelled,

    /// Catch-all for errors that don't fit the categories above.
    #[error("{0}")]
    Other(String),
}

/// Convenience alias so every crate can use `cfms_core::Result<T>`.
pub type Result<T> = result::Result<T, Error>;
