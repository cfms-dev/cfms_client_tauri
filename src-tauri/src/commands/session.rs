//! Adapt application-owned session cleanup to the native state container.
use crate::{AppHandleState, UploadInterruption};

pub(super) async fn get_connection_auth(
    state: &AppHandleState,
) -> Result<
    (
        cfms_transport::Connection,
        String,
        cfms_service::sensitive::SecretString,
    ),
    String,
> {
    cfms_service::session::get_connection_auth(&state.inner).await
}

pub(super) async fn clear_auth_state(state: &AppHandleState) {
    let update = state.inner.auth_update.lock().await;
    state.inner.clear_auth_locked(&update).await;
    clear_native_auth_state(state);
}

fn clear_native_auth_state(state: &AppHandleState) {
    state.public_keys.cancel();
    state.tasks.clear();
    state
        .active_uploads
        .interrupt_all(UploadInterruption::Cancelled);
    state.upload_tasks.clear();
}

pub(super) async fn disconnect_locked_session(state: &AppHandleState, generation: u64) {
    let update = state.inner.auth_update.lock().await;
    if state
        .inner
        .auth_generation
        .load(std::sync::atomic::Ordering::SeqCst)
        != generation
    {
        return;
    }
    state.inner.clear_auth_locked(&update).await;
    clear_native_auth_state(state);
    if let Some(connection) = state.inner.conn.write().await.take() {
        tokio::spawn(async move {
            connection.close().await;
        });
    }
    clear_connection_state(state).await;
    let _ = state
        .inner
        .event_tx
        .send(cfms_core::ServiceEvent::AppLockAttemptsExceeded);
}

pub(super) async fn close_primary_connection(state: &AppHandleState) {
    cfms_service::session::close_primary_connection(&state.inner).await;
}

pub(super) async fn clear_connection_state(state: &AppHandleState) {
    cfms_service::session::clear_connection_state(&state.inner).await;
}
