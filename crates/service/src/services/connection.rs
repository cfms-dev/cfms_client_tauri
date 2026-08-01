//! Primary connection watchdog and reconnect helpers.

use cfms_core::ServiceEvent;
use std::sync::Arc;
use std::time::Duration;
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
                let is_transient = super::retry::is_transient_error(&error);
                let retry_after_seconds = super::retry::error_retry_after_seconds(&error);
                last_error = Some(error.to_string());

                if attempt < attempts && is_transient {
                    tokio::time::sleep(super::retry::retry_delay(attempt, retry_after_seconds))
                        .await;
                } else if !is_transient {
                    break;
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

async fn connect_once(config: &ConnectionConfig) -> cfms_core::Result<cfms_transport::Connection> {
    let tls_config = cfms_transport::tls::build_config_with_identity(
        &config.ca_dir,
        config.disable_ssl,
        config.client_cert_path.as_deref(),
        config.client_key_path.as_deref(),
    )?;

    let connection = cfms_transport::Connection::connect(
        &config.url,
        tls_config,
        config.proxy_addr.as_deref(),
        config.force_ipv4,
    )
    .await?;

    // Capacity rejections happen immediately after a successful WebSocket
    // upgrade. Give the receive loop a brief opportunity to record 1013 so a
    // watchdog reconnect is not reported as restored and then lost again.
    tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    if connection.is_closed()
        && let Some(close) = connection.close_info()
        && close.code == 1013
    {
        return Err(cfms_core::Error::ConnectionRejected {
            status: 503,
            message: close.reason,
            retry_after_seconds: None,
        });
    }

    Ok(connection)
}
