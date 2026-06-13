//! Primary connection watchdog and reconnect helpers.

use std::sync::Arc;
use std::time::Duration;

use cfms_core::ServiceEvent;
use tokio::sync::watch;

use crate::state::AppState;

const CHECK_INTERVAL: Duration = Duration::from_secs(3);
pub const DEFAULT_RECONNECT_ATTEMPTS: usize = 3;

#[derive(Debug, Clone)]
struct ConnectionConfig {
    url: String,
    ca_dir: std::path::PathBuf,
    disable_ssl: bool,
    proxy_addr: Option<String>,
    force_ipv4: bool,
    client_cert_path: Option<std::path::PathBuf>,
    client_key_path: Option<std::path::PathBuf>,
}

/// Watch the primary connection and restore it after unexpected disconnects.
pub async fn run(state: Arc<AppState>, mut shutdown_rx: watch::Receiver<bool>) {
    let mut interval = tokio::time::interval(CHECK_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = shutdown_rx.changed() => break,
            _ = interval.tick() => {
                if !has_closed_connection(&state).await {
                    continue;
                }

                match ensure_connected(&state, DEFAULT_RECONNECT_ATTEMPTS, true).await {
                    Ok(_) => {
                        tracing::info!("Primary connection restored by watchdog");
                        let _ = state.event_tx.send(ServiceEvent::ConnectionRestored);
                    }
                    Err(error) => {
                        tracing::warn!("Primary connection reconnect failed: {error}");
                        clear_closed_connection(&state).await;
                        clear_auth(&state).await;
                        let _ = state.event_tx.send(ServiceEvent::ConnectionLost { error });
                    }
                }
            }
        }
    }
}

/// Return a live primary connection, reconnecting when the cached one is closed.
///
/// `force = true` always builds a fresh connection. `force = false` returns the
/// current connection when it is still live.
pub async fn ensure_connected(
    state: &AppState,
    max_attempts: usize,
    force: bool,
) -> Result<cfms_transport::Connection, String> {
    let _guard = state.reconnect_lock.lock().await;

    if !force
        && let Some(conn) = state.conn.read().await.clone()
        && !conn.is_closed()
    {
        return Ok(conn);
    }

    let config = load_config(state).await?;
    let attempts = max_attempts.max(1);
    let mut last_error = None;

    for attempt in 1..=attempts {
        match connect_once(&config).await {
            Ok(conn) => {
                let mut current = state.conn.write().await;
                *current = Some(conn.clone());
                return Ok(conn);
            }
            Err(error) => {
                tracing::warn!(
                    "Reconnect attempt {attempt}/{attempts} failed for {}: {error}",
                    config.url,
                );
                last_error = Some(error);

                if attempt < attempts {
                    tokio::time::sleep(backoff(attempt)).await;
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "Reconnect failed".to_string()))
}

async fn has_closed_connection(state: &AppState) -> bool {
    state
        .conn
        .read()
        .await
        .as_ref()
        .is_some_and(cfms_transport::Connection::is_closed)
}

async fn clear_closed_connection(state: &AppState) {
    let mut conn = state.conn.write().await;
    if conn
        .as_ref()
        .is_some_and(cfms_transport::Connection::is_closed)
    {
        *conn = None;
    }
}

async fn clear_auth(state: &AppState) {
    let mut username = state.username.write().await;
    let mut token = state.token.write().await;
    let mut token_exp = state.token_exp.write().await;
    let mut nickname = state.nickname.write().await;
    let mut permissions = state.permissions.write().await;
    let mut groups = state.groups.write().await;
    let mut dek = state.dek.write().await;
    let mut avatar_path = state.avatar_path.write().await;

    *username = None;
    *token = None;
    *token_exp = None;
    *nickname = None;
    permissions.clear();
    groups.clear();
    *dek = None;
    *avatar_path = None;
    state
        .pending_2fa
        .store(false, std::sync::atomic::Ordering::SeqCst);
}

async fn load_config(state: &AppState) -> Result<ConnectionConfig, String> {
    let url = state
        .server_address
        .read()
        .await
        .clone()
        .ok_or_else(|| "No server address configured".to_string())?;
    let ca_dir = state
        .ca_dir
        .read()
        .await
        .clone()
        .ok_or_else(|| "No CA directory configured".to_string())?;
    let disable_ssl = *state.disable_ssl_enforcement.read().await;
    let proxy_addr = state.proxy_addr.read().await.clone();
    let force_ipv4 = *state.force_ipv4.read().await;
    let client_cert_path = state.client_cert_path.read().await.clone();
    let client_key_path = state.client_key_path.read().await.clone();

    Ok(ConnectionConfig {
        url,
        ca_dir,
        disable_ssl,
        proxy_addr,
        force_ipv4,
        client_cert_path,
        client_key_path,
    })
}

async fn connect_once(config: &ConnectionConfig) -> Result<cfms_transport::Connection, String> {
    let tls_config = cfms_transport::tls::build_config_with_identity(
        &config.ca_dir,
        config.disable_ssl,
        config.client_cert_path.as_deref(),
        config.client_key_path.as_deref(),
    )
    .map_err(|e| format!("TLS config error: {e}"))?;

    cfms_transport::Connection::connect(
        &config.url,
        tls_config,
        config.proxy_addr.as_deref(),
        config.force_ipv4,
    )
    .await
    .map_err(|e| format!("Connection failed: {e}"))
}

fn backoff(attempt: usize) -> Duration {
    Duration::from_millis(350 * attempt as u64)
}
