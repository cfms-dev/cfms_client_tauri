//! Shared in-memory application state.
//!
//! [`AppState`] is the central store for authentication, encryption keys,
//! the WebSocket connection, and lockdown status.  It is wrapped in an
//! [`Arc`] and shared across all background services and Tauri commands.
//!
//! # Thread safety
//!
//! Read-heavy fields use [`tokio::sync::RwLock`] so concurrent readers
//! (checking auth status, reading preferences) don't contend.  Writes are
//! infrequent (login, token refresh, lockdown toggle) so write
//! contention is negligible.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tokio::sync::{broadcast, RwLock};
use zeroize::Zeroizing;

use cfms_core::ServiceEvent;

/// Central application state shared via `Arc`.
pub struct AppState {
    // --- Authentication ---
    /// Logged-in username.  `None` means not authenticated.
    pub username: RwLock<Option<String>>,
    /// Bearer token for API requests.
    pub token: RwLock<Option<String>>,
    /// Unix timestamp (seconds) when the token expires.
    pub token_exp: RwLock<Option<i64>>,
    /// Display name.
    pub nickname: RwLock<Option<String>>,
    /// Server-assigned permission strings.
    pub permissions: RwLock<Vec<String>>,
    /// Server-assigned group strings.
    pub groups: RwLock<Vec<String>>,

    // --- Encryption ---
    /// Data Encryption Key (256-bit AES key).  Never persisted to disk;
    /// lives only in memory and is zeroized on drop.
    pub dek: RwLock<Option<Zeroizing<[u8; 32]>>>,

    // --- Connection ---
    /// Multiplexed WSS connection to the CFMS server.
    pub conn: RwLock<Option<cfms_transport::Connection>>,
    /// Server address (e.g. `"cfms.example.com:8443"`).
    pub server_address: RwLock<Option<String>>,
    /// If `true`, TLS certificate validation is skipped.
    pub disable_ssl_enforcement: RwLock<bool>,

    // --- Application ---
    /// Whether the server has activated lockdown mode.
    pub app_lockdown: AtomicBool,

    // --- Events ---
    /// Broadcast channel for service-to-frontend events.
    pub event_tx: broadcast::Sender<ServiceEvent>,
}

impl AppState {
    /// Create a new `AppState` with all fields in their default (empty) state.
    pub fn new() -> Arc<Self> {
        let (event_tx, _) = broadcast::channel(256);
        Arc::new(Self {
            username: RwLock::new(None),
            token: RwLock::new(None),
            token_exp: RwLock::new(None),
            nickname: RwLock::new(None),
            permissions: RwLock::new(Vec::new()),
            groups: RwLock::new(Vec::new()),
            dek: RwLock::new(None),
            conn: RwLock::new(None),
            server_address: RwLock::new(None),
            disable_ssl_enforcement: RwLock::new(false),
            app_lockdown: AtomicBool::new(false),
            event_tx,
        })
    }
}
