// Server-side directory & document operations
// ---------------------------------------------------------------------------

/// Create a new directory on the CFMS server.
///
/// Mirrors [`create_directory`] from the Python reference (`create.py`).
#[tauri::command]
pub async fn create_directory(
    state: tauri::State<'_, AppHandleState>,
    parent_id: Option<String>,
    name: String,
    exists_ok: Option<bool>,
) -> Result<String, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "create_directory",
        serde_json::json!({"parent_id": parent_id, "name": name, "exists_ok": exists_ok.unwrap_or(false)}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    let id = resp.data["id"]
        .as_str()
        .ok_or_else(|| "Server response missing id".to_string())?
        .to_string();

    Ok(id)
}

/// Delete a directory on the CFMS server.
///
/// Mirrors `delete_directory` from the Python reference (`batch_operations.py`).
#[tauri::command]
pub async fn delete_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: String,
) -> Result<bool, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "delete_directory",
        serde_json::json!({"folder_id": folder_id}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    Ok(true)
}

/// Delete a document on the CFMS server.
///
/// Mirrors `delete_document` from the Python reference (`batch_operations.py`).
#[tauri::command]
pub async fn delete_document(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
) -> Result<bool, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "delete_document",
        serde_json::json!({"document_id": document_id}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    Ok(true)
}

/// Rename a directory on the CFMS server.
#[tauri::command]
pub async fn rename_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: String,
    new_name: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "rename_directory",
        serde_json::json!({ "folder_id": folder_id, "new_name": new_name }),
    )
    .await
}

/// Rename a document on the CFMS server.
#[tauri::command]
pub async fn rename_document(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    new_title: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "rename_document",
        serde_json::json!({ "document_id": document_id, "new_title": new_title }),
    )
    .await
}

/// Move a directory into another directory, or root when target is `None`.
#[tauri::command]
pub async fn move_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: String,
    target_folder_id: Option<String>,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "move_directory",
        serde_json::json!({
            "folder_id": folder_id,
            "target_folder_id": non_empty_optional(target_folder_id),
        }),
    )
    .await
}

/// Move a document into another directory, or root when target is `None`.
#[tauri::command]
pub async fn move_document(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    target_folder_id: Option<String>,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "move_document",
        serde_json::json!({
            "document_id": document_id,
            "target_folder_id": non_empty_optional(target_folder_id),
        }),
    )
    .await
}

/// Fetch server-side document properties.
#[tauri::command]
pub async fn get_document_info(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "get_document_info",
        serde_json::json!({ "document_id": document_id }),
    )
    .await
}

/// Set server-side document metadata tags.
#[tauri::command]
pub async fn set_document_tags(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    tags: Vec<String>,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "set_document_tags",
        serde_json::json!({ "document_id": document_id, "tags": tags }),
    )
    .await
}

/// Fetch server-side directory properties.
#[tauri::command]
pub async fn get_directory_info(
    state: tauri::State<'_, AppHandleState>,
    directory_id: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "get_directory_info",
        serde_json::json!({ "directory_id": directory_id }),
    )
    .await
}

/// View temporary access entries for a document or directory.
#[tauri::command]
pub async fn view_access_entries(
    state: tauri::State<'_, AppHandleState>,
    object_type: String,
    object_identifier: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "view_access_entries",
        serde_json::json!({
            "object_type": object_type,
            "object_identifier": object_identifier,
        }),
    )
    .await
}

/// Revoke a temporary access entry.
#[tauri::command]
pub async fn revoke_access(
    state: tauri::State<'_, AppHandleState>,
    entry_id: i64,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "revoke_access",
        serde_json::json!({ "entry_id": entry_id }),
    )
    .await
}

/// Grant temporary access to a document or directory.
#[tauri::command]
pub async fn grant_access(
    state: tauri::State<'_, AppHandleState>,
    entity_identifier: String,
    entity_type: String,
    target_type: String,
    target_identifier: String,
    access_types: Vec<String>,
    start_time: f64,
    end_time: f64,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "grant_access",
        serde_json::json!({
            "entity_identifier": entity_identifier,
            "entity_type": entity_type,
            "target_type": target_type,
            "target_identifier": target_identifier,
            "access_types": access_types,
            "start_time": start_time,
            "end_time": end_time,
        }),
    )
    .await
}

/// Fetch document or directory access rules.
#[tauri::command]
pub async fn get_access_rules(
    state: tauri::State<'_, AppHandleState>,
    object_type: String,
    object_id: String,
) -> Result<serde_json::Value, String> {
    match object_type.as_str() {
        "document" => {
            server_action_json(
                &state,
                "get_document_access_rules",
                serde_json::json!({ "document_id": object_id }),
            )
            .await
        }
        "directory" => {
            server_action_json(
                &state,
                "get_directory_access_rules",
                serde_json::json!({ "directory_id": object_id }),
            )
            .await
        }
        other => Err(format!("Invalid object type: {other}")),
    }
}

