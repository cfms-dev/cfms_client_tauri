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
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize};

use cfms_core::ServiceEvent;
use tokio::sync::{Mutex, RwLock, broadcast};

use crate::sensitive::{SecretKey, SecretString};

/// Central application state shared via `Arc`.
pub struct AppState {
    // --- Authentication ---
    /// Logged-in username.  `None` means not authenticated.
    pub username: RwLock<Option<String>>,
    pub user_id: RwLock<Option<String>>,
    /// Bearer token for API requests.
    pub token: RwLock<Option<SecretString>>,
    /// Unix timestamp (seconds) when the token expires.
    pub token_exp: RwLock<Option<i64>>,
    pub pending_auth: RwLock<Option<crate::authentication::PendingAuthentication>>,
    pub escalation: RwLock<Option<crate::authentication::IssuedToken>>,
    /// Invalidates in-flight authentication responses when the session is cleared.
    pub auth_generation: AtomicU64,
    pub auth_update: Mutex<()>,
    /// Display name.
    pub nickname: RwLock<Option<String>>,
    /// Server-assigned permission strings.
    pub permissions: RwLock<Vec<String>>,
    /// Server-assigned group strings.
    pub groups: RwLock<Vec<String>>,

    // --- Encryption ---
    /// Active Data Encryption Key (256-bit AES key), zeroized on drop.
    /// The native shell may retain a copy in operating-system secure storage.
    pub dek: RwLock<Option<SecretKey>>,
    /// Device-local keys must never replace the server's password envelope.
    pub preference_dek_local_only: AtomicBool,
    /// Encrypted preference DEK returned by the server during this login.
    /// Kept only in memory so the user can recover from an administrator
    /// password reset by supplying the old password that wraps this DEK.
    pub server_preference_dek: RwLock<Option<String>>,

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
    /// Extension capability flags advertised by the latest `server_info` handshake.
    pub server_extension_flags: RwLock<Vec<String>>,
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
    /// Serialises reconnect attempts from background services and IPC commands.
    pub reconnect_lock: Mutex<()>,

    // --- Application ---
    /// Whether the server has activated lockdown mode.
    pub app_lockdown: AtomicBool,
    /// Administrator-provided reason for the active lockdown, when present.
    pub lockdown_reason: RwLock<Option<String>>,

    /// Runtime download queue concurrency, mirrored from user preferences.
    pub download_max_concurrent: AtomicUsize,
    pub upload_max_concurrent: AtomicUsize,
    /// Maximum download chunk size advertised to protocol v20 servers.
    pub download_max_chunk_size: AtomicUsize,

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
    /// Leave elevation locally, preserving the ordinary login session.
    pub async fn drop_escalation(&self) {
        let _update = self.auth_update.lock().await;
        self.escalation.write().await.take();
    }

    /// Elevated authority is temporary; ordinary session renewal is independent.
    pub async fn request_token(&self) -> Option<SecretString> {
        let elevated = {
            let mut escalation = self.escalation.write().await;
            if escalation
                .as_ref()
                .is_some_and(|issued| issued.claims.exp <= crate::authentication::unix_now())
            {
                escalation.take();
            }
            escalation.as_ref().map(|issued| issued.secret.clone())
        };
        match elevated {
            Some(token) => Some(token),
            None => self.token.read().await.clone(),
        }
    }

