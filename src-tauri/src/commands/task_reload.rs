// Download task reload (mirrors reference/src/include/classes/services/download.py)
// ---------------------------------------------------------------------------

/// Reload download tasks for the current user.
///
/// Loads tasks from the per-user encrypted JSON file into the in-memory queue.
/// Must be called after login (when username, server_address, and DEK are set).
///
/// Mirrors [`reload_tasks_for_user`] in the Python reference.
#[tauri::command]
pub async fn reload_tasks_for_user(
    state: tauri::State<'_, AppHandleState>,
) -> Result<usize, String> {
    let username = {
        let u = state.inner.username.read().await;
        u.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;

    let server_hash = cfms_core::get_server_hash(&server_addr);

    let dek = {
        let d = state.inner.dek.read().await;
        d.clone()
    };

    let count = state
        .tasks
        .load_for_user(&state.app_data_dir, &server_hash, &username, dek.as_deref())
        .map_err(|e| format!("Failed to load download tasks: {e}"))?;

    tracing::info!("Reloaded {count} download tasks for user {username}");
    Ok(count)
}

// ---------------------------------------------------------------------------
