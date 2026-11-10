use crate::AppHandleState;
use cfms_service::files::access_batches::{ItemChange, Problem, Snapshot, Target};

#[tauri::command]
pub async fn prepare_access_batch(
    state: tauri::State<'_, AppHandleState>,
    targets: Vec<Target>,
    rules: serde_json::Value,
    inherit: bool,
    recursive: bool,
) -> Result<String, String> {
    state
        .inner
        .access_batches
        .create(&state.inner, targets, rules, inherit, recursive)
        .await
}
#[tauri::command]
pub async fn get_access_batch(
    state: tauri::State<'_, AppHandleState>,
    id: String,
) -> Result<Snapshot, String> {
    Ok(state
        .inner
        .access_batches
        .get(&state.inner, &id)
        .await?
        .snapshot())
}
#[tauri::command]
pub async fn get_access_batch_changes(
    state: tauri::State<'_, AppHandleState>,
    id: String,
    after: u64,
) -> Result<Vec<ItemChange>, String> {
    Ok(state
        .inner
        .access_batches
        .get(&state.inner, &id)
        .await?
        .changes(after))
}
#[tauri::command]
pub async fn run_access_batch(
    state: tauri::State<'_, AppHandleState>,
    id: String,
    command: String,
    allow_incomplete: bool,
) -> Result<(), String> {
    if !["scan", "apply", "retry", "continue", "resubmit"].contains(&command.as_str()) {
        return Err("Invalid access batch operation".into());
    }
    state
        .inner
        .access_batches
        .get(&state.inner, &id)
        .await?
        .run(&state.inner, &id, &command, allow_incomplete)
        .await
}
#[tauri::command]
pub async fn stop_access_batch(
    state: tauri::State<'_, AppHandleState>,
    id: String,
    reason: Option<Problem>,
) -> Result<(), String> {
    state
        .inner
        .access_batches
        .get(&state.inner, &id)
        .await?
        .stop(&state.inner, &id, reason);
    Ok(())
}
#[tauri::command]
pub async fn dispose_access_batch(
    state: tauri::State<'_, AppHandleState>,
    id: String,
) -> Result<(), String> {
    state
        .inner
        .access_batches
        .get(&state.inner, &id)
        .await?
        .stop(&state.inner, &id, None);
    state.inner.access_batches.remove(&id);
    Ok(())
}
#[tauri::command]
pub async fn decide_access_batch(
    state: tauri::State<'_, AppHandleState>,
    id: String,
    ticket: u64,
    answer: String,
) -> Result<(), String> {
    state
        .inner
        .access_batches
        .get(&state.inner, &id)
        .await?
        .decide(ticket, answer)
}
