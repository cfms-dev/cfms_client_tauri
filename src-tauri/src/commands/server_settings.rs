use super::server_actions::server_action_once;
use crate::AppHandleState;

const SETTINGS_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Discovery/reads have a deadline independent of mutation and global reconnect policy.
async fn read_settings(
    state: &AppHandleState,
    action: &str,
    data: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let read = async {
        let identity = cfms_service::rpc::SessionIdentity::capture(&state.inner).await?;
        let (conn, username, token) = super::session::get_connection_auth(state).await?;
        identity.ensure_current(&state.inner).await?;
        let response: cfms_core::Response =
            cfms_service::rpc::send_typed_action_request_with_timeout(
                &conn,
                action,
                data,
                &username,
                &token,
                SETTINGS_READ_TIMEOUT,
            )
            .await
            .map_err(|err| match err {
                cfms_service::rpc::RpcError::Open(error)
                | cfms_service::rpc::RpcError::Send(error) => {
                    if error.to_string().contains("RPC timed out") {
                        "CFMS_SETTINGS_READ_TIMEOUT".into()
                    } else {
                        error.to_string()
                    }
                }
                cfms_service::rpc::RpcError::Closed(Some(close)) if close.code == 1013 => {
                    super::shared_helpers::format_server_error_parts(
                        503,
                        &close.reason,
                        &serde_json::json!({}),
                    )
                }
                cfms_service::rpc::RpcError::Closed(_) => {
                    "Connection closed before settings response".into()
                }
                cfms_service::rpc::RpcError::Decode(_) => "Invalid settings response".into(),
                cfms_service::rpc::RpcError::Encode(_) => {
                    "Could not encode settings request".into()
                }
            })?;
        identity.ensure_current(&state.inner).await?;
        if response.code != 200 {
            return Err(super::shared_helpers::format_server_response_error(
                &response,
            ));
        }
        Ok(response.data)
    };
    tokio::time::timeout(SETTINGS_READ_TIMEOUT, read)
        .await
        .map_err(|_| "CFMS_SETTINGS_READ_TIMEOUT".to_string())?
}

#[tauri::command]
pub async fn list_server_settings(
    state: tauri::State<'_, AppHandleState>,
    namespace: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut data = serde_json::json!({});
    if let Some(namespace) = namespace {
        data["namespace"] = namespace.into();
    }
    read_settings(&state, "core.setting.list", data).await
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
    read_settings(&state, "core.setting.get", data).await
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
