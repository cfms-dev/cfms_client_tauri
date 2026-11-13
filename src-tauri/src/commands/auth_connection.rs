use super::connection_config::ConnectionSettingsDto;
use super::connection_config::remember_successful_connection;
#[cfg(target_os = "android")]
use super::mobile::exit_app_after_launcher_transition;
use super::preference_keys::cache_current_preference_key;
use super::session::clear_auth_state;
use super::session::clear_connection_state;
use super::session::close_primary_connection;
use super::session::get_connection_auth;
use super::settings::ensure_writable_ca_dir;
use super::shared_helpers::decrypt_preference_dek;
use super::shared_helpers::extract_preference_dek_content;
use super::shared_helpers::format_server_error_parts;
use super::shared_helpers::format_server_response_error;
use super::shared_helpers::format_transport_error;
use super::shared_helpers::remember_server_preference_dek;
use super::shared_helpers::rewrap_and_upload_preference_dek;
use super::shared_helpers::send_action_request;
use super::shared_helpers::upload_and_select_preference_dek;
use super::transfer_helpers::unix_now;
use crate::AppHandleState;
use crate::UploadInterruption;
use cfms_core::ServerInfo;
use cfms_service::authentication::ESCALATED;
use cfms_service::authentication::GENERAL;
use cfms_service::authentication::IssuedToken;
use cfms_service::authentication::POST_AUTH;
use cfms_service::session::build_auth_status;
use cfms_service::session::build_server_state;
use rand::RngExt;
use tauri::Manager;
use tauri::Runtime;

