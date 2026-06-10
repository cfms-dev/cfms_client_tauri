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

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use tokio::sync::{RwLock, broadcast};
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

    // --- Avatar ---
    /// Local filesystem path to the cached user avatar image.
    pub avatar_path: RwLock<Option<String>>,

    // --- Connection ---
    /// Multiplexed WSS connection to the CFMS server.
    pub conn: RwLock<Option<cfms_transport::Connection>>,
    /// Server address (e.g. `"cfms.example.com:8443"`).
    pub server_address: RwLock<Option<String>>,
    /// Human-readable server name as reported by `server_info`.
    pub server_name: RwLock<Option<String>>,
    /// Wire-protocol version the connected server speaks.
    pub server_protocol_version: RwLock<Option<u32>>,
    /// If `true`, TLS certificate validation is skipped.
    pub disable_ssl_enforcement: RwLock<bool>,
    /// If `true`, direct outbound connections only use IPv4 addresses.
    pub force_ipv4: RwLock<bool>,
    /// Path to the CA certificate directory, stored so that dedicated
    /// transfer connections can rebuild TLS config on demand.
    pub ca_dir: RwLock<Option<PathBuf>>,
    /// Optional SOCKS5 proxy address used for all outbound server connections.
    pub proxy_addr: RwLock<Option<String>>,
    /// Optional client certificate path for mutual TLS.
    pub client_cert_path: RwLock<Option<PathBuf>>,
    /// Optional client private key path for mutual TLS.
    pub client_key_path: RwLock<Option<PathBuf>>,

    // --- Application ---
    /// Whether the server has activated lockdown mode.
    pub app_lockdown: AtomicBool,

    /// Whether a 2FA verification is pending during login.
    /// When true, the user has submitted credentials but hasn't completed
    /// 2FA yet — `token` holds a placeholder and `is_logged_in` helpers
    /// should return false.
    pub pending_2fa: AtomicBool,

    // --- Events ---
    /// Broadcast channel for service-to-frontend events.
    pub event_tx: broadcast::Sender<ServiceEvent>,
}

/// Lightweight read-only snapshot of key application state, used by the
/// background service heartbeat to communicate status to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct AppStateSnapshot {
    pub authenticated: bool,
    pub connected: bool,
    pub lockdown: bool,
    pub token_near_expiry: bool,
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
            avatar_path: RwLock::new(None),
            conn: RwLock::new(None),
            server_address: RwLock::new(None),
            server_name: RwLock::new(None),
            server_protocol_version: RwLock::new(None),
            disable_ssl_enforcement: RwLock::new(false),
            force_ipv4: RwLock::new(false),
            ca_dir: RwLock::new(None),
            proxy_addr: RwLock::new(None),
            client_cert_path: RwLock::new(None),
            client_key_path: RwLock::new(None),
            app_lockdown: AtomicBool::new(false),
            pending_2fa: AtomicBool::new(false),
            event_tx,
        })
    }

    /// Return a cheap, read-only snapshot of the current application state.
    /// Does not acquire any write locks.
    pub fn snapshot_status(&self) -> AppStateSnapshot {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let token_near_expiry = self
            .token_exp
            .try_read()
            .ok()
            .and_then(|v| *v)
            .map(|exp| exp - now < 300)
            .unwrap_or(false);
        AppStateSnapshot {
            authenticated: self.token.try_read().map(|t| t.is_some()).unwrap_or(false),
            connected: self.conn.try_read().map(|c| c.is_some()).unwrap_or(false),
            lockdown: self.app_lockdown.load(std::sync::atomic::Ordering::Relaxed),
            token_near_expiry,
        }
    }
}
