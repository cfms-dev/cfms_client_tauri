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
    state.public_keys.cancel();
    state.inner.clear_auth().await;
    state.tasks.clear();
    state
        .active_uploads
        .interrupt_all(UploadInterruption::Cancelled);
    state.upload_tasks.clear();
}

pub(super) async fn close_primary_connection(state: &AppHandleState) {
    cfms_service::session::close_primary_connection(&state.inner).await;
}

pub(super) async fn clear_connection_state(state: &AppHandleState) {
    cfms_service::session::clear_connection_state(&state.inner).await;
}
