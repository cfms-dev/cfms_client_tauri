// DEK setup helpers
// ---------------------------------------------------------------------------

/// Send an action request over the connection and return the parsed response.
///
/// Creates a short-lived stream, sends the JSON payload, reads the response,
/// and closes the stream with a conclusion frame.
async fn send_action_request(
    conn: &cfms_transport::Connection,
    action: &str,
    data: serde_json::Value,
    username: &str,
    token: &str,
) -> Result<cfms_core::Response, String> {
    let random_bytes: [u8; 16] = rand::thread_rng().r#gen();
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

async fn remember_server_preference_dek(
    inner: &cfms_service::state::AppState,
    encrypted_dek: Option<String>,
) {
    let mut stored = inner.server_preference_dek.write().await;
    *stored = encrypted_dek;
}

fn is_transient_connection_error(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    lower.contains("connection closed")
        || lower.contains("connection failed")
        || lower.contains("failed to create stream")
        || lower.contains("failed to send")
        || lower.contains("send failed")
        || lower.contains("websocket")
        || lower.contains("tcp connect")
        || lower.contains("stream closed")
        || lower.contains("no response")
}

async fn decrypt_preference_dek(
    encrypted_dek: &str,
    password: &str,
) -> Result<zeroize::Zeroizing<[u8; constants::KEY_LEN]>, String> {
    let encrypted = encrypted_dek.to_owned();
    let password = password.to_owned();
    tokio::task::spawn_blocking(move || {
        dek::decrypt_dek(&encrypted, &password).map_err(|e| format!("DEK decryption failed: {e}"))
    })
    .await
    .map_err(|e| format!("DEK decryption task panicked: {e}"))?
}

async fn encrypt_preference_dek(
    dek_bytes: [u8; constants::KEY_LEN],
    password: &str,
) -> Result<String, String> {
    let password = password.to_owned();
    tokio::task::spawn_blocking(move || {
        dek::encrypt_dek(&dek_bytes, &password).map_err(|e| format!("DEK encryption failed: {e}"))
    })
    .await
    .map_err(|e| format!("DEK encryption task panicked: {e}"))?
}

async fn upload_and_select_preference_dek(
    conn: &cfms_transport::Connection,
    encrypted_dek: &str,
    username: &str,
    token: &str,
) -> Result<(), String> {
    let upload_resp = send_action_request(
        conn,
        "upload_user_key",
        serde_json::json!({"content": encrypted_dek, "label": "preference_dek"}),
        username,
        token,
    )
    .await?;

    if upload_resp.code != 200 {
        return Err(format!(
            "upload_user_key returned {}: {}",
            upload_resp.code, upload_resp.message
        ));
    }

    let key_id = upload_resp.data["id"]
        .as_str()
        .ok_or_else(|| "upload_user_key response missing id".to_string())?
        .to_string();

    let set_resp = send_action_request(
        conn,
        "set_user_preference_dek",
        serde_json::json!({"id": key_id}),
        username,
        token,
    )
    .await?;

    if set_resp.code != 200 {
        return Err(format!(
            "set_user_preference_dek returned {}: {}",
            set_resp.code, set_resp.message
        ));
    }

    Ok(())
}

async fn rewrap_and_upload_preference_dek(
    conn: &cfms_transport::Connection,
    dek_bytes: [u8; constants::KEY_LEN],
    password: &str,
    username: &str,
    token: &str,
) -> Result<String, String> {
    let encrypted = encrypt_preference_dek(dek_bytes, password).await?;
    upload_and_select_preference_dek(conn, &encrypted, username, token).await?;
    Ok(encrypted)
}

/// Set up the Data Encryption Key after a successful login.
///
/// Mirrors [`_setup_dek`] from the Python reference implementation:
///
/// 1. If the server returned a `preference_dek`, decrypt its `key_content`
///    with the password-derived KEK to recover the DEK.
/// 2. Otherwise, generate a new random DEK, encrypt it, upload it to the
///    server's keyring (`upload_user_key`), and register it as the
///    preference DEK (`set_user_preference_dek`).
///
/// Failures are logged but **not** propagated — DEK setup is best-effort;
/// the user can still log in without encrypted configuration support.
async fn setup_dek(
    inner: &cfms_service::state::AppState,
    login_data: &serde_json::Value,
    password: &str,
    username: &str,
    token: &str,
    conn: &cfms_transport::Connection,
) {
    if password.is_empty() {
        return;
    }

    let result: Result<(), String> = async {
        if let Some(preference_dek) = login_data.get("preference_dek") {
            // --- Server already has an encrypted DEK — decrypt it. ---
            let key_content = preference_dek["key_content"]
                .as_str()
                .ok_or_else(|| "preference_dek missing key_content".to_string())?;

            remember_server_preference_dek(inner, Some(key_content.to_string())).await;
            let decrypted = decrypt_preference_dek(key_content, password).await?;

            let mut d = inner.dek.write().await;
            *d = Some(decrypted);
        } else {
            remember_server_preference_dek(inner, None).await;

            // --- First login with keyring support — generate and upload. ---
            let new_dek = dek::generate_dek();
            let _encrypted = rewrap_and_upload_preference_dek(
                conn,
                *new_dek,
                password,
                username,
                token,
            )
            .await?;

            // Store the DEK in memory.
            let mut d = inner.dek.write().await;
            *d = Some(new_dek);
        }
        Ok(())
    }
    .await;

    if let Err(e) = result {
        // Non-fatal: encryption is best-effort; login still succeeds.
        tracing::warn!("DEK setup failed (config will not be encrypted this session): {e}");
    }
}
