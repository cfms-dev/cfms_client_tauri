use super::server_actions::{server_action_json, server_action_once};
use crate::AppHandleState;

#[tauri::command]
pub async fn list_server_settings(
    state: tauri::State<'_, AppHandleState>,
    namespace: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut data = serde_json::json!({});
    if let Some(namespace) = namespace {
        data["namespace"] = namespace.into();
    }
    server_action_json(&state, "core.setting.list", data).await
}

#[tauri::command]
pub async fn get_server_settings(
    state: tauri::State<'_, AppHandleState>,
    namespace: String,
    keys: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let mut data = serde_json::json!({"namespace": namespace});
    if let Some(keys) = keys {
        data["keys"] = keys.into();
    }
    server_action_json(&state, "core.setting.get", data).await
}

#[tauri::command]
pub async fn update_server_settings(
    state: tauri::State<'_, AppHandleState>,
    namespace: String,
    changes: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let identity = cfms_service::rpc::SessionIdentity::capture(&state.inner).await?;
    let result = server_action_once(
        &state,
        &identity,
        "core.setting.update",
        serde_json::json!({"namespace": namespace, "changes": changes}),
    )
    .await?;
    if namespace == "server" && result["settings"]["name"]["value"].is_string() {
        let _guard = state.inner.auth_update.lock().await;
        identity
            .ensure_current_locked(&state.inner, &_guard)
            .await?;
        *state.inner.server_name.write().await = result["settings"]["name"]["value"]
            .as_str()
            .map(String::from);
    }
    Ok(result)
}
