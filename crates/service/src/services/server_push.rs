//! Server-push stream listener.
//!
//! This is the Rust counterpart of the reference project's
//! `ServerStreamHandleService`: it owns the single `accept_stream()` loop for
//! server-initiated messages and dispatches events to focused handlers.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;

use cfms_core::ServiceEvent;

use crate::state::AppState;

const IDLE_POLL: Duration = Duration::from_millis(500);
const NO_CONNECTION_POLL: Duration = Duration::from_secs(1);

/// Run the server-push listener loop.
pub async fn run(state: Arc<AppState>, mut shutdown_rx: watch::Receiver<bool>) {
    loop {
        if *shutdown_rx.borrow() {
            break;
        }

        match current_connection(&state).await {
            Some(conn) if !conn.is_closed() => {
                accept_loop(Arc::clone(&state), &conn, &mut shutdown_rx).await;
            }
            _ => {
                tokio::select! {
                    _ = tokio::time::sleep(NO_CONNECTION_POLL) => {},
                    _ = shutdown_rx.changed() => break,
                }
            }
        }
    }

    tracing::info!("ServerPushService stopped");
}

async fn current_connection(state: &AppState) -> Option<cfms_transport::Connection> {
    state.conn.read().await.clone()
}

async fn accept_loop(
    state: Arc<AppState>,
    conn: &cfms_transport::Connection,
    shutdown_rx: &mut watch::Receiver<bool>,
) {
    loop {
        if *shutdown_rx.borrow() || conn.is_closed() || connection_was_replaced(&state, conn).await
        {
            break;
        }

        let stream = tokio::select! {
            stream = conn.accept_stream() => stream,
            _ = tokio::time::sleep(IDLE_POLL) => continue,
            _ = shutdown_rx.changed() => break,
        };

        match stream {
            Some(stream) => {
                let state = Arc::clone(&state);
                tokio::spawn(async move {
                    dispatch_stream(state, stream).await;
                });
            }
            None => break,
        }
    }
}

async fn connection_was_replaced(state: &AppState, conn: &cfms_transport::Connection) -> bool {
    match state.conn.read().await.as_ref() {
        Some(current) => !current.is_same_connection(conn),
        None => true,
    }
}

async fn dispatch_stream(state: Arc<AppState>, mut stream: cfms_transport::Stream) {
    let payload = match stream.recv().await {
        Some(p) => p,
        None => return,
    };

    let msg: serde_json::Value = match serde_json::from_slice(&payload) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("Failed to parse server-pushed message: {e}");
            return;
        }
    };

    let event = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");
    let data = msg.get("data").cloned().unwrap_or(serde_json::Value::Null);

    tracing::debug!("Server push: event={event}, data={data:?}");

    match event {
        "lockdown" => handle_lockdown(&state, &data).await,
        "" => tracing::debug!("Ignoring server push without event name"),
        other => tracing::debug!("Unhandled server push event: {other}"),
    }
}

async fn handle_lockdown(state: &AppState, data: &serde_json::Value) {
    let status = data
        .get("status")
        .and_then(|s| s.as_bool())
        .unwrap_or(false);
    state
        .app_lockdown
        .store(status, std::sync::atomic::Ordering::SeqCst);
    let reason = status
        .then(|| data.get("reason").and_then(|value| value.as_str()))
        .flatten()
        .map(ToOwned::to_owned);
    *state.lockdown_reason.write().await = reason.clone();
    let _ = state
        .event_tx
        .send(ServiceEvent::Lockdown { status, reason });
    tracing::info!("Lockdown status changed: {status}");
}
