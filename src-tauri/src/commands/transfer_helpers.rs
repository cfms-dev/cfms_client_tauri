use super::session::get_connection_auth;
use super::shared_helpers::format_server_response_error;
use super::shared_helpers::format_transport_error;
use super::shared_helpers::send_action_request;
#[cfg(target_os = "android")]
use super::transfer_types::AndroidImportedUploadPath;
use super::transfer_types::PreparedUploadSource;
use super::transfer_types::UploadConflictStrategy;
use super::transfer_types::UploadFileResult;
use super::transfer_types::UploadProgressEvent;
use super::upload_tasks::emit_upload_snapshot;
#[cfg(target_os = "android")]
use crate::AndroidUploadFileImporter;
use crate::AppHandleState;
use crate::UploadInterruption;
use cfms_service::transfers::MAX_UPLOAD_RETRIES;
use cfms_service::transfers::suffixed_upload_name;
use cfms_service::transfers::upload_retry_delay;
use tauri::Emitter;
use tauri::Manager;
use tauri::Runtime;

pub(super) fn download_root(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
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

pub(super) async fn create_transfer_connection(
    state: &cfms_service::state::AppState,
) -> cfms_core::Result<cfms_transport::Connection> {
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

    let url = url.ok_or_else(|| cfms_core::Error::Other("No server address configured".into()))?;
    let ca_dir =
        ca_dir.ok_or_else(|| cfms_core::Error::Other("No CA directory configured".into()))?;

    let tls_config = cfms_transport::tls::build_config_with_identity(
        &ca_dir,
        disable_ssl,
        client_cert_path.as_deref(),
        client_key_path.as_deref(),
        std::sync::Arc::clone(&state.crl_service),
    )?;

    cfms_transport::Connection::connect(&url, tls_config, proxy_addr.as_deref(), force_ipv4).await
}

pub(super) struct UploadTransferSession {
    pub(super) conn: Option<cfms_transport::Connection>,
    pub(super) directory_progress: Option<(u64, u64)>,
}

impl UploadTransferSession {
    pub(super) fn new() -> Self {
        Self {
            conn: None,
            directory_progress: None,
        }
    }

    async fn get(
        &mut self,
        state: &cfms_service::state::AppState,
    ) -> cfms_core::Result<cfms_transport::Connection> {
        if self
            .conn
            .as_ref()
            .is_some_and(cfms_transport::Connection::is_closed)
            && let Some(conn) = self.conn.take()
        {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(5), conn.close()).await;
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
            let _ = tokio::time::timeout(std::time::Duration::from_secs(5), conn.close()).await;
        }
    }

    pub(super) async fn close(&mut self) {
        if let Some(conn) = self.conn.take() {
            tauri::async_runtime::spawn(async move {
                let _ = tokio::time::timeout(std::time::Duration::from_secs(5), conn.close()).await;
            });
        }
    }
}

impl Drop for UploadTransferSession {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take() {
            tauri::async_runtime::spawn(async move {
                let _ = tokio::time::timeout(std::time::Duration::from_secs(5), conn.close()).await;
            });
        }
    }
}

pub(super) async fn wait_for_upload_resume<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    control: &mut tokio::sync::watch::Receiver<Option<UploadInterruption>>,
) -> Result<(), UploadInterruption> {
    loop {
        match *control.borrow() {
            None => return Ok(()),
            Some(UploadInterruption::Cancelled) => return Err(UploadInterruption::Cancelled),
            Some(UploadInterruption::Paused) => {
                app.state::<AppHandleState>().active_uploads.park(id);
            }
        }
        if control.changed().await.is_err() {
            return Err(UploadInterruption::Cancelled);
        }
    }
}

pub(super) struct CreateServerDirectoryResult {
    pub(super) id: String,
}

pub(super) async fn create_server_directory(
    state: &AppHandleState,
    parent_id: Option<String>,
    name: String,
    exists_ok: bool,
) -> Result<CreateServerDirectoryResult, String> {
    let (conn, username, token) = get_connection_auth(state).await?;
    let resp = send_action_request(
        &conn,
        "core.directory.create",
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
        return Ok(CreateServerDirectoryResult { id: id.to_string() });
    }

    if resp.code != 200 {
        return Err(format_server_response_error(&resp));
    }

    let id = resp
        .data
        .get("id")
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Server response missing directory id".to_string())?;

    Ok(CreateServerDirectoryResult { id })
}

