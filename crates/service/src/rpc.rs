//! Authenticated RPC transport shared by application workflows and background services.

use rand::RngExt;

/// Identifies one authenticated lifetime, including re-login to the same account.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionIdentity {
    pub server: String,
    pub username: String,
    pub generation: u64,
}

impl SessionIdentity {
    pub async fn capture(state: &crate::state::AppState) -> Result<Self, String> {
        let _auth = state.auth_update.lock().await;
        Ok(Self {
            server: state
                .server_address
                .read()
                .await
                .clone()
                .ok_or("No server address")?,
            username: state.username.read().await.clone().ok_or("Not logged in")?,
            generation: state
                .auth_generation
                .load(std::sync::atomic::Ordering::SeqCst),
        })
    }
    pub async fn ensure_current(&self, state: &crate::state::AppState) -> Result<(), String> {
        let guard = state.auth_update.lock().await;
        self.ensure_current_locked(state, &guard).await
    }
    pub async fn ensure_current_locked(
        &self,
        state: &crate::state::AppState,
        _guard: &tokio::sync::MutexGuard<'_, ()>,
    ) -> Result<(), String> {
        if state
            .auth_generation
            .load(std::sync::atomic::Ordering::SeqCst)
            == self.generation
            && state.server_address.read().await.as_deref() == Some(self.server.as_str())
            && state.username.read().await.as_deref() == Some(self.username.as_str())
        {
            Ok(())
        } else {
            Err("The active server or account changed".into())
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ActionFailure {
    pub status: Option<u16>,
    pub message: String,
    pub data: serde_json::Value,
    pub sent: bool,
}

impl std::fmt::Display for ActionFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(code) = self.status {
            write!(
                f,
                "Server returned {code}: {}\nCFMS_ERROR_DATA:{}",
                self.message, self.data
            )
        } else {
            write!(f, "{}", self.message)
        }
    }
}

impl ActionFailure {
    pub fn local(message: impl Into<String>) -> Self {
        Self {
            status: None,
            message: message.into(),
            data: serde_json::Value::Null,
            sent: false,
        }
    }
    pub fn retry_after(&self) -> Option<u64> {
        self.data
            .get("retry_after_seconds")
            .and_then(|v| v.as_u64())
    }
    pub fn transient(&self) -> bool {
        matches!(self.status, Some(429 | 503))
    }
}

/// One send only. A lost response to a mutation is never replayed here.
pub async fn action_once(
    state: &crate::state::AppState,
    identity: &SessionIdentity,
    action: &str,
    data: serde_json::Value,
) -> Result<serde_json::Value, ActionFailure> {
    action_once_guarded(state, identity, action, data, || async { Ok(()) }).await
}

/// Re-check admission after reconnect and stream creation, immediately before sending.
pub async fn action_once_guarded<F, Fut>(
    state: &crate::state::AppState,
    identity: &SessionIdentity,
    action: &str,
    data: serde_json::Value,
    check: F,
) -> Result<serde_json::Value, ActionFailure>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    use std::sync::atomic::{AtomicBool, Ordering};
    let sent = AtomicBool::new(false);
    let operation = async {
        identity
            .ensure_current(state)
            .await
            .map_err(ActionFailure::local)?;
        let (conn, username, token) = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            crate::session::get_connection_auth(state),
        )
        .await
        .map_err(|_| ActionFailure::local("Connection setup timed out"))?
        .map_err(ActionFailure::local)?;
        check().await.map_err(ActionFailure::local)?;
        identity
            .ensure_current(state)
            .await
            .map_err(ActionFailure::local)?;
        let before_send = || async {
            identity.ensure_current(state).await?;
            check().await?;
            sent.store(true, Ordering::SeqCst);
            Ok(())
        };
        let result = send_typed_action_request_guarded::<serde_json::Value, _, _>(
            &conn,
            action,
            data,
            &username,
            &token,
            before_send,
            Some(std::time::Duration::from_secs(30)),
        )
        .await;
        identity
            .ensure_current(state)
            .await
            .map_err(ActionFailure::local)?;
        let response = result.map_err(|error| ActionFailure {
            status: None,
            message: format!("{action}: {error:?}"),
            data: serde_json::Value::Null,
            sent: sent.load(Ordering::SeqCst),
        })?;
        if response.code != 200 {
            return Err(ActionFailure {
                status: Some(response.code),
                message: response.message,
                data: response.data,
                sent: true,
            });
        }
        Ok(response.data)
    };
    operation.await
}

/// The operation that failed, before an adapter chooses its error presentation.
#[derive(Debug)]
pub enum RpcError {
    Encode(serde_json::Error),
    Open(cfms_core::Error),
    Send(cfms_core::Error),
    Closed(Option<cfms_transport::ConnectionCloseInfo>),
    Decode(serde_json::Error),
}

