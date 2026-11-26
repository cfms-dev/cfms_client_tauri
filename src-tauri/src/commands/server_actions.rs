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
    let expected_identity = cfms_service::rpc::SessionIdentity::capture(&state.inner).await?;
    let mut last_error = None;
    for attempt in 1..=cfms_service::connection::DEFAULT_RECONNECT_ATTEMPTS {
        let (conn, username, token) = get_connection_auth(state).await?;
        expected_identity.ensure_current(&state.inner).await?;
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

pub(super) async fn server_action_bool(
    state: &AppHandleState,
    action: &str,
    data: serde_json::Value,
) -> Result<bool, String> {
    server_action_json(state, action, data).await?;
    Ok(true)
}