pub(super) async fn apply_successful_login_response(
    state: &AppHandleState,
    username: &str,
    data: &mut serde_json::Value,
    clear_dek: bool,
    clear_tasks: bool,
) -> Result<(), String> {
    if clear_tasks {
        state
            .active_uploads
            .interrupt_all(UploadInterruption::Cancelled);
    }
    let issued = IssuedToken::from_response(data, GENERAL)?;
    let exp = issued.claims.exp.floor() as i64;
    *state.inner.user_id.write().await = Some(issued.claims.sub.clone());
    let token = issued.secret;

    {
        let mut u = state.inner.username.write().await;
        *u = Some(username.to_string());
    }
    {
        let mut t = state.inner.token.write().await;
        *t = Some(token);
    }
    {
        let mut e = state.inner.token_exp.write().await;
        *e = Some(exp);
    }
    {
        let nickname = data["nickname"].as_str().unwrap_or(username).to_string();
        let mut n = state.inner.nickname.write().await;
        *n = Some(nickname);
    }
    {
        let perms: Vec<String> = data["permissions"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        let mut p = state.inner.permissions.write().await;
        *p = perms;
    }
    {
        let grps: Vec<String> = data["groups"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        let mut g = state.inner.groups.write().await;
        *g = grps;
    }
    state.inner.pending_auth.write().await.take();
    state.inner.escalation.write().await.take();

    if clear_dek {
        let mut d = state.inner.dek.write().await;
        *d = None;
    }

    let server_preference_dek = match extract_preference_dek_content(data) {
        Ok(content) => content.map(ToOwned::to_owned),
        Err(error) => {
            tracing::warn!("Login response contained an unusable preference DEK: {error}");
            None
        }
    };
    remember_server_preference_dek(&state.inner, server_preference_dek).await;
    if clear_tasks {
        state.tasks.clear();
        state.upload_tasks.clear();
    }

    Ok(())
}

/// Change a password using an elevated session, or restricted POST_AUTH.
#[tauri::command]
pub async fn change_password(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    new_password: String,
) -> Result<(), String> {
    let new_password = zeroize::Zeroizing::new(new_password);
    let conn = state
        .inner
        .conn
        .read()
        .await
        .clone()
        .ok_or_else(|| "Not connected to a server".to_string())?;
    let post_auth = state
        .inner
        .pending_auth
        .read()
        .await
        .as_ref()
        .filter(|p| p.username == username && p.issued.claims.purpose == POST_AUTH)
        .map(|p| p.issued.secret.clone());
    if let Some(token) = post_auth {
        let response = send_action_request(
            &conn,
            "core.user.password.set",
            serde_json::json!({"new_passwd":new_password.as_str()}),
            &username,
            &token,
        )
        .await?;
        if response.code != 200 {
            return Err(format_server_response_error(&response));
        }
        clear_auth_state(&state).await;
        return Ok(());
    }

    let (conn, auth_username, token) = get_connection_auth(&state).await?;
    if auth_username != username {
        return Err("Password change account does not match the session".into());
    }
    let claims = cfms_service::authentication::decode_claims(&token)?;
    if claims.purpose != ESCALATED || claims.exp <= cfms_service::authentication::unix_now() {
        return Err(format_server_error_parts(
            403,
            "Authentication elevation required",
            &serde_json::json!({}),
        ));
    }
    let original_envelope = state.inner.server_preference_dek.read().await.clone();
    let server_key = if state
        .inner
        .preference_dek_local_only
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        None
    } else {
        state.inner.dek.read().await.clone()
    };
    change_password_and_rewrap_preferences(
        &conn,
        &auth_username,
        &token,
        &new_password,
        server_key,
        original_envelope,
    )
    .await?;
    clear_auth_state(&state).await;
    Ok(())
}

/// Prepare recovery data before key rotation; restore the original ciphertext on a definite rejection.
async fn change_password_and_rewrap_preferences(
    conn: &cfms_transport::Connection,
    username: &str,
    token: &str,
    new_password: &str,
    server_key: Option<cfms_service::sensitive::SecretKey>,
    original_envelope: Option<String>,
) -> Result<(), String> {
    let prepared = if let (Some(key), Some(_)) = (server_key, original_envelope.as_ref()) {
        rewrap_and_upload_preference_dek(conn, key, new_password, username, token).await?;
        true
    } else {
        false
    };
    let response = send_action_request(
        conn,
        "core.user.password.set",
        serde_json::json!({"new_passwd":new_password}),
        username,
        token,
    )
    .await?;
    if response.code != 200 {
        if prepared
            && let Err(error) = upload_and_select_preference_dek(
                conn,
                original_envelope.as_deref().unwrap(),
                username,
                token,
            )
            .await
        {
            return Err(format_server_error_parts(
                response.code,
                &format!(
                    "{}; additionally failed to restore the previous preference DEK: {error}",
                    response.message,
                ),
                &response.data,
            ));
        }
        return Err(format_server_response_error(&response));
    }
    Ok(())
}

#[cfg(test)]
mod password_change_protocol_tests {
    use super::*;
    use cfms_transport::frame::{self, FrameHeader, FrameKind};
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    #[tokio::test]
    async fn handshake_uses_protocol_thirty_action_without_authentication() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut websocket = tokio_tungstenite::accept_async(socket).await.unwrap();
            let bytes = websocket.next().await.unwrap().unwrap().into_data();
            let (header, payload) = frame::decode(&bytes).unwrap();
            let request: serde_json::Value = serde_json::from_slice(payload).unwrap();
            assert_eq!(request["action"], "core.server.info.get");
            assert_eq!(request["data"], serde_json::json!({}));
            assert!(request["username"].is_null());
            assert!(request["token"].is_null());
            websocket.send(Message::Binary(frame::encode(&FrameHeader {
                id: header.id, kind: FrameKind::Conclusion,
            }, &serde_json::to_vec(&serde_json::json!({
                "code":200, "message":"", "timestamp":0.0,
                "data":{"server_name":"protocol-30", "protocol_version":30, "lockdown":false, "lockdown_reason":null, "extension_flags":[]},
            })).unwrap()).into())).await.unwrap();
        });
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let tls = cfms_transport::tls::TlsConfig::plaintext();
        let connection =
            cfms_transport::Connection::connect(&format!("ws://{address}"), tls, None, true)
                .await
                .unwrap();
        let info = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            request_server_info(&connection),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(info.protocol_version, 30);
        server.await.unwrap();
        connection.close().await;
    }

    async fn check_change(unlocked: bool, code: u16) {
        let key = cfms_crypto::generate_dek();
        let original = cfms_crypto::dek::encrypt_dek(&key, "historical-password").unwrap();
        let expected_original = original.clone();
        let expected_key = key.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server =
            tokio::spawn(async move {
                let (socket, _) = listener.accept().await.unwrap();
                let mut websocket = tokio_tungstenite::accept_async(socket).await.unwrap();
                let mut expected = Vec::new();
                if unlocked {
                    expected.extend(["core.user.key.upload", "core.user.preferred_dek.set"]);
                }
                expected.push("core.user.password.set");
                if unlocked && code != 200 {
                    expected.extend(["core.user.key.upload", "core.user.preferred_dek.set"]);
                }
                for (index, action) in expected.iter().enumerate() {
                    let bytes = websocket.next().await.unwrap().unwrap().into_data();
                    let (header, payload) = frame::decode(&bytes).unwrap();
                    assert_eq!(header.kind, FrameKind::Process);
                    let request: serde_json::Value = serde_json::from_slice(payload).unwrap();
                    assert_eq!(request["action"], *action);
                    assert_eq!(request["username"], "alice");
                    assert_eq!(request["token"], "native-only-token");
                    assert!(request["nonce"].is_string());
                    assert!(request["timestamp"].is_number());
                    let mut data = serde_json::json!({});
                    let response_code = if *action == "core.user.password.set" {
                        assert_eq!(
                            request["data"],
                            serde_json::json!({"new_passwd":"new-password"})
                        );
                        data = serde_json::json!({"reason":"password_policy"});
                        code
                    } else {
                        if *action == "core.user.key.upload" {
                            let content = request["data"]["content"].as_str().unwrap();
                            if index == 0 {
                                let content = content.to_owned();
                                let decoded = tokio::task::spawn_blocking(move || {
                                    cfms_crypto::dek::decrypt_dek(&content, "new-password")
                                })
                                .await
                                .unwrap()
                                .unwrap();
                                assert_eq!(*decoded, *expected_key);
                            } else {
                                assert_eq!(content, expected_original);
                            }
                            data = serde_json::json!({"id":"prepared-key"});
                        } else {
                            assert_eq!(request["data"], serde_json::json!({"id":"prepared-key"}));
                        }
                        200
                    };
                    websocket.send(Message::Binary(frame::encode(&FrameHeader {
                    id: header.id, kind: FrameKind::Conclusion,
                }, &serde_json::to_vec(&serde_json::json!({
                    "code":response_code, "data":data, "message":"", "timestamp":0.0,
                })).unwrap()).into())).await.unwrap();
                }
            });
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let tls = cfms_transport::tls::TlsConfig::plaintext();
        let connection =
            cfms_transport::Connection::connect(&format!("ws://{address}"), tls, None, true)
                .await
                .unwrap();
        // A round trip performs the production one-million-iteration KDF twice.
        // Debug builds need a CPU budget independent of the transport timeout.
        const PASSWORD_REWRAP_TEST_BUDGET: std::time::Duration = std::time::Duration::from_secs(60);
        let result = tokio::time::timeout(
            PASSWORD_REWRAP_TEST_BUDGET,
            change_password_and_rewrap_preferences(
                &connection,
                "alice",
                "native-only-token",
                "new-password",
                unlocked.then_some(key),
                Some(original),
            ),
        )
        .await
        .unwrap();
        if code == 200 {
            assert!(result.is_ok(), "{result:?}");
        } else {
            let error = result.unwrap_err();
            assert!(error.starts_with(&format!("Server returned {code}:")));
            assert!(error.contains("CFMS_ERROR_DATA:{\"reason\":\"password_policy\"}"));
        }
        server.await.unwrap();
        connection.close().await;
    }

    #[tokio::test]
    async fn elevated_password_change_rewraps_an_unlocked_preference_key() {
        check_change(true, 200).await;
    }

    #[tokio::test]
    async fn rejected_password_change_restores_the_original_ciphertext() {
        check_change(true, 400).await;
    }

    #[tokio::test]
    async fn locked_preference_keys_are_preserved_without_blocking_password_changes() {
        check_change(false, 200).await;
    }

    #[tokio::test]
    async fn permission_rejections_preserve_their_status_without_reauthentication() {
        check_change(false, 403).await;
    }
}

