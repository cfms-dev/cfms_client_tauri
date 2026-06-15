/// Convenience helper: extract (connection, username, token) from app state.
async fn get_connection_auth(
    state: &AppHandleState,
) -> Result<(cfms_transport::Connection, String, String), String> {
    let conn = cfms_service::services::connection::ensure_connected(
        &state.inner,
        cfms_service::services::connection::DEFAULT_RECONNECT_ATTEMPTS,
        false,
    )
    .await
    .map_err(|e| format!("Not connected to a server: {e}"))?;
    let username = state
        .inner
        .username
        .read()
        .await
        .clone()
        .ok_or_else(|| "Not logged in".to_string())?;
    let token = state
        .inner
        .token
        .read()
        .await
        .clone()
        .ok_or_else(|| "Not logged in".to_string())?;
    Ok((conn, username, token))
}

fn download_root(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_handle
        .path()
        .resolve("downloads", tauri::path::BaseDirectory::Download)
        .unwrap_or_else(|_| {
            app_handle
                .path()
                .resolve("downloads", tauri::path::BaseDirectory::AppData)
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
        }))
}

async fn create_transfer_connection(
    state: &cfms_service::state::AppState,
) -> Result<cfms_transport::Connection, String> {
    let (url, ca_dir, disable_ssl, proxy_addr, force_ipv4, client_cert_path, client_key_path) = {
        let addr = state.server_address.read().await;
        let ca = state.ca_dir.read().await;
        let dse = state.disable_ssl_enforcement.read().await;
        let proxy = state.proxy_addr.read().await;
        let force_ipv4 = state.force_ipv4.read().await;
        let cert = state.client_cert_path.read().await;
        let key = state.client_key_path.read().await;
        (
            addr.clone(),
            ca.clone(),
            *dse,
            proxy.clone(),
            *force_ipv4,
            cert.clone(),
            key.clone(),
        )
    };

    let url = url.ok_or_else(|| "No server address configured".to_string())?;
    let ca_dir = ca_dir.ok_or_else(|| "No CA directory configured".to_string())?;

    let tls_config = cfms_transport::tls::build_config_with_identity(
        &ca_dir,
        disable_ssl,
        client_cert_path.as_deref(),
        client_key_path.as_deref(),
    )
    .map_err(|e| format!("TLS config error: {e}"))?;

    cfms_transport::Connection::connect(&url, tls_config, proxy_addr.as_deref(), force_ipv4)
        .await
        .map_err(|e| format!("Transfer connection failed: {e}"))
}

async fn create_server_directory(
    state: &AppHandleState,
    parent_id: Option<String>,
    name: String,
    exists_ok: bool,
) -> Result<String, String> {
    let (conn, username, token) = get_connection_auth(state).await?;
    let resp = send_action_request(
        &conn,
        "create_directory",
        serde_json::json!({
            "parent_id": non_empty_optional(parent_id),
            "name": name,
            "exists_ok": exists_ok,
        }),
        &username,
        &token,
    )
    .await?;

    if resp.code == 409
        && exists_ok
        && resp.data.get("type").and_then(|v| v.as_str()) == Some("directory")
        && let Some(id) = resp.data.get("id").and_then(|v| v.as_str())
    {
        return Ok(id.to_string());
    }

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    resp.data
        .get("id")
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Server response missing directory id".to_string())
}

fn clean_optional_upload_name(name: Option<String>) -> Option<String> {
    name.and_then(|value| {
        let cleaned = value
            .chars()
            .map(|ch| match ch {
                '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'..='\u{1f}' => '_',
                _ => ch,
            })
            .collect::<String>()
            .trim()
            .trim_matches('.')
            .to_string();
        if cleaned.is_empty() {
            None
        } else {
            Some(cleaned)
        }
    })
}

