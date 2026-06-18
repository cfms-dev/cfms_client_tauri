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
    send_typed_action_request(conn, action, data, username, token).await
}

async fn send_typed_action_request<T>(
    conn: &cfms_transport::Connection,
    action: &str,
    data: serde_json::Value,
    username: &str,
    token: &str,
) -> Result<cfms_core::Response<T>, String>
where
    T: serde::de::DeserializeOwned,
{
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

    serde_json::from_slice::<cfms_core::Response<T>>(&response_bytes)
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DekSetupStatus {
    Ready,
    ResetRequired,
    RecoveryRequired,
}

fn extract_preference_dek_content(login_data: &serde_json::Value) -> Result<Option<&str>, String> {
    match login_data.get("preference_dek") {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(preference_dek) => preference_dek
            .get("key_content")
            .and_then(|key_content| key_content.as_str())
            .filter(|key_content| !key_content.trim().is_empty())
            .map(Some)
            .ok_or_else(|| "preference_dek missing key_content".to_string()),
    }
}

async fn install_fresh_preference_dek(
    inner: &cfms_service::state::AppState,
    password: &str,
    username: &str,
    token: &str,
    conn: &cfms_transport::Connection,
) -> Result<(), String> {
    let new_dek = dek::generate_dek();
    let encrypted =
        rewrap_and_upload_preference_dek(conn, *new_dek, password, username, token).await?;

    {
        let mut d = inner.dek.write().await;
        *d = Some(new_dek);
    }
    remember_server_preference_dek(inner, Some(encrypted)).await;

    Ok(())
}

/// Set up the Data Encryption Key after a successful login.
///
/// Mirrors [`_setup_dek`] from the Python reference implementation:
///
/// 1. If the server returned a `preference_dek`, decrypt its `key_content`
///    with the password-derived KEK to recover the DEK.
/// 2. Otherwise, report that the loading flow should generate and upload a
///    fresh DEK during its encryption setup phase.
///
/// If the server-side DEK is missing or unusable while local encrypted state
/// exists, the session is allowed to continue only so the frontend can ask the
/// user to recover or discard that local state.
async fn setup_dek(
    inner: &cfms_service::state::AppState,
    encrypted_dek: Option<String>,
    password: &str,
) -> Result<DekSetupStatus, String> {
    if password.is_empty() {
        return Err("Cannot set up preference encryption without a password".to_string());
    }

    {
        let mut d = inner.dek.write().await;
        *d = None;
    }

    if let Some(encrypted_dek) = encrypted_dek {
        remember_server_preference_dek(inner, Some(encrypted_dek.clone())).await;
        let decrypted = decrypt_preference_dek(&encrypted_dek, password).await?;

        let mut d = inner.dek.write().await;
        *d = Some(decrypted);
        return Ok(DekSetupStatus::Ready);
    }

    remember_server_preference_dek(inner, None).await;
    Ok(DekSetupStatus::ResetRequired)
}

async fn setup_preference_dek_for_loading(
    inner: &cfms_service::state::AppState,
    password: &str,
    username: &str,
    token: &str,
    conn: &cfms_transport::Connection,
    has_local_encrypted_state: bool,
) -> Result<DekSetupStatus, String> {
    let server_dek = inner.server_preference_dek.read().await.clone();
    if has_local_encrypted_state && server_dek.is_none() {
        {
            let mut d = inner.dek.write().await;
            *d = None;
        }
        tracing::warn!(
            "Preference DEK is missing on the server while encrypted local state exists"
        );
        return Ok(DekSetupStatus::RecoveryRequired);
    }

    match setup_dek(inner, server_dek, password).await {
        Ok(DekSetupStatus::Ready) => Ok(DekSetupStatus::Ready),
        Ok(DekSetupStatus::ResetRequired) => {
            install_fresh_preference_dek(inner, password, username, token, conn).await?;
            Ok(DekSetupStatus::Ready)
        }
        Ok(DekSetupStatus::RecoveryRequired) => Ok(DekSetupStatus::RecoveryRequired),
        Err(error) => {
            if has_local_encrypted_state {
                tracing::warn!(
                    "Preference DEK setup needs user recovery before encrypted local state can be used: {error}"
                );
                return Ok(DekSetupStatus::RecoveryRequired);
            }

            tracing::warn!(
                "Preference DEK setup failed with no local encrypted state; replacing server DEK during loading: {error}"
            );
            install_fresh_preference_dek(inner, password, username, token, conn).await?;
            Ok(DekSetupStatus::Ready)
        }
    }
}

async fn ensure_preference_dek(
    inner: &cfms_service::state::AppState,
    password: &str,
    username: &str,
    token: &str,
    conn: &cfms_transport::Connection,
) -> Result<(), String> {
    if inner.dek.read().await.is_some() {
        return Ok(());
    }

    if password.is_empty() {
        return Err("Cannot create a preference DEK without the current password".to_string());
    }

    install_fresh_preference_dek(inner, password, username, token, conn).await
}
