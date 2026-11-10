use super::server_actions::server_action_bool;
use super::server_actions::server_action_json;
use crate::AppHandleState;
use cfms_service::files::SERVER_CURSOR_PAGE_SIZE;

// Core protocol 27 durable schedule management.

#[tauri::command]
pub async fn list_scheduled_task_types(
    state: tauri::State<'_, AppHandleState>,
) -> Result<Vec<cfms_core::ScheduledTaskType>, String> {
    let raw = server_action_json(
        &state,
        "core.schedule.task_type.list",
        serde_json::json!({}),
    )
    .await?;
    serde_json::from_value(raw.get("items").cloned().unwrap_or_default())
        .map_err(|error| format!("Invalid scheduled task type response: {error}"))
}

#[tauri::command]
pub async fn list_schedules(
    state: tauri::State<'_, AppHandleState>,
    cursor: Option<String>,
    page_size: Option<u32>,
    include_deleted: bool,
) -> Result<cfms_core::CursorPage<cfms_core::Schedule>, String> {
    let raw = server_action_json(
        &state,
        "core.schedule.list",
        serde_json::json!({
            "cursor": cursor,
            "page_size": page_size
                .unwrap_or(SERVER_CURSOR_PAGE_SIZE)
                .clamp(1, SERVER_CURSOR_PAGE_SIZE),
            "include_deleted": include_deleted,
        }),
    )
    .await?;
    serde_json::from_value(raw).map_err(|error| format!("Invalid schedule list response: {error}"))
}

#[tauri::command]
pub async fn get_schedule(
    state: tauri::State<'_, AppHandleState>,
    id: String,
) -> Result<cfms_core::Schedule, String> {
    let raw =
        server_action_json(&state, "core.schedule.get", serde_json::json!({ "id": id })).await?;
    serde_json::from_value(raw).map_err(|error| format!("Invalid schedule response: {error}"))
}

#[tauri::command]
pub async fn create_schedule(
    state: tauri::State<'_, AppHandleState>,
    task_name: String,
    payload: serde_json::Value,
    trigger: cfms_core::ScheduleTrigger,
    enabled: bool,
) -> Result<cfms_core::Schedule, String> {
    let raw = server_action_json(
        &state,
        "core.schedule.create",
        serde_json::json!({
            "task_name": task_name,
            "payload": payload,
            "trigger": trigger,
            "enabled": enabled,
        }),
    )
    .await?;
    serde_json::from_value(raw)
        .map_err(|error| format!("Invalid created schedule response: {error}"))
}

#[tauri::command]
pub async fn update_schedule(
    state: tauri::State<'_, AppHandleState>,
    id: String,
    revision: u64,
    task_name: Option<String>,
    payload: Option<serde_json::Value>,
    trigger: Option<cfms_core::ScheduleTrigger>,
    enabled: Option<bool>,
) -> Result<cfms_core::Schedule, String> {
    let mut data = serde_json::json!({ "id": id, "revision": revision });
    let object = data
        .as_object_mut()
        .expect("schedule update payload is always an object");
    if let Some(task_name) = task_name {
        object.insert("task_name".to_string(), serde_json::json!(task_name));
    }
    if let Some(payload) = payload {
        object.insert("payload".to_string(), payload);
    }
    if let Some(trigger) = trigger {
        object.insert("trigger".to_string(), serde_json::json!(trigger));
    }
    if let Some(enabled) = enabled {
        object.insert("enabled".to_string(), serde_json::json!(enabled));
    }

    let raw = server_action_json(&state, "core.schedule.update", data).await?;
    serde_json::from_value(raw)
        .map_err(|error| format!("Invalid updated schedule response: {error}"))
}

#[tauri::command]
pub async fn delete_schedule(
    state: tauri::State<'_, AppHandleState>,
    id: String,
    revision: u64,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "core.schedule.delete",
        serde_json::json!({ "id": id, "revision": revision }),
    )
    .await
}
