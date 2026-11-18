//! Android Keystore backend bridged through `AndroidAuthKeyPlugin`.
use base64ct::{Base64, Encoding};
use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupportResponse {
    available: bool,
    hardware_backed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateResponse {
    sec1_public_key: String,
    hardware_backed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignResponse {
    signature: String,
}

pub fn probe_support<R: Runtime>(app: &AppHandle<R>) -> (bool, bool) {
    app.state::<crate::AndroidAuthKeyPlugin<R>>()
        .handle
        .run_mobile_plugin::<SupportResponse>("checkHardwareAuthSupport", serde_json::json!({}))
        .map(|res| (res.available, res.hardware_backed))
        .unwrap_or((false, false))
}

pub fn verify_exists<R: Runtime>(app: &AppHandle<R>, key_id: &str) -> Result<(), String> {
    app.state::<crate::AndroidAuthKeyPlugin<R>>()
        .handle
        .run_mobile_plugin::<()>(
            "verifyHardwareAuthKey",
            serde_json::json!({ "keyId": key_id }),
        )
        .map_err(|err| {
            if err.to_string().contains("publicKey.storageInvalidated") {
                "publicKey.storageInvalidated".to_string()
            } else {
                crate::secure_store::UNAVAILABLE.to_string()
            }
        })
}

pub fn generate_p256<R: Runtime>(
    app: &AppHandle<R>,
    key_id: &str,
) -> Result<(String, String, bool), String> {
    let res = app
        .state::<crate::AndroidAuthKeyPlugin<R>>()
        .handle
        .run_mobile_plugin::<GenerateResponse>(
            "generateHardwareAuthKey",
            serde_json::json!({ "keyId": key_id }),
        )
        .map_err(|_| crate::secure_store::UNAVAILABLE)?;
    let sec1 = Base64::decode_vec(&res.sec1_public_key).map_err(|_| "publicKey.invalidFile")?;
    let (public_key, fingerprint) =
        match cfms_service::public_key_auth::p256_public_key_from_sec1(&sec1) {
            Ok(pair) => pair,
            Err(err) => {
                let _ = delete_key(app, key_id);
                return Err(err);
            }
        };
    Ok((public_key, fingerprint, res.hardware_backed))
}

pub fn sign_p256<R: Runtime>(
    app: &AppHandle<R>,
    key_id: &str,
    challenge: &[u8],
) -> Result<String, String> {
    let challenge_b64 = Base64::encode_string(challenge);
    let res = app
        .state::<crate::AndroidAuthKeyPlugin<R>>()
        .handle
        .run_mobile_plugin::<SignResponse>(
            "signHardwareAuthChallenge",
            serde_json::json!({ "keyId": key_id, "challenge": challenge_b64 }),
        )
        .map_err(|err| {
            if err.to_string().contains("publicKey.storageInvalidated") {
                "publicKey.storageInvalidated".to_string()
            } else {
                "publicKey.signingFailed".to_string()
            }
        })?;
    let der = Base64::decode_vec(&res.signature).map_err(|_| "publicKey.signingFailed")?;
    cfms_service::public_key_auth::encode_p256_der_signature(&der)
}

pub fn delete_key<R: Runtime>(app: &AppHandle<R>, key_id: &str) -> Result<(), String> {
    app.state::<crate::AndroidAuthKeyPlugin<R>>()
        .handle
        .run_mobile_plugin::<()>(
            "deleteHardwareAuthKey",
            serde_json::json!({ "keyId": key_id }),
        )
        .map_err(|_| crate::secure_store::UNAVAILABLE.into())
}
