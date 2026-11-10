//! Per-test loopback RPC peer, exercising the real frame and stream boundaries.
use cfms_transport::frame::{self, FrameHeader, FrameKind};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio_tungstenite::tungstenite::Message;

pub struct Peer {
    pub state: Arc<crate::state::AppState>,
    pub requests: Arc<Mutex<Vec<Value>>>,
    pub received: Arc<tokio::sync::Notify>,
    server: tokio::task::JoinHandle<()>,
}
impl Peer {
    pub async fn new(respond: impl FnMut(&Value) -> Option<(u16, Value)> + Send + 'static) -> Self {
        Self::create(respond, None).await
    }
    pub async fn gated(
        respond: impl FnMut(&Value) -> Option<(u16, Value)> + Send + 'static,
        gate: Arc<tokio::sync::Notify>,
    ) -> Self {
        Self::create(respond, Some(gate)).await
    }
    async fn create(
        mut respond: impl FnMut(&Value) -> Option<(u16, Value)> + Send + 'static,
        gate: Option<Arc<tokio::sync::Notify>>,
    ) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        let received = Arc::new(tokio::sync::Notify::new());
        let request_received = received.clone();
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(socket).await.unwrap();
            while let Some(Ok(message)) = ws.next().await {
                if message.is_close() {
                    break;
                }
                if !message.is_binary() {
                    continue;
                }
                let bytes = message.into_data();
                let (header, payload) = frame::decode(&bytes).unwrap();
                if payload.is_empty() {
                    continue;
                }
                let request: Value = serde_json::from_slice(payload).unwrap();
                recorded.lock().unwrap().push(request.clone());
                request_received.notify_one();
                if let Some(gate) = &gate {
                    gate.notified().await;
                }
                let Some((code, data)) = respond(&request) else {
                    let _ = ws.close(None).await;
                    break;
                };
                let response = serde_json::to_vec(&json!({"code": code, "message": "test response", "data": data, "timestamp": 0})).unwrap();
                if ws
                    .send(Message::Binary(
                        frame::encode(
                            &FrameHeader {
                                id: header.id,
                                kind: FrameKind::Conclusion,
                            },
                            &response,
                        )
                        .into(),
                    ))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let conn = cfms_transport::Connection::connect(
            &format!("ws://{address}"),
            cfms_transport::tls::TlsConfig::plaintext(),
            None,
            true,
        )
        .await
        .unwrap();
        let state = crate::state::AppState::new();
        *state.conn.write().await = Some(conn);
        *state.username.write().await = Some("alice".into());
        *state.server_address.write().await = Some(format!("ws://{address}"));
        *state.token.write().await = Some(crate::sensitive::SecretString::new("test-token".into()));
        *state.permissions.write().await = vec!["set_access_rules".into()];
        Self {
            state,
            requests,
            received,
            server,
        }
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.server.abort();
    }
}

pub fn page(items: Value, next: Option<&str>) -> Value {
    json!({"items": items, "page_size":128, "has_more":next.is_some(), "next_cursor":next, "parent_id":null})
}
