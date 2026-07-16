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

struct UploadTransferSession {
    conn: Option<cfms_transport::Connection>,
}

impl UploadTransferSession {
    fn new() -> Self {
        Self { conn: None }
    }

    async fn get(
        &mut self,
        state: &cfms_service::state::AppState,
    ) -> Result<cfms_transport::Connection, String> {
        if self
            .conn
            .as_ref()
            .is_some_and(cfms_transport::Connection::is_closed)
            && let Some(conn) = self.conn.take()
        {
            conn.close().await;
        }

        if self.conn.is_none() {
            self.conn = Some(create_transfer_connection(state).await?);
        }

        Ok(self
            .conn
            .as_ref()
            .expect("upload transfer connection exists after creation")
            .clone())
    }

    async fn discard(&mut self) {
        if let Some(conn) = self.conn.take() {
            conn.close().await;
        }
    }

    async fn close(&mut self) {
        self.discard().await;
    }
}

struct CreateServerDirectoryResult {
    id: String,
}

async fn create_server_directory(
    state: &AppHandleState,
    parent_id: Option<String>,
    name: String,
    exists_ok: bool,
) -> Result<CreateServerDirectoryResult, String> {
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
        return Ok(CreateServerDirectoryResult {
            id: id.to_string(),
        });
    }

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    let id = resp
        .data
        .get("id")
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Server response missing directory id".to_string())?;

    Ok(CreateServerDirectoryResult { id })
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
    transfer_session: &mut UploadTransferSession,
) -> Result<UploadFileResult, String> {
    if !source.is_file() {
        return Err("Selected path is not a file".to_string());
    }

    let mut file_name = upload_name
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
    let mut create_resp = match send_action_request(
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

    if create_resp.code == 409 && matches!(conflict_strategy, UploadConflictStrategy::KeepBoth) {
        for suffix in 1..=10_000 {
            let candidate = suffixed_upload_name(&file_name, suffix);
            create_resp = match send_action_request(
                &conn,
                "create_document",
                serde_json::json!({
                    "title": candidate,
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
            if create_resp.code != 409 {
                file_name = candidate;
                break;
            }
        }
    }

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

    let transfer_conn = match transfer_session.get(&state.inner).await {
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
    if let Err(message) = result {
        transfer_session.discard().await;
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

    if transfer_conn.is_closed() {
        transfer_session.discard().await;
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

fn suffixed_upload_name(name: &str, suffix: usize) -> String {
    let path = std::path::Path::new(name);
    let extension = path.extension().and_then(|value| value.to_str());
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or(name);
    match extension {
        Some(extension) if !stem.is_empty() => format!("{stem} ({suffix}).{extension}"),
        _ => format!("{name} ({suffix})"),
    }
}

fn relative_upload_path(path: &std::path::Path) -> String {
    path.components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn split_listing_page(page: ListingCursorPage) -> ListDirectoryResponse {
    let mut folders = Vec::new();
    let mut documents = Vec::new();

    for item in page.items {
        match item {
            cfms_core::ServerListingItem::Directory(folder) => folders.push(folder),
            cfms_core::ServerListingItem::Document(document) => documents.push(document),
        }
    }

    ListDirectoryResponse {
        folders,
        documents,
        parent_id: page.parent_id,
    }
}

fn split_listing_page_dto(page: ListingCursorPage) -> ListDirectoryPageDto {
    let page_size = page.page_size;
    let next_cursor = page.next_cursor.clone();
    let has_more = page.has_more;
    let split = split_listing_page(page);

    ListDirectoryPageDto {
        folders: split.folders,
        documents: split.documents,
        parent_id: split.parent_id,
        page_size,
        next_cursor,
        has_more,
    }
}

fn merge_listing_response(target: &mut ListDirectoryResponse, page: ListingCursorPage) {
    target.parent_id = page.parent_id.clone();
    let split = split_listing_page(page);
    target.folders.extend(split.folders);
    target.documents.extend(split.documents);
}

async fn fetch_all_listing_pages(
    state: &AppHandleState,
    action: &str,
    mut data: serde_json::Value,
) -> Result<ListDirectoryResponse, String> {
    let mut combined = ListDirectoryResponse {
        folders: Vec::new(),
        documents: Vec::new(),
        parent_id: None,
    };
    let mut cursor: Option<String> = None;

    loop {
        data["page_size"] = serde_json::json!(SERVER_CURSOR_PAGE_SIZE);
        data["cursor"] = cursor
            .as_ref()
            .map(|value| serde_json::Value::String(value.clone()))
            .unwrap_or(serde_json::Value::Null);

        let page: ListingCursorPage = serde_json::from_value(server_action_json(state, action, data.clone()).await?)
            .map_err(|e| format!("Invalid {action} page response: {e}"))?;
        let has_more = page.has_more;
        cursor = page.next_cursor.clone();
        merge_listing_response(&mut combined, page);

        if !has_more {
            break;
        }
        if cursor.is_none() {
            return Err(format!("{action} reported more pages without next_cursor"));
        }
    }

    Ok(combined)
}

async fn fetch_all_cursor_items(
    state: &AppHandleState,
    action: &str,
    mut data: serde_json::Value,
) -> Result<Vec<serde_json::Value>, String> {
    let mut items = Vec::new();
    let mut cursor: Option<String> = None;

    loop {
        data["page_size"] = serde_json::json!(SERVER_CURSOR_PAGE_SIZE);
        data["cursor"] = cursor
            .as_ref()
            .map(|value| serde_json::Value::String(value.clone()))
            .unwrap_or(serde_json::Value::Null);

        let page: CursorPage<serde_json::Value> =
            serde_json::from_value(server_action_json(state, action, data.clone()).await?)
                .map_err(|e| format!("Invalid {action} page response: {e}"))?;
        let has_more = page.has_more;
        cursor = page.next_cursor.clone();
        items.extend(page.items);

        if !has_more {
            break;
        }
        if cursor.is_none() {
            return Err(format!("{action} reported more pages without next_cursor"));
        }
    }

    Ok(items)
}

fn split_search_page(mut page: CursorPage<serde_json::Value>) -> serde_json::Value {
    let mut documents = Vec::new();
    let mut directories = Vec::new();

    for item in page.items.drain(..) {
        match item.get("type").and_then(|value| value.as_str()) {
            Some("directory") => directories.push(item),
            Some("document") => documents.push(item),
            _ => {}
        }
    }

    serde_json::json!({
        "documents": documents,
        "directories": directories,
        "page_size": page.page_size,
        "next_cursor": page.next_cursor,
        "has_more": page.has_more,
    })
}

#[cfg(test)]
mod protocol_v15_tests {
    use super::*;

    #[test]
    fn split_listing_page_maps_v15_items_to_legacy_response() {
        let page: ListingCursorPage = serde_json::from_str(
            r#"{
                "items": [
                    { "type": "directory", "id": "dir", "name": "Folder", "created_time": 1.0 },
                    { "type": "document", "id": "doc", "title": "File", "name": "File", "size": 5, "last_modified": 2.0 }
                ],
                "page_size": 128,
                "next_cursor": null,
                "has_more": false,
                "parent_id": "/"
            }"#,
        )
        .unwrap();

        let split = split_listing_page(page);

        assert_eq!(split.folders.len(), 1);
        assert_eq!(split.folders[0].name, "Folder");
        assert_eq!(split.documents.len(), 1);
        assert_eq!(split.documents[0].title, "File");
        assert_eq!(split.parent_id.as_deref(), Some("/"));
    }

    #[test]
    fn split_listing_page_dto_preserves_cursor_metadata() {
        let page: ListingCursorPage = serde_json::from_str(
            r#"{
                "items": [
                    { "type": "directory", "id": "dir", "name": "Folder", "created_time": 1.0 },
                    { "type": "document", "id": "doc", "title": "File", "size": 5, "last_modified": 2.0 }
                ],
                "page_size": 128,
                "next_cursor": "next-page",
                "has_more": true,
                "parent_id": "parent"
            }"#,
        )
        .unwrap();

        let split = split_listing_page_dto(page);

        assert_eq!(split.folders.len(), 1);
        assert_eq!(split.documents.len(), 1);
        assert_eq!(split.parent_id.as_deref(), Some("parent"));
        assert_eq!(split.page_size, 128);
        assert_eq!(split.next_cursor.as_deref(), Some("next-page"));
        assert!(split.has_more);
    }

    #[test]
    fn directory_page_size_is_clamped_to_protocol_limits() {
        assert_eq!(directory_page_size(None), SERVER_CURSOR_PAGE_SIZE);
        assert_eq!(directory_page_size(Some(0)), 1);
        assert_eq!(directory_page_size(Some(32)), 32);
        assert_eq!(directory_page_size(Some(10_000)), SERVER_CURSOR_PAGE_SIZE);
    }

    #[test]
    fn invalid_listing_page_returns_a_descriptive_error() {
        let error = parse_listing_page_dto(serde_json::json!({ "has_more": false }))
            .expect_err("missing page fields must fail");

        assert!(error.starts_with("Invalid list_directory page response:"));
    }

    #[test]
    fn split_search_page_preserves_cursor_metadata() {
        let page: CursorPage<serde_json::Value> = serde_json::from_str(
            r#"{
                "items": [
                    { "type": "directory", "id": "dir", "name": "Folder" },
                    { "type": "document", "id": "doc", "name": "File", "size": 5 }
                ],
                "page_size": 64,
                "next_cursor": "cursor",
                "has_more": true
            }"#,
        )
        .unwrap();

        let split = split_search_page(page);

        assert_eq!(split["directories"].as_array().unwrap().len(), 1);
        assert_eq!(split["documents"].as_array().unwrap().len(), 1);
        assert_eq!(split["page_size"], 64);
        assert_eq!(split["next_cursor"], "cursor");
        assert_eq!(split["has_more"], true);
    }

    #[test]
    fn keep_both_suffix_preserves_file_extension() {
        assert_eq!(suffixed_upload_name("report.pdf", 2), "report (2).pdf");
        assert_eq!(suffixed_upload_name("README", 1), "README (1)");
    }

    #[test]
    fn relative_upload_paths_use_protocol_separators() {
        let path = std::path::Path::new("nested").join("reports").join("summary.txt");
        assert_eq!(relative_upload_path(&path), "nested/reports/summary.txt");
    }
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
    *state.inner.lockdown_reason.write().await = None;
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
    let has_preference_dek = inner.dek.read().await.is_some();

    let mut status = serde_json::json!({
        "username": username,
        "nickname": nickname,
        "has_token": has_token,
        "token_exp": token_exp,
        "permissions": permissions,
        "groups": groups,
        "avatar_path": inner.avatar_path.read().await.clone(),
        "has_server_preference_dek": has_server_preference_dek,
        "has_preference_dek": has_preference_dek,
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
    let lockdown_reason = inner.lockdown_reason.read().await.clone();

    serde_json::json!({
        "connected": connected,
        "server_address": server_address,
        "server_name": server_name,
        "protocol_version": *protocol_version,
        "lockdown": lockdown,
        "lockdown_reason": lockdown_reason,
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
