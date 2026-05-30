//! Lockdown monitor service — event-driven WSS push listener.
//!
//! Consumes `Connection::accept_stream()` exclusively, parsing incoming
//! server-pushed streams for events (most critically, "lockdown").
//!
//! When the server pushes a lockdown event, this service updates
//! [`AppState::app_lockdown`] and emits a [`ServiceEvent::Lockdown`] so the
//! frontend can react (show a lockdown banner, navigate to the lock screen).

use std::sync::Arc;

use tokio::sync::watch;

use cfms_core::ServiceEvent;

use crate::state::AppState;

/// Run the lockdown monitor loop.
///
/// This is event-driven (no fixed interval).  It waits for a connection,
/// then enters a tight loop accepting server-initiated streams.
pub async fn run(state: Arc<AppState>, mut shutdown_rx: watch::Receiver<bool>) {
    loop {
        if *shutdown_rx.borrow() {
            break;
        }

        // Wait for a connection to become available.
        let conn = {
            let guard = state.conn.read().await;
            guard.clone()
        };

        match conn {
            Some(conn) => {
                // Enter the accept loop for this connection.
                accept_loop(&state, &conn, &mut shutdown_rx).await;
            }
            None => {
                // No connection yet — wait and retry.
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {},
                    _ = shutdown_rx.changed() => { break; }
                }
            }
        }
    }

    tracing::info!("LockdownMonitorService stopped");
}

/// Accept and dispatch server-initiated streams on a single connection.
async fn accept_loop(
    state: &AppState,
    conn: &cfms_transport::Connection,
    shutdown_rx: &mut watch::Receiver<bool>,
) {
    loop {
        if *shutdown_rx.borrow() {
            break;
        }

        // Race between accepting a stream, connection replacement,
        // and shutdown.
        let stream = {
            // We can't directly race on accept_stream() because it's
            // a method on the Connection.  Instead, poll with a short
            // timeout so we can re-check shutdown/connection replacement.
            //
            // accept_stream() blocks until a stream arrives or the
            // connection closes.  We use tokio::spawn to race it
            // against a shutdown check.
            tokio::select! {
                stream = conn.accept_stream() => stream,
                _ = shutdown_rx.changed() => { break; }
            }
        };

        match stream {
            Some(stream) => {
                dispatch_stream(state, stream).await;
            }
            None => {
                // Connection closed (accept_stream returned None).
                // Exit the accept loop — the outer loop will wait
                // for a new connection.
                tracing::info!("Connection closed — exiting accept loop");
                return;
            }
        }
    }
}

/// Parse and dispatch a single server-pushed stream.
async fn dispatch_stream(
    state: &AppState,
    mut stream: cfms_transport::Stream,
) {
    let payload = match stream.recv().await {
        Some(p) => p,
        None => return,
    };

    let msg: serde_json::Value = match serde_json::from_slice(&payload) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("Failed to parse server push message: {e}");
            return;
        }
    };

    let event = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");
    let data = msg.get("data");

    tracing::debug!("Server push: event={event}, data={data:?}");

    match event {
        "lockdown" => {
            let status = data
                .and_then(|d| d.get("status"))
                .and_then(|s| s.as_bool())
                .unwrap_or(false);
            state
                .app_lockdown
                .store(status, std::sync::atomic::Ordering::SeqCst);
            let _ = state.event_tx.send(ServiceEvent::Lockdown { status });
            tracing::info!("Lockdown status changed: {status}");
        }
        other => {
            tracing::debug!("Unhandled server event: {other}");
            // Future: dispatch through a handler registry for extensibility.
        }
    }
}