pub(super) fn clean_optional_upload_name(name: Option<String>) -> Option<String> {
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
pub(super) fn prepare_upload_source<R: Runtime>(
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
pub(super) fn prepare_upload_source<R: Runtime>(
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
pub(super) fn prepare_upload_directory_source<R: Runtime>(
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
pub(super) fn prepare_upload_directory_source<R: Runtime>(
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

pub(super) async fn upload_local_file<R: Runtime>(
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
    let source_size = std::fs::metadata(&source).map(|m| m.len()).unwrap_or(0);
    let directory_progress = transfer_session.directory_progress;
    let emit_file_progress = move |app: &tauri::AppHandle<R>,
                                   id: &str,
                                   task_id: Option<&str>,
                                   name: &str,
                                   current: u64,
                                   total: u64,
                                   status: &str,
                                   message: Option<String>| {
        let (current, total) = if let Some((offset, all)) = directory_progress {
            (
                offset.saturating_add(if matches!(status, "completed" | "skipped") {
                    source_size
                } else {
                    current
                }),
                all,
            )
        } else {
            (current, total)
        };
        emit_upload_progress(app, id, task_id, name, current, total, status, message);
    };
    let mut upload_control = state
        .active_uploads
        .subscribe(&upload_id)
        .ok_or_else(|| "Upload must be submitted through the queue".to_string())?;
    wait_for_upload_resume(app_handle, &upload_id, &mut upload_control)
        .await
        .map_err(|reason| upload_interruption_message(reason).to_string())?;

    emit_file_progress(
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
            return Err(err);
        }
    };
    let mut create_resp = match send_action_request(
        &conn,
        "core.document.create",
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
            return Err(err);
        }
    };

    if create_resp.code == 409 && matches!(conflict_strategy, UploadConflictStrategy::KeepBoth) {
        for suffix in 1..=10_000 {
            let candidate = suffixed_upload_name(&file_name, suffix);
            create_resp = match send_action_request(
                &conn,
                "core.document.create",
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
                emit_file_progress(
                    app_handle,
                    &upload_id,
                    None,
                    &file_name,
                    0,
                    0,
                    "skipped",
                    Some("Skipped existing document".to_string()),
                );
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
                    "core.document.upload",
                    serde_json::json!({ "document_id": document_id }),
                    &username,
                    &token,
                )
                .await
                {
                    Ok(response) => response,
                    Err(err) => {
                        return Err(err);
                    }
                };

                if upload_resp.code != 200 {
                    return Err(format_server_response_error(&upload_resp));
                }

                overwritten = true;
                let task_id = match extract_task_id(&upload_resp.data) {
                    Ok(id) => id,
                    Err(err) => {
                        return Err(err);
                    }
                };
                (task_id, Some(document_id), false)
            }
            _ => {
                return Err(format_server_response_error(&create_resp));
            }
        }
    } else if create_resp.code != 200 {
        return Err(format_server_response_error(&create_resp));
    } else {
        let task_id = match extract_task_id(&create_resp.data) {
            Ok(id) => id,
            Err(err) => {
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

    let emit_handle = app_handle.clone();
    let progress_upload_id = upload_id.clone();
    let progress_task_id = task_id.clone();
    let progress_file_name = file_name.clone();
    let progress_run = state.active_uploads.run_id(&upload_id);
    let progress = move |current: u64, total: u64| {
        if emit_handle
            .state::<AppHandleState>()
            .active_uploads
            .run_id(&progress_upload_id)
            != progress_run
        {
            return;
        }
        emit_file_progress(
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

    let mut retry_attempt = 0u32;
    loop {
        let pending_interruption = *upload_control.borrow();
        if let Some(reason) = pending_interruption {
            transfer_session.discard().await;
            emit_interrupted_upload(app_handle, &upload_id, Some(&task_id), &file_name, reason);
            if reason == UploadInterruption::Cancelled {
                return Err(upload_interruption_message(reason).to_string());
            }
            if let Err(cancelled) =
                wait_for_upload_resume(app_handle, &upload_id, &mut upload_control).await
            {
                emit_interrupted_upload(
                    app_handle,
                    &upload_id,
                    Some(&task_id),
                    &file_name,
                    cancelled,
                );
                return Err(upload_interruption_message(cancelled).to_string());
            }
            retry_attempt = 0;
            emit_file_progress(
                app_handle,
                &upload_id,
                Some(&task_id),
                &file_name,
                0,
                0,
                "uploading",
                Some("Resuming upload".to_string()),
            );
        }

        let transfer_conn = match transfer_session.get(&state.inner).await {
            Ok(conn) => conn,
            Err(error) => {
                let Some(delay) = upload_retry_delay(&error, retry_attempt) else {
                    let message = format_transport_error(&error);
                    emit_file_progress(
                        app_handle,
                        &upload_id,
                        Some(&task_id),
                        &file_name,
                        0,
                        0,
                        "failed",
                        Some(message.clone()),
                    );
                    return Err(message);
                };

                retry_attempt += 1;
                state.upload_tasks.note_retry(&upload_id, retry_attempt);
                emit_file_progress(
                    app_handle,
                    &upload_id,
                    Some(&task_id),
                    &file_name,
                    0,
                    0,
                    "uploading",
                    Some(format!(
                        "Server temporarily unavailable; retrying upload (attempt {retry_attempt}/{MAX_UPLOAD_RETRIES})"
                    )),
                );
                tokio::select! {
                    _ = tokio::time::sleep(delay) => {}
                    _ = upload_control.changed() => {}
                }
                continue;
            }
        };
        state
            .active_uploads
            .set_transfer_conn(&upload_id, transfer_conn.clone());

        let attempt_result = tokio::select! {
            result = cfms_transfer::upload::send(
                &transfer_conn,
                &task_id,
                &source,
                false,
                &progress,
            ) => result,
            _ = upload_control.changed() => Err(cfms_core::Error::Cancelled),
        };
        state.active_uploads.clear_transfer_conn(&upload_id);

        match attempt_result {
            Ok(()) => {
                if transfer_conn.is_closed() {
                    transfer_session.discard().await;
                }
                break;
            }
            Err(error) => {
                transfer_session.discard().await;
                if upload_control.borrow().is_some() {
                    continue;
                }
                let Some(delay) = upload_retry_delay(&error, retry_attempt) else {
                    let message = format_transport_error(&error);
                    emit_file_progress(
                        app_handle,
                        &upload_id,
                        Some(&task_id),
                        &file_name,
                        0,
                        0,
                        "failed",
                        Some(message.clone()),
                    );
                    return Err(message);
                };

                retry_attempt += 1;
                state.upload_tasks.note_retry(&upload_id, retry_attempt);
                emit_file_progress(
                    app_handle,
                    &upload_id,
                    Some(&task_id),
                    &file_name,
                    0,
                    0,
                    "uploading",
                    Some(format!(
                        "Connection interrupted; resuming upload (attempt {retry_attempt}/{MAX_UPLOAD_RETRIES})"
                    )),
                );
                tokio::select! {
                    _ = tokio::time::sleep(delay) => {}
                    _ = upload_control.changed() => {}
                }
            }
        }
    }

    emit_file_progress(
        app_handle,
        &upload_id,
        Some(&task_id),
        &file_name,
        std::fs::metadata(&source).map(|m| m.len()).unwrap_or(0),
        std::fs::metadata(&source).map(|m| m.len()).unwrap_or(0),
        "completed",
        Some("Upload completed".to_string()),
    );

    Ok(UploadFileResult {
        upload_id,
        task_id: Some(task_id),
        document_id,
        file_name,
        skipped,
        overwritten,
    })
}

pub(super) fn upload_interruption_message(reason: UploadInterruption) -> &'static str {
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
    let state = app_handle.state::<AppHandleState>();
    if state.active_uploads.generation(upload_id) != Some(state.upload_tasks.generation()) {
        return;
    }
    let persistent_status = match status {
        "pending" => cfms_core::UploadTaskStatus::Pending,
        "paused" => cfms_core::UploadTaskStatus::Paused,
        "interrupted" => cfms_core::UploadTaskStatus::Interrupted,
        "completed" => cfms_core::UploadTaskStatus::Completed,
        "failed" => cfms_core::UploadTaskStatus::Failed,
        "cancelled" => cfms_core::UploadTaskStatus::Cancelled,
        "skipped" => cfms_core::UploadTaskStatus::Skipped,
        _ => cfms_core::UploadTaskStatus::Uploading,
    };
    app_handle
        .state::<AppHandleState>()
        .upload_tasks
        .update_progress(
            upload_id,
            task_id,
            file_name,
            current_bytes,
            total_bytes,
            persistent_status,
            message.clone(),
        );

    emit_upload_snapshot(app_handle, upload_id);
    // This event is a notification for mounted file views, not a scheduler callback.
    if let Some(task) = state.upload_tasks.get(upload_id) {
        let _ = app_handle.emit(
            "cfms:upload-progress",
            UploadProgressEvent {
                upload_id: task.upload_id,
                task_id: task.task_id,
                file_name: task.file_name,
                current_bytes: task.current_bytes,
                total_bytes: task.total_bytes,
                progress: task.progress,
                status: serde_json::to_value(task.status)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_string))
                    .unwrap_or_default(),
                message: task.message,
            },
        );
    }
}

fn extract_task_id(data: &serde_json::Value) -> Result<String, String> {
    data.get("task_data")
        .and_then(|value| value.get("task_id"))
        .or_else(|| data.get("task_id"))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Server response missing task_id".to_string())
}

pub(super) fn non_empty_optional(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

/// Current Unix timestamp in seconds.
pub(super) fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
