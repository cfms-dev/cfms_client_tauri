// Authentication & Connection
// ---------------------------------------------------------------------------

/// Log in with username and password (and optional 2FA token).
///
/// Sends a login request over the established WSS connection to the
/// CFMS server.  The server may:
///
/// - Accept the login (code 200) — auth state is stored.
/// - Request 2FA verification (code 202) — caller must re-invoke with
///   `twofa_token`.
/// - Reject the login (any other code) — an error is returned.
///
/// The Data Encryption Key (DEK) metadata is captured after successful
/// authentication, but password-dependent DEK work is deferred to the
/// post-login encryption setup phase so the login form can transition quickly.
#[tauri::command]
pub async fn login(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    password: String,
    twofa_token: Option<String>,
) -> Result<serde_json::Value, String> {
    // --- Obtain the active connection ---
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    let response =
        send_login_request(&conn, &username, &password, twofa_token.as_deref()).await?;

    tracing::info!(
        "Login response: code={}, message={}",
        response.code,
        response.message
    );

    match response.code {
        // --- Success (no 2FA) ---
        200 => {
            let data = &response.data;

            apply_successful_login_response(&state, &username, data, true, true).await?;

            let mut status = build_auth_status(&state.inner).await;
            status["needs_preference_dek_setup"] = serde_json::Value::Bool(true);
            Ok(status)
        }

        // --- 2FA required ---
        202 => {
            // Mark 2FA as pending so auth status polls don't report as
            // authenticated until 2FA is completed.
            state
                .inner
                .pending_2fa
                .store(true, std::sync::atomic::Ordering::SeqCst);

            // Store partial auth state so the frontend can re-submit with 2FA.
            // No DEK setup here — the real token isn't available yet.
            // DEK setup happens when the frontend re-invokes login with
            // twofa_token and the server returns 200.
            {
                let mut u = state.inner.username.write().await;
                *u = Some(username.clone());
            }
            {
                // Store a placeholder token to indicate partial auth.
                let mut t = state.inner.token.write().await;
                *t = Some("pending_2fa".to_string());
            }
            {
                let mut e = state.inner.token_exp.write().await;
                *e = Some(unix_now() + 300); // 5-minute 2FA window
            }
            {
                let mut n = state.inner.nickname.write().await;
                *n = Some(username.clone());
            }
            {
                let mut p = state.inner.permissions.write().await;
                p.clear();
            }
            {
                let mut g = state.inner.groups.write().await;
                g.clear();
            }

            let method = response
                .data
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("totp")
                .to_string();

            Ok(serde_json::json!({
                "username": &username,
                "nickname": &username,
                "has_token": false,
                "token_exp": null,
                "permissions": [],
                "groups": [],
                "requires_2fa": true,
                "2fa_method": method,
            }))
        }

        // --- Password must be changed before login ---
        //
        // Mirrors the Python reference which shows a PasswdUserDialog for
        // codes 4001 / 4002.
        //
        // The frontend should surface a password-change prompt — we include
        // the server's message so the user knows why.
        4001 | 4002 => {
            let server_preference_dek = response
                .data
                .get("preference_dek")
                .and_then(|preference_dek| preference_dek.get("key_content"))
                .and_then(|key_content| key_content.as_str())
                .map(ToOwned::to_owned);
            remember_server_preference_dek(&state.inner, server_preference_dek).await;

            Err(format!(
                "Password must be changed before login: {}",
                response.message
            ))
        }

        // --- Server-side error ---
        other => Err(format!("Login failed: ({}) {}", other, response.message)),
    }
}

async fn send_login_request(
    conn: &cfms_transport::Connection,
    username: &str,
    password: &str,
    twofa_token: Option<&str>,
) -> Result<cfms_core::Response, String> {
    let mut request = serde_json::json!({
        "action": "login",
        "data": {
            "username": username,
            "password": password,
        },
    });
    if let Some(token) = twofa_token {
        request["data"]["2fa_token"] = serde_json::Value::String(token.to_string());
    }

    let mut stream = conn
        .create_stream()
        .await
        .map_err(|e| format!("Failed to create stream: {e}"))?;

    let request_bytes =
        serde_json::to_vec(&request).map_err(|e| format!("Failed to encode login request: {e}"))?;

    stream
        .send(conn, request_bytes)
        .await
        .map_err(|e| format!("Failed to send login request: {e}"))?;

    let response_bytes = stream
        .recv()
        .await
        .ok_or_else(|| "Connection closed before login response".to_string())?;

    serde_json::from_slice(&response_bytes)
        .map_err(|e| format!("Invalid login response from server: {e}"))
}

