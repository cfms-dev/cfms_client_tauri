//! Token refresh service — runs every 60 seconds.
//!
//! Checks the remaining lifetime of the authentication token and refreshes it
//! when it falls below the 300-second threshold.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;

use cfms_core::ServiceEvent;

use crate::state::AppState;

/// Interval between token lifetime checks.
pub const INTERVAL: Duration = Duration::from_secs(60);

/// Threshold: if the token expires within this many seconds, a refresh is
/// attempted proactively.
const REFRESH_THRESHOLD: Duration = Duration::from_secs(300);

/// Run the token refresh loop.
///
/// Returns when `shutdown_rx` signals (or the loop exits due to auth loss).
pub async fn run(state: Arc<AppState>, mut shutdown_rx: watch::Receiver<bool>) {
    loop {
        if *shutdown_rx.borrow() {
            break;
        }

        tick(&state).await;

        tokio::select! {
            _ = tokio::time::sleep(INTERVAL) => {},
            _ = shutdown_rx.changed() => { break; }
        }
    }

    tracing::info!("TokenRefreshService stopped");
}

/// A single tick of the refresh logic.
async fn tick(state: &AppState) {
    // Check if we have a valid session.
    let (token, token_exp) = {
        let token = state.token.read().await;
        let exp = state.token_exp.read().await;
        if token.is_none() || exp.is_none() {
            return; // Not logged in — nothing to refresh.
        }
        (token.clone().unwrap(), exp.unwrap())
    };

    let now = unix_now();
    let remaining = token_exp - now;

    if remaining <= 0 {
        // Token already expired — clear auth state.
        tracing::warn!("Token expired — clearing auth state");
        clear_auth(state).await;
        let _ = state.event_tx.send(ServiceEvent::TokenExpired);
        return;
    }

    if remaining <= REFRESH_THRESHOLD.as_secs() as i64 {
        tracing::info!("Token expires in {remaining}s — refreshing…");
        match try_refresh(state, &token).await {
            Ok((new_token, new_exp)) => {
                let mut t = state.token.write().await;
                let mut e = state.token_exp.write().await;
                *t = Some(new_token);
                *e = Some(new_exp);
                tracing::info!("Token refreshed (expires in {}s)", new_exp - unix_now());
            }
            Err(e) => {
                tracing::error!("Token refresh failed: {e}");
                // On auth failure (401/403), clear state.
                if e.contains("401") || e.contains("403") {
                    clear_auth(state).await;
                    let _ = state.event_tx.send(ServiceEvent::TokenExpired);
                }
            }
        }
    }
}

/// Attempt to refresh the token via the server connection.
async fn try_refresh(state: &AppState, token: &str) -> Result<(String, i64), String> {
    let conn = super::connection::ensure_connected(
        state,
        super::connection::DEFAULT_RECONNECT_ATTEMPTS,
        false,
    )
    .await?;

    let mut stream = conn
        .create_stream()
        .await
        .map_err(|e| format!("create_stream: {e}"))?;

    let request = serde_json::json!({
        "action": "refresh_token",
        "data": {},
        "username": "",
        "token": token,
        "timestamp": unix_now(),
        "nonce": rand_nonce(),
    });

    stream
        .send(&conn, serde_json::to_vec(&request).unwrap())
        .await
        .map_err(|e| format!("send: {e}"))?;

    let response_raw = stream.recv().await.ok_or("no response")?;

    let response: cfms_core::Response =
        serde_json::from_slice(&response_raw).map_err(|e| format!("parse response: {e}"))?;

    if response.code != 200 {
        return Err(format!("server returned {}", response.code));
    }

    // Extract new token and expiry from response data.
    let data = response.data;
    let new_token = data["token"]
        .as_str()
        .ok_or("missing token in response")?
        .to_string();
    let new_exp = data["exp"].as_i64().unwrap_or_else(|| unix_now() + 3600); // default 1h

    Ok((new_token, new_exp))
}

async fn clear_auth(state: &AppState) {
    let mut username = state.username.write().await;
    let mut token = state.token.write().await;
    let mut token_exp = state.token_exp.write().await;
    let mut nickname = state.nickname.write().await;
    *username = None;
    *token = None;
    *token_exp = None;
    *nickname = None;
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn rand_nonce() -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(16);
    for _ in 0..16 {
        let b: u8 = rand::random();
        write!(&mut s, "{b:02x}").unwrap();
    }
    s
}
