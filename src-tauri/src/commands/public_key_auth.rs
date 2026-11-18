use super::authentication::finish_authentication;
use super::server_actions::server_action_json;
use super::session::{clear_auth_state, get_connection_auth};
use super::shared_helpers::format_server_error_parts;
use super::transfer_helpers::unix_now;
use crate::AppHandleState;
use cfms_service::authentication::AUTH;
use cfms_service::authentication::GENERAL;
#[cfg(target_os = "android")]
use serde::Deserialize;
use std::sync::Arc;
use tauri::Manager;
use tauri::Runtime;
use tauri::ipc::Channel;

#[tauri::command]
pub async fn get_managed_auth_keys<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
) -> Result<crate::managed_auth_keys::ManagedKeyInventory, String> {
    let current_server = state.inner.server_address.read().await.clone();
    tokio::task::spawn_blocking(move || {
        let vault = app.state::<crate::managed_auth_keys::ManagedAuthKeys>();
        let _guard = vault.operation.lock().unwrap();
        if app
            .state::<crate::local_data_reset::LocalDataResetRuntime>()
            .in_progress
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Ok(crate::managed_auth_keys::ManagedKeyInventory {
                storage_available: false,
                hardware_backed: false,
                bound_keys: Vec::new(),
                rescue_keys: Vec::new(),
            });
        }
        crate::managed_auth_keys::list_inventory(&app, current_server.as_deref())
    })
    .await
    .map_err(|_| crate::secure_store::UNAVAILABLE.to_string())?
}

#[tauri::command]
pub async fn select_managed_auth_key<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    key_id: String,
) -> Result<crate::public_key_auth::KeyInfo, String> {
    let current_server = state.inner.server_address.read().await.clone();
    let current_hash = current_server.as_deref().map(cfms_core::get_server_hash);
    let registry = state.public_keys.clone();
    tokio::task::spawn_blocking(move || {
        let vault = app.state::<crate::managed_auth_keys::ManagedAuthKeys>();
        let _guard = vault.operation.lock().unwrap();
        if app
            .state::<crate::local_data_reset::LocalDataResetRuntime>()
            .in_progress
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err(crate::secure_store::UNAVAILABLE.into());
        }
        let record =
            crate::managed_auth_keys::find_record(&app, &key_id)?.ok_or("publicKey.selectAgain")?;
        crate::managed_auth_keys::verify_key_usable(&app, &record)?;
        Ok(registry.select_managed(&record, current_hash.as_deref()))
    })
    .await
    .map_err(|_| "publicKey.selectAgain".to_string())?
}

