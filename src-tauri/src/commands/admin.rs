// Administration / management operations
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_users(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    let mut users = Vec::new();
    let mut offset = 0u32;
    let mut total = 0u32;

    loop {
        let page = server_action_json(
            &state,
            "list_users",
            serde_json::json!({ "offset": offset, "count": SERVER_CURSOR_PAGE_SIZE }),
        )
        .await?;
        total = page.get("total").and_then(|value| value.as_u64()).unwrap_or(total as u64) as u32;
        let page_users = page
            .get("users")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        let count = page_users.len() as u32;
        users.extend(page_users);

        if !page.get("has_more").and_then(|value| value.as_bool()).unwrap_or(false) {
            break;
        }
        if count == 0 {
            return Err("list_users reported more pages without users".to_string());
        }
        offset += count;
    }

    let count = users.len();
    Ok(serde_json::json!({
        "users": users,
        "total": total,
        "offset": 0,
        "count": count,
        "has_more": false,
    }))
}

#[tauri::command]
pub async fn create_user(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    password: String,
    nickname: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "create_user",
        serde_json::json!({
            "username": username,
            "password": password,
            "nickname": nickname,
            "permissions": [],
            "groups": [],
        }),
    )
    .await
}

#[tauri::command]
pub async fn rename_user(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    nickname: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "rename_user",
        serde_json::json!({ "username": username, "nickname": nickname }),
    )
    .await
}

#[tauri::command]
pub async fn delete_user(
    state: tauri::State<'_, AppHandleState>,
    username: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "delete_user",
        serde_json::json!({ "username": username }),
    )
    .await
}

#[tauri::command]
pub async fn get_user_info(
    state: tauri::State<'_, AppHandleState>,
    username: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "get_user_info",
        serde_json::json!({ "username": username }),
    )
    .await
}

#[tauri::command]
pub async fn change_user_groups(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    groups: Vec<String>,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "change_user_groups",
        serde_json::json!({ "username": username, "groups": groups }),
    )
    .await
}

#[tauri::command]
pub async fn change_user_permissions(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    permissions: Vec<String>,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "change_user_permissions",
        serde_json::json!({ "username": username, "permissions": permissions }),
    )
    .await
}

#[tauri::command]
pub async fn reset_user_password(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    new_password: String,
    bypass_passwd_requirements: bool,
    force_update_after_login: bool,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "set_passwd",
        serde_json::json!({
            "username": username,
            "old_passwd": "",
            "new_passwd": new_password,
            "bypass_passwd_requirements": bypass_passwd_requirements,
            "force_update_after_login": force_update_after_login,
        }),
    )
    .await
}

#[tauri::command]
pub async fn manage_user_status(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    status: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "manage_user_status",
        serde_json::json!({ "username": username, "status": status }),
    )
    .await
}

#[tauri::command]
pub async fn set_lockdown(
    state: tauri::State<'_, AppHandleState>,
    status: bool,
) -> Result<bool, String> {
    let changed =
        server_action_bool(&state, "lockdown", serde_json::json!({ "status": status })).await?;

    state
        .inner
        .app_lockdown
        .store(status, std::sync::atomic::Ordering::SeqCst);
    let _ = state
        .inner
        .event_tx
        .send(cfms_core::ServiceEvent::Lockdown { status });

    Ok(changed)
}

#[tauri::command]
pub async fn block_user(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    block_types: Vec<String>,
    target: serde_json::Value,
    not_after: Option<f64>,
) -> Result<bool, String> {
    let mut data = serde_json::json!({
        "username": username,
        "block_types": block_types,
        "target": target,
    });
    if let Some(value) = not_after {
        data["not_after"] = serde_json::json!(value);
    }

    server_action_bool(&state, "block_user", data).await
}

#[tauri::command]
pub async fn list_user_blocks(
    state: tauri::State<'_, AppHandleState>,
    username: String,
) -> Result<serde_json::Value, String> {
    let items = fetch_all_cursor_items(
        &state,
        "list_user_blocks",
        serde_json::json!({ "username": username }),
    )
    .await?;

    Ok(serde_json::json!({ "blocks": items }))
}

#[tauri::command]
pub async fn unblock_user(
    state: tauri::State<'_, AppHandleState>,
    block_id: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "unblock_user",
        serde_json::json!({ "block_id": block_id }),
    )
    .await
}