async fn request_server_info(conn: &cfms_transport::Connection) -> Result<ServerInfo, String> {
    let random_bytes: [u8; 16] = rand::rng().random();
    let nonce = hex::encode(random_bytes);

    let request = serde_json::json!({
        "action": "core.server.info.get",
        "data": {},
        "username": null,
        "token": null,
        "timestamp": unix_now(),
        "nonce": nonce,
    });

    let request_bytes = serde_json::to_vec(&request)
        .map_err(|e| format!("Failed to encode server_info request: {e}"))?;

    let mut stream = conn
        .create_stream()
        .await
        .map_err(|e| format!("Failed to create stream for server_info: {e}"))?;

    stream
        .send(conn, request_bytes)
        .await
        .map_err(|e| format!("Failed to send server_info request: {e}"))?;

    let response_bytes = match stream.recv().await {
        Some(response) => response,
        None => {
            if let Some(close) = conn.close_info()
                && close.code == 1013
            {
                return Err(format_server_error_parts(
                    503,
                    &close.reason,
                    &serde_json::json!({ "close_code": close.code }),
                ));
            }
            return Err("Connection closed before server_info response".to_string());
        }
    };

    let response: cfms_core::Response = serde_json::from_slice(&response_bytes)
        .map_err(|e| format!("Invalid server_info response: {e}"))?;

    if response.code != 200 {
        return Err(format_server_response_error(&response));
    }

    serde_json::from_value(response.data).map_err(|e| format!("Invalid server_info data: {e}"))
}

