use super::server_actions::server_action_json;
use super::shared_helpers::format_server_error_parts;
use super::transfer_helpers::download_root;
use super::transfer_helpers::non_empty_optional;
use super::transfer_helpers::unix_now;
use crate::AppHandleState;
use cfms_core::CursorPage;
use cfms_core::DownloadTaskDto;
use cfms_core::DownloadTaskStatus;
use cfms_core::FileEntry;
use cfms_core::ListDirectoryResponse;
use cfms_core::NodeLookupResponse;
use cfms_core::ServiceEvent;
use cfms_service::files::ListDirectoryPageDto;
use cfms_service::files::directory_page_size;
use cfms_service::files::parse_listing_page_dto;
use cfms_service::files::supports_node_lookup;
use cfms_service::files::validate_node_lookup_response;
use cfms_service::files::{ListingCursorPage, SERVER_CURSOR_PAGE_SIZE, merge_listing_response};
use cfms_service::transfers::download_queue;
use tauri::Manager;

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
        "core.directory.list",
        serde_json::json!({"folder_id": folder_id}),
    )
    .await
}

/// Fetch a single cursor page from a server-side directory listing.
///
/// The existing `list_directory` command remains available for callers that
/// require a complete response. Interactive file browsing uses this command so
/// the Webview can display the first page while later pages are still loading.
#[tauri::command]
pub async fn list_directory_page(
    state: tauri::State<'_, AppHandleState>,
    folder_id: Option<String>,
    cursor: Option<String>,
    page_size: Option<u32>,
) -> Result<ListDirectoryPageDto, String> {
    let raw = server_action_json(
        &state,
        "core.directory.list",
        serde_json::json!({
            "folder_id": folder_id,
            "cursor": cursor,
            "page_size": directory_page_size(page_size),
        }),
    )
    .await?;
    parse_listing_page_dto(raw)
}

/// Resolve one absolute, human-readable path through the optional
/// `node_lookup` server extension.
#[tauri::command]
pub async fn resolve_node_path(
    state: tauri::State<'_, AppHandleState>,
    path: String,
) -> Result<NodeLookupResponse, String> {
    let has_node_lookup = {
        let extension_flags = state.inner.server_extension_flags.read().await;
        supports_node_lookup(&extension_flags)
    };
    if !has_node_lookup {
        return Err("The connected server does not advertise node_lookup support".to_string());
    }

    let raw = server_action_json(
        &state,
        "node_lookup.node.resolve",
        serde_json::json!({ "path": path }),
    )
    .await?;
    let response: NodeLookupResponse = serde_json::from_value(raw)
        .map_err(|error| format!("Invalid node_lookup response: {error}"))?;
    validate_node_lookup_response(response)
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
    let server_task = download_queue::request_server_download_task(&state.inner, &document_id)
        .await
        .map_err(format_download_task_request_error)?;
    let task_id = server_task.task_id;
    let supports_resume = server_task.supports_resume;

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
        failure_kind: None,
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
        server_task_recreate_count: 0,
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
        .rfind(|part| !part.is_empty())
        .unwrap_or(path_or_name)
        .to_string()
}

fn format_download_task_request_error(error: cfms_core::Error) -> String {
    match error {
        cfms_core::Error::Server {
            code,
            message,
            scope,
            limit,
            retry_after_seconds,
            task_status,
            retryable,
        } => {
            let mut data = serde_json::Map::new();
            if let Some(scope) = scope {
                data.insert("scope".into(), scope.into());
            }
            if let Some(limit) = limit {
                data.insert("limit".into(), limit.into());
            }
            if let Some(seconds) = retry_after_seconds {
                data.insert("retry_after_seconds".into(), seconds.into());
            }
            if let Some(task_status) = task_status {
                data.insert("task_status".into(), task_status.into());
            }
            if let Some(retryable) = retryable {
                data.insert("retryable".into(), retryable.into());
            }
            format_server_error_parts(code, &message, &serde_json::Value::Object(data))
        }
        error => error.to_string(),
    }
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

pub(super) async fn fetch_all_listing_pages(
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

        let page: ListingCursorPage =
            serde_json::from_value(server_action_json(state, action, data.clone()).await?)
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

pub(super) async fn fetch_all_cursor_items(
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
