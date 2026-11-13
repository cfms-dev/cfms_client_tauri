//! Authenticated request adapters: identity checks, reconnect policy and IPC errors.
use super::session::get_connection_auth;
use super::shared_helpers::{
    format_server_response_error, is_transient_connection_error, send_action_request,
};
use crate::AppHandleState;

/// Mutations are sent once, retaining an explicit unknown-outcome marker.
pub(super) async fn server_action_once(
    state: &AppHandleState,
    identity: &cfms_service::rpc::SessionIdentity,
    action: &str,
    data: serde_json::Value,
) -> Result<serde_json::Value, String> {
    cfms_service::rpc::action_once(&state.inner, identity, action, data)
        .await
        .map_err(|error| {
            if let Some(code) = error.status {
                super::shared_helpers::format_server_error_parts(code, &error.message, &error.data)
            } else if error.sent {
                format!("CFMS_REQUEST_UNCONFIRMED: {}", error.message)
            } else {
                error.message
            }
        })
}

pub(super) async fn server_action_json(
    state: &AppHandleState,
    action: &str,
    data: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let resp = server_action_response(state, action, data).await?;
    if resp.code != 200 {
        return Err(format_server_response_error(&resp));
    }

    Ok(resp.data)
}

/// Send an authenticated server action while preserving the complete response
/// envelope. Unlike `server_action_json`, non-200 responses are returned to the
/// caller so developer tooling can inspect the server's structured result.
pub(super) async fn server_action_response(
    state: &AppHandleState,
    action: &str,
    data: serde_json::Value,
) -> Result<cfms_core::Response, String> {
    let expected_identity = capture_server_action_identity(&state.inner).await?;
    let mut last_error = None;
    for attempt in 1..=cfms_service::connection::DEFAULT_RECONNECT_ATTEMPTS {
        let (conn, username, token) = get_connection_auth(state).await?;
        ensure_server_action_identity(&state.inner, &expected_identity, &username).await?;
        match send_action_request(&conn, action, data.clone(), &username, &token).await {
            Ok(resp) => return Ok(resp),
            Err(error) if is_transient_connection_error(&error) => {
                tracing::warn!(
                    "Request {action} failed on attempt {attempt}; reconnecting: {error}",
                );
                last_error = Some(error);
                cfms_service::connection::ensure_connected(
                    &state.inner,
                    cfms_service::connection::DEFAULT_RECONNECT_ATTEMPTS,
                    true,
                )
                .await?;
            }
            Err(error) => return Err(error),
        }
    }

    Err(last_error.unwrap_or_else(|| format!("{action} failed after reconnect attempts")))
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ServerActionIdentity {
    pub(super) server_address: Option<String>,
    pub(super) user_id: String,
}

async fn capture_server_action_identity(
    state: &cfms_service::state::AppState,
) -> Result<ServerActionIdentity, String> {
    let server_address = state.server_address.read().await.clone();
    let user_id = state
        .user_id
        .read()
        .await
        .clone()
        .ok_or_else(|| "Not logged in".to_string())?;
    Ok(ServerActionIdentity {
        server_address,
        user_id,
    })
}

async fn ensure_server_action_identity(
    state: &cfms_service::state::AppState,
    expected: &ServerActionIdentity,
    _username: &str,
) -> Result<(), String> {
    let current = ServerActionIdentity {
        server_address: state.server_address.read().await.clone(),
        user_id: state.user_id.read().await.clone().ok_or("Not logged in")?,
    };
    validate_server_action_identity(expected, &current)
}

pub(super) fn validate_server_action_identity(
    expected: &ServerActionIdentity,
    current: &ServerActionIdentity,
) -> Result<(), String> {
    if current == expected {
        return Ok(());
    }
    Err("Request cancelled because the active server or account changed".to_string())
}

pub(super) async fn server_action_bool(
    state: &AppHandleState,
    action: &str,
    data: serde_json::Value,
) -> Result<bool, String> {
    server_action_json(state, action, data).await?;
    Ok(true)
}