/// Recover a server-returned preference DEK with a previous password, then
/// rewrap it with the current login password and upload it back to the server.
#[tauri::command]
pub async fn recover_preference_dek<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    recovery_password: String,
    current_password: String,
) -> Result<(), String> {
    let recovery_password = zeroize::Zeroizing::new(recovery_password);
    let current_password = zeroize::Zeroizing::new(current_password);

    if recovery_password.is_empty() {
        return Err("Recovery password is required".to_string());
    }
    if current_password.is_empty() {
        return Err("Current password is required".to_string());
    }

    let encrypted_dek = state
        .inner
        .server_preference_dek
        .read()
        .await
        .clone()
        .ok_or_else(|| "No encrypted preference DEK was returned by the server".to_string())?;

    let recovered_dek = decrypt_preference_dek(&encrypted_dek, &recovery_password)
        .await
        .map_err(|_| "Failed to decrypt preference DEK with the supplied password".to_string())?;

    let (conn, username, token) = get_connection_auth(&state).await?;
    let encrypted_for_current_password = rewrap_and_upload_preference_dek(
        &conn,
        recovered_dek.clone(),
        &current_password,
        &username,
        &token,
    )
    .await?;

    {
        let mut dek = state.inner.dek.write().await;
        *dek = Some(recovered_dek);
    }
    remember_server_preference_dek(&state.inner, Some(encrypted_for_current_password)).await;
    state
        .inner
        .preference_dek_local_only
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let _ = cache_current_preference_key(&app, &state).await;

    Ok(())
}

/// Log out and clear all authentication state.
#[tauri::command]
pub async fn logout(state: tauri::State<'_, AppHandleState>) -> Result<(), String> {
    clear_auth_state(&state).await;

    // Close the connection if one is open.
    {
        let mut conn = state.inner.conn.write().await;
        if let Some(c) = conn.take() {
            // Spawn so we don't block the command on close handshake.
            tokio::spawn(async move { c.close().await });
        }
    }

    Ok(())
}

/// Clear authentication state while preserving the current server connection.
#[tauri::command]
pub async fn clear_auth_session(state: tauri::State<'_, AppHandleState>) -> Result<(), String> {
    clear_auth_state(&state).await;
    Ok(())
}

/// Request process termination from the native side.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn quit_application<R: Runtime>(app_handle: tauri::AppHandle<R>) -> Result<(), String> {
    exit_app_after_launcher_transition(app_handle).await
}

/// Request process termination from the native side.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn quit_application(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