/// Existing background-service interface; preserves structured transport errors.
pub async fn send_action_request(
    conn: &cfms_transport::Connection,
    action: &str,
    data: serde_json::Value,
    username: &str,
    token: &str,
) -> cfms_core::Result<cfms_core::Response> {
    send_typed_action_request(conn, action, data, username, token)
        .await
        .map_err(|error| match error {
            RpcError::Encode(error) => {
                cfms_core::Error::Other(format!("Failed to encode {action} request: {error}"))
            }
            RpcError::Open(error) | RpcError::Send(error) => error,
            RpcError::Closed(Some(close)) if close.code == 1013 => {
                cfms_core::Error::ConnectionRejected {
                    status: 503,
                    message: close.reason,
                    retry_after_seconds: None,
                }
            }
            RpcError::Closed(_) => {
                cfms_core::Error::Connection(format!("Connection closed before {action} response"))
            }
            RpcError::Decode(error) => {
                cfms_core::Error::Protocol(format!("Invalid {action} response: {error}"))
            }
        })
}

/// Encode credentials once, use a short-lived stream, and decode a typed envelope.
pub async fn send_typed_action_request<T: serde::de::DeserializeOwned>(
    conn: &cfms_transport::Connection,
    action: &str,
    data: serde_json::Value,
    username: &str,
    token: &str,
) -> Result<cfms_core::Response<T>, RpcError> {
    send_typed_action_request_guarded(
        conn,
        action,
        data,
        username,
        token,
        || async { Ok(()) },
        None,
    )
    .await
}

async fn send_typed_action_request_guarded<T, F, Fut>(
    conn: &cfms_transport::Connection,
    action: &str,
    data: serde_json::Value,
    username: &str,
    token: &str,
    check: F,
    limit: Option<std::time::Duration>,
) -> Result<cfms_core::Response<T>, RpcError>
where
    T: serde::de::DeserializeOwned,
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let mut stream = rpc_deadline(
        async { conn.create_stream().await.map_err(RpcError::Open) },
        limit,
        RpcError::Open,
    )
    .await?;
    check()
        .await
        .map_err(|message| RpcError::Open(cfms_core::Error::Other(message)))?;
    let random_bytes: [u8; 16] = rand::rng().random();
    let nonce = hex::encode(random_bytes);
    let request_bytes =
        crate::sensitive::encode_action_request(action, data, username, token, unix_now(), &nonce)
            .map_err(RpcError::Encode)?;
    let io = async {
        stream
            .send_sensitive(conn, request_bytes.into_zeroizing())
            .await
            .map_err(RpcError::Send)?;
        let response_bytes = stream
            .recv()
            .await
            .ok_or_else(|| RpcError::Closed(conn.close_info()))?;
        let response_bytes = zeroize::Zeroizing::new(response_bytes);
        serde_json::from_slice(&response_bytes).map_err(RpcError::Decode)
    };
    rpc_deadline(io, limit, RpcError::Send).await
}

async fn rpc_deadline<T>(
    future: impl std::future::Future<Output = Result<T, RpcError>>,
    limit: Option<std::time::Duration>,
    stage: fn(cfms_core::Error) -> RpcError,
) -> Result<T, RpcError> {
    match limit {
        Some(limit) => tokio::time::timeout(limit, future)
            .await
            .map_err(|_| stage(cfms_core::Error::Connection("RPC timed out".into())))?,
        None => future.await,
    }
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_rpc::Peer;
    use serde_json::json;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };

    #[tokio::test]
    async fn intentional_admission_pause_does_not_consume_the_network_timeout() {
        let peer = Peer::new(|_| Some((200, json!({"ok":true})))).await;
        let identity = SessionIdentity::capture(&peer.state).await.unwrap();
        let state = peer.state.clone();
        let entered = Arc::new(tokio::sync::Notify::new());
        let resume = Arc::new(tokio::sync::Notify::new());
        let first = Arc::new(AtomicBool::new(true));
        let signal = entered.clone();
        let gate = resume.clone();
        tokio::time::pause();
        let run = tokio::spawn(async move {
            action_once_guarded(&state, &identity, "test.action", json!({}), || {
                let first = first.swap(false, Ordering::SeqCst);
                let signal = signal.clone();
                let gate = gate.clone();
                async move {
                    if first {
                        signal.notify_one();
                        gate.notified().await;
                    }
                    Ok(())
                }
            })
            .await
        });
        entered.notified().await;
        tokio::time::advance(std::time::Duration::from_secs(31)).await;
        assert!(!run.is_finished());
        assert!(peer.requests.lock().unwrap().is_empty());
        tokio::time::resume();
        resume.notify_one();
        assert_eq!(
            tokio::time::timeout(std::time::Duration::from_secs(5), run)
                .await
                .unwrap()
                .unwrap()
                .unwrap()["ok"],
            true
        );
    }

    #[tokio::test]
    async fn timeout_after_sending_remains_an_unconfirmed_mutation() {
        let gate = Arc::new(tokio::sync::Notify::new());
        let peer = Peer::gated(|_| Some((200, json!({}))), gate).await;
        let identity = SessionIdentity::capture(&peer.state).await.unwrap();
        let state = peer.state.clone();
        let run =
            tokio::spawn(
                async move { action_once(&state, &identity, "test.write", json!({})).await },
            );
        tokio::time::timeout(std::time::Duration::from_secs(5), peer.received.notified())
            .await
            .unwrap();
        tokio::time::pause();
        tokio::time::advance(std::time::Duration::from_secs(31)).await;
        let error = run.await.unwrap().unwrap_err();
        assert!(error.sent);
        assert_eq!(
            crate::files::access_batches::classify_failure(&error, true).kind,
            "unconfirmed"
        );
    }
}