/// Set document or directory access rules.
#[tauri::command]
pub async fn set_access_rules(
    state: tauri::State<'_, AppHandleState>,
    object_type: String,
    object_id: String,
    access_rules: serde_json::Value,
    inherit_parent: bool,
) -> Result<bool, String> {
    match object_type.as_str() {
        "document" => {
            server_action_bool(
                &state,
                "set_document_rules",
                serde_json::json!({
                    "document_id": object_id,
                    "access_rules": access_rules,
                    "inherit_parent": inherit_parent,
                }),
            )
            .await
        }
        "directory" => {
            server_action_bool(
                &state,
                "set_directory_rules",
                serde_json::json!({
                    "directory_id": object_id,
                    "access_rules": access_rules,
                    "inherit_parent": inherit_parent,
                }),
            )
            .await
        }
        other => Err(format!("Invalid object type: {other}")),
    }
}

/// List all revisions for a document.
#[tauri::command]
pub async fn list_revisions(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "list_revisions",
        serde_json::json!({ "document_id": document_id }),
    )
    .await
}

/// Request a specific revision and enqueue it in the download queue.
#[tauri::command]
pub async fn get_revision(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    revision_id: String,
    filename: String,
    is_current: Option<bool>,
) -> Result<serde_json::Value, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "get_revision",
        serde_json::json!({ "id": revision_id.clone() }),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    let task_data = resp
        .data
        .get("task_data")
        .ok_or_else(|| "Server response missing task_data".to_string())?;
    let task_id = task_data["task_id"]
        .as_str()
        .ok_or_else(|| "Server response missing task_id".to_string())?
        .to_string();
    let supports_resume = task_data["supports_resume"].as_bool().unwrap_or(false);

    let local_filename = if is_current.unwrap_or(false) {
        filename
    } else {
        format!("rev{revision_id}_{filename}")
    };
    let download_root = download_root(&app_handle)?;
    std::fs::create_dir_all(&download_root)
        .map_err(|e| format!("Failed to create download directory: {e}"))?;
    let file_path = download_root.join(&local_filename);

    let task = DownloadTaskDto {
        task_id: task_id.clone(),
        file_id: revision_id.clone(),
        filename: local_filename.clone(),
        file_path: file_path.to_string_lossy().into_owned(),
        status: DownloadTaskStatus::Pending,
        progress: 0.0,
        current_bytes: 0,
        total_bytes: 0,
        message: None,
        error: None,
        created_at: unix_now(),
        started_at: None,
        completed_at: None,
        priority: 0,
        retry_count: 0,
        max_retries: 3,
        scheduled_time: None,
        stage: 0,
        bandwidth_limit: None,
        pause_position: None,
        supports_resume,
        batch_id: None,
        batch_name: None,
        batch_root_id: None,
        batch_created_at: None,
    };

    state
        .tasks
        .insert(&task)
        .map_err(|e| format!("Failed to add download: {e}"))?;
    let _ = state
        .inner
        .event_tx
        .send(ServiceEvent::DownloadTaskUpdated { task: task.clone() });
    let _ = state.inner.event_tx.send(ServiceEvent::ActiveCountChanged {
        count: state.tasks.active_count(),
    });

    Ok(serde_json::json!({
        "task_id": task_id,
        "file_id": revision_id,
        "filename": local_filename,
        "file_path": task.file_path,
    }))
}

/// Set a specific revision as the document's current revision.
#[tauri::command]
pub async fn set_current_revision(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    revision_id: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "set_current_revision",
        serde_json::json!({
            "document_id": document_id,
            "revision_id": revision_id,
        }),
    )
    .await
}