#[cfg(target_os = "android")]
fn prepare_upload_source<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    file_path: String,
) -> Result<PreparedUploadSource, String> {
    let source = std::path::PathBuf::from(&file_path);
    if source.is_file() {
        return Ok(PreparedUploadSource {
            path: source,
            display_name: None,
            cleanup_on_drop: false,
        });
    }

    let importer = app_handle.state::<AndroidUploadFileImporter<R>>();
    let imported = importer
        .handle
        .run_mobile_plugin::<AndroidImportedUploadPath>(
            "importFile",
            serde_json::json!({ "uri": file_path }),
        )
        .map_err(|e| format!("Failed to import selected file: {e}"))?;
    let imported_path = std::path::PathBuf::from(imported.path);
    if !imported_path.is_file() {
        return Err("Selected path is not a file".to_string());
    }

    Ok(PreparedUploadSource {
        path: imported_path,
        display_name: Some(imported.display_name),
        cleanup_on_drop: true,
    })
}

#[cfg(not(target_os = "android"))]
fn prepare_upload_source<R: Runtime>(
    _app_handle: &tauri::AppHandle<R>,
    file_path: String,
) -> Result<PreparedUploadSource, String> {
    let source = std::path::PathBuf::from(file_path);
    if !source.is_file() {
        return Err("Selected path is not a file".to_string());
    }

    Ok(PreparedUploadSource {
        path: source,
        display_name: None,
        cleanup_on_drop: false,
    })
}

#[cfg(target_os = "android")]
fn prepare_upload_directory_source<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    directory_path: String,
) -> Result<PreparedUploadSource, String> {
    let source = std::path::PathBuf::from(&directory_path);
    if source.is_dir() {
        return Ok(PreparedUploadSource {
            path: source,
            display_name: None,
            cleanup_on_drop: false,
        });
    }

    let importer = app_handle.state::<AndroidUploadFileImporter<R>>();
    let imported = importer
        .handle
        .run_mobile_plugin::<AndroidImportedUploadPath>(
            "importDirectory",
            serde_json::json!({ "uri": directory_path }),
        )
        .map_err(|e| format!("Failed to import selected folder: {e}"))?;
    let imported_path = std::path::PathBuf::from(imported.path);
    if !imported_path.is_dir() {
        return Err("Selected path is not a directory".to_string());
    }

    Ok(PreparedUploadSource {
        path: imported_path,
        display_name: Some(imported.display_name),
        cleanup_on_drop: true,
    })
}

#[cfg(not(target_os = "android"))]
fn prepare_upload_directory_source<R: Runtime>(
    _app_handle: &tauri::AppHandle<R>,
    directory_path: String,
) -> Result<PreparedUploadSource, String> {
    let source = std::path::PathBuf::from(directory_path);
    if !source.is_dir() {
        return Err("Selected path is not a directory".to_string());
    }

    Ok(PreparedUploadSource {
        path: source,
        display_name: None,
        cleanup_on_drop: false,
    })
}