    /// Create a new `AppState` with all fields in their default (empty) state.
    pub fn new() -> Arc<Self> {
        let (event_tx, _) = broadcast::channel(256);
        Arc::new(Self {
            username: RwLock::new(None),
            user_id: RwLock::new(None),
            token: RwLock::new(None),
            token_exp: RwLock::new(None),
            pending_auth: RwLock::new(None),
            escalation: RwLock::new(None),
            auth_generation: AtomicU64::new(0),
            auth_update: Mutex::new(()),
            nickname: RwLock::new(None),
            permissions: RwLock::new(Vec::new()),
            groups: RwLock::new(Vec::new()),
            dek: RwLock::new(None),
            server_preference_dek: RwLock::new(None),
            preference_dek_local_only: AtomicBool::new(false),
            avatar_path: RwLock::new(None),
            conn: RwLock::new(None),
            server_address: RwLock::new(None),
            server_name: RwLock::new(None),
            server_protocol_version: RwLock::new(None),
            server_extension_flags: RwLock::new(Vec::new()),
            disable_ssl_enforcement: RwLock::new(false),
            force_ipv4: RwLock::new(false),
            ca_dir: RwLock::new(None),
            proxy_addr: RwLock::new(None),
            client_cert_path: RwLock::new(None),
            client_key_path: RwLock::new(None),
            reconnect_lock: Mutex::new(()),
            app_lockdown: AtomicBool::new(false),
            lockdown_reason: RwLock::new(None),
            download_max_concurrent: AtomicUsize::new(cfms_core::DEFAULT_TASK_CONCURRENCY as usize),
            upload_max_concurrent: AtomicUsize::new(cfms_core::DEFAULT_TASK_CONCURRENCY as usize),
            download_max_chunk_size: AtomicUsize::new(
                cfms_core::constants::DEFAULT_DOWNLOAD_CHUNK_SIZE as usize,
            ),
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
            connected: self
                .conn
                .try_read()
                .map(|c| c.as_ref().is_some_and(|conn| !conn.is_closed()))
                .unwrap_or(false),
            lockdown: self.app_lockdown.load(std::sync::atomic::Ordering::Relaxed),
            token_near_expiry,
        }
    }

    /// Clear all authentication material owned by the service layer.
    ///
    /// `SecretString` and `SecretKey` values are zeroized as they are removed.
    /// Queue-specific persistence contexts are cleared by the Tauri shell,
    /// which owns those queues.
    pub async fn clear_auth(&self) {
        let _update = self.auth_update.lock().await;
        self.auth_generation
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut username = self.username.write().await;
        let mut token = self.token.write().await;
        let mut token_exp = self.token_exp.write().await;
        let mut nickname = self.nickname.write().await;
        let mut permissions = self.permissions.write().await;
        let mut groups = self.groups.write().await;
        let mut dek = self.dek.write().await;
        let mut server_preference_dek = self.server_preference_dek.write().await;
        let mut avatar_path = self.avatar_path.write().await;

        username.take();
        self.user_id.write().await.take();
        token.take();
        token_exp.take();
        nickname.take();
        permissions.clear();
        groups.clear();
        dek.take();
        self.preference_dek_local_only
            .store(false, std::sync::atomic::Ordering::SeqCst);
        server_preference_dek.take();
        avatar_path.take();
        self.pending_auth.write().await.take();
        self.escalation.write().await.take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authentication::{AUTH, ESCALATED, IssuedToken, PendingAuthentication, TokenClaims};
    use zeroize::Zeroizing;

    fn issued(secret: &str, purpose: u8, exp: f64) -> IssuedToken {
        IssuedToken {
            secret: SecretString::new(secret.into()),
            claims: TokenClaims {
                sub: "alice-id".into(),
                purpose,
                exp,
            },
        }
    }

    #[tokio::test]
    async fn elevation_expiry_and_session_refresh_are_independent() {
        let state = AppState::new();
        *state.token.write().await = Some(SecretString::new("general".into()));
        *state.escalation.write().await = Some(issued(
            "elevated",
            ESCALATED,
            crate::authentication::unix_now() + 300.0,
        ));
        assert_eq!(state.request_token().await.unwrap().as_str(), "elevated");
        *state.token.write().await = Some(SecretString::new("refreshed-general".into()));
        assert_eq!(state.request_token().await.unwrap().as_str(), "elevated");
        state.escalation.write().await.as_mut().unwrap().claims.exp = 1.0;
        assert_eq!(
            state.request_token().await.unwrap().as_str(),
            "refreshed-general"
        );
        assert!(state.escalation.read().await.is_none());
    }

    #[tokio::test]
    async fn dropping_elevation_preserves_the_general_session() {
        let state = AppState::new();
        *state.token.write().await = Some(SecretString::new("general".into()));
        *state.escalation.write().await = Some(issued(
            "elevated",
            ESCALATED,
            crate::authentication::unix_now() + 300.0,
        ));
        state.drop_escalation().await;
        assert!(state.escalation.read().await.is_none());
        assert_eq!(state.request_token().await.unwrap().as_str(), "general");
        state.drop_escalation().await;
        assert_eq!(state.request_token().await.unwrap().as_str(), "general");
    }

    #[tokio::test]
    async fn clear_auth_removes_every_session_value() {
        let state = AppState::new();
        *state.username.write().await = Some("alice".into());
        *state.user_id.write().await = Some("alice-id".into());
        *state.token.write().await = Some(SecretString::new("token".into()));
        *state.token_exp.write().await = Some(42);
        *state.nickname.write().await = Some("Alice".into());
        state.permissions.write().await.push("read".into());
        state.groups.write().await.push("staff".into());
        *state.dek.write().await = Some(Zeroizing::new([7; 32]));
        state
            .preference_dek_local_only
            .store(true, std::sync::atomic::Ordering::SeqCst);
        *state.server_preference_dek.write().await = Some("encrypted-envelope".into());
        *state.avatar_path.write().await = Some("avatar.png".into());
        *state.pending_auth.write().await = Some(PendingAuthentication {
            username: "alice".into(),
            issued: issued("auth-only", AUTH, 42.0),
            methods: vec!["totp".into()],
        });
        *state.escalation.write().await = Some(issued("elevated", ESCALATED, 42.0));

        state.clear_auth().await;

        assert!(state.username.read().await.is_none());
        assert!(state.user_id.read().await.is_none());
        assert!(state.token.read().await.is_none());
        assert!(state.token_exp.read().await.is_none());
        assert!(state.nickname.read().await.is_none());
        assert!(state.permissions.read().await.is_empty());
        assert!(state.groups.read().await.is_empty());
        assert!(state.dek.read().await.is_none());
        assert!(
            !state
                .preference_dek_local_only
                .load(std::sync::atomic::Ordering::SeqCst)
        );
        assert!(state.server_preference_dek.read().await.is_none());
        assert!(state.avatar_path.read().await.is_none());
        assert!(state.pending_auth.read().await.is_none());
        assert!(state.escalation.read().await.is_none());
        assert_eq!(
            state
                .auth_generation
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
    }
}