#[tauri::command]
pub async fn generate_user_auth_public_key<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    label: Option<String>,
) -> Result<serde_json::Value, String> {
    let (_, username, _) = get_connection_auth(&state).await?;
    let user_id = state
        .inner
        .user_id
        .read()
        .await
        .clone()
        .ok_or("Not logged in")?;
    let server = state
        .inner
        .server_address
        .read()
        .await
        .clone()
        .ok_or("Not connected to a server")?;

    let app_gen = app.clone();
    let generated = tokio::task::spawn_blocking(move || {
        let vault = app_gen.state::<crate::managed_auth_keys::ManagedAuthKeys>();
        let _guard = vault.operation.lock().unwrap();
        if app_gen
            .state::<crate::local_data_reset::LocalDataResetRuntime>()
            .in_progress
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err(crate::secure_store::UNAVAILABLE.to_string());
        }
        crate::managed_auth_keys::generate_keypair(&app_gen)
    })
    .await
    .map_err(|_| crate::secure_store::UNAVAILABLE.to_string())??;

    let normalized_label = label.and_then(|l| {
        let trimmed = l.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    let register_result = server_action_json(
        &state,
        "core.user.authentication.public_key.register",
        serde_json::json!({
            "public_key": &generated.public_key,
            "label": &normalized_label,
        }),
    )
    .await;

    let mut response = match register_result {
        Ok(value) => value,
        Err(error) => {
            let app_cleanup = app.clone();
            let key_id = generated.key_id.clone();
            let backend = generated.backend;
            let _ = tokio::task::spawn_blocking(move || {
                let vault = app_cleanup.state::<crate::managed_auth_keys::ManagedAuthKeys>();
                let _guard = vault.operation.lock().unwrap();
                let _ = crate::managed_auth_keys::delete_secret_material(
                    &app_cleanup,
                    &key_id,
                    backend,
                );
            })
            .await;
            return Err(error);
        }
    };

    let credential_id = response["credential_id"].as_str().map(String::from);
    let final_label = response["label"]
        .as_str()
        .map(String::from)
        .or(normalized_label);
    let fingerprint = response["fingerprint"]
        .as_str()
        .map(String::from)
        .unwrap_or_else(|| generated.fingerprint.clone());

    let record = crate::managed_auth_keys::ManagedKeyRecord {
        key_id: generated.key_id.clone(),
        backend: generated.backend,
        hardware_backed: generated.hardware_backed,
        algorithm: generated.algorithm.clone(),
        fingerprint,
        public_key: generated.public_key,
        label: final_label,
        server_hash: cfms_core::get_server_hash(&server),
        server_address: crate::managed_auth_keys::display_server_address(&server),
        user_id,
        username,
        credential_id,
        created_at: unix_now().max(0) as u64,
    };

    let app_save = app.clone();
    if let Err(err) = tokio::task::spawn_blocking(move || {
        let vault = app_save.state::<crate::managed_auth_keys::ManagedAuthKeys>();
        let _guard = vault.operation.lock().unwrap();
        crate::managed_auth_keys::save_record(&app_save, record)
    })
    .await
    .map_err(|_| crate::secure_store::UNAVAILABLE.to_string())
    .and_then(|res| res)
    {
        tracing::warn!("Public key registered on server, but saving local metadata failed: {err}");
    }

    response["key_id"] = generated.key_id.into();
    response["hardware_backed"] = generated.hardware_backed.into();
    response["algorithm"] = generated.algorithm.into();
    Ok(response)
}

#[tauri::command]
pub async fn pick_auth_private_key<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
) -> Result<Option<crate::public_key_auth::KeyInfo>, String> {
    let registry = state.public_keys.clone();
    tokio::task::spawn_blocking(move || {
        #[cfg(not(target_os = "android"))]
        let selected = {
            use tauri_plugin_dialog::DialogExt;
            app.dialog()
                .file()
                .blocking_pick_file()
                .map(|file| {
                    use std::io::Read;
                    let path = file.into_path().map_err(|_| "publicKey.invalidFile")?;
                    let mut bytes = zeroize::Zeroizing::new(Vec::new());
                    std::fs::File::open(&path)
                        .map_err(|_| "publicKey.invalidFile")?
                        .take(1024 * 1024 + 1)
                        .read_to_end(&mut bytes)
                        .map_err(|_| "publicKey.invalidFile")?;
                    if bytes.len() > 1024 * 1024 {
                        return Err("publicKey.invalidFile".to_string());
                    }
                    Ok((
                        bytes,
                        path.file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned(),
                    ))
                })
                .transpose()?
        };
        #[cfg(target_os = "android")]
        let selected = {
            use base64ct::{Base64, Encoding};
            #[derive(Deserialize)]
            struct Picked {
                filename: Option<String>,
                content: Option<String>,
            }
            let picked = app
                .state::<crate::AndroidGithubCredentialPlugin<R>>()
                .handle
                .run_mobile_plugin::<Picked>("pickPrivateKey", serde_json::json!({}))
                .map_err(|_| "publicKey.invalidFile")?;
            if let (Some(filename), Some(content)) = (picked.filename, picked.content) {
                let content = zeroize::Zeroizing::new(content);
                Some((
                    zeroize::Zeroizing::new(
                        Base64::decode_vec(&content).map_err(|_| "publicKey.invalidFile")?,
                    ),
                    filename,
                ))
            } else {
                None
            }
        };
        selected
            .map(|(bytes, filename)| registry.select(&bytes, filename))
            .transpose()
    })
    .await
    .map_err(|_| "publicKey.invalidFile".to_string())?
}

#[tauri::command]
pub fn release_auth_private_key(state: tauri::State<'_, AppHandleState>, key_ref: String) {
    state.public_keys.release(&key_ref);
}

