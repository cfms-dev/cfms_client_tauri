//! Token refresh service — runs every 60 seconds.
//!
//! Checks the remaining lifetime of the authentication token and refreshes it
//! when it falls below the 300-second threshold.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;

use cfms_core::ServiceEvent;

use crate::sensitive::SecretString;
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
    let generation = state
        .auth_generation
        .load(std::sync::atomic::Ordering::SeqCst);
    // Check if we have a valid session.
    let (username, token, token_exp) = {
        let username = state.username.read().await;
        let token = state.token.read().await;
        let exp = state.token_exp.read().await;
        if username.is_none() || token.is_none() || exp.is_none() {
            return; // Not logged in — nothing to refresh.
        }
        (
            username.clone().unwrap(),
            token.clone().unwrap(),
            exp.unwrap(),
        )
    };

    let now = unix_now();
    let remaining = token_exp - now;

    if remaining <= 0 {
        // Token already expired — clear auth state.
        tracing::warn!("Token expired — clearing auth state");
        state.clear_auth().await;
        let _ = state.event_tx.send(ServiceEvent::TokenExpired);
        return;
    }

    if remaining <= REFRESH_THRESHOLD.as_secs() as i64 {
        tracing::info!("Token expires in {remaining}s — refreshing…");
        match try_refresh(state, &username, &token).await {
            Ok((new_token, new_exp)) => {
                let _update = state.auth_update.lock().await;
                if state
                    .auth_generation
                    .load(std::sync::atomic::Ordering::SeqCst)
                    != generation
                {
                    return;
                }
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
                    state.clear_auth().await;
                    let _ = state.event_tx.send(ServiceEvent::TokenExpired);
                }
            }
        }
    }
}

/// Attempt to refresh the token via the server connection.
async fn try_refresh(
    state: &AppState,
    username: &str,
    token: &str,
) -> Result<(SecretString, i64), String> {
    let mut conn = crate::connection::ensure_connected(
        state,
        crate::connection::DEFAULT_RECONNECT_ATTEMPTS,
        false,
    )
    .await?;

    let response = {
        let mut final_response = None;
        for attempt in 1..=crate::transfers::retry::MAX_BACKGROUND_RETRIES {
            match crate::rpc::send_action_request(
                &conn,
                "core.auth.token.refresh",
                serde_json::json!({}),
                username,
                token,
            )
            .await
            {
                Ok(response) if response.code == 200 => {
                    final_response = Some(response);
                    break;
                }
                Ok(response) if crate::transfers::retry::is_transient_response(&response) => {
                    if attempt == crate::transfers::retry::MAX_BACKGROUND_RETRIES {
                        return Err(format!(
                            "server returned {} after retry attempts",
                            response.code
                        ));
                    }
                    tokio::time::sleep(crate::transfers::retry::retry_delay(
                        attempt,
                        crate::transfers::retry::response_retry_after_seconds(&response),
                    ))
                    .await;
                }
                Ok(response) => return Err(format!("server returned {}", response.code)),
                Err(error) if crate::transfers::retry::is_transient_error(&error) => {
                    if attempt == crate::transfers::retry::MAX_BACKGROUND_RETRIES {
                        return Err(error.to_string());
                    }
                    tokio::time::sleep(crate::transfers::retry::retry_delay(
                        attempt,
                        crate::transfers::retry::error_retry_after_seconds(&error),
                    ))
                    .await;
                    conn = crate::connection::ensure_connected(
                        state,
                        crate::connection::DEFAULT_RECONNECT_ATTEMPTS,
                        true,
                    )
                    .await?;
                }
                Err(error) => return Err(error.to_string()),
            }
        }
        final_response.ok_or_else(|| "token refresh exhausted retry attempts".to_string())?
    };

    // Extract new token and expiry from response data.
    let mut data = response.data;
    let issued = crate::authentication::IssuedToken::from_response(
        &mut data,
        crate::authentication::GENERAL,
    )?;
    Ok((issued.secret, issued.claims.exp.floor() as i64))
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
