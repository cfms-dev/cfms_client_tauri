// File scanning
// ---------------------------------------------------------------------------

/// Scan a local directory recursively with parallel traversal.
#[tauri::command]
pub async fn scan_directory(
    path: String,
    pattern: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    let p = std::path::Path::new(&path);
    cfms_service::scan::scan_directory(p, pattern.as_deref())
        .map_err(|e| format!("Scan failed: {e}"))
}

// ---------------------------------------------------------------------------
// Server-side file browsing (mirrors reference/src/include/ui/util/path.py)
// ---------------------------------------------------------------------------

/// List a directory on the CFMS server.
///
/// Sends the `list_directory` action over the active WSS connection.
/// Pass `folder_id = None` to list the root directory.
///
/// Returns a [`ListDirectoryResponse`] containing sub-folders, documents,
/// and the parent folder ID.
#[tauri::command]
pub async fn list_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: Option<String>,
) -> Result<ListDirectoryResponse, String> {
    fetch_all_listing_pages(
        &state,
        "list_directory",
        serde_json::json!({"folder_id": folder_id}),
    )
    .await
}

/// Request a document download from the CFMS server.
///
/// Sends the `get_document` action, receives a download task from the server,
/// and adds it to the persistent download queue.
///
/// Mirrors [`get_document`] from the Python reference (`path.py`).
#[tauri::command]
pub async fn get_document(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    filename: String,
    batch_id: Option<String>,
    batch_name: Option<String>,
    batch_root_id: Option<String>,
    batch_created_at: Option<i64>,
    batch_estimated_total: Option<u32>,
) -> Result<serde_json::Value, String> {
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    let username = {
        let u = state.inner.username.read().await;
        u.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let token = {
        let t = state.inner.token.read().await;
        t.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let resp = send_action_request(
        &conn,
        "get_document",
        serde_json::json!({"document_id": document_id}),
        &username,
        &token,
    )
    .await?;

    // Handle 403 (Access Denied)
    if resp.code == 403 {
        return Err(format!("Access denied: {}", resp.message));
    }

    // Handle 404 (Not Found)
    if resp.code == 404 {
        return Err("Document not found on server".to_string());
    }

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    // Extract task data from the server response.
    let task_data = &resp.data["task_data"];
    let task_id = task_data["task_id"]
        .as_str()
        .ok_or_else(|| "Server response missing task_id".to_string())?
        .to_string();
    let _start_time = task_data["start_time"].as_f64().unwrap_or(0.0);
    let _end_time = task_data["end_time"].as_f64().unwrap_or(0.0);
    let supports_resume = task_data["supports_resume"].as_bool().unwrap_or(false);

    // Build a local download path.  Use the Tauri download directory when
    // available; otherwise fall back to the app data directory.
    let download_root = app_handle
        .path()
        .resolve("downloads", tauri::path::BaseDirectory::Download)
        .unwrap_or_else(|_| {
            app_handle
                .path()
                .resolve("downloads", tauri::path::BaseDirectory::AppData)
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
        });

    // Ensure the download directory exists.
    let _ = std::fs::create_dir_all(&download_root);

    let file_path = download_root.join(&filename);
    let display_filename = download_display_filename(&filename);
    let now = unix_now();

    let task = DownloadTaskDto {
        task_id: task_id.clone(),
        file_id: document_id.clone(),
        filename: display_filename.clone(),
        file_path: file_path.to_string_lossy().into_owned(),
        status: DownloadTaskStatus::Pending,
        progress: 0.0,
        current_bytes: 0,
        total_bytes: 0,
        message: None,
        error: None,
        created_at: now,
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
        batch_id: non_empty_optional(batch_id),
        batch_name: non_empty_optional(batch_name),
        batch_root_id: non_empty_optional(batch_root_id),
        batch_created_at,
        batch_estimated_total,
    };

    // Persist the download task so the download queue service picks it up.
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
        "file_id": document_id,
        "filename": display_filename,
        "file_path": task.file_path,
    }))
}

fn download_display_filename(path_or_name: &str) -> String {
    path_or_name
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .next_back()
        .unwrap_or(path_or_name)
        .to_string()
}

/// Create a subdirectory under the local download root.
#[tauri::command]
pub async fn ensure_download_subdirectory(
    app_handle: tauri::AppHandle,
    relative_path: String,
) -> Result<String, String> {
    let download_root = download_root(&app_handle)?;
    let directory_path = resolve_download_subdirectory(download_root, &relative_path)?;
    std::fs::create_dir_all(&directory_path)
        .map_err(|e| format!("Failed to create download directory: {e}"))?;

    Ok(directory_path.to_string_lossy().into_owned())
}

fn resolve_download_subdirectory(
    mut root: std::path::PathBuf,
    relative_path: &str,
) -> Result<std::path::PathBuf, String> {
    for raw_part in relative_path.split(['/', '\\']) {
        let part = raw_part.trim();
        if part.is_empty() || part == "." {
            continue;
        }

        if part == ".." || part.contains(':') || part.contains('\0') {
            return Err("Invalid download directory path".to_string());
        }

        root.push(part);
    }

    Ok(root)
}

// ---------------------------------------------------------------------------