#[tauri::command]
pub async fn list_groups(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    let mut groups = Vec::new();
    let mut offset = 0u32;
    let mut total = 0u32;

    loop {
        let page = server_action_json(
            &state,
            "list_groups",
            serde_json::json!({ "offset": offset, "count": SERVER_CURSOR_PAGE_SIZE }),
        )
        .await?;
        total = page.get("total").and_then(|value| value.as_u64()).unwrap_or(total as u64) as u32;
        let page_groups = page
            .get("groups")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        let count = page_groups.len() as u32;
        groups.extend(page_groups);

        if !page.get("has_more").and_then(|value| value.as_bool()).unwrap_or(false) {
            break;
        }
        if count == 0 {
            return Err("list_groups reported more pages without groups".to_string());
        }
        offset += count;
    }

    let count = groups.len();
    Ok(serde_json::json!({
        "groups": groups,
        "total": total,
        "offset": 0,
        "count": count,
        "has_more": false,
    }))
}

#[tauri::command]
pub async fn create_group(
    state: tauri::State<'_, AppHandleState>,
    group_name: String,
    display_name: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "create_group",
        serde_json::json!({
            "group_name": group_name,
            "display_name": display_name,
            "permissions": [],
        }),
    )
    .await
}

#[tauri::command]
pub async fn rename_group(
    state: tauri::State<'_, AppHandleState>,
    group_name: String,
    display_name: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "rename_group",
        serde_json::json!({ "group_name": group_name, "display_name": display_name }),
    )
    .await
}

#[tauri::command]
pub async fn delete_group(
    state: tauri::State<'_, AppHandleState>,
    group_name: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "delete_group",
        serde_json::json!({ "group_name": group_name }),
    )
    .await
}

#[tauri::command]
pub async fn get_group_info(
    state: tauri::State<'_, AppHandleState>,
    group_name: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "get_group_info",
        serde_json::json!({ "group_name": group_name }),
    )
    .await
}

#[tauri::command]
pub async fn change_group_permissions(
    state: tauri::State<'_, AppHandleState>,
    group_name: String,
    permissions: Vec<String>,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "change_group_permissions",
        serde_json::json!({ "group_name": group_name, "permissions": permissions }),
    )
    .await
}

#[tauri::command]
pub async fn view_audit_logs(
    state: tauri::State<'_, AppHandleState>,
    cursor: Option<String>,
    page_size: Option<u32>,
    filters: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let raw = server_action_json(
        &state,
        "view_audit_logs",
        serde_json::json!({
            "cursor": cursor,
            "page_size": page_size.unwrap_or(SERVER_CURSOR_PAGE_SIZE).clamp(1, SERVER_CURSOR_PAGE_SIZE),
            "filters": filters.unwrap_or_default(),
        }),
    )
    .await?;
    let page: CursorPage<serde_json::Value> =
        serde_json::from_value(raw).map_err(|e| format!("Invalid audit log response: {e}"))?;

    Ok(serde_json::json!({
        "entries": page.items,
        "page_size": page.page_size,
        "next_cursor": page.next_cursor,
        "has_more": page.has_more,
    }))
}

#[tauri::command]
pub async fn list_user_keys(
    state: tauri::State<'_, AppHandleState>,
    target_username: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut keys = Vec::new();
    let mut offset = 0u32;
    let mut total = 0u32;

    loop {
        let mut data = serde_json::json!({
            "offset": offset,
            "count": SERVER_CURSOR_PAGE_SIZE,
        });
        if let Some(username) = target_username.as_deref().filter(|value| !value.trim().is_empty()) {
            data["target_username"] = serde_json::Value::String(username.to_string());
        }

        let page = server_action_json(&state, "list_user_keys", data).await?;
        total = page.get("total").and_then(|value| value.as_u64()).unwrap_or(total as u64) as u32;
        let page_keys = page
            .get("keys")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        let count = page_keys.len() as u32;
        keys.extend(page_keys);

        if !page.get("has_more").and_then(|value| value.as_bool()).unwrap_or(false) {
            break;
        }
        if count == 0 {
            return Err("list_user_keys reported more pages without keys".to_string());
        }
        offset += count;
    }

    let count = keys.len();
    Ok(serde_json::json!({
        "keys": keys,
        "total": total,
        "offset": 0,
        "count": count,
        "has_more": false,
    }))
}

#[tauri::command]
pub async fn get_user_key(
    state: tauri::State<'_, AppHandleState>,
    id: String,
) -> Result<serde_json::Value, String> {
    server_action_json(&state, "get_user_key", serde_json::json!({ "id": id })).await
}

#[tauri::command]
pub async fn delete_user_key(
    state: tauri::State<'_, AppHandleState>,
    id: String,
) -> Result<bool, String> {
    server_action_bool(&state, "delete_user_key", serde_json::json!({ "id": id })).await
}

// ---------------------------------------------------------------------------