/// Upload a local file as a new revision for an existing document.
#[tauri::command]
pub async fn upload_new_revision<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    file_path: String,
) -> Result<serde_json::Value, String> {
    let source = prepare_upload_source(&app_handle, file_path)?;

    let (conn, username, token) = get_connection_auth(&state).await?;
    let resp = send_action_request(
        &conn,
        "upload_document",
        serde_json::json!({ "document_id": document_id }),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    let task_data = resp
        .data
        .get("task_data")
        .ok_or_else(|| "Server response missing task_data".to_string())?;
    let task_id = task_data["task_id"]
        .as_str()
        .ok_or_else(|| "Server response missing task_id".to_string())?
        .to_string();

    let transfer_conn = create_transfer_connection(&state.inner).await?;
    let emit_handle = app_handle.clone();
    let progress_document_id = document_id.clone();
    let progress_task_id = task_id.clone();
    let progress = move |current: u64, total: u64| {
        let progress = if total > 0 {
            current as f64 / total as f64
        } else {
            1.0
        };
        let _ = emit_handle.emit(
            "cfms:upload-revision-progress",
            UploadRevisionProgressEvent {
                document_id: progress_document_id.clone(),
                task_id: progress_task_id.clone(),
                current_bytes: current,
                total_bytes: total,
                progress,
            },
        );
    };

    let result =
        cfms_transfer::upload::send(&transfer_conn, &task_id, &source.path, &progress).await;
    transfer_conn.close().await;
    result.map_err(|e| format!("Upload failed: {e}"))?;

    let _ = app_handle.emit(
        "cfms:upload-revision-progress",
        UploadRevisionProgressEvent {
            document_id: document_id.clone(),
            task_id: task_id.clone(),
            current_bytes: 1,
            total_bytes: 1,
            progress: 1.0,
        },
    );

    Ok(serde_json::json!({
        "task_id": task_id,
        "document_id": document_id,
    }))
}

/// Upload a local file as a new document in a server-side directory.
#[tauri::command]
pub async fn upload_document_file<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    parent_id: Option<String>,
    file_path: String,
    upload_id: String,
    conflict_strategy: Option<UploadConflictStrategy>,
    upload_name: Option<String>,
) -> Result<serde_json::Value, String> {
    let source = prepare_upload_source(&app_handle, file_path)?;
    let upload_name =
        clean_optional_upload_name(upload_name).or_else(|| source.display_name.clone());
    let result = upload_local_file(
        &app_handle,
        &state,
        parent_id,
        source.path.clone(),
        upload_name,
        upload_id,
        conflict_strategy.unwrap_or_default(),
    )
    .await?;

    Ok(serde_json::json!({
        "upload_id": result.upload_id,
        "task_id": result.task_id,
        "document_id": result.document_id,
        "file_name": result.file_name,
        "skipped": result.skipped,
        "overwritten": result.overwritten,
    }))
}