/// Establish a WSS connection to the CFMS server and perform the initial
/// `server_info` handshake.
///
/// Uses the TLS configuration from [`cfms_transport::tls::build_config`]
/// with the local CA certificate store.  When `disable_ssl_enforcement`
/// is `true`, certificate verification is skipped (insecure).
///
/// # Post-connect handshake
///
/// After the WebSocket is established this command immediately sends a
/// `server_info` request to:
///
/// 1. Validate protocol-version compatibility between client and server.
/// 2. Surface the server's display name and lockdown status.
///
/// If the server's protocol version is higher than the client's supported range the
/// connection is torn down and an error is returned — the frontend
/// should direct the user to update the client.
///
/// If the server's protocol version is lower than the supported range the connection is also
/// closed — the server is too old and the client cannot downgrade.
///
/// # Returns
///
/// [`ServerInfo`] on success, including the server's advertised extension flags.
///
/// # Reference
///
/// Mirrors `ConnectFormController.action_connect` in
/// `reference/src/include/controllers/connect.py`.
const CONNECT_CANCELLED_ERROR: &str = "connection_cancelled";

async fn wait_for_connect_cancellation(cancel_rx: &mut tokio::sync::watch::Receiver<bool>) {
    if *cancel_rx.borrow() {
        return;
    }
    let _ = cancel_rx.changed().await;
}

