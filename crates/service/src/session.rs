//! Frontend-safe session snapshots; tokens and key material stay native.

use crate::authentication::AUTH;

pub async fn build_auth_status(inner: &crate::state::AppState) -> serde_json::Value {
    let pending = inner.pending_auth.read().await.as_ref().map(|p| {
        (
            p.username.clone(),
            p.issued.claims.purpose,
            p.methods.clone(),
        )
    });
    let username = inner
        .username
        .read()
        .await
        .clone()
        .or_else(|| pending.as_ref().map(|p| p.0.clone()));
    let nickname = inner.nickname.read().await.clone();
    let has_token = inner.token.read().await.is_some();
    let token_exp = *inner.token_exp.read().await;
    let escalation_exp = inner
        .escalation
        .read()
        .await
        .as_ref()
        .filter(|issued| issued.claims.exp > crate::authentication::unix_now())
        .map(|issued| issued.claims.exp);
    let permissions = inner.permissions.read().await.clone();
    let groups = inner.groups.read().await.clone();
    let has_server_preference_dek = inner.server_preference_dek.read().await.is_some();
    let has_preference_dek = inner.dek.read().await.is_some();

    let mut status = serde_json::json!({
        "username": username,
        "user_id": inner.user_id.read().await.clone(),
        "nickname": nickname,
        "has_token": has_token,
        "token_exp": token_exp,
        "escalation_exp": escalation_exp,
        "permissions": permissions,
        "groups": groups,
        "avatar_path": inner.avatar_path.read().await.clone(),
        "has_server_preference_dek": has_server_preference_dek,
        "has_preference_dek": has_preference_dek,
    });

    if let Some(pending) = pending.as_ref().filter(|p| p.1 == AUTH) {
        status["requires_2fa"] = serde_json::Value::Bool(true);
        status["authentication_methods"] = serde_json::json!(pending.2);
    }

    status
}

pub async fn build_server_state(inner: &crate::state::AppState) -> serde_json::Value {
    let (security, connected) = {
        let connection = inner.conn.read().await;
        (
            connection
                .as_ref()
                .map(|conn| (conn.id(), conn.revocation_status())),
            connection.as_ref().is_some_and(|conn| !conn.is_closed()),
        )
    };
    let server_address = inner.server_address.read().await.clone();
    let server_name = inner.server_name.read().await.clone();
    let protocol_version = inner.server_protocol_version.read().await;
    let extension_flags = inner.server_extension_flags.read().await.clone();
    let lockdown = inner.app_lockdown.load(std::sync::atomic::Ordering::SeqCst);
    let lockdown_reason = inner.lockdown_reason.read().await.clone();

    serde_json::json!({
        "connected": connected,
        "connection_id": security.as_ref().map(|(id, _)| id),
        "revocation": security.map(|(_, status)| status),
        "server_address": server_address,
        "server_name": server_name,
        "protocol_version": *protocol_version,
        "lockdown": lockdown,
        "lockdown_reason": lockdown_reason,
        "extension_flags": extension_flags,
    })
}

/// Convenience helper: extract (connection, username, token) from app state.
pub async fn get_connection_auth(
    state: &crate::state::AppState,
) -> Result<
    (
        cfms_transport::Connection,
        String,
        crate::sensitive::SecretString,
    ),
    String,
> {
    let conn = crate::connection::ensure_connected(
        state,
        crate::connection::DEFAULT_RECONNECT_ATTEMPTS,
        false,
    )
    .await
    .map_err(|e| format!("Not connected to a server: {e}"))?;
    let username = state
        .username
        .read()
        .await
        .clone()
        .ok_or_else(|| "Not logged in".to_string())?;
    let token = state.request_token().await.ok_or("Not logged in")?;
    Ok((conn, username, token))
}

pub async fn close_primary_connection(state: &crate::state::AppState) {
    let conn = {
        let mut c = state.conn.write().await;
        c.take()
    };

    if let Some(conn) = conn {
        tokio::spawn(async move { conn.close().await });
    }
}

pub async fn clear_connection_state(state: &crate::state::AppState) {
    {
        let mut addr = state.server_address.write().await;
        *addr = None;
    }
    {
        let mut name = state.server_name.write().await;
        *name = None;
    }
    {
        let mut pv = state.server_protocol_version.write().await;
        *pv = None;
    }
    state.server_extension_flags.write().await.clear();
    state
        .app_lockdown
        .store(false, std::sync::atomic::Ordering::SeqCst);
    *state.lockdown_reason.write().await = None;
    {
        let mut ca = state.ca_dir.write().await;
        *ca = None;
    }
    {
        let mut force_ipv4 = state.force_ipv4.write().await;
        *force_ipv4 = false;
    }
    {
        let mut proxy = state.proxy_addr.write().await;
        *proxy = None;
    }
    {
        let mut cert = state.client_cert_path.write().await;
        *cert = None;
    }
    {
        let mut key = state.client_key_path.write().await;
        *key = None;
    }
}
