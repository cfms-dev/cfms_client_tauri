//! Authenticated RPC transport shared by application workflows and background services.

use rand::RngExt;

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
    let random_bytes: [u8; 16] = rand::rng().random();
    let nonce = hex::encode(random_bytes);
    let request_bytes =
        crate::sensitive::encode_action_request(action, data, username, token, unix_now(), &nonce)
            .map_err(RpcError::Encode)?;
    let mut stream = conn.create_stream().await.map_err(RpcError::Open)?;
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
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