async fn apply_successful_login_response(
    state: &AppHandleState,
    username: &str,
    data: &serde_json::Value,
    clear_dek: bool,
    clear_tasks: bool,
) -> Result<String, String> {
    let token = data["token"]
        .as_str()
        .ok_or_else(|| "Server did not return a token".to_string())?
        .to_string();

    {
        let mut u = state.inner.username.write().await;
        *u = Some(username.to_string());
    }
    {
        let mut t = state.inner.token.write().await;
        *t = Some(token.clone());
    }
    {
        let exp = data["exp"].as_i64().unwrap_or(unix_now() + 3600);
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
    state
        .inner
        .pending_2fa
        .store(false, std::sync::atomic::Ordering::SeqCst);

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
    }

    Ok(token)
}

/// Change a user's password via the server's `set_passwd` action.
///
/// This supports the *self-change* flow used when the server rejects a login
/// with code 4001/4002 ("password must be changed before login").  In that
/// case the user is **not** authenticated yet, so no top-level token is sent —
/// the server takes the self-change path, verifying `old_passwd` directly
/// (see `RequestSetPasswdHandler` in the server reference).
///
/// Mirrors `PasswdDialogController.action_passwd_user` in the Python reference
/// (`controllers/dialogs/passwd.py`) for the `passwd_other = False` case:
/// `username`/`token` are omitted at the top level and the elevated flags
/// (`bypass_passwd_requirements`, `force_update_after_login`) are kept `false`
/// — the server rejects them for a self-change anyway.
#[tauri::command]
pub async fn change_password(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    // --- Obtain the active connection ---
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    let mut prepared_dek_rewrap = if let Some(existing_dek) = state.inner.dek.read().await.clone() {
        match get_connection_auth(&state).await {
            Ok((auth_conn, auth_username, auth_token))
                if auth_username == username && auth_token != "pending_2fa" =>
            {
                let encrypted = rewrap_and_upload_preference_dek(
                    &auth_conn,
                    *existing_dek,
                    &new_password,
                    &auth_username,
                    &auth_token,
                )
                .await
                .map_err(|e| {
                    format!("Failed to prepare preference DEK rewrap before password change: {e}")
                })?;
                Some((existing_dek, encrypted, auth_conn, auth_username, auth_token))
            }
            Ok(_) | Err(_) => None,
        }
    } else {
        None
    };

    let request = serde_json::json!({
        "action": "set_passwd",
        "data": {
            "username": &username,
            "old_passwd": &old_password,
            "new_passwd": &new_password,
            "bypass_passwd_requirements": false,
            "force_update_after_login": false,
        },
    });

    let mut stream = conn
        .create_stream()
        .await
        .map_err(|e| format!("Failed to create stream: {e}"))?;

    let request_bytes = serde_json::to_vec(&request)
        .map_err(|e| format!("Failed to encode change-password request: {e}"))?;

    stream
        .send(&conn, request_bytes)
        .await
        .map_err(|e| format!("Failed to send change-password request: {e}"))?;

    let response_bytes = stream
        .recv()
        .await
        .ok_or_else(|| "Connection closed before change-password response".to_string())?;

    // Politely close the stream.
    let _ = stream.send_final(&conn, vec![]).await;

    let response: cfms_core::Response = serde_json::from_slice(&response_bytes)
        .map_err(|e| format!("Invalid change-password response from server: {e}"))?;

    tracing::info!(
        "set_passwd response: code={}, message={}",
        response.code,
        response.message
    );

    if response.code != 200 {
        if let Some((dek, _, auth_conn, auth_username, auth_token)) = prepared_dek_rewrap.take() {
            match rewrap_and_upload_preference_dek(
                &auth_conn,
                *dek,
                &old_password,
                &auth_username,
                &auth_token,
            )
            .await
            {
                Ok(encrypted) => remember_server_preference_dek(&state.inner, Some(encrypted)).await,
                Err(error) => {
                    tracing::warn!(
                        "Failed to roll back prepared preference DEK after password change rejection: {error}"
                    );
                    return Err(format!(
                        "({}) {}; additionally failed to restore the previous preference DEK: {}",
                        response.code, response.message, error
                    ));
                }
            }
        }
        return Err(format!("({}) {}", response.code, response.message));
    }

    if let Some((dek, encrypted, _, _, _)) = prepared_dek_rewrap.take() {
        {
            let mut stored_dek = state.inner.dek.write().await;
            *stored_dek = Some(dek);
        }
        remember_server_preference_dek(&state.inner, Some(encrypted)).await;
    }

    Ok(())
}

