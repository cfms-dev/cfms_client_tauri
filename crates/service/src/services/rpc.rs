//! Small RPC helper shared by background services.

use rand::RngExt;

/// Send one action request over a short-lived client stream.
pub async fn send_action_request(
    conn: &cfms_transport::Connection,
    action: &str,
    data: serde_json::Value,
    username: &str,
    token: &str,
) -> cfms_core::Result<cfms_core::Response> {
    let random_bytes: [u8; 16] = rand::rng().random();
    let nonce = hex::encode(random_bytes);

    let request = serde_json::json!({
        "action": action,
        "data": data,
        "username": username,
        "token": token,
        "timestamp": unix_now(),
        "nonce": nonce,
    });

    let request_bytes = serde_json::to_vec(&request).map_err(|error| {
        cfms_core::Error::Other(format!("Failed to encode {action} request: {error}"))
    })?;

    let mut stream = conn.create_stream().await?;

    stream.send(conn, request_bytes).await?;

    let response_bytes = match stream.recv().await {
        Some(response) => response,
        None => {
            if let Some(close) = conn.close_info()
                && close.code == 1013
            {
                return Err(cfms_core::Error::ConnectionRejected {
                    status: 503,
                    message: close.reason,
                    retry_after_seconds: None,
                });
            }
            return Err(cfms_core::Error::Connection(format!(
                "Connection closed before {action} response"
            )));
        }
    };

    serde_json::from_slice::<cfms_core::Response>(&response_bytes)
        .map_err(|error| cfms_core::Error::Protocol(format!("Invalid {action} response: {error}")))
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
