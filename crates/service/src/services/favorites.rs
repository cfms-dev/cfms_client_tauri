//! Favorites validation service — runs every 300 seconds (5 minutes).
//!
//! Validates that favorited files and directories still exist on the server.
//! Invalid items are tracked so the frontend can display appropriate warnings.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;

use cfms_core::ServiceEvent;

use crate::state::AppState;

/// Interval between validation runs.
pub const INTERVAL: Duration = Duration::from_secs(300);

/// Run the favorites validation loop.
pub async fn run(state: Arc<AppState>, mut shutdown_rx: watch::Receiver<bool>) {
    let mut invalid_files = HashSet::new();
    let mut access_denied_files = HashSet::new();

    loop {
        if *shutdown_rx.borrow() {
            break;
        }

        let invalid_count = tick(&state, &mut invalid_files, &mut access_denied_files).await;

        let _ = state.event_tx.send(ServiceEvent::FavoritesValidationComplete {
            invalid_count: invalid_count as u32,
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
    invalid_files: &mut HashSet<String>,
    access_denied_files: &mut HashSet<String>,
) -> usize {
    // Skip if not logged in.
    let has_token = state.token.read().await.is_some();
    if !has_token {
        return 0;
    }

    // Favorites are stored as a JSON array in settings under "favorites".
    // For now we support a simple structure; full implementation will
    // follow in Phase 3 when the preferences model is fully defined.
    //
    // The reference Python implementation loads favourites from
    // `app_shared.user_perference.favourites["files"]` and
    // `favourites["directories"]`, which are dicts mapping file_id/dir_id
    // to metadata dicts containing at least "id" and "name".

    tracing::debug!("Favorites validation tick — not yet fully wired");

    // For now, return 0 — the full implementation requires the connection
    // to be established and the preferences model to be loaded.
    invalid_files.len() + access_denied_files.len()
}