/// Recover a server-returned preference DEK with a previous password, then
/// rewrap it with the current login password and upload it back to the server.
#[tauri::command]
pub async fn recover_preference_dek(
    state: tauri::State<'_, AppHandleState>,
    recovery_password: String,
    current_password: String,
) -> Result<(), String> {
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
        *recovered_dek,
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
/// If the server's protocol version is *higher* than the client's the
/// connection is torn down and an error is returned — the frontend
/// should direct the user to update the client.
///
/// If the server's protocol version is *lower* the connection is also
/// closed — the server is too old and the client cannot downgrade.
///
/// # Returns
///
/// [`ServerInfo`] on success: `{ server_name, protocol_version, lockdown }`.
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
        "Connecting to {url} (disable_ssl_enforcement={disable_ssl_enforcement}, effective_disable_ssl={effective_disable_ssl}, proxy={}, force_ipv4={})",
        proxy_addr.as_deref().unwrap_or("none"),
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
        ) => result.map_err(|e| format!("Connection failed: {e}")),
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
        result = async {
        let random_bytes: [u8; 16] = rand::thread_rng().r#gen();
        let nonce = hex::encode(random_bytes);

        let request = serde_json::json!({
            "action": "server_info",
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
            .send(&conn, request_bytes)
            .await
            .map_err(|e| format!("Failed to send server_info request: {e}"))?;

        let response_bytes = stream
            .recv()
            .await
            .ok_or_else(|| "Connection closed before server_info response".to_string())?;

        let response: cfms_core::Response = serde_json::from_slice(&response_bytes)
            .map_err(|e| format!("Invalid server_info response: {e}"))?;

        if response.code != 200 {
            return Err(format!(
                "Server returned {} from server_info: {}",
                response.code, response.message
            ));
        }

        serde_json::from_value(response.data)
            .map_err(|e| format!("Invalid server_info data: {e}"))
        } => result,
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
    let client_protocol = cfms_core::constants::PROTOCOL_VERSION;

    if server_info.protocol_version != client_protocol {
        // Tear down — cannot communicate with this server.
        state.connect_attempts.unregister(attempt_id);
        conn.close().await;

        if server_info.protocol_version > client_protocol {
            return Err(format!(
                "server_update_required:{}:{}",
                server_info.protocol_version, client_protocol
            ));
        } else {
            return Err(format!(
                "server_too_old:{}:{}",
                server_info.protocol_version, client_protocol
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
    if let Err(error) = remember_successful_connection(&state.settings, &url) {
        tracing::warn!("Failed to remember server address: {error}");
    }

    tracing::info!(
        "Connected to {url} — server={}, protocol={}, lockdown={}",
        server_info.server_name,
        server_info.protocol_version,
        server_info.lockdown,
    );

    Ok(serde_json::json!({
        "server_name": server_info.server_name,
        "protocol_version": server_info.protocol_version,
        "lockdown": server_info.lockdown,
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

fn trimmed_path(value: &str) -> Option<std::path::PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(std::path::PathBuf::from(trimmed))
    }
}

fn system_proxy_setting() -> Option<String> {
    env_proxy_setting().or_else(platform_system_proxy_setting)
}

fn env_proxy_setting() -> Option<String> {
    [
        "CFMS_PROXY",
        "ALL_PROXY",
        "all_proxy",
        "HTTPS_PROXY",
        "https_proxy",
    ]
    .iter()
    .find_map(|key| std::env::var(key).ok())
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

#[cfg(windows)]
fn platform_system_proxy_setting() -> Option<String> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let internet_settings = hkcu
        .open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            KEY_READ,
        )
        .ok()?;
    let enabled = internet_settings
        .get_value::<u32, _>("ProxyEnable")
        .unwrap_or(0);
    if enabled == 0 {
        return None;
    }

    internet_settings
        .get_value::<String, _>("ProxyServer")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(not(windows))]
fn platform_system_proxy_setting() -> Option<String> {
    None
}

fn normalize_proxy_url(
    raw: &str,
    default_scheme: &str,
    context: &str,
) -> Result<Option<url::Url>, String> {
    let selected = select_proxy_rule(raw, &["socks", "https", "http"])
        .unwrap_or_else(|| raw.trim().to_string());
    let trimmed = selected.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(None);
    }

    let proxy_url = if trimmed.contains("://") {
        url::Url::parse(trimmed).map_err(|e| format!("Invalid proxy URL for {context}: {e}"))?
    } else {
        let scheme = proxy_rule_scheme(raw).unwrap_or(default_scheme);
        url::Url::parse(&format!("{scheme}://{trimmed}"))
            .map_err(|e| format!("Invalid proxy URL for {context}: {e}"))?
    };

    match proxy_url.scheme() {
        "http" | "https" | "socks4" | "socks4a" | "socks5" | "socks5h" => {
            if proxy_url.host_str().is_none() {
                return Err(format!("Proxy URL for {context} must include a host."));
            }
            if proxy_url.port_or_known_default().is_none() {
                return Err(format!(
                    "Proxy URL for {context} must include a port, e.g. socks5h://127.0.0.1:1080.",
                ));
            }
            Ok(Some(proxy_url))
        }
        _ => Err(format!(
            "Only HTTP, HTTPS and SOCKS proxy URLs are supported for {context}.",
        )),
    }
}

fn select_proxy_rule(raw: &str, preferred_keys: &[&str]) -> Option<String> {
    if !raw.contains('=') {
        return None;
    }

    let entries = raw
        .split(';')
        .filter_map(|entry| {
            let (key, value) = entry.split_once('=')?;
            let key = key.trim().to_ascii_lowercase();
            let value = value.trim();
            (!key.is_empty() && !value.is_empty()).then(|| (key, value.to_string()))
        })
        .collect::<Vec<_>>();

    preferred_keys.iter().find_map(|preferred| {
        entries
            .iter()
            .find(|(key, _)| key == preferred)
            .map(|(_, value)| value.clone())
    })
}

fn proxy_rule_scheme(raw: &str) -> Option<&'static str> {
    if !raw.contains('=') {
        return None;
    }
    if select_proxy_rule(raw, &["socks"]).is_some() {
        Some("socks5h")
    } else if select_proxy_rule(raw, &["https", "http"]).is_some() {
        Some("http")
    } else {
        None
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
        "get_2fa_status",
        serde_json::json!({}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("({}) {}", resp.code, resp.message));
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
        "setup_2fa",
        serde_json::json!({"method": "totp"}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("({}) {}", resp.code, resp.message));
    }

    Ok(resp.data)
}

/// Verify the TOTP setup code and enable two-factor authentication.
#[tauri::command]
pub async fn validate_2fa(
    state: tauri::State<'_, AppHandleState>,
    token: String,
) -> Result<(), String> {
    let (conn, username, auth_token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "validate_2fa",
        serde_json::json!({"token": token}),
        &username,
        &auth_token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("({}) {}", resp.code, resp.message));
    }

    Ok(())
}

/// Cancel a pending TOTP setup before verification.
#[tauri::command]
pub async fn cancel_2fa_setup(state: tauri::State<'_, AppHandleState>) -> Result<(), String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "cancel_2fa_setup",
        serde_json::json!({}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("({}) {}", resp.code, resp.message));
    }

    Ok(())
}

/// Disable two-factor authentication for the authenticated user.
#[tauri::command]
pub async fn disable_2fa(
    state: tauri::State<'_, AppHandleState>,
    password: String,
) -> Result<(), String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "disable_2fa",
        serde_json::json!({"password": password}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("({}) {}", resp.code, resp.message));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