async fn upload_local_file<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    state: &AppHandleState,
    parent_id: Option<String>,
    source: std::path::PathBuf,
    upload_name: Option<String>,
    upload_id: String,
    conflict_strategy: UploadConflictStrategy,
) -> Result<UploadFileResult, String> {
    if !source.is_file() {
        return Err("Selected path is not a file".to_string());
    }

    let file_name = upload_name
        .or_else(|| {
            source
                .file_name()
                .and_then(|name| name.to_str())
                .map(ToOwned::to_owned)
        })
        .ok_or_else(|| "Selected file has no valid name".to_string())?;
    let mut upload_control = state.active_uploads.register(&upload_id);

    emit_upload_progress(
        app_handle,
        &upload_id,
        None,
        &file_name,
        0,
        std::fs::metadata(&source).map(|m| m.len()).unwrap_or(0),
        "uploading",
        Some("Preparing upload".to_string()),
    );

    let (conn, username, token) = match get_connection_auth(state).await {
        Ok(auth) => auth,
        Err(err) => {
            state.active_uploads.unregister(&upload_id);
            return Err(err);
        }
    };
    let create_resp = match send_action_request(
        &conn,
        "create_document",
        serde_json::json!({
            "title": file_name,
            "folder_id": non_empty_optional(parent_id.clone()),
            "access_rules": {},
        }),
        &username,
        &token,
    )
    .await
    {
        Ok(response) => response,
        Err(err) => {
            state.active_uploads.unregister(&upload_id);
            return Err(err);
        }
    };

    let mut overwritten = false;
    let (task_id, document_id, skipped) = if create_resp.code == 409 {
        let conflict_type = create_resp
            .data
            .get("type")
            .and_then(|value| value.as_str());
        let conflict_id = create_resp
            .data
            .get("id")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned);

        match (conflict_strategy, conflict_type, conflict_id) {
            (UploadConflictStrategy::Skip, _, _) => {
                emit_upload_progress(
                    app_handle,
                    &upload_id,
                    None,
                    &file_name,
                    0,
                    0,
                    "skipped",
                    Some("Skipped existing document".to_string()),
                );
                state.active_uploads.unregister(&upload_id);
                return Ok(UploadFileResult {
                    upload_id,
                    task_id: None,
                    document_id: None,
                    file_name,
                    skipped: true,
                    overwritten: false,
                });
            }
            (UploadConflictStrategy::Overwrite, Some("document"), Some(document_id)) => {
                let upload_resp = match send_action_request(
                    &conn,
                    "upload_document",
                    serde_json::json!({ "document_id": document_id }),
                    &username,
                    &token,
                )
                .await
                {
                    Ok(response) => response,
                    Err(err) => {
                        state.active_uploads.unregister(&upload_id);
                        return Err(err);
                    }
                };

                if upload_resp.code != 200 {
                    state.active_uploads.unregister(&upload_id);
                    return Err(format!(
                        "Server returned {}: {}",
                        upload_resp.code, upload_resp.message
                    ));
                }

                overwritten = true;
                let task_id = match extract_task_id(&upload_resp.data) {
                    Ok(id) => id,
                    Err(err) => {
                        state.active_uploads.unregister(&upload_id);
                        return Err(err);
                    }
                };
                (task_id, Some(document_id), false)
            }
            _ => {
                state.active_uploads.unregister(&upload_id);
                return Err(format!(
                    "Server returned {}: {}",
                    create_resp.code, create_resp.message
                ));
            }
        }
    } else if create_resp.code != 200 {
        state.active_uploads.unregister(&upload_id);
        return Err(format!(
            "Server returned {}: {}",
            create_resp.code, create_resp.message
        ));
    } else {
        let task_id = match extract_task_id(&create_resp.data) {
            Ok(id) => id,
            Err(err) => {
                state.active_uploads.unregister(&upload_id);
                return Err(err);
            }
        };
        let document_id = create_resp
            .data
            .get("id")
            .or_else(|| create_resp.data.get("document_id"))
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned);
        (task_id, document_id, false)
    };

    if let Some(reason) = *upload_control.borrow() {
        emit_interrupted_upload(app_handle, &upload_id, Some(&task_id), &file_name, reason);
        state.active_uploads.unregister(&upload_id);
        return Err(upload_interruption_message(reason).to_string());
    }

    let transfer_conn = match create_transfer_connection(&state.inner).await {
        Ok(conn) => conn,
        Err(err) => {
            state.active_uploads.unregister(&upload_id);
            return Err(err);
        }
    };
    state
        .active_uploads
        .set_transfer_conn(&upload_id, transfer_conn.clone());
    let emit_handle = app_handle.clone();
    let progress_upload_id = upload_id.clone();
    let progress_task_id = task_id.clone();
    let progress_file_name = file_name.clone();
    let progress = move |current: u64, total: u64| {
        emit_upload_progress(
            &emit_handle,
            &progress_upload_id,
            Some(&progress_task_id),
            &progress_file_name,
            current,
            total,
            "uploading",
            None,
        );
    };

    let result = tokio::select! {
        result = cfms_transfer::upload::send(&transfer_conn, &task_id, &source, &progress) => {
            result.map_err(|err| format!("Upload failed: {err}"))
        }
        changed = upload_control.changed() => {
            let reason = if changed.is_ok() {
                (*upload_control.borrow()).unwrap_or(UploadInterruption::Cancelled)
            } else {
                UploadInterruption::Cancelled
            };
            Err(upload_interruption_message(reason).to_string())
        }
    };
    transfer_conn.close().await;

    if let Err(message) = result {
        if let Some(reason) = *upload_control.borrow() {
            emit_interrupted_upload(app_handle, &upload_id, Some(&task_id), &file_name, reason);
            state.active_uploads.unregister(&upload_id);
            return Err(message);
        }

        emit_upload_progress(
            app_handle,
            &upload_id,
            Some(&task_id),
            &file_name,
            0,
            0,
            "failed",
            Some(message.clone()),
        );
        state.active_uploads.unregister(&upload_id);
        return Err(message);
    }

    emit_upload_progress(
        app_handle,
        &upload_id,
        Some(&task_id),
        &file_name,
        1,
        1,
        "completed",
        Some("Upload completed".to_string()),
    );
    state.active_uploads.unregister(&upload_id);

    Ok(UploadFileResult {
        upload_id,
        task_id: Some(task_id),
        document_id,
        file_name,
        skipped,
        overwritten,
    })
}