/// Upload a local directory recursively, preserving its directory structure.
#[tauri::command]
pub async fn upload_directory<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    parent_id: Option<String>,
    directory_path: String,
    upload_id: String,
    conflict_strategy: Option<UploadConflictStrategy>,
    upload_name: Option<String>,
) -> Result<serde_json::Value, String> {
    let source = prepare_upload_directory_source(&app_handle, directory_path)?;
    let root = source.path.clone();
    if !root.is_dir() {
        return Err("Selected path is not a directory".to_string());
    }

    let root_name = clean_optional_upload_name(upload_name)
        .or_else(|| source.display_name.clone())
        .or_else(|| {
            root.file_name()
                .and_then(|name| name.to_str())
                .map(ToOwned::to_owned)
        })
        .ok_or_else(|| "Selected directory has no valid name".to_string())?;

    let root_id = create_server_directory(&state, parent_id, root_name, true).await?;
    let entries = collect_directory_entries(&root)?;
    let total_files = entries.iter().filter(|entry| entry.is_file()).count();
    let mut uploaded_files = 0usize;
    let mut dir_ids = std::collections::HashMap::<std::path::PathBuf, String>::new();
    dir_ids.insert(std::path::PathBuf::new(), root_id.clone());
    let conflict_strategy = conflict_strategy.unwrap_or_default();

    for entry in entries {
        let relative = entry
            .strip_prefix(&root)
            .map_err(|e| format!("Failed to resolve upload path: {e}"))?
            .to_path_buf();

        if entry.is_dir() {
            let parent_rel = relative
                .parent()
                .unwrap_or_else(|| std::path::Path::new(""));
            let parent_server_id = dir_ids
                .get(parent_rel)
                .cloned()
                .ok_or_else(|| "Missing parent directory while uploading".to_string())?;
            let name = entry
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| "Directory has no valid name".to_string())?
                .to_string();
            let id = create_server_directory(&state, Some(parent_server_id), name, true).await?;
            dir_ids.insert(relative, id);
            continue;
        }

        if entry.is_file() {
            let parent_rel = relative
                .parent()
                .unwrap_or_else(|| std::path::Path::new(""));
            let parent_server_id = dir_ids
                .get(parent_rel)
                .cloned()
                .ok_or_else(|| "Missing parent directory while uploading".to_string())?;
            upload_local_file(
                &app_handle,
                &state,
                Some(parent_server_id),
                entry,
                None,
                upload_id.clone(),
                conflict_strategy,
            )
            .await?;
            uploaded_files += 1;
        }
    }

    Ok(serde_json::json!({
        "upload_id": upload_id,
        "directory_id": root_id,
        "total_files": total_files,
        "uploaded_files": uploaded_files,
    }))
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn select_upload_directory<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<AndroidSelectedUploadDirectory, String> {
    let importer = app.state::<AndroidUploadFileImporter<R>>();
    importer
        .handle
        .run_mobile_plugin::<AndroidSelectedUploadDirectory>(
            "selectDirectory",
            serde_json::json!({}),
        )
        .map_err(|e| format!("Failed to select upload folder: {e}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn select_upload_directory<R: Runtime>(
    _app: tauri::AppHandle<R>,
) -> Result<AndroidSelectedUploadDirectory, String> {
    Err("Android folder picker is only available on Android.".to_string())
}

#[tauri::command]
pub async fn classify_upload_path(path: String) -> Result<String, String> {
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Failed to inspect upload path: {e}"))?;

    if metadata.is_dir() {
        Ok("directory".to_string())
    } else if metadata.is_file() {
        Ok("file".to_string())
    } else {
        Err("Dropped path is not a regular file or directory.".to_string())
    }
}

#[tauri::command]
pub async fn pause_upload(
    state: tauri::State<'_, AppHandleState>,
    upload_id: String,
) -> Result<bool, String> {
    Ok(state
        .active_uploads
        .interrupt(&upload_id, UploadInterruption::Paused))
}

#[tauri::command]
pub async fn resume_upload(_upload_id: String) -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub async fn cancel_upload(
    state: tauri::State<'_, AppHandleState>,
    upload_id: String,
) -> Result<bool, String> {
    Ok(state
        .active_uploads
        .interrupt(&upload_id, UploadInterruption::Cancelled))
}

/// Search documents and directories on the server.
#[tauri::command]
pub async fn search_files(
    state: tauri::State<'_, AppHandleState>,
    query: String,
    limit: Option<u32>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    search_documents: Option<bool>,
    search_directories: Option<bool>,
) -> Result<serde_json::Value, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("Search query cannot be empty".to_string());
    }

    server_action_json(
        &state,
        "search",
        serde_json::json!({
            "query": trimmed,
            "limit": limit.unwrap_or(100).clamp(1, 1000),
            "sort_by": sort_by.unwrap_or_else(|| "name".to_string()),
            "sort_order": sort_order.unwrap_or_else(|| "asc".to_string()),
            "search_documents": search_documents.unwrap_or(true),
            "search_directories": search_directories.unwrap_or(true),
        }),
    )
    .await
}

// ---------------------------------------------------------------------------
// Trash / recycle-bin operations
// ---------------------------------------------------------------------------

/// List deleted folders and documents for a server-side folder.
///
/// Mirrors the Python reference's `list_deleted_items` action used by the
/// TrashViewController.
#[tauri::command]
pub async fn list_deleted_items(
    state: tauri::State<'_, AppHandleState>,
    folder_id: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "list_deleted_items",
        serde_json::json!({ "folder_id": folder_id }),
    )
    .await
}

/// Restore a deleted document, optionally with a new title or destination.
#[tauri::command]
pub async fn restore_document(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    new_title: Option<String>,
    target_folder_id: Option<String>,
) -> Result<bool, String> {
    let mut data = serde_json::json!({ "document_id": document_id });
    if let Some(value) = non_empty_optional(new_title) {
        data["new_title"] = serde_json::Value::String(value);
    }
    if let Some(value) = non_empty_optional(target_folder_id) {
        data["target_folder_id"] = serde_json::Value::String(value);
    }

    server_action_bool(&state, "restore_document", data).await
}

/// Restore a deleted directory, optionally with a new name or destination.
#[tauri::command]
pub async fn restore_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: String,
    new_name: Option<String>,
    target_parent_id: Option<String>,
) -> Result<bool, String> {
    let mut data = serde_json::json!({ "folder_id": folder_id });
    if let Some(value) = non_empty_optional(new_name) {
        data["new_name"] = serde_json::Value::String(value);
    }
    if let Some(value) = non_empty_optional(target_parent_id) {
        data["target_parent_id"] = serde_json::Value::String(value);
    }

    server_action_bool(&state, "restore_directory", data).await
}

/// Permanently delete a document already marked as deleted.
#[tauri::command]
pub async fn purge_document(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "purge_document",
        serde_json::json!({ "document_id": document_id }),
    )
    .await
}

/// Permanently delete a directory already marked as deleted.
#[tauri::command]
pub async fn purge_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "purge_directory",
        serde_json::json!({ "folder_id": folder_id }),
    )
    .await
}

// ---------------------------------------------------------------------------
