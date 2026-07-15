//! Small RPC helper shared by background services.

use rand::RngExt;

/// Send one action request over a short-lived client stream.
pub async fn send_action_request(
    conn: &cfms_transport::Connection,
    action: &str,
    data: serde_json::Value,
    username: &str,
    token: &str,
) -> Result<cfms_core::Response, String> {
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

    let request_bytes = serde_json::to_vec(&request)
        .map_err(|e| format!("Failed to encode {action} request: {e}"))?;

    let mut stream = conn
        .create_stream()
        .await
        .map_err(|e| format!("Failed to create stream for {action}: {e}"))?;

    stream
        .send(conn, request_bytes)
        .await
        .map_err(|e| format!("Failed to send {action} request: {e}"))?;

    let response_bytes = stream
        .recv()
        .await
        .ok_or_else(|| format!("Connection closed before {action} response"))?;

    serde_json::from_slice::<cfms_core::Response>(&response_bytes)
        .map_err(|e| format!("Invalid {action} response: {e}"))
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