#[tauri::command]
pub async fn cancel_public_key_authentication(
    state: tauri::State<'_, AppHandleState>,
) -> Result<(), String> {
    state.public_keys.cancel();
    clear_auth_state(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn respond_public_key_interaction(
    state: tauri::State<'_, AppHandleState>,
    interaction_id: String,
    key_ref: String,
    passphrase: String,
) -> Result<(), String> {
    let passphrase = zeroize::Zeroizing::new(passphrase);
    let registry = state.public_keys.clone();
    tokio::task::spawn_blocking(move || {
        let key = registry.take(&key_ref, &passphrase)?;
        let mut active = registry.active.lock().unwrap();
        let active = active.as_mut().ok_or("publicKey.cancelled")?;
        if active
            .reply
            .as_ref()
            .is_none_or(|(id, _)| id != &interaction_id)
        {
            return Err("publicKey.cancelled".into());
        }
        active
            .reply
            .take()
            .unwrap()
            .1
            .send(key)
            .map_err(|_| "publicKey.cancelled".into())
    })
    .await
    .map_err(|_| "publicKey.signingFailed".to_string())?
}

fn sign_with_handle<R: Runtime>(
    app: &tauri::AppHandle<R>,
    handle: &crate::public_key_auth::SigningKeyHandle,
    challenge: &[u8],
) -> Result<String, String> {
    match handle {
        crate::public_key_auth::SigningKeyHandle::External(key) => {
            cfms_service::public_key_auth::sign(key, challenge)
        }
        crate::public_key_auth::SigningKeyHandle::Managed {
            key_id, backend, ..
        } => {
            let vault = app.state::<crate::managed_auth_keys::ManagedAuthKeys>();
            let _guard = vault.operation.lock().unwrap();
            crate::managed_auth_keys::sign_challenge(app, key_id, *backend, challenge)
        }
    }
}

#[tauri::command]
pub async fn login_with_public_key<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    username: String,
    key_ref: String,
    passphrase: String,
    on_interaction: Channel<crate::public_key_auth::AuthInteraction>,
    mfa: bool,
) -> Result<serde_json::Value, String> {
    let initial_generation = state
        .inner
        .auth_generation
        .load(std::sync::atomic::Ordering::SeqCst);
    let passphrase = zeroize::Zeroizing::new(passphrase);
    let registry = state.public_keys.clone();
    let key = tokio::task::spawn_blocking(move || registry.take(&key_ref, &passphrase))
        .await
        .map_err(|_| "publicKey.signingFailed".to_string())??;
    if state
        .inner
        .auth_generation
        .load(std::sync::atomic::Ordering::SeqCst)
        != initial_generation
    {
        return Err("publicKey.cancelled".into());
    }
    if !mfa {
        state.public_keys.cancel();
        state.inner.clear_auth().await;
    }
    let generation = state
        .inner
        .auth_generation
        .load(std::sync::atomic::Ordering::SeqCst);
    let conn = state
        .inner
        .conn
        .read()
        .await
        .clone()
        .ok_or("Not connected to a server")?;
    let fingerprint = key.fingerprint()?;
    let (user, request) = if mfa {
        let pending = state.inner.pending_auth.read().await;
        let pending = pending
            .as_ref()
            .filter(|pending| {
                pending.issued.claims.purpose == AUTH
                    && pending.methods.iter().any(|method| method == "publickey")
                    && pending.issued.claims.exp > cfms_service::authentication::unix_now()
            })
            .ok_or("publicKey.cancelled")?;
        (
            pending.username.clone(),
            cfms_service::sensitive::SensitiveJson::new(serde_json::json!({
                "action":"core.auth.token.exchange", "data":{"method":"publickey", "data":{"fingerprint":fingerprint}, "target_purpose":GENERAL},
                "username":pending.username,"token":pending.issued.secret.as_str(),
                "timestamp":unix_now(),"nonce":crate::public_key_auth::random_id(),
            })),
        )
    } else {
        (
            username.clone(),
            cfms_service::sensitive::SensitiveJson::new(serde_json::json!({
                "action":"core.auth.login", "data":{"method":"publickey", "credential":{"username":username,"fingerprint":fingerprint}},
            })),
        )
    };
    let id = crate::public_key_auth::random_id();
    let (cancel, mut cancellation) = tokio::sync::watch::channel(false);
    {
        let mut active = state.public_keys.active.lock().unwrap();
        if active.is_some() {
            return Err("publicKey.busy".into());
        }
        *active = Some(crate::public_key_auth::ActiveAttempt {
            id: id.clone(),
            cancel,
            reply: None,
        });
    }
    let app_sign = app.clone();
    let signer: Arc<
        dyn Fn(&crate::public_key_auth::SigningKeyHandle, &[u8]) -> Result<String, String>
            + Send
            + Sync,
    > = Arc::new(move |handle, challenge| sign_with_handle(&app_sign, handle, challenge));
    let outcome = run_public_key_stream(
        &state.inner,
        &state.public_keys,
        &conn,
        &mut cancellation,
        request,
        key,
        signer,
        on_interaction,
        generation,
        if mfa { "mfa" } else { "login" },
    )
    .await;
    state.public_keys.finish(&id);
    let (response, rescue_key_ids) = outcome?;
    let response_code = response.code;
    let status = finish_authentication(&state, &user, response, generation).await?;
    if (response_code == 200 || response_code == 202) && !rescue_key_ids.is_empty() {
        if let Some(current_server) = state.inner.server_address.read().await.clone() {
            let resolved_user_id = state.inner.user_id.read().await.clone();
            let user_for_rebind = user.clone();
            let _ = tokio::task::spawn_blocking(move || {
                let vault = app.state::<crate::managed_auth_keys::ManagedAuthKeys>();
                let _guard = vault.operation.lock().unwrap();
                let _ = crate::managed_auth_keys::rebind_keys_to_server(
                    &app,
                    &rescue_key_ids,
                    &current_server,
                    resolved_user_id.as_deref(),
                    &user_for_rebind,
                );
            })
            .await;
        }
    }
    Ok(status)
}

async fn run_public_key_stream(
    state: &cfms_service::state::AppState,
    public_keys: &crate::public_key_auth::PublicKeyState,
    conn: &cfms_transport::Connection,
    cancellation: &mut tokio::sync::watch::Receiver<bool>,
    request: cfms_service::sensitive::SensitiveJson,
    mut key: crate::public_key_auth::SigningKeyHandle,
    signer: Arc<
        dyn Fn(&crate::public_key_auth::SigningKeyHandle, &[u8]) -> Result<String, String>
            + Send
            + Sync,
    >,
    channel: Channel<crate::public_key_auth::AuthInteraction>,
    generation: u64,
    stage: &str,
) -> Result<(cfms_core::Response, Vec<String>), String> {
    use crate::public_key_auth::AuthInteraction;
    let mut rescue_keys_used = Vec::new();
    if let Some(kid) = key.rescue_key_id() {
        rescue_keys_used.push(kid.to_string());
    }
    let mut stream = conn.create_stream().await.map_err(|e| e.to_string())?;
    let exchange = async {
        stream
            .send_sensitive(
                conn,
                zeroize::Zeroizing::new(
                    serde_json::to_vec(request.as_value()).map_err(|e| e.to_string())?,
                ),
            )
            .await
            .map_err(|e| e.to_string())?;
        loop {
            let bytes = tokio::time::timeout(std::time::Duration::from_secs(65), stream.recv())
                .await
                .map_err(|_| "publicKey.expired")?
                .ok_or_else(|| {
                    if let Some(close) = conn.close_info()
                        && close.code == 1013
                    {
                        return format_server_error_parts(
                            503,
                            &close.reason,
                            &serde_json::json!({"close_code":close.code}),
                        );
                    }
                    "Connection closed during authentication".into()
                })?;
            let bytes = zeroize::Zeroizing::new(bytes);
            if state
                .auth_generation
                .load(std::sync::atomic::Ordering::SeqCst)
                != generation
            {
                return Err("publicKey.cancelled".into());
            }
            let message: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|_| "publicKey.invalidChallenge")?;
            if message.get("code").is_some() {
                let parsed: cfms_core::Response =
                    serde_json::from_value(message).map_err(|_| "publicKey.invalidChallenge")?;
                return Ok((parsed, rescue_keys_used));
            }
            let data = &message["data"];
            let interaction = data["interaction_id"]
                .as_str()
                .ok_or("publicKey.invalidChallenge")?;
            if data["method"] != "publickey" || data["stage"] != stage {
                return Err("publicKey.invalidChallenge".into());
            }
            let response = match message["action"].as_str() {
                Some("auth_challenge") => {
                    let fingerprint = key.fingerprint()?;
                    let challenge = cfms_service::public_key_auth::decode_challenge(
                        data,
                        stream.id,
                        &fingerprint,
                        stage,
                    )?;
                    channel
                        .send(AuthInteraction::Signing)
                        .map_err(|_| "publicKey.cancelled")?;
                    let step_signer = Arc::clone(&signer);
                    let (next_key, signature) = tokio::task::spawn_blocking(move || {
                        let signature = step_signer(&key, &challenge)?;
                        Ok::<_, String>((key, signature))
                    })
                    .await
                    .map_err(|_| "publicKey.signingFailed")??;
                    key = next_key;
                    serde_json::json!({"fingerprint":fingerprint,"signature":signature})
                }
                Some("auth_continue") => {
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    public_keys
                        .active
                        .lock()
                        .unwrap()
                        .as_mut()
                        .ok_or("publicKey.cancelled")?
                        .reply = Some((interaction.into(), tx));
                    channel
                        .send(AuthInteraction::SelectKey {
                            interaction_id: interaction.into(),
                        })
                        .map_err(|_| "publicKey.cancelled")?;
                    key = tokio::time::timeout(std::time::Duration::from_secs(60), rx)
                        .await
                        .map_err(|_| "publicKey.expired")?
                        .map_err(|_| "publicKey.cancelled")?;
                    if let Some(kid) = key.rescue_key_id()
                        && !rescue_keys_used.iter().any(|existing| existing == kid)
                    {
                        rescue_keys_used.push(kid.to_string());
                    }
                    serde_json::json!({"fingerprint":key.fingerprint()?})
                }
                _ => return Err("publicKey.invalidChallenge".into()),
            };
            let response = cfms_service::sensitive::SensitiveJson::new(
                serde_json::json!({"action":"auth_response","interaction_id":interaction,"method":"publickey","data":response}),
            );
            stream
                .send_sensitive(
                    conn,
                    zeroize::Zeroizing::new(
                        serde_json::to_vec(response.as_value()).map_err(|e| e.to_string())?,
                    ),
                )
                .await
                .map_err(|e| e.to_string())?;
        }
    };
    let result = tokio::select! {
        biased;
        _ = cancellation.changed() => Err("publicKey.cancelled".into()),
        result = exchange => result,
    };
    if result.is_err() {
        let _ = stream.send_final(conn, Vec::new()).await;
    }
    result
}