#[tauri::command]
pub async fn connect(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    url: String,
    disable_ssl_enforcement: bool,
) -> Result<serde_json::Value, String> {
    let (attempt_id, mut cancel_rx) = state.connect_attempts.register();

    if let Ok(directory) = app_handle.path().app_cache_dir() {
        state
            .inner
            .crl_service
            .set_cache_directory(directory.join("crl"))
            .await;
    }
    state
        .inner
        .crl_service
        .set_allowed_hosts(&ConnectionSettingsDto::load(&state.settings).crl_allowed_hosts)?;

    clear_auth_state(&state).await;
    close_primary_connection(&state).await;
    clear_connection_state(&state).await;

    // Use a writable CA directory under AppData. On Android, bundled
    // resources live inside the APK and cannot be enumerated through
    // std::fs; ensure_writable_ca_dir seeds AppData from compile-time
    // bundled certificates on first use.
    let setup_result: Result<_, String> = (|| {
        let ca_dir = ensure_writable_ca_dir(&app_handle)?;
        let connection_settings = ConnectionSettingsDto::load(&state.settings);
        let proxy_addr = connection_settings.proxy_addr()?;
        let (client_cert_path, client_key_path) = connection_settings.client_identity_paths();
        let effective_disable_ssl = disable_ssl_enforcement || is_loopback_wss_url(&url);
        let tls_config = cfms_transport::tls::build_config_with_identity(
            &ca_dir,
            effective_disable_ssl,
            client_cert_path.as_deref(),
            client_key_path.as_deref(),
            std::sync::Arc::clone(&state.inner.crl_service),
        )
        .map_err(|e| format!("TLS config error: {e}"))?;

        Ok((
            ca_dir,
            connection_settings,
            proxy_addr,
            client_cert_path,
            client_key_path,
            effective_disable_ssl,
            tls_config,
        ))
    })();
    let (
        ca_dir,
        connection_settings,
        proxy_addr,
        client_cert_path,
        client_key_path,
        effective_disable_ssl,
        tls_config,
    ) = match setup_result {
        Ok(setup) => setup,
        Err(error) => {
            state.connect_attempts.unregister(attempt_id);
            return Err(error);
        }
    };

    tracing::info!(
        "Connecting (disable_ssl_enforcement={disable_ssl_enforcement}, effective_disable_ssl={effective_disable_ssl}, proxy_configured={}, force_ipv4={})",
        proxy_addr.is_some(),
        connection_settings.force_ipv4,
    );

    // Establish connection.
    let connect_result = tokio::select! {
        biased;
        _ = wait_for_connect_cancellation(&mut cancel_rx) => {
            Err(CONNECT_CANCELLED_ERROR.to_string())
        }
        result = cfms_transport::Connection::connect(
            &url,
            tls_config,
            proxy_addr.as_deref(),
            connection_settings.force_ipv4,
        ) => result.map_err(|error| format_transport_error(&error)),
    };
    let conn = match connect_result {
        Ok(conn) => conn,
        Err(error) => {
            state.connect_attempts.unregister(attempt_id);
            return Err(error);
        }
    };

    // --- Post-connect handshake: request server_info ---
    //
    // This request is sent *without* authentication (username / token are
    // empty) because we haven't logged in yet — exactly matching the Python
    // reference which passes `username=None, token=None` in `_request()`.
    let server_info_result = tokio::select! {
         biased;
         _ = wait_for_connect_cancellation(&mut cancel_rx) => {
             Err(CONNECT_CANCELLED_ERROR.to_string())
         }
         result = request_server_info(&conn) => result,
    };
    let server_info: ServerInfo = match server_info_result {
        Ok(server_info) => server_info,
        Err(error) => {
            state.connect_attempts.unregister(attempt_id);
            tokio::spawn(async move { conn.close().await });
            return Err(error);
        }
    };

    // --- Protocol version compatibility check ---
    //
    // Mirrors the Python reference's protocol-version gate in
    // `ConnectFormController.action_connect`.
    let min_supported_protocol = cfms_core::constants::MIN_SUPPORTED_PROTOCOL_VERSION;
    let max_supported_protocol = cfms_core::constants::MAX_SUPPORTED_PROTOCOL_VERSION;

    if !cfms_core::constants::is_supported_protocol_version(server_info.protocol_version) {
        // Tear down — cannot communicate with this server.
        state.connect_attempts.unregister(attempt_id);
        conn.close().await;

        if server_info.protocol_version > max_supported_protocol {
            return Err(format!(
                "server_update_required:{}:{}",
                server_info.protocol_version, max_supported_protocol
            ));
        } else {
            return Err(format!(
                "server_too_old:{}:{}",
                server_info.protocol_version, min_supported_protocol
            ));
        }
    }

    // Atomically win against cancellation before publishing the connection.
    // A superseded or cancelled attempt must never update shared state.
    if !state.connect_attempts.claim_completion(attempt_id) {
        tokio::spawn(async move { conn.close().await });
        return Err(CONNECT_CANCELLED_ERROR.to_string());
    }

    // --- Store connection state ---
    cfms_service::connection::watch_security(&state.inner, &conn);
    {
        let mut c = state.inner.conn.write().await;
        *c = Some(conn);
    }
    {
        let mut addr = state.inner.server_address.write().await;
        *addr = Some(url.clone());
    }
    {
        let mut name = state.inner.server_name.write().await;
        *name = Some(server_info.server_name.clone());
    }
    {
        let mut pv = state.inner.server_protocol_version.write().await;
        *pv = Some(server_info.protocol_version);
    }
    {
        let mut flags = state.inner.server_extension_flags.write().await;
        *flags = server_info.extension_flags.clone();
    }
    // Apply initial lockdown status from server_info.
    // The server_push background service will also fire Lockdown events
    // for dynamic changes, but this covers the static case during connect.
    {
        let mut dse = state.inner.disable_ssl_enforcement.write().await;
        *dse = effective_disable_ssl;
    }
    {
        let mut force_ipv4 = state.inner.force_ipv4.write().await;
        *force_ipv4 = connection_settings.force_ipv4;
    }
    {
        let mut proxy = state.inner.proxy_addr.write().await;
        *proxy = proxy_addr;
    }
    {
        let mut cert = state.inner.client_cert_path.write().await;
        *cert = client_cert_path;
    }
    {
        let mut key = state.inner.client_key_path.write().await;
        *key = client_key_path;
    }
    // Store the CA directory path so that dedicated transfer connections
    // can rebuild their TLS config on demand.
    {
        let mut ca = state.inner.ca_dir.write().await;
        *ca = Some(ca_dir);
    }
    state
        .inner
        .app_lockdown
        .store(server_info.lockdown, std::sync::atomic::Ordering::SeqCst);
    *state.inner.lockdown_reason.write().await = server_info.lockdown_reason.clone();
    if let Err(error) = remember_successful_connection(&state.settings, &url) {
        tracing::warn!("Failed to remember server address: {error}");
    }

    tracing::info!(
        "Connected — protocol={}, lockdown={}",
        server_info.protocol_version,
        server_info.lockdown,
    );

    Ok(serde_json::json!({
        "server_name": server_info.server_name,
        "protocol_version": server_info.protocol_version,
        "lockdown": server_info.lockdown,
        "lockdown_reason": server_info.lockdown_reason,
        "extension_flags": server_info.extension_flags,
    }))
}

