use super::preferences::update_preferences;
use crate::AppHandleState;
use cfms_service::{
    app_lock::{Change, Settings, Snapshot},
    rpc::SessionIdentity,
};

#[tauri::command]
pub async fn initialize_app_lock(
    state: tauri::State<'_, AppHandleState>,
) -> Result<Snapshot, String> {
    let identity = SessionIdentity::capture(&state.inner).await?;
    let legacy = state
        .settings
        .get("app_lock_settings_v1")
        .map_err(|e| e.to_string())?;
    let pref = update_preferences(&state, move |pref| {
        let settings = Settings::parse(&pref.app_lock);
        if !settings.enabled
            && settings.pin.is_none()
            && !settings.biometric_enabled
            && settings.platform_credentials.is_empty()
            && !settings.timed_lock_enabled
            && let Some(raw) = legacy
            && let Ok(value) = serde_json::from_str(&raw)
        {
            pref.app_lock =
                serde_json::to_value(Settings::parse(&value)).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await?;
    identity.ensure_current(&state.inner).await?;
    let snapshot = state
        .inner
        .app_lock
        .initialize(identity, Settings::parse(&pref.app_lock));
    let _ = state.settings.set("app_lock_settings_v1", "");
    Ok(snapshot)
}
#[tauri::command]
pub async fn get_app_lock(state: tauri::State<'_, AppHandleState>) -> Result<Snapshot, String> {
    state
        .inner
        .app_lock
        .current(&SessionIdentity::capture(&state.inner).await?)
}
#[tauri::command]
pub async fn configure_app_lock(
    state: tauri::State<'_, AppHandleState>,
    change: Change,
) -> Result<Snapshot, String> {
    let identity = SessionIdentity::capture(&state.inner).await?;
    let pref = update_preferences(&state, move |pref| {
        let mut settings = Settings::parse(&pref.app_lock);
        change.apply(&mut settings)?;
        pref.app_lock = serde_json::to_value(settings).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await?;
    identity.ensure_current(&state.inner).await?;
    Ok(state
        .inner
        .app_lock
        .initialize(identity, Settings::parse(&pref.app_lock)))
}
#[tauri::command]
pub async fn app_lock_activity(
    state: tauri::State<'_, AppHandleState>,
    background: bool,
) -> Result<Snapshot, String> {
    state
        .inner
        .app_lock
        .activity(&SessionIdentity::capture(&state.inner).await?, background)
}
#[tauri::command]
pub async fn lock_app(state: tauri::State<'_, AppHandleState>) -> Result<Snapshot, String> {
    state
        .inner
        .app_lock
        .lock(&SessionIdentity::capture(&state.inner).await?)
}
#[tauri::command]
pub async fn verify_app_lock_pin(
    state: tauri::State<'_, AppHandleState>,
    pin: String,
) -> Result<Snapshot, String> {
    let identity = SessionIdentity::capture(&state.inner).await?;
    let (ticket, record) = state.inner.app_lock.begin(&identity, "pin")?;
    let pin = zeroize::Zeroizing::new(pin);
    let result =
        tokio::task::spawn_blocking(move || record.ok_or("PIN is not configured")?.verify(&pin))
            .await
            .map_err(|e| e.to_string())?;
    identity.ensure_current(&state.inner).await?;
    let outcome = match &result {
        Ok(true) => "accepted",
        Ok(false) => "failed",
        Err(_) => "cancelled",
    };
    let snapshot = state
        .inner
        .app_lock
        .finish(&identity, ticket, outcome, true)?;
    enforce_attempt_limit(&state, &snapshot, identity.generation).await;
    result?;
    Ok(snapshot)
}
#[tauri::command]
pub async fn begin_app_lock_prompt(
    state: tauri::State<'_, AppHandleState>,
    method: String,
) -> Result<u64, String> {
    if !["biometric", "platform"].contains(&method.as_str()) {
        return Err("Invalid platform unlock method".into());
    }
    Ok(state
        .inner
        .app_lock
        .begin(&SessionIdentity::capture(&state.inner).await?, &method)?
        .0)
}
#[tauri::command]
pub async fn finish_app_lock_prompt(
    state: tauri::State<'_, AppHandleState>,
    ticket: u64,
    outcome: String,
) -> Result<Snapshot, String> {
    let identity = SessionIdentity::capture(&state.inner).await?;
    let snapshot = state
        .inner
        .app_lock
        .finish(&identity, ticket, &outcome, false)?;
    enforce_attempt_limit(&state, &snapshot, identity.generation).await;
    Ok(snapshot)
}
async fn enforce_attempt_limit(state: &AppHandleState, snapshot: &Snapshot, generation: u64) {
    if snapshot.disconnect_required {
        super::session::disconnect_locked_session(state, generation).await;
    }
}