fn upload_interruption_message(reason: UploadInterruption) -> &'static str {
    match reason {
        UploadInterruption::Paused => "Upload paused",
        UploadInterruption::Cancelled => "Upload cancelled",
    }
}

fn emit_interrupted_upload<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    upload_id: &str,
    task_id: Option<&str>,
    file_name: &str,
    reason: UploadInterruption,
) {
    let status = match reason {
        UploadInterruption::Paused => "paused",
        UploadInterruption::Cancelled => "cancelled",
    };
    emit_upload_progress(
        app_handle,
        upload_id,
        task_id,
        file_name,
        0,
        0,
        status,
        Some(upload_interruption_message(reason).to_string()),
    );
}

fn emit_upload_progress<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    upload_id: &str,
    task_id: Option<&str>,
    file_name: &str,
    current_bytes: u64,
    total_bytes: u64,
    status: &str,
    message: Option<String>,
) {
    let progress = if total_bytes > 0 {
        current_bytes as f64 / total_bytes as f64
    } else if status == "completed" {
        1.0
    } else {
        0.0
    };

    let _ = app_handle.emit(
        "cfms:upload-progress",
        UploadProgressEvent {
            upload_id: upload_id.to_string(),
            task_id: task_id.map(ToOwned::to_owned),
            file_name: file_name.to_string(),
            current_bytes,
            total_bytes,
            progress,
            status: status.to_string(),
            message,
        },
    );
}

fn extract_task_id(data: &serde_json::Value) -> Result<String, String> {
    data.get("task_data")
        .and_then(|value| value.get("task_id"))
        .or_else(|| data.get("task_id"))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Server response missing task_id".to_string())
}

fn collect_directory_entries(root: &std::path::Path) -> Result<Vec<std::path::PathBuf>, String> {
    let mut entries = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(path) = stack.pop() {
        let children = std::fs::read_dir(&path)
            .map_err(|e| format!("Failed to read directory {}: {e}", path.display()))?;
        for child in children {
            let child = child.map_err(|e| format!("Failed to read directory entry: {e}"))?;
            let child_path = child.path();
            if child_path.is_dir() {
                stack.push(child_path.clone());
            }
            entries.push(child_path);
        }
    }

    entries.sort_by(|a, b| {
        let a_depth = a.components().count();
        let b_depth = b.components().count();
        a_depth.cmp(&b_depth).then_with(|| a.cmp(b))
    });
    Ok(entries)
}

async fn server_action_json(
    state: &AppHandleState,
    action: &str,
    data: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut last_error = None;
    for attempt in 1..=cfms_service::services::connection::DEFAULT_RECONNECT_ATTEMPTS {
        let (conn, username, token) = get_connection_auth(state).await?;
        match send_action_request(&conn, action, data.clone(), &username, &token).await {
            Ok(resp) => {
                if resp.code != 200 {
                    return Err(format!("Server returned {}: {}", resp.code, resp.message));
                }

                return Ok(resp.data);
            }
            Err(error) if is_transient_connection_error(&error) => {
                tracing::warn!(
                    "Request {action} failed on attempt {attempt}; reconnecting: {error}",
                );
                last_error = Some(error);
                cfms_service::services::connection::ensure_connected(
                    &state.inner,
                    cfms_service::services::connection::DEFAULT_RECONNECT_ATTEMPTS,
                    true,
                )
                .await?;
            }
            Err(error) => return Err(error),
        }
    }

    Err(last_error.unwrap_or_else(|| format!("{action} failed after reconnect attempts")))
}

async fn server_action_bool(
    state: &AppHandleState,
    action: &str,
    data: serde_json::Value,
) -> Result<bool, String> {
    server_action_json(state, action, data).await?;
    Ok(true)
}