#[cfg(test)]
mod public_key_stream_tests {
    use super::*;
    use base64ct::{Base64, Encoding};
    use cfms_transport::frame::{self, FrameHeader, FrameKind};
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    async fn check_stream_lifecycle(final_code: Option<u16>, cancel: bool, stage: &'static str) {
        let vectors: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../../crates/service/tests/fixtures/auth-keys.json"
        ))
        .unwrap();
        let key = cfms_service::public_key_auth::parse(
            vectors[0]["private_key"].as_str().unwrap().as_bytes(),
        )
        .unwrap();
        let fingerprint = cfms_service::public_key_auth::fingerprint(&key).unwrap();
        let server_fingerprint = fingerprint.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (observed, request_received) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut websocket = tokio_tungstenite::accept_async(socket).await.unwrap();
            let request = websocket.next().await.unwrap().unwrap().into_data();
            let (header, payload) = frame::decode(&request).unwrap();
            assert_eq!(header.id, 1);
            assert_eq!(header.kind, FrameKind::Process);
            let request: serde_json::Value = serde_json::from_slice(payload).unwrap();
            assert_eq!(
                request["action"],
                if stage == "mfa" {
                    "core.auth.token.exchange"
                } else {
                    "core.auth.login"
                }
            );
            observed.send(()).unwrap();

            if !cancel {
                let message = if final_code == Some(401) {
                    None
                } else {
                    let challenge = serde_json::to_vec(&serde_json::json!({
                        "scope":"cfms.auth.publickey", "stream_id":1, "interaction_id":"test-step",
                        "fingerprint":server_fingerprint, "stage":stage,
                    }))
                    .unwrap();
                    Some(serde_json::json!({
                        "action":"auth_challenge", "data":{
                            "method":if final_code.is_some() { "publickey" } else { "invalid" },
                            "stage":stage, "interaction_id":"test-step", "challenge":Base64::encode_string(&challenge),
                        },
                    }))
                };
                if let Some(message) = message {
                    websocket
                        .send(Message::Binary(
                            frame::encode(
                                &FrameHeader {
                                    id: 1,
                                    kind: FrameKind::Process,
                                },
                                &serde_json::to_vec(&message).unwrap(),
                            )
                            .into(),
                        ))
                        .await
                        .unwrap();
                    if final_code.is_some() {
                        let proof = websocket.next().await.unwrap().unwrap().into_data();
                        let (header, payload) = frame::decode(&proof).unwrap();
                        assert_eq!(header.id, 1);
                        assert_eq!(header.kind, FrameKind::Process);
                        let proof: serde_json::Value = serde_json::from_slice(payload).unwrap();
                        assert_eq!(proof["action"], "auth_response");
                        assert_eq!(proof["interaction_id"], "test-step");
                        assert_eq!(proof["data"]["fingerprint"], server_fingerprint);
                        assert!(!proof["data"]["signature"].as_str().unwrap().is_empty());
                    }
                }
                if let Some(code) = final_code {
                    websocket
                        .send(Message::Binary(
                            frame::encode(
                                &FrameHeader {
                                    id: 1,
                                    kind: FrameKind::Conclusion,
                                },
                                &serde_json::to_vec(&serde_json::json!({
                                    "code":code, "data":{}, "message":"", "timestamp":0.0,
                                }))
                                .unwrap(),
                            )
                            .into(),
                        ))
                        .await
                        .unwrap();
                }
            }

            if final_code.is_none() {
                let cleanup = websocket.next().await.unwrap().unwrap().into_data();
                let (header, payload) = frame::decode(&cleanup).unwrap();
                assert_eq!(header.id, 1);
                assert_eq!(header.kind, FrameKind::Conclusion);
                assert!(payload.is_empty());
            }
            let following = websocket.next().await.unwrap().unwrap().into_data();
            let (header, payload) = frame::decode(&following).unwrap();
            assert_eq!(header.id, 3);
            assert_eq!(header.kind, FrameKind::Process);
            assert_eq!(payload, b"following request");
        });
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let tls = cfms_transport::tls::TlsConfig::plaintext();
        let connection =
            cfms_transport::Connection::connect(&format!("ws://{address}"), tls, None, true)
                .await
                .unwrap();
        let state = cfms_service::state::AppState::new();
        let public_keys = crate::public_key_auth::PublicKeyState::default();
        let (control, mut cancellation) = tokio::sync::watch::channel(false);
        let request = cfms_service::sensitive::SensitiveJson::new(if stage == "mfa" {
            serde_json::json!({
                "action":"core.auth.token.exchange", "data":{
                    "method":"publickey", "data":{"fingerprint":fingerprint},
                    "target_purpose":GENERAL,
                },
            })
        } else {
            serde_json::json!({
                "action":"core.auth.login", "data":{
                    "method":"publickey", "credential":{"username":"test", "fingerprint":fingerprint},
                },
            })
        });
        let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            let signer = Arc::new(
                |handle: &crate::public_key_auth::SigningKeyHandle, challenge: &[u8]| match handle {
                    crate::public_key_auth::SigningKeyHandle::External(k) => {
                        cfms_service::public_key_auth::sign(k, challenge)
                    }
                    _ => unreachable!(),
                },
            );
            tokio::join!(
                run_public_key_stream(
                    &state,
                    &public_keys,
                    &connection,
                    &mut cancellation,
                    request,
                    crate::public_key_auth::SigningKeyHandle::External(key),
                    signer,
                    Channel::new(|_| Ok(())),
                    0,
                    stage,
                ),
                async {
                    request_received.await.unwrap();
                    if cancel {
                        control.send(true).unwrap();
                    }
                },
            )
        })
        .await
        .unwrap();
        if let Some(code) = final_code {
            assert_eq!(result.unwrap().0.code, code);
        } else {
            assert!(result.is_err());
        }
        let following = connection.create_stream().await.unwrap();
        following
            .send(&connection, b"following request".to_vec())
            .await
            .unwrap();
        let outcome = tokio::time::timeout(std::time::Duration::from_secs(5), server).await;
        connection.close().await;
        outcome.unwrap().unwrap();
    }

    #[tokio::test]
    async fn final_responses_do_not_send_another_conclusion() {
        for (code, stage) in [
            (200, "login"),
            (202, "login"),
            (401, "login"),
            (4001, "login"),
            (4002, "login"),
            (200, "mfa"),
            (401, "mfa"),
        ] {
            check_stream_lifecycle(Some(code), false, stage).await;
        }
    }

    #[tokio::test]
    async fn invalid_challenge_concludes_only_the_authentication_stream() {
        check_stream_lifecycle(None, false, "login").await;
    }

    #[tokio::test]
    async fn cancellation_concludes_only_the_authentication_stream() {
        check_stream_lifecycle(None, true, "login").await;
    }
}
