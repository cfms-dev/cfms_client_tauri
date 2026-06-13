//! CFMS Transport — secure WebSocket connection engine.
//!
//! Provides:
//!
//! - [`tls`] — rustls-based TLS configuration with custom CA certificate pinning.
//! - [`frame`] — multiplexed frame protocol (encode/decode).
//! - [`stream`] — virtual stream abstraction over a shared connection.
//! - [`connector`] — high-level [`Connection`] API (connect, create stream, accept stream).
//! - [`proxy`] — HTTP(S) CONNECT and SOCKS proxy support.
//!
//! # Architecture
//!
//! ```text
//!                    ┌────────────────────────┐
//!                    │    Connection          │
//!                    │  (one per server)      │
//!                    └───┬────────────────────┘
//!                        │  frame multiplexing
//!          ┌─────────────┼─────────────┐
//!          ▼             ▼             ▼
//!     Stream(1)     Stream(3)     Stream(5)
//!   (download)     (upload)     (server push)
//! ```
//!
//! Odd stream IDs are client-initiated; even IDs are server-initiated.

#![forbid(unsafe_code)]

pub mod connector;
pub mod frame;
pub mod proxy;
pub mod stream;
pub mod tls;

// Re-exports
pub use connector::Connection;
pub use frame::{FrameHeader, FrameKind};
pub use stream::Stream;