async fn clear_auth_state(state: &AppHandleState) {
    {
        let mut u = state.inner.username.write().await;
        let mut t = state.inner.token.write().await;
        let mut e = state.inner.token_exp.write().await;
        let mut n = state.inner.nickname.write().await;
        let mut p = state.inner.permissions.write().await;
        let mut g = state.inner.groups.write().await;
        let mut d = state.inner.dek.write().await;
        let mut spd = state.inner.server_preference_dek.write().await;
        let mut a = state.inner.avatar_path.write().await;
        *u = None;
        *t = None;
        *e = None;
        *n = None;
        p.clear();
        g.clear();
        *d = None;
        *spd = None;
        *a = None;
    }

    state.tasks.clear();
    state
        .inner
        .pending_2fa
        .store(false, std::sync::atomic::Ordering::SeqCst);
}

async fn close_primary_connection(state: &AppHandleState) {
    let conn = {
        let mut c = state.inner.conn.write().await;
        c.take()
    };

    if let Some(conn) = conn {
        tokio::spawn(async move { conn.close().await });
    }
}

async fn clear_connection_state(state: &AppHandleState) {
    {
        let mut addr = state.inner.server_address.write().await;
        *addr = None;
    }
    {
        let mut name = state.inner.server_name.write().await;
        *name = None;
    }
    {
        let mut pv = state.inner.server_protocol_version.write().await;
        *pv = None;
    }
    state
        .inner
        .app_lockdown
        .store(false, std::sync::atomic::Ordering::SeqCst);
    {
        let mut ca = state.inner.ca_dir.write().await;
        *ca = None;
    }
    {
        let mut force_ipv4 = state.inner.force_ipv4.write().await;
        *force_ipv4 = false;
    }
    {
        let mut proxy = state.inner.proxy_addr.write().await;
        *proxy = None;
    }
    {
        let mut cert = state.inner.client_cert_path.write().await;
        *cert = None;
    }
    {
        let mut key = state.inner.client_key_path.write().await;
        *key = None;
    }
}

fn non_empty_optional(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

/// Build a JSON auth-status payload (auth fields only — no server state).
async fn build_auth_status(inner: &cfms_service::state::AppState) -> serde_json::Value {
    let username = inner.username.read().await.clone();
    let nickname = inner.nickname.read().await.clone();
    let pending_2fa = inner.pending_2fa.load(std::sync::atomic::Ordering::SeqCst);
    // When 2FA is pending, the token is a placeholder — don't report as
    // authenticated.
    let has_token = !pending_2fa && inner.token.read().await.is_some();
    let token_exp = if pending_2fa {
        None
    } else {
        *inner.token_exp.read().await
    };
    let permissions = inner.permissions.read().await.clone();
    let groups = inner.groups.read().await.clone();
    let has_server_preference_dek = inner.server_preference_dek.read().await.is_some();

    let mut status = serde_json::json!({
        "username": username,
        "nickname": nickname,
        "has_token": has_token,
        "token_exp": token_exp,
        "permissions": permissions,
        "groups": groups,
        "avatar_path": inner.avatar_path.read().await.clone(),
        "has_server_preference_dek": has_server_preference_dek,
    });

    if pending_2fa {
        status["requires_2fa"] = serde_json::Value::Bool(true);
        status["2fa_method"] = serde_json::Value::String("totp".to_string());
    }

    status
}

/// Build a JSON server-state payload (connection fields only — no auth data).
async fn build_server_state(inner: &cfms_service::state::AppState) -> serde_json::Value {
    let connected = inner
        .conn
        .read()
        .await
        .as_ref()
        .is_some_and(|conn| !conn.is_closed());
    let server_address = inner.server_address.read().await.clone();
    let server_name = inner.server_name.read().await.clone();
    let protocol_version = inner.server_protocol_version.read().await;
    let lockdown = inner.app_lockdown.load(std::sync::atomic::Ordering::SeqCst);

    serde_json::json!({
        "connected": connected,
        "server_address": server_address,
        "server_name": server_name,
        "protocol_version": *protocol_version,
        "lockdown": lockdown,
    })
}

/// Current Unix timestamp in seconds.
fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