/// Cancel the connection attempt currently waiting on transport or handshake.
#[tauri::command]
pub fn cancel_connect(state: tauri::State<'_, AppHandleState>) -> bool {
    let cancelled = state.connect_attempts.cancel();
    if cancelled {
        tracing::info!("Connection attempt cancellation requested");
    }
    cancelled
}

fn is_loopback_wss_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "wss" {
        return false;
    }

    match parsed.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

#[cfg(test)]
mod loopback_url_tests {
    use super::is_loopback_wss_url;

    #[test]
    fn recognizes_ipv4_ipv6_and_named_loopback_urls() {
        assert!(is_loopback_wss_url("wss://localhost:5104"));
        assert!(is_loopback_wss_url("wss://127.0.0.2:5104"));
        assert!(is_loopback_wss_url("wss://[::1]:5104"));
    }

    #[test]
    fn rejects_non_loopback_or_non_wss_urls() {
        assert!(!is_loopback_wss_url("wss://192.0.2.1:5104"));
        assert!(!is_loopback_wss_url("ws://127.0.0.1:5104"));
        assert!(!is_loopback_wss_url("not a URL"));
    }
}

/// Close the WSS connection and clear all server/auth metadata.
///
/// Resets the connection, address, server name, protocol version, and
/// lockdown flag so the frontend reflects a clean disconnected state. Auth
/// state is also cleared so credentials never outlive the server session they
/// came from.
#[tauri::command]
pub async fn disconnect(state: tauri::State<'_, AppHandleState>) -> Result<(), String> {
    state.connect_attempts.cancel();
    clear_auth_state(&state).await;
    close_primary_connection(&state).await;
    clear_connection_state(&state).await;

    tracing::info!("Disconnected");
    Ok(())
}

/// Get the current authentication status (username, token, permissions, etc.).
#[tauri::command]
pub async fn get_auth_status(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    Ok(build_auth_status(&state.inner).await)
}

/// Get the current server-connection state (connected, address, lockdown).
#[tauri::command]
pub async fn get_server_state(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    Ok(build_server_state(&state.inner).await)
}

/// Get the authenticated user's two-factor authentication status.
#[tauri::command]
pub async fn get_2fa_status(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "core.user.authentication.totp.status.get",
        serde_json::json!({}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format_server_response_error(&resp));
    }

    Ok(resp.data)
}

/// Start TOTP setup for the authenticated user.
#[tauri::command]
pub async fn setup_2fa(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "core.user.authentication.totp.setup",
        serde_json::json!({"method": "totp"}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format_server_response_error(&resp));
    }

    Ok(resp.data)
}

/// Verify the TOTP setup code and enable two-factor authentication.
#[tauri::command]
pub async fn validate_2fa(
    state: tauri::State<'_, AppHandleState>,
    token: String,
) -> Result<(), String> {
    let token = zeroize::Zeroizing::new(token);
    let (conn, username, auth_token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "core.user.authentication.totp.setup.confirm",
        serde_json::json!({"token": token.as_str()}),
        &username,
        &auth_token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format_server_response_error(&resp));
    }

    Ok(())
}

/// Cancel a pending TOTP setup before verification.
#[tauri::command]
pub async fn cancel_2fa_setup(state: tauri::State<'_, AppHandleState>) -> Result<(), String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "core.user.authentication.totp.setup.cancel",
        serde_json::json!({}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format_server_response_error(&resp));
    }

    Ok(())
}

/// Disable two-factor authentication for the authenticated user.
#[tauri::command]
pub async fn disable_2fa(
    state: tauri::State<'_, AppHandleState>,
    password: String,
) -> Result<(), String> {
    let password = zeroize::Zeroizing::new(password);
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "core.user.authentication.totp.delete",
        serde_json::json!({"password": password.as_str()}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format_server_response_error(&resp));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
