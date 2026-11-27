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

    /// Authenticated revocation evidence; never retry as an ordinary network failure.
    #[error("certificate_revoked: {0}")]
    CertificateRevoked(String),

    /// The WebSocket upgrade was rejected with an HTTP response.
    #[error("connection rejected ({status}): {message}")]
    ConnectionRejected {
        status: u16,
        message: String,
        retry_after_seconds: Option<u64>,
    },

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
    Server {
        code: u32,
        message: String,
        scope: Option<String>,
        limit: Option<u64>,
        retry_after_seconds: Option<u64>,
        /// File-task state returned by protocol 25 claim failures.
        task_status: Option<String>,
        /// Server-declared retryability for protocol 25 file-task claim failures.
        retryable: Option<bool>,
    },

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

impl Error {
    /// Build [`Error::Server`] from a decoded protocol response envelope.
    pub fn from_server_response(response: &crate::Response) -> Self {
        Self::from_server_response_parts(
            u32::from(response.code),
            response.message.clone(),
            &response.data,
        )
    }

    /// Build [`Error::Server`] from status code, message, and JSON `data` object.
    pub fn from_server_response_parts(
        code: u32,
        message: String,
        data: &serde_json::Value,
    ) -> Self {
        Self::Server {
            code,
            message,
            scope: data
                .get("scope")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
            limit: data.get("limit").and_then(serde_json::Value::as_u64),
            retry_after_seconds: data
                .get("retry_after_seconds")
                .and_then(serde_json::Value::as_u64),
            task_status: data
                .get("task_status")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
            retryable: data.get("retryable").and_then(serde_json::Value::as_bool),
        }
    }
}

/// Envelope used when decoding transfer/status frames that may omit `data` or `timestamp`.
#[derive(Debug, serde::Deserialize)]
pub struct ServerResponseEnvelope {
    pub code: u32,
    pub message: String,
    #[serde(default)]
    pub data: serde_json::Value,
}

impl ServerResponseEnvelope {
    pub fn into_error(self) -> Error {
        Error::from_server_response_parts(self.code, self.message, &self.data)
    }
}

/// Format a server status, message, and structured `data` payload across the
/// IPC string-error boundary while omitting empty `{}` / `null` payloads.
pub fn format_server_error_parts(
    code: impl std::fmt::Display,
    message: &str,
    data: &serde_json::Value,
) -> String {
    let mut error = format!("Server returned {code}: {message}");
    let error_data = serde_json::to_string(data).unwrap_or_else(|_| "{}".to_string());
    if error_data != "{}" && error_data != "null" {
        error.push_str("\nCFMS_ERROR_DATA:");
        error.push_str(&error_data);
    }
    error
}

/// Convenience alias so every crate can use `cfms_core::Result<T>`.
pub type Result<T> = result::Result<T, Error>;
