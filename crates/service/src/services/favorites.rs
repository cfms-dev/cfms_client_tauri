//! Favorites validation service — runs every 300 seconds (5 minutes).
//!
//! Validates that favorited files and directories still exist on the server.
//! Invalid items are tracked so the frontend can display appropriate warnings.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;

use cfms_core::ServiceEvent;

use crate::state::AppState;

/// Interval between validation runs.
pub const INTERVAL: Duration = Duration::from_secs(300);

/// Run the favorites validation loop.
pub async fn run(
    state: Arc<AppState>,
    app_data_dir: PathBuf,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let mut invalid_files = HashSet::new();
    let mut invalid_directories = HashSet::new();
    let mut access_denied_files = HashSet::new();
    let mut access_denied_directories = HashSet::new();

    loop {
        if *shutdown_rx.borrow() {
            break;
        }

        let unavailable_count = tick(
            &state,
            &app_data_dir,
            &mut invalid_files,
            &mut invalid_directories,
            &mut access_denied_files,
            &mut access_denied_directories,
        )
        .await;

        let _ = state
            .event_tx
            .send(ServiceEvent::FavoritesValidationComplete {
                invalid_count: unavailable_count as u32,
            });

        tokio::select! {
            _ = tokio::time::sleep(INTERVAL) => {},
            _ = shutdown_rx.changed() => { break; }
        }
    }

    tracing::info!("FavoritesValidationService stopped");
}

/// Validate all favorites and return the count of invalid items.
async fn tick(
    state: &AppState,
    app_data_dir: &std::path::Path,
    invalid_files: &mut HashSet<String>,
    invalid_directories: &mut HashSet<String>,
    access_denied_files: &mut HashSet<String>,
    access_denied_directories: &mut HashSet<String>,
) -> usize {
    let Some(snapshot) = validation_snapshot(state).await else {
        clear_validation_state(
            invalid_files,
            invalid_directories,
            access_denied_files,
            access_denied_directories,
        );
        return 0;
    };

    let preferences = match load_preferences(app_data_dir, &snapshot).await {
        Ok(preferences) => preferences,
        Err(error) => {
            tracing::warn!("Skipping favorites validation: {error}");
            return unavailable_count(
                invalid_files,
                invalid_directories,
                access_denied_files,
                access_denied_directories,
            );
        }
    };

    if preferences.favourites.files.is_empty() && preferences.favourites.directories.is_empty() {
        clear_validation_state(
            invalid_files,
            invalid_directories,
            access_denied_files,
            access_denied_directories,
        );
        return 0;
    }

    let conn = match super::connection::ensure_connected(
        state,
        super::connection::DEFAULT_RECONNECT_ATTEMPTS,
        false,
    )
    .await
    {
        Ok(conn) => conn,
        Err(error) => {
            tracing::warn!("Skipping favorites validation: {error}");
            return unavailable_count(
                invalid_files,
                invalid_directories,
                access_denied_files,
                access_denied_directories,
            );
        }
    };

    for file_id in preferences.favourites.files.keys() {
        validate_item(
            &conn,
            &snapshot,
            "get_document_info",
            serde_json::json!({ "document_id": file_id }),
            file_id,
            invalid_files,
            access_denied_files,
        )
        .await;
    }

    for dir_id in preferences.favourites.directories.keys() {
        validate_item(
            &conn,
            &snapshot,
            "get_directory_info",
            serde_json::json!({ "directory_id": dir_id }),
            dir_id,
            invalid_directories,
            access_denied_directories,
        )
        .await;
    }

    unavailable_count(
        invalid_files,
        invalid_directories,
        access_denied_files,
        access_denied_directories,
    )
}

#[derive(Clone)]
struct ValidationSnapshot {
    username: String,
    token: String,
    server_hash: String,
    dek: Option<[u8; cfms_core::constants::KEY_LEN]>,
}

async fn validation_snapshot(state: &AppState) -> Option<ValidationSnapshot> {
    if state.pending_2fa.load(std::sync::atomic::Ordering::SeqCst) {
        return None;
    }

    let username = state.username.read().await.clone()?;
    let token = state.token.read().await.clone()?;
    let server_addr = state.server_address.read().await.clone()?;
    let dek = state.dek.read().await.clone().map(|d| *d);

    Some(ValidationSnapshot {
        username,
        token,
        server_hash: cfms_core::get_server_hash(&server_addr),
        dek,
    })
}

async fn load_preferences(
    app_data_dir: &std::path::Path,
    snapshot: &ValidationSnapshot,
) -> Result<cfms_core::UserPreference, String> {
    let app_data_dir = app_data_dir.to_path_buf();
    let server_hash = snapshot.server_hash.clone();
    let username = snapshot.username.clone();
    let dek = snapshot.dek;

    tokio::task::spawn_blocking(move || {
        crate::user_preferences::load(&app_data_dir, &server_hash, &username, dek.as_ref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Preference load task failed: {e}"))?
}

async fn validate_item(
    conn: &cfms_transport::Connection,
    snapshot: &ValidationSnapshot,
    action: &str,
    data: serde_json::Value,
    id: &str,
    invalid: &mut HashSet<String>,
    access_denied: &mut HashSet<String>,
) {
    match super::rpc::send_action_request(conn, action, data, &snapshot.username, &snapshot.token)
        .await
    {
        Ok(response) if response.code == 200 => {
            invalid.remove(id);
            access_denied.remove(id);
        }
        Ok(response) if response.code == 403 => {
            access_denied.insert(id.to_string());
            invalid.remove(id);
        }
        Ok(response) => {
            invalid.insert(id.to_string());
            access_denied.remove(id);
            tracing::debug!(
                "Favorite {id} failed validation through {action}: ({}) {}",
                response.code,
                response.message
            );
        }
        Err(error) => {
            tracing::warn!("Favorite {id} validation request failed through {action}: {error}");
        }
    }
}

fn clear_validation_state(
    invalid_files: &mut HashSet<String>,
    invalid_directories: &mut HashSet<String>,
    access_denied_files: &mut HashSet<String>,
    access_denied_directories: &mut HashSet<String>,
) {
    invalid_files.clear();
    invalid_directories.clear();
    access_denied_files.clear();
    access_denied_directories.clear();
}

fn unavailable_count(
    invalid_files: &HashSet<String>,
    invalid_directories: &HashSet<String>,
    access_denied_files: &HashSet<String>,
    access_denied_directories: &HashSet<String>,
) -> usize {
    invalid_files.len()
        + invalid_directories.len()
        + access_denied_files.len()
        + access_denied_directories.len()
}
