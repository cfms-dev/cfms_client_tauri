//! Tauri IPC commands — the boundary between the frontend Webview and the
//! Rust backend.
//!
//! All commands delegate to [`cfms_service`] types through the Tauri managed
//! state ([`AppHandleState`](super::AppHandleState)).
//!
//! # Security
//!
//! No file I/O or network requests happen in the Webview.  Every sensitive
//! operation goes through these commands, which run on the Rust side.

use cfms_core::constants;
use cfms_core::{
    DownloadTaskDto, DownloadTaskStatus, FileEntry, ListDirectoryResponse, ServerInfo,
    ServiceEvent, ServiceStatusInfo, UserPreference,
};
use cfms_crypto::dek;
use cfms_service::services::download_queue;
use rand::Rng;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use std::io::Write;

use tauri::{Emitter, Manager, Runtime, ipc::Channel};
#[cfg(not(target_os = "android"))]
use tauri_plugin_updater::UpdaterExt;

#[cfg(target_os = "android")]
use crate::AndroidUploadFileImporter;
#[cfg(target_os = "android")]
use crate::{AndroidApkInstaller, AndroidFileOpener, AndroidPasskey};
use crate::{AppHandleState, UploadInterruption};

const UPDATE_RELEASES_API: &str =
    "https://api.github.com/repos/cfms-dev/cfms_client_tauri/releases";
const UPDATE_USER_AGENT: &str = "cfms-client-tauri-updater";
const CA_CERT_API_URL: &str = "https://api.github.com/repos/cfms-dev/ca/contents/";
const CA_MANIFEST_FILENAME: &str = ".manifest.json";
const MAX_RECENT_CONNECTION_ADDRESSES: usize = 5;

include!(concat!(env!("OUT_DIR"), "/bundled_ca.rs"));

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConnectionSettingsDto {
    pub enable_proxy: bool,
    pub follow_system_proxy: bool,
    pub custom_proxy: String,
    pub force_ipv4: bool,
    pub client_cert_path: String,
    pub client_key_path: String,
    pub remember_connection_addresses: bool,
    pub recent_connection_addresses: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaCertificateStatusDto {
    pub ca_dir: String,
    pub certificate_count: usize,
    pub last_checked: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaCertificateUpdateResultDto {
    pub added: Vec<String>,
    pub updated: Vec<String>,
    pub removed: Vec<String>,
    pub unchanged: Vec<String>,
    pub errors: Vec<String>,
    pub last_checked: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct CaManifest {
    #[serde(default)]
    last_check: Option<f64>,
    #[serde(default)]
    files: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubContentsEntry {
    name: String,
    sha: String,
    download_url: Option<String>,
    #[serde(rename = "type")]
    entry_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct UploadRevisionProgressEvent {
    pub document_id: String,
    pub task_id: String,
    pub current_bytes: u64,
    pub total_bytes: u64,
    pub progress: f64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum UploadConflictStrategy {
    #[default]
    Fail,
    Skip,
    Overwrite,
}

#[derive(Debug, Clone, Serialize)]
pub struct UploadProgressEvent {
    pub upload_id: String,
    pub task_id: Option<String>,
    pub file_name: String,
    pub current_bytes: u64,
    pub total_bytes: u64,
    pub progress: f64,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
struct UploadFileResult {
    upload_id: String,
    task_id: Option<String>,
    document_id: Option<String>,
    file_name: String,
    skipped: bool,
    overwritten: bool,
}

#[derive(Debug)]
struct PreparedUploadSource {
    path: std::path::PathBuf,
    display_name: Option<String>,
    cleanup_on_drop: bool,
}

impl Drop for PreparedUploadSource {
    fn drop(&mut self) {
        if self.cleanup_on_drop {
            match std::fs::metadata(&self.path) {
                Ok(metadata) if metadata.is_dir() => {
                    let _ = std::fs::remove_dir_all(&self.path);
                }
                Ok(_) => {
                    let _ = std::fs::remove_file(&self.path);
                }
                Err(_) => {}
            }
        }
    }
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AndroidImportedUploadPath {
    path: String,
    display_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidSelectedUploadDirectory {
    uri: String,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidPasskeyAvailability {
    available: bool,
    web_view_web_authn: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidPasskeyRegistration {
    id: String,
    registration_response_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidPasskeyAssertion {
    id: String,
    authentication_response_json: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateChannel {
    Stable,
    Beta,
    Alpha,
}

impl UpdateChannel {
    fn parse(value: Option<&str>) -> Self {
        match value
            .unwrap_or("stable")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "alpha" => Self::Alpha,
            "beta" => Self::Beta,
            _ => Self::Stable,
        }
    }

    const fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
            Self::Alpha => "alpha",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct GithubReleaseDto {
    tag_name: String,
    body: Option<String>,
    prerelease: bool,
    html_url: String,
    published_at: Option<String>,
    assets: Vec<GithubAssetDto>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAssetDto {
    name: String,
    label: Option<String>,
    browser_download_url: String,
    #[cfg(target_os = "android")]
    digest: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateMetadata {
    pub current_version: String,
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub channel: String,
    pub release_url: String,
    pub install_mode: String,
}

#[derive(Debug, Clone)]
#[cfg(target_os = "android")]
pub struct MobileAppUpdate {
    download_url: String,
    file_name: String,
    digest: Option<AssetDigest>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone)]
struct AssetDigest {
    kind: AssetDigestKind,
    value: String,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AssetDigestKind {
    Sha256,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum AppUpdateDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

impl ConnectionSettingsDto {
    fn load(settings: &cfms_service::db::settings::SettingsStore) -> Self {
        let proxy_settings = settings.get("proxy_settings").ok().flatten();
        let custom_proxy = settings
            .get("custom_proxy")
            .ok()
            .flatten()
            .unwrap_or_default();

        let follow_system_proxy = matches!(
            proxy_settings.as_deref(),
            Some("system") | Some("true") | Some("True")
        );

        let enable_proxy = proxy_settings
            .as_deref()
            .map(|value| !value.trim().is_empty() && value != "none" && value != "null")
            .unwrap_or(false);

        Self {
            enable_proxy,
            follow_system_proxy,
            custom_proxy,
            force_ipv4: settings
                .get("force_ipv4")
                .ok()
                .flatten()
                .map(|value| value == "true")
                .unwrap_or(false),
            client_cert_path: settings
                .get("client_cert_path")
                .ok()
                .flatten()
                .unwrap_or_default(),
            client_key_path: settings
                .get("client_key_path")
                .ok()
                .flatten()
                .unwrap_or_default(),
            remember_connection_addresses: settings
                .get("remember_connection_addresses")
                .ok()
                .flatten()
                .map(|value| value == "true")
                .unwrap_or(false),
            recent_connection_addresses: load_recent_connection_addresses(settings),
        }
    }

    fn proxy_setting_value(&self) -> String {
        if !self.enable_proxy {
            String::new()
        } else if self.follow_system_proxy {
            "system".to_string()
        } else {
            self.custom_proxy.trim().to_string()
        }
    }

    fn proxy_addr(&self) -> Result<Option<String>, String> {
        let raw = self.configured_proxy_setting();
        let Some(raw) = raw else {
            return Ok(None);
        };

        normalize_proxy_url(&raw, self.proxy_default_scheme(), "CFMS connections")
            .map(|proxy_url| proxy_url.map(|url| url.to_string()))
    }

    fn update_proxy_url(&self) -> Result<Option<url::Url>, String> {
        let raw = self.configured_proxy_setting();
        let Some(raw) = raw else {
            return Ok(None);
        };

        normalize_proxy_url(&raw, self.proxy_default_scheme(), "update checks")
    }

    fn proxy_default_scheme(&self) -> &'static str {
        if self.follow_system_proxy {
            "http"
        } else {
            "socks5h"
        }
    }

    fn configured_proxy_setting(&self) -> Option<String> {
        if !self.enable_proxy {
            return None;
        }

        let raw = if self.follow_system_proxy {
            system_proxy_setting()
        } else {
            Some(self.custom_proxy.trim().to_string())
        }?;

        let trimmed = raw.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    }

    fn client_identity_paths(&self) -> (Option<std::path::PathBuf>, Option<std::path::PathBuf>) {
        let cert = trimmed_path(&self.client_cert_path);
        let key = trimmed_path(&self.client_key_path);
        (cert, key)
    }
}

// ---------------------------------------------------------------------------
// Health / info (existing commands, preserved for backward compat)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

#[tauri::command]
pub fn ping() -> String {
    "pong".into()
}

#[tauri::command]
pub fn protocol_version() -> u32 {
    constants::PROTOCOL_VERSION
}

#[tauri::command]
pub fn crypto_info() -> serde_json::Value {
    serde_json::json!({
        "kdf_iterations": constants::KDF_ITERATIONS,
        "salt_len": constants::SALT_LEN,
        "key_len": constants::KEY_LEN,
        "nonce_len": constants::NONCE_LEN,
        "tag_len": constants::TAG_LEN,
    })
}

// ---------------------------------------------------------------------------
// Service status
// ---------------------------------------------------------------------------

/// Get the status of background services.
#[tauri::command]
pub async fn get_service_status(
    state: tauri::State<'_, AppHandleState>,
) -> Result<Vec<ServiceStatusInfo>, String> {
    // We track services by whether their handles are active.
    // For now, return a static list since all services start together.
    let lockdown = state
        .inner
        .app_lockdown
        .load(std::sync::atomic::Ordering::SeqCst);
    Ok(vec![
        ServiceStatusInfo {
            name: "token_refresh".into(),
            running: state.inner.token.read().await.is_some(),
        },
        ServiceStatusInfo {
            name: "favorites_validation".into(),
            running: true,
        },
        ServiceStatusInfo {
            name: "server_push".into(),
            running: true,
        },
        ServiceStatusInfo {
            name: "connection_reconnect".into(),
            running: true,
        },
        ServiceStatusInfo {
            name: "download_queue".into(),
            running: true,
        },
        ServiceStatusInfo {
            name: "app_lockdown".into(),
            running: lockdown,
        },
    ])
}

/// Run one immediate favorites/recent-visits validation cycle.
#[tauri::command]
pub async fn validate_file_shortcuts(
    state: tauri::State<'_, AppHandleState>,
) -> Result<cfms_service::services::favorites::ShortcutValidationStatus, String> {
    let status =
        cfms_service::services::favorites::validate_now(&state.inner, &state.app_data_dir).await;

    let _ = state
        .inner
        .event_tx
        .send(ServiceEvent::FavoritesValidationComplete {
            invalid_count: status.invalid_count,
            invalid_files: status.invalid_files.clone(),
            invalid_directories: status.invalid_directories.clone(),
            access_denied_files: status.access_denied_files.clone(),
            access_denied_directories: status.access_denied_directories.clone(),
        });

    Ok(status)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_passkey_availability<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<AndroidPasskeyAvailability, String> {
    let passkey = app.state::<AndroidPasskey<R>>();
    passkey
        .handle
        .run_mobile_plugin::<AndroidPasskeyAvailability>("isAvailable", serde_json::json!({}))
        .map_err(|e| format!("Failed to query Android passkey availability: {e}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_passkey_availability() -> Result<AndroidPasskeyAvailability, String> {
    Ok(AndroidPasskeyAvailability {
        available: false,
        web_view_web_authn: false,
    })
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_create_passkey<R: Runtime>(
    app: tauri::AppHandle<R>,
    request_json: String,
) -> Result<AndroidPasskeyRegistration, String> {
    let passkey = app.state::<AndroidPasskey<R>>();
    passkey
        .handle
        .run_mobile_plugin::<AndroidPasskeyRegistration>(
            "createPasskey",
            serde_json::json!({ "requestJson": request_json }),
        )
        .map_err(|e| format!("Failed to create Android passkey: {e}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_create_passkey(
    request_json: String,
) -> Result<AndroidPasskeyRegistration, String> {
    let _ = request_json;
    Err("Android passkeys are only available on Android.".to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn android_get_passkey<R: Runtime>(
    app: tauri::AppHandle<R>,
    request_json: String,
) -> Result<AndroidPasskeyAssertion, String> {
    let passkey = app.state::<AndroidPasskey<R>>();
    passkey
        .handle
        .run_mobile_plugin::<AndroidPasskeyAssertion>(
            "getPasskey",
            serde_json::json!({ "requestJson": request_json }),
        )
        .map_err(|e| format!("Failed to verify Android passkey: {e}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn android_get_passkey(request_json: String) -> Result<AndroidPasskeyAssertion, String> {
    let _ = request_json;
    Err("Android passkeys are only available on Android.".to_string())
}

// ---------------------------------------------------------------------------
// Application updater
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    channel: Option<String>,
) -> Result<Option<AppUpdateMetadata>, String> {
    let channel = UpdateChannel::parse(channel.as_deref());
    check_android_app_update(&app, state, channel).await
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    channel: Option<String>,
) -> Result<Option<AppUpdateMetadata>, String> {
    let channel = UpdateChannel::parse(channel.as_deref());
    let proxy_url = update_proxy_url(&state)?;
    tracing::info!(
        "Checking for app updates (proxy={})",
        describe_update_proxy(proxy_url.as_ref())
    );
    let client = update_http_client(proxy_url.as_ref())?;
    let Some(release) =
        find_update_release(&client, channel, UpdateAssetKind::DesktopManifest).await?
    else {
        let mut pending = state
            .pending_update
            .lock()
            .map_err(|_| "Updater state is unavailable.".to_string())?;
        *pending = None;
        return Ok(None);
    };
    let Some(manifest_asset) = select_update_manifest_asset(&release, channel) else {
        let mut pending = state
            .pending_update
            .lock()
            .map_err(|_| "Updater state is unavailable.".to_string())?;
        *pending = None;
        return Ok(None);
    };

    let manifest_url = manifest_asset.browser_download_url.clone();
    let release_url = release.html_url.clone();

    let endpoint =
        url::Url::parse(&manifest_url).map_err(|e| format!("Invalid update manifest URL: {e}"))?;
    let mut updater_builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("Failed to configure updater endpoint: {e}"))?;
    if let Some(proxy_url) = proxy_url {
        updater_builder = updater_builder.proxy(proxy_url);
    }
    let mut update = updater_builder
        .build()
        .map_err(|e| format!("Failed to initialize updater: {e}"))?
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {e}"))?;

    if let Some(update) = update.as_mut() {
        reconcile_update_download_url(update, &release)?;
    }

    let metadata = update.as_ref().map(|update| AppUpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update.date.map(|date| date.to_string()),
        body: update.body.clone(),
        channel: channel.as_str().to_string(),
        release_url,
        install_mode: "desktop".to_string(),
    });

    let mut pending = state
        .pending_update
        .lock()
        .map_err(|_| "Updater state is unavailable.".to_string())?;
    *pending = update;

    Ok(metadata)
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn install_app_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    on_event: Channel<AppUpdateDownloadEvent>,
) -> Result<(), String> {
    install_android_app_update(app, state, on_event).await
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn open_downloaded_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<(), String> {
    ensure_regular_file_exists(&path)?;

    let opener = app.state::<AndroidFileOpener<R>>();
    opener
        .handle
        .run_mobile_plugin::<()>("openFile", serde_json::json!({ "path": path }))
        .map_err(|e| format!("Failed to open downloaded file: {e}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn open_downloaded_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<(), String> {
    ensure_regular_file_exists(&path)?;

    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(path, None::<&str>)
        .map_err(|e| format!("Failed to open downloaded file: {e}"))
}

fn ensure_regular_file_exists(path: &str) -> Result<(), String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("Downloaded file was not found: {e}"))?;
    if !metadata.is_file() {
        return Err("Downloaded path is not a file.".to_string());
    }
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn install_app_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    on_event: Channel<AppUpdateDownloadEvent>,
) -> Result<(), String> {
    let _ = &app;
    let update_proxy = {
        let settings = ConnectionSettingsDto::load(&state.settings);
        settings.update_proxy_url()?
    };
    let update = {
        let mut pending = state
            .pending_update
            .lock()
            .map_err(|_| "Updater state is unavailable.".to_string())?;
        pending.take()
    };

    let Some(mut update) = update else {
        return Err("No pending update is available. Check for updates first.".to_string());
    };

    let mut started = false;
    let download_url = update.download_url.clone();
    update.proxy = update_proxy;
    tracing::info!(
        "Installing app update (proxy={})",
        describe_update_proxy(update.proxy.as_ref())
    );
    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    let _ = on_event.send(AppUpdateDownloadEvent::Started { content_length });
                    started = true;
                }
                let _ = on_event.send(AppUpdateDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(AppUpdateDownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| format!("Failed to install update from {download_url}: {e}"))
}

#[cfg(target_os = "android")]
async fn check_android_app_update(
    app: &tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    channel: UpdateChannel,
) -> Result<Option<AppUpdateMetadata>, String> {
    let proxy_url = update_proxy_url(&state)?;
    tracing::info!(
        "Checking for Android app updates (proxy={})",
        describe_update_proxy(proxy_url.as_ref())
    );
    let client = update_http_client(proxy_url.as_ref())?;
    let release = find_update_release(&client, channel, UpdateAssetKind::AndroidApk).await?;
    let Some(release) = release else {
        clear_mobile_pending_update(&state)?;
        return Ok(None);
    };

    let current_version = app.package_info().version.to_string();
    if !is_release_newer(&release.tag_name, &current_version) {
        clear_mobile_pending_update(&state)?;
        return Ok(None);
    }

    let Some(asset) = select_android_apk_asset(&release) else {
        clear_mobile_pending_update(&state)?;
        return Ok(None);
    };

    let digest = asset.digest.as_deref().and_then(parse_asset_digest);
    let file_name = sanitize_update_file_name(&asset.name, &release.tag_name);

    let update = MobileAppUpdate {
        download_url: asset.browser_download_url.clone(),
        file_name,
        digest,
    };

    let metadata = AppUpdateMetadata {
        current_version,
        version: release.tag_name,
        date: release.published_at,
        body: release.body,
        channel: channel.as_str().to_string(),
        release_url: release.html_url,
        install_mode: "android-apk".to_string(),
    };

    let mut pending = state
        .pending_mobile_update
        .lock()
        .map_err(|_| "Mobile updater state is unavailable.".to_string())?;
    *pending = Some(update);

    Ok(Some(metadata))
}

#[cfg(target_os = "android")]
async fn install_android_app_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    on_event: Channel<AppUpdateDownloadEvent>,
) -> Result<(), String> {
    let proxy_url = update_proxy_url(&state)?;
    tracing::info!(
        "Installing Android app update (proxy={})",
        describe_update_proxy(proxy_url.as_ref())
    );
    let client = update_http_client(proxy_url.as_ref())?;
    let update = {
        let pending = state
            .pending_mobile_update
            .lock()
            .map_err(|_| "Mobile updater state is unavailable.".to_string())?;
        pending.clone()
    };

    let Some(update) = update else {
        return Err("No pending Android update is available. Check for updates first.".to_string());
    };

    let update_dir = android_update_cache_dir(&app)?;
    tokio::fs::create_dir_all(&update_dir)
        .await
        .map_err(|e| format!("Failed to create update directory: {e}"))?;
    let target_path = update_dir.join(&update.file_name);

    download_mobile_update(&client, &update, &target_path, &on_event).await?;

    let installer = app.state::<AndroidApkInstaller<R>>();
    installer
        .handle
        .run_mobile_plugin::<()>(
            "installApk",
            serde_json::json!({ "path": target_path.to_string_lossy() }),
        )
        .map_err(|e| format!("Failed to open Android package installer: {e}"))?;

    let mut pending = state
        .pending_mobile_update
        .lock()
        .map_err(|_| "Mobile updater state is unavailable.".to_string())?;
    *pending = None;

    Ok(())
}

#[cfg(target_os = "android")]
fn android_update_cache_dir<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
    // Keep APK handoff files under Android cache; file_paths.xml exposes
    // this via <cache-path>, while app_data_dir may live outside FileProvider.
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to resolve update cache directory: {e}"))?
        .join("updates"))
}

#[cfg(target_os = "android")]
fn clear_mobile_pending_update(state: &tauri::State<'_, AppHandleState>) -> Result<(), String> {
    let mut pending = state
        .pending_mobile_update
        .lock()
        .map_err(|_| "Mobile updater state is unavailable.".to_string())?;
    *pending = None;
    Ok(())
}

#[cfg(target_os = "android")]
async fn download_mobile_update(
    client: &reqwest::Client,
    update: &MobileAppUpdate,
    target_path: &std::path::Path,
    on_event: &Channel<AppUpdateDownloadEvent>,
) -> Result<(), String> {
    if is_cached_mobile_update_valid(target_path, update).await? {
        let size = tokio::fs::metadata(target_path)
            .await
            .ok()
            .map(|metadata| metadata.len());
        let _ = on_event.send(AppUpdateDownloadEvent::Started {
            content_length: size,
        });
        if let Some(size) = size {
            let _ = on_event.send(AppUpdateDownloadEvent::Progress {
                chunk_length: size as usize,
            });
        }
        let _ = on_event.send(AppUpdateDownloadEvent::Finished);
        return Ok(());
    }

    let mut response = client
        .get(&update.download_url)
        .header(reqwest::header::USER_AGENT, UPDATE_USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Failed to download Android update: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Android update download failed: {e}"))?;

    let content_length = response.content_length();
    let _ = on_event.send(AppUpdateDownloadEvent::Started { content_length });

    let tmp_path = target_path.with_extension("apk.part");
    let mut file = std::fs::File::create(&tmp_path)
        .map_err(|e| format!("Failed to create temporary update file: {e}"))?;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed while downloading Android update: {e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write Android update file: {e}"))?;
        let _ = on_event.send(AppUpdateDownloadEvent::Progress {
            chunk_length: chunk.len(),
        });
    }

    file.flush()
        .map_err(|e| format!("Failed to flush Android update file: {e}"))?;
    drop(file);

    if let Some(digest) = &update.digest {
        verify_update_digest(&tmp_path, digest).await?;
    }

    tokio::fs::rename(&tmp_path, target_path)
        .await
        .map_err(|e| format!("Failed to finalize Android update file: {e}"))?;

    let _ = on_event.send(AppUpdateDownloadEvent::Finished);
    Ok(())
}

#[cfg(target_os = "android")]
async fn is_cached_mobile_update_valid(
    target_path: &std::path::Path,
    update: &MobileAppUpdate,
) -> Result<bool, String> {
    let Ok(metadata) = tokio::fs::metadata(target_path).await else {
        return Ok(false);
    };
    if metadata.len() == 0 {
        return Ok(false);
    }

    let Some(digest) = &update.digest else {
        return Ok(false);
    };

    verify_update_digest(target_path, digest)
        .await
        .map(|_| true)
}

#[cfg(target_os = "android")]
async fn verify_update_digest(path: &std::path::Path, digest: &AssetDigest) -> Result<(), String> {
    match digest.kind {
        AssetDigestKind::Sha256 => {
            let expected = digest.value.to_ascii_lowercase();
            let path = path.to_path_buf();
            let actual = tokio::task::spawn_blocking(move || {
                cfms_transfer::compute_sha256(&path).map(hex::encode)
            })
            .await
            .map_err(|e| format!("SHA-256 verification task failed: {e}"))?
            .map_err(|e| format!("Failed to calculate update SHA-256: {e}"))?;

            if actual == expected {
                Ok(())
            } else {
                Err("Downloaded update failed SHA-256 verification.".to_string())
            }
        }
    }
}

#[cfg(target_os = "android")]
fn parse_asset_digest(raw: &str) -> Option<AssetDigest> {
    let (kind, value) = raw.split_once(':')?;
    let kind = match kind.trim().to_ascii_lowercase().as_str() {
        "sha256" => AssetDigestKind::Sha256,
        _ => return None,
    };
    let value = value.trim().to_ascii_lowercase();
    if value.is_empty() {
        return None;
    }
    Some(AssetDigest { kind, value })
}

#[cfg(target_os = "android")]
fn sanitize_update_file_name(raw: &str, version: &str) -> String {
    let fallback = format!("cfms-client-{version}.apk");
    let source = if raw.trim().is_empty() {
        &fallback
    } else {
        raw
    };
    let mut sanitized = source
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => ch,
            _ => '_',
        })
        .collect::<String>();

    if !sanitized.to_ascii_lowercase().ends_with(".apk") {
        sanitized.push_str(".apk");
    }

    sanitized
}

#[derive(Debug, Clone, Copy)]
enum UpdateAssetKind {
    DesktopManifest,
    #[cfg(target_os = "android")]
    AndroidApk,
}

async fn find_update_release(
    client: &reqwest::Client,
    channel: UpdateChannel,
    asset_kind: UpdateAssetKind,
) -> Result<Option<GithubReleaseDto>, String> {
    let releases = client
        .get(UPDATE_RELEASES_API)
        .header(reqwest::header::USER_AGENT, UPDATE_USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch release list: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub release request failed: {e}"))?
        .json::<Vec<GithubReleaseDto>>()
        .await
        .map_err(|e| format!("Failed to parse release list: {e}"))?;

    let mut candidates = releases
        .into_iter()
        .filter(|release| select_update_asset(release, channel, asset_kind).is_some())
        .filter_map(|release| {
            channel_match_priority(channel, release_channel(&release))
                .map(|priority| (priority, release))
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|(left_priority, left), (right_priority, right)| {
        left_priority
            .cmp(right_priority)
            .then_with(|| compare_release_version(right, left))
            .then_with(|| right.published_at.cmp(&left.published_at))
    });

    Ok(candidates.into_iter().map(|(_, release)| release).next())
}

fn update_proxy_url(state: &tauri::State<'_, AppHandleState>) -> Result<Option<url::Url>, String> {
    let settings = ConnectionSettingsDto::load(&state.settings);
    settings.update_proxy_url()
}

fn update_http_client(proxy_url: Option<&url::Url>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().user_agent(UPDATE_USER_AGENT);
    if let Some(proxy_url) = proxy_url {
        let proxy = reqwest::Proxy::all(proxy_url.as_str())
            .map_err(|e| format!("Failed to configure updater proxy: {e}"))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|e| format!("Failed to initialize updater HTTP client: {e}"))
}

fn describe_update_proxy(proxy_url: Option<&url::Url>) -> String {
    let Some(proxy_url) = proxy_url else {
        return "none".to_string();
    };

    let host = proxy_url.host_str().unwrap_or("unknown");
    match proxy_url.port() {
        Some(port) => format!("{}://{}:{}", proxy_url.scheme(), host, port),
        None => format!("{}://{}", proxy_url.scheme(), host),
    }
}

fn select_update_asset(
    release: &GithubReleaseDto,
    channel: UpdateChannel,
    kind: UpdateAssetKind,
) -> Option<&GithubAssetDto> {
    match kind {
        UpdateAssetKind::DesktopManifest => select_update_manifest_asset(release, channel),
        #[cfg(target_os = "android")]
        UpdateAssetKind::AndroidApk => select_android_apk_asset(release),
    }
}

fn select_update_manifest_asset(
    release: &GithubReleaseDto,
    channel: UpdateChannel,
) -> Option<&GithubAssetDto> {
    let channel_manifest = format!("latest-{}.json", channel.as_str());
    release
        .assets
        .iter()
        .find(|asset| asset.name == channel_manifest)
        .or_else(|| {
            release
                .assets
                .iter()
                .find(|asset| asset.name == "latest.json")
        })
}

#[cfg(not(target_os = "android"))]
fn reconcile_update_download_url(
    update: &mut tauri_plugin_updater::Update,
    release: &GithubReleaseDto,
) -> Result<(), String> {
    let Some(requested_file_name) = update_download_file_name(&update.download_url) else {
        return Ok(());
    };

    let Some(asset) = release.assets.iter().find(|asset| {
        asset.name == requested_file_name || asset.label.as_deref() == Some(&requested_file_name)
    }) else {
        return Ok(());
    };

    if asset.browser_download_url == update.download_url.as_str() {
        return Ok(());
    }

    update.download_url = url::Url::parse(&asset.browser_download_url)
        .map_err(|e| format!("Invalid update asset URL: {e}"))?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn update_download_file_name(download_url: &url::Url) -> Option<String> {
    download_url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .map(|segment| segment.replace("%20", " "))
}

#[cfg(target_os = "android")]
fn select_android_apk_asset(release: &GithubReleaseDto) -> Option<&GithubAssetDto> {
    release
        .assets
        .iter()
        .filter(|asset| asset.name.to_ascii_lowercase().ends_with(".apk"))
        .max_by_key(|asset| android_apk_asset_score(&asset.name))
}

#[cfg(target_os = "android")]
fn android_apk_asset_score(name: &str) -> u8 {
    let lower = name.to_ascii_lowercase();
    let mut score = 0;
    if lower.contains("universal") {
        score += 4;
    }
    if lower.contains("android") {
        score += 2;
    }
    if !lower.contains("debug") {
        score += 1;
    }
    score
}

fn release_channel(release: &GithubReleaseDto) -> UpdateChannel {
    if let Some(body) = release.body.as_deref() {
        let lower = body.to_ascii_lowercase();
        if lower.contains("<!-- channel: alpha -->") {
            return UpdateChannel::Alpha;
        }
        if lower.contains("<!-- channel: beta -->") {
            return UpdateChannel::Beta;
        }
        if lower.contains("<!-- channel: stable -->") {
            return UpdateChannel::Stable;
        }
    }

    if release.prerelease {
        UpdateChannel::Alpha
    } else {
        UpdateChannel::Stable
    }
}

fn channel_match_priority(requested: UpdateChannel, actual: UpdateChannel) -> Option<u8> {
    match (requested, actual) {
        (UpdateChannel::Stable, UpdateChannel::Stable) => Some(0),
        (UpdateChannel::Beta, UpdateChannel::Beta) => Some(0),
        (UpdateChannel::Beta, UpdateChannel::Stable) => Some(1),
        (UpdateChannel::Alpha, UpdateChannel::Alpha) => Some(0),
        (UpdateChannel::Alpha, UpdateChannel::Beta) => Some(1),
        (UpdateChannel::Alpha, UpdateChannel::Stable) => Some(2),
        _ => None,
    }
}

fn compare_release_version(
    left: &GithubReleaseDto,
    right: &GithubReleaseDto,
) -> std::cmp::Ordering {
    let left_version = parse_release_version(&left.tag_name);
    let right_version = parse_release_version(&right.tag_name);
    left_version.cmp(&right_version)
}

fn parse_release_version(tag: &str) -> Option<semver::Version> {
    semver::Version::parse(tag.trim_start_matches('v')).ok()
}

#[cfg(target_os = "android")]
fn is_release_newer(release_tag: &str, current_version: &str) -> bool {
    let Some(release_version) = parse_release_version(release_tag) else {
        return false;
    };
    let Some(current_version) = parse_release_version(current_version) else {
        return true;
    };
    release_version > current_version
}

// ---------------------------------------------------------------------------
// Download queue commands
// ---------------------------------------------------------------------------

/// Add a download task to the persistent queue.
#[tauri::command]
pub async fn add_download(
    state: tauri::State<'_, AppHandleState>,
    task: DownloadTaskDto,
) -> Result<(), String> {
    state
        .tasks
        .insert(&task)
        .map_err(|e| format!("Failed to add download: {e}"))
}

/// Get all download tasks, optionally filtered by status.
#[tauri::command]
pub async fn get_download_tasks(
    state: tauri::State<'_, AppHandleState>,
    status_filter: Option<DownloadTaskStatus>,
) -> Result<Vec<DownloadTaskDto>, String> {
    Ok(state.tasks.list(status_filter))
}

/// Pause an in-progress download.
#[tauri::command]
pub async fn pause_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    download_queue::pause_task(&state.tasks, &task_id)
        .map_err(|e| format!("Failed to pause download: {e}"))
}

/// Resume a paused download.
#[tauri::command]
pub async fn resume_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    download_queue::resume_task(&state.tasks, &task_id)
        .map_err(|e| format!("Failed to resume download: {e}"))
}

/// Cancel a download task.
#[tauri::command]
pub async fn cancel_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    download_queue::cancel_task(&state.tasks, &state.active_downloads, &task_id)
        .map_err(|e| format!("Failed to cancel download: {e}"))
}

/// Clear completed and cancelled tasks.
#[tauri::command]
pub async fn clear_completed_tasks(state: tauri::State<'_, AppHandleState>) -> Result<u32, String> {
    Ok(state.tasks.clear_completed() as u32)
}

/// Clear failed tasks. Returns count removed.
#[tauri::command]
pub async fn clear_failed_tasks(state: tauri::State<'_, AppHandleState>) -> Result<u32, String> {
    Ok(state.tasks.clear_failed() as u32)
}

/// Delete a download task and remove its file from disk.
///
/// Removes the task from the in-memory queue and deletes the associated file
/// if it exists on the filesystem.
#[tauri::command]
pub async fn delete_download(
    state: tauri::State<'_, AppHandleState>,
    task_id: String,
) -> Result<bool, String> {
    // Look up the task to get its file_path for filesystem cleanup.
    if let Some(task) = state.tasks.get(&task_id) {
        // Try to delete the file from disk (best-effort, don't fail if missing).
        let path = std::path::Path::new(&task.file_path);
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }

    // Remove from the in-memory queue.
    state.tasks.delete(&task_id);

    Ok(true)
}

// ---------------------------------------------------------------------------
// Server-side directory & document operations
// ---------------------------------------------------------------------------

/// Create a new directory on the CFMS server.
///
/// Mirrors [`create_directory`] from the Python reference (`create.py`).
#[tauri::command]
pub async fn create_directory(
    state: tauri::State<'_, AppHandleState>,
    parent_id: Option<String>,
    name: String,
    exists_ok: Option<bool>,
) -> Result<String, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "create_directory",
        serde_json::json!({"parent_id": parent_id, "name": name, "exists_ok": exists_ok.unwrap_or(false)}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    let id = resp.data["id"]
        .as_str()
        .ok_or_else(|| "Server response missing id".to_string())?
        .to_string();

    Ok(id)
}

/// Delete a directory on the CFMS server.
///
/// Mirrors `delete_directory` from the Python reference (`batch_operations.py`).
#[tauri::command]
pub async fn delete_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: String,
) -> Result<bool, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "delete_directory",
        serde_json::json!({"folder_id": folder_id}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    Ok(true)
}

/// Delete a document on the CFMS server.
///
/// Mirrors `delete_document` from the Python reference (`batch_operations.py`).
#[tauri::command]
pub async fn delete_document(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
) -> Result<bool, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "delete_document",
        serde_json::json!({"document_id": document_id}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    Ok(true)
}

/// Rename a directory on the CFMS server.
#[tauri::command]
pub async fn rename_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: String,
    new_name: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "rename_directory",
        serde_json::json!({ "folder_id": folder_id, "new_name": new_name }),
    )
    .await
}

/// Rename a document on the CFMS server.
#[tauri::command]
pub async fn rename_document(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    new_title: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "rename_document",
        serde_json::json!({ "document_id": document_id, "new_title": new_title }),
    )
    .await
}

/// Move a directory into another directory, or root when target is `None`.
#[tauri::command]
pub async fn move_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: String,
    target_folder_id: Option<String>,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "move_directory",
        serde_json::json!({
            "folder_id": folder_id,
            "target_folder_id": non_empty_optional(target_folder_id),
        }),
    )
    .await
}

/// Move a document into another directory, or root when target is `None`.
#[tauri::command]
pub async fn move_document(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    target_folder_id: Option<String>,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "move_document",
        serde_json::json!({
            "document_id": document_id,
            "target_folder_id": non_empty_optional(target_folder_id),
        }),
    )
    .await
}

/// Fetch server-side document properties.
#[tauri::command]
pub async fn get_document_info(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "get_document_info",
        serde_json::json!({ "document_id": document_id }),
    )
    .await
}

/// Fetch server-side directory properties.
#[tauri::command]
pub async fn get_directory_info(
    state: tauri::State<'_, AppHandleState>,
    directory_id: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "get_directory_info",
        serde_json::json!({ "directory_id": directory_id }),
    )
    .await
}

/// View temporary access entries for a document or directory.
#[tauri::command]
pub async fn view_access_entries(
    state: tauri::State<'_, AppHandleState>,
    object_type: String,
    object_identifier: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "view_access_entries",
        serde_json::json!({
            "object_type": object_type,
            "object_identifier": object_identifier,
        }),
    )
    .await
}

/// Revoke a temporary access entry.
#[tauri::command]
pub async fn revoke_access(
    state: tauri::State<'_, AppHandleState>,
    entry_id: i64,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "revoke_access",
        serde_json::json!({ "entry_id": entry_id }),
    )
    .await
}

/// Grant temporary access to a document or directory.
#[tauri::command]
pub async fn grant_access(
    state: tauri::State<'_, AppHandleState>,
    entity_identifier: String,
    entity_type: String,
    target_type: String,
    target_identifier: String,
    access_types: Vec<String>,
    start_time: f64,
    end_time: f64,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "grant_access",
        serde_json::json!({
            "entity_identifier": entity_identifier,
            "entity_type": entity_type,
            "target_type": target_type,
            "target_identifier": target_identifier,
            "access_types": access_types,
            "start_time": start_time,
            "end_time": end_time,
        }),
    )
    .await
}

/// Fetch document or directory access rules.
#[tauri::command]
pub async fn get_access_rules(
    state: tauri::State<'_, AppHandleState>,
    object_type: String,
    object_id: String,
) -> Result<serde_json::Value, String> {
    match object_type.as_str() {
        "document" => {
            server_action_json(
                &state,
                "get_document_access_rules",
                serde_json::json!({ "document_id": object_id }),
            )
            .await
        }
        "directory" => {
            server_action_json(
                &state,
                "get_directory_access_rules",
                serde_json::json!({ "directory_id": object_id }),
            )
            .await
        }
        other => Err(format!("Invalid object type: {other}")),
    }
}

/// Set document or directory access rules.
#[tauri::command]
pub async fn set_access_rules(
    state: tauri::State<'_, AppHandleState>,
    object_type: String,
    object_id: String,
    access_rules: serde_json::Value,
    inherit_parent: bool,
) -> Result<bool, String> {
    match object_type.as_str() {
        "document" => {
            server_action_bool(
                &state,
                "set_document_rules",
                serde_json::json!({
                    "document_id": object_id,
                    "access_rules": access_rules,
                    "inherit_parent": inherit_parent,
                }),
            )
            .await
        }
        "directory" => {
            server_action_bool(
                &state,
                "set_directory_rules",
                serde_json::json!({
                    "directory_id": object_id,
                    "access_rules": access_rules,
                    "inherit_parent": inherit_parent,
                }),
            )
            .await
        }
        other => Err(format!("Invalid object type: {other}")),
    }
}

/// List all revisions for a document.
#[tauri::command]
pub async fn list_revisions(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "list_revisions",
        serde_json::json!({ "document_id": document_id }),
    )
    .await
}

/// Request a specific revision and enqueue it in the download queue.
#[tauri::command]
pub async fn get_revision(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    revision_id: String,
    filename: String,
    is_current: Option<bool>,
) -> Result<serde_json::Value, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "get_revision",
        serde_json::json!({ "id": revision_id.clone() }),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    let task_data = resp
        .data
        .get("task_data")
        .ok_or_else(|| "Server response missing task_data".to_string())?;
    let task_id = task_data["task_id"]
        .as_str()
        .ok_or_else(|| "Server response missing task_id".to_string())?
        .to_string();
    let supports_resume = task_data["supports_resume"].as_bool().unwrap_or(false);

    let local_filename = if is_current.unwrap_or(false) {
        filename
    } else {
        format!("rev{revision_id}_{filename}")
    };
    let download_root = download_root(&app_handle)?;
    std::fs::create_dir_all(&download_root)
        .map_err(|e| format!("Failed to create download directory: {e}"))?;
    let file_path = download_root.join(&local_filename);

    let task = DownloadTaskDto {
        task_id: task_id.clone(),
        file_id: revision_id.clone(),
        filename: local_filename.clone(),
        file_path: file_path.to_string_lossy().into_owned(),
        status: DownloadTaskStatus::Pending,
        progress: 0.0,
        current_bytes: 0,
        total_bytes: 0,
        message: None,
        error: None,
        created_at: unix_now(),
        started_at: None,
        completed_at: None,
        priority: 0,
        retry_count: 0,
        max_retries: 3,
        scheduled_time: None,
        stage: 0,
        bandwidth_limit: None,
        pause_position: None,
        supports_resume,
    };

    state
        .tasks
        .insert(&task)
        .map_err(|e| format!("Failed to add download: {e}"))?;

    Ok(serde_json::json!({
        "task_id": task_id,
        "file_id": revision_id,
        "filename": local_filename,
        "file_path": task.file_path,
    }))
}

/// Set a specific revision as the document's current revision.
#[tauri::command]
pub async fn set_current_revision(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    revision_id: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "set_current_revision",
        serde_json::json!({
            "document_id": document_id,
            "revision_id": revision_id,
        }),
    )
    .await
}

/// Upload a local file as a new revision for an existing document.
#[tauri::command]
pub async fn upload_new_revision<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    file_path: String,
) -> Result<serde_json::Value, String> {
    let source = prepare_upload_source(&app_handle, file_path)?;

    let (conn, username, token) = get_connection_auth(&state).await?;
    let resp = send_action_request(
        &conn,
        "upload_document",
        serde_json::json!({ "document_id": document_id }),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    let task_data = resp
        .data
        .get("task_data")
        .ok_or_else(|| "Server response missing task_data".to_string())?;
    let task_id = task_data["task_id"]
        .as_str()
        .ok_or_else(|| "Server response missing task_id".to_string())?
        .to_string();

    let transfer_conn = create_transfer_connection(&state.inner).await?;
    let emit_handle = app_handle.clone();
    let progress_document_id = document_id.clone();
    let progress_task_id = task_id.clone();
    let progress = move |current: u64, total: u64| {
        let progress = if total > 0 {
            current as f64 / total as f64
        } else {
            1.0
        };
        let _ = emit_handle.emit(
            "cfms:upload-revision-progress",
            UploadRevisionProgressEvent {
                document_id: progress_document_id.clone(),
                task_id: progress_task_id.clone(),
                current_bytes: current,
                total_bytes: total,
                progress,
            },
        );
    };

    let result =
        cfms_transfer::upload::send(&transfer_conn, &task_id, &source.path, &progress).await;
    transfer_conn.close().await;
    result.map_err(|e| format!("Upload failed: {e}"))?;

    let _ = app_handle.emit(
        "cfms:upload-revision-progress",
        UploadRevisionProgressEvent {
            document_id: document_id.clone(),
            task_id: task_id.clone(),
            current_bytes: 1,
            total_bytes: 1,
            progress: 1.0,
        },
    );

    Ok(serde_json::json!({
        "task_id": task_id,
        "document_id": document_id,
    }))
}

/// Upload a local file as a new document in a server-side directory.
#[tauri::command]
pub async fn upload_document_file<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    parent_id: Option<String>,
    file_path: String,
    upload_id: String,
    conflict_strategy: Option<UploadConflictStrategy>,
    upload_name: Option<String>,
) -> Result<serde_json::Value, String> {
    let source = prepare_upload_source(&app_handle, file_path)?;
    let upload_name =
        clean_optional_upload_name(upload_name).or_else(|| source.display_name.clone());
    let result = upload_local_file(
        &app_handle,
        &state,
        parent_id,
        source.path.clone(),
        upload_name,
        upload_id,
        conflict_strategy.unwrap_or_default(),
    )
    .await?;

    Ok(serde_json::json!({
        "upload_id": result.upload_id,
        "task_id": result.task_id,
        "document_id": result.document_id,
        "file_name": result.file_name,
        "skipped": result.skipped,
        "overwritten": result.overwritten,
    }))
}

/// Upload a local directory recursively, preserving its directory structure.
#[tauri::command]
pub async fn upload_directory<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: tauri::State<'_, AppHandleState>,
    parent_id: Option<String>,
    directory_path: String,
    upload_id: String,
    conflict_strategy: Option<UploadConflictStrategy>,
    upload_name: Option<String>,
) -> Result<serde_json::Value, String> {
    let source = prepare_upload_directory_source(&app_handle, directory_path)?;
    let root = source.path.clone();
    if !root.is_dir() {
        return Err("Selected path is not a directory".to_string());
    }

    let root_name = clean_optional_upload_name(upload_name)
        .or_else(|| source.display_name.clone())
        .or_else(|| {
            root.file_name()
                .and_then(|name| name.to_str())
                .map(ToOwned::to_owned)
        })
        .ok_or_else(|| "Selected directory has no valid name".to_string())?;

    let root_id = create_server_directory(&state, parent_id, root_name, true).await?;
    let entries = collect_directory_entries(&root)?;
    let total_files = entries.iter().filter(|entry| entry.is_file()).count();
    let mut uploaded_files = 0usize;
    let mut dir_ids = std::collections::HashMap::<std::path::PathBuf, String>::new();
    dir_ids.insert(std::path::PathBuf::new(), root_id.clone());
    let conflict_strategy = conflict_strategy.unwrap_or_default();

    for entry in entries {
        let relative = entry
            .strip_prefix(&root)
            .map_err(|e| format!("Failed to resolve upload path: {e}"))?
            .to_path_buf();

        if entry.is_dir() {
            let parent_rel = relative
                .parent()
                .unwrap_or_else(|| std::path::Path::new(""));
            let parent_server_id = dir_ids
                .get(parent_rel)
                .cloned()
                .ok_or_else(|| "Missing parent directory while uploading".to_string())?;
            let name = entry
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| "Directory has no valid name".to_string())?
                .to_string();
            let id = create_server_directory(&state, Some(parent_server_id), name, true).await?;
            dir_ids.insert(relative, id);
            continue;
        }

        if entry.is_file() {
            let parent_rel = relative
                .parent()
                .unwrap_or_else(|| std::path::Path::new(""));
            let parent_server_id = dir_ids
                .get(parent_rel)
                .cloned()
                .ok_or_else(|| "Missing parent directory while uploading".to_string())?;
            upload_local_file(
                &app_handle,
                &state,
                Some(parent_server_id),
                entry,
                None,
                upload_id.clone(),
                conflict_strategy,
            )
            .await?;
            uploaded_files += 1;
        }
    }

    Ok(serde_json::json!({
        "upload_id": upload_id,
        "directory_id": root_id,
        "total_files": total_files,
        "uploaded_files": uploaded_files,
    }))
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn select_upload_directory<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<AndroidSelectedUploadDirectory, String> {
    let importer = app.state::<AndroidUploadFileImporter<R>>();
    importer
        .handle
        .run_mobile_plugin::<AndroidSelectedUploadDirectory>(
            "selectDirectory",
            serde_json::json!({}),
        )
        .map_err(|e| format!("Failed to select upload folder: {e}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn select_upload_directory<R: Runtime>(
    _app: tauri::AppHandle<R>,
) -> Result<AndroidSelectedUploadDirectory, String> {
    Err("Android folder picker is only available on Android.".to_string())
}

#[tauri::command]
pub async fn classify_upload_path(path: String) -> Result<String, String> {
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Failed to inspect upload path: {e}"))?;

    if metadata.is_dir() {
        Ok("directory".to_string())
    } else if metadata.is_file() {
        Ok("file".to_string())
    } else {
        Err("Dropped path is not a regular file or directory.".to_string())
    }
}

#[tauri::command]
pub async fn pause_upload(
    state: tauri::State<'_, AppHandleState>,
    upload_id: String,
) -> Result<bool, String> {
    Ok(state
        .active_uploads
        .interrupt(&upload_id, UploadInterruption::Paused))
}

#[tauri::command]
pub async fn resume_upload(_upload_id: String) -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub async fn cancel_upload(
    state: tauri::State<'_, AppHandleState>,
    upload_id: String,
) -> Result<bool, String> {
    Ok(state
        .active_uploads
        .interrupt(&upload_id, UploadInterruption::Cancelled))
}

/// Search documents and directories on the server.
#[tauri::command]
pub async fn search_files(
    state: tauri::State<'_, AppHandleState>,
    query: String,
    limit: Option<u32>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    search_documents: Option<bool>,
    search_directories: Option<bool>,
) -> Result<serde_json::Value, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("Search query cannot be empty".to_string());
    }

    server_action_json(
        &state,
        "search",
        serde_json::json!({
            "query": trimmed,
            "limit": limit.unwrap_or(100).clamp(1, 1000),
            "sort_by": sort_by.unwrap_or_else(|| "name".to_string()),
            "sort_order": sort_order.unwrap_or_else(|| "asc".to_string()),
            "search_documents": search_documents.unwrap_or(true),
            "search_directories": search_directories.unwrap_or(true),
        }),
    )
    .await
}

// ---------------------------------------------------------------------------
// Trash / recycle-bin operations
// ---------------------------------------------------------------------------

/// List deleted folders and documents for a server-side folder.
///
/// Mirrors the Python reference's `list_deleted_items` action used by the
/// TrashViewController.
#[tauri::command]
pub async fn list_deleted_items(
    state: tauri::State<'_, AppHandleState>,
    folder_id: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "list_deleted_items",
        serde_json::json!({ "folder_id": folder_id }),
    )
    .await
}

/// Restore a deleted document, optionally with a new title or destination.
#[tauri::command]
pub async fn restore_document(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    new_title: Option<String>,
    target_folder_id: Option<String>,
) -> Result<bool, String> {
    let mut data = serde_json::json!({ "document_id": document_id });
    if let Some(value) = non_empty_optional(new_title) {
        data["new_title"] = serde_json::Value::String(value);
    }
    if let Some(value) = non_empty_optional(target_folder_id) {
        data["target_folder_id"] = serde_json::Value::String(value);
    }

    server_action_bool(&state, "restore_document", data).await
}

/// Restore a deleted directory, optionally with a new name or destination.
#[tauri::command]
pub async fn restore_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: String,
    new_name: Option<String>,
    target_parent_id: Option<String>,
) -> Result<bool, String> {
    let mut data = serde_json::json!({ "folder_id": folder_id });
    if let Some(value) = non_empty_optional(new_name) {
        data["new_name"] = serde_json::Value::String(value);
    }
    if let Some(value) = non_empty_optional(target_parent_id) {
        data["target_parent_id"] = serde_json::Value::String(value);
    }

    server_action_bool(&state, "restore_directory", data).await
}

/// Permanently delete a document already marked as deleted.
#[tauri::command]
pub async fn purge_document(
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "purge_document",
        serde_json::json!({ "document_id": document_id }),
    )
    .await
}

/// Permanently delete a directory already marked as deleted.
#[tauri::command]
pub async fn purge_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "purge_directory",
        serde_json::json!({ "folder_id": folder_id }),
    )
    .await
}

// ---------------------------------------------------------------------------
// Administration / management operations
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_users(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    server_action_json(&state, "list_users", serde_json::json!({})).await
}

#[tauri::command]
pub async fn create_user(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    password: String,
    nickname: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "create_user",
        serde_json::json!({
            "username": username,
            "password": password,
            "nickname": nickname,
            "permissions": [],
            "groups": [],
        }),
    )
    .await
}

#[tauri::command]
pub async fn rename_user(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    nickname: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "rename_user",
        serde_json::json!({ "username": username, "nickname": nickname }),
    )
    .await
}

#[tauri::command]
pub async fn delete_user(
    state: tauri::State<'_, AppHandleState>,
    username: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "delete_user",
        serde_json::json!({ "username": username }),
    )
    .await
}

#[tauri::command]
pub async fn get_user_info(
    state: tauri::State<'_, AppHandleState>,
    username: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "get_user_info",
        serde_json::json!({ "username": username }),
    )
    .await
}

#[tauri::command]
pub async fn change_user_groups(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    groups: Vec<String>,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "change_user_groups",
        serde_json::json!({ "username": username, "groups": groups }),
    )
    .await
}

#[tauri::command]
pub async fn reset_user_password(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    new_password: String,
    bypass_passwd_requirements: bool,
    force_update_after_login: bool,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "set_passwd",
        serde_json::json!({
            "username": username,
            "old_passwd": "",
            "new_passwd": new_password,
            "bypass_passwd_requirements": bypass_passwd_requirements,
            "force_update_after_login": force_update_after_login,
        }),
    )
    .await
}

#[tauri::command]
pub async fn set_lockdown(
    state: tauri::State<'_, AppHandleState>,
    status: bool,
) -> Result<bool, String> {
    let changed =
        server_action_bool(&state, "lockdown", serde_json::json!({ "status": status })).await?;

    state
        .inner
        .app_lockdown
        .store(status, std::sync::atomic::Ordering::SeqCst);
    let _ = state
        .inner
        .event_tx
        .send(cfms_core::ServiceEvent::Lockdown { status });

    Ok(changed)
}

#[tauri::command]
pub async fn block_user(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    block_types: Vec<String>,
    target: serde_json::Value,
    not_after: Option<f64>,
) -> Result<bool, String> {
    let mut data = serde_json::json!({
        "username": username,
        "block_types": block_types,
        "target": target,
    });
    if let Some(value) = not_after {
        data["not_after"] = serde_json::json!(value);
    }

    server_action_bool(&state, "block_user", data).await
}

#[tauri::command]
pub async fn list_user_blocks(
    state: tauri::State<'_, AppHandleState>,
    username: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "list_user_blocks",
        serde_json::json!({ "username": username }),
    )
    .await
}

#[tauri::command]
pub async fn unblock_user(
    state: tauri::State<'_, AppHandleState>,
    block_id: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "unblock_user",
        serde_json::json!({ "block_id": block_id }),
    )
    .await
}

#[tauri::command]
pub async fn list_groups(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    server_action_json(&state, "list_groups", serde_json::json!({})).await
}

#[tauri::command]
pub async fn create_group(
    state: tauri::State<'_, AppHandleState>,
    group_name: String,
    display_name: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "create_group",
        serde_json::json!({
            "group_name": group_name,
            "display_name": display_name,
            "permissions": [],
        }),
    )
    .await
}

#[tauri::command]
pub async fn rename_group(
    state: tauri::State<'_, AppHandleState>,
    group_name: String,
    display_name: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "rename_group",
        serde_json::json!({ "group_name": group_name, "display_name": display_name }),
    )
    .await
}

#[tauri::command]
pub async fn delete_group(
    state: tauri::State<'_, AppHandleState>,
    group_name: String,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "delete_group",
        serde_json::json!({ "group_name": group_name }),
    )
    .await
}

#[tauri::command]
pub async fn get_group_info(
    state: tauri::State<'_, AppHandleState>,
    group_name: String,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "get_group_info",
        serde_json::json!({ "group_name": group_name }),
    )
    .await
}

#[tauri::command]
pub async fn change_group_permissions(
    state: tauri::State<'_, AppHandleState>,
    group_name: String,
    permissions: Vec<String>,
) -> Result<bool, String> {
    server_action_bool(
        &state,
        "change_group_permissions",
        serde_json::json!({ "group_name": group_name, "permissions": permissions }),
    )
    .await
}

#[tauri::command]
pub async fn view_audit_logs(
    state: tauri::State<'_, AppHandleState>,
    offset: u32,
    count: u32,
) -> Result<serde_json::Value, String> {
    server_action_json(
        &state,
        "view_audit_logs",
        serde_json::json!({ "offset": offset, "count": count }),
    )
    .await
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

/// Scan a local directory recursively with parallel traversal.
#[tauri::command]
pub async fn scan_directory(
    path: String,
    pattern: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    let p = std::path::Path::new(&path);
    cfms_service::scan::scan_directory(p, pattern.as_deref())
        .map_err(|e| format!("Scan failed: {e}"))
}

// ---------------------------------------------------------------------------
// Server-side file browsing (mirrors reference/src/include/ui/util/path.py)
// ---------------------------------------------------------------------------

/// List a directory on the CFMS server.
///
/// Sends the `list_directory` action over the active WSS connection.
/// Pass `folder_id = None` to list the root directory.
///
/// Returns a [`ListDirectoryResponse`] containing sub-folders, documents,
/// and the parent folder ID.
#[tauri::command]
pub async fn list_directory(
    state: tauri::State<'_, AppHandleState>,
    folder_id: Option<String>,
) -> Result<ListDirectoryResponse, String> {
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    let username = {
        let u = state.inner.username.read().await;
        u.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let token = {
        let t = state.inner.token.read().await;
        t.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let resp = send_action_request(
        &conn,
        "list_directory",
        serde_json::json!({"folder_id": folder_id}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    let data: ListDirectoryResponse = serde_json::from_value(resp.data)
        .map_err(|e| format!("Invalid list_directory response: {e}"))?;

    Ok(data)
}

/// Request a document download from the CFMS server.
///
/// Sends the `get_document` action, receives a download task from the server,
/// and adds it to the persistent download queue.
///
/// Mirrors [`get_document`] from the Python reference (`path.py`).
#[tauri::command]
pub async fn get_document(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    document_id: String,
    filename: String,
) -> Result<serde_json::Value, String> {
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    let username = {
        let u = state.inner.username.read().await;
        u.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let token = {
        let t = state.inner.token.read().await;
        t.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let resp = send_action_request(
        &conn,
        "get_document",
        serde_json::json!({"document_id": document_id}),
        &username,
        &token,
    )
    .await?;

    // Handle 403 (Access Denied)
    if resp.code == 403 {
        return Err(format!("Access denied: {}", resp.message));
    }

    // Handle 404 (Not Found)
    if resp.code == 404 {
        return Err("Document not found on server".to_string());
    }

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    // Extract task data from the server response.
    let task_data = &resp.data["task_data"];
    let task_id = task_data["task_id"]
        .as_str()
        .ok_or_else(|| "Server response missing task_id".to_string())?
        .to_string();
    let _start_time = task_data["start_time"].as_f64().unwrap_or(0.0);
    let _end_time = task_data["end_time"].as_f64().unwrap_or(0.0);

    // Build a local download path.  Use the Tauri download directory when
    // available; otherwise fall back to the app data directory.
    let download_root = app_handle
        .path()
        .resolve("downloads", tauri::path::BaseDirectory::Download)
        .unwrap_or_else(|_| {
            app_handle
                .path()
                .resolve("downloads", tauri::path::BaseDirectory::AppData)
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
        });

    // Ensure the download directory exists.
    let _ = std::fs::create_dir_all(&download_root);

    let file_path = download_root.join(&filename);
    let now = unix_now();

    let task = DownloadTaskDto {
        task_id: task_id.clone(),
        file_id: document_id.clone(),
        filename: filename.clone(),
        file_path: file_path.to_string_lossy().into_owned(),
        status: DownloadTaskStatus::Pending,
        progress: 0.0,
        current_bytes: 0,
        total_bytes: 0,
        message: None,
        error: None,
        created_at: now,
        started_at: None,
        completed_at: None,
        priority: 0,
        retry_count: 0,
        max_retries: 3,
        scheduled_time: None,
        stage: 0,
        bandwidth_limit: None,
        pause_position: None,
        supports_resume: false,
    };

    // Persist the download task so the download queue service picks it up.
    state
        .tasks
        .insert(&task)
        .map_err(|e| format!("Failed to add download: {e}"))?;

    Ok(serde_json::json!({
        "task_id": task_id,
        "file_id": document_id,
        "filename": filename,
        "file_path": task.file_path,
    }))
}

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------

/// Read a user setting.
#[tauri::command]
pub async fn get_setting(
    state: tauri::State<'_, AppHandleState>,
    key: String,
) -> Result<Option<String>, String> {
    state
        .settings
        .get(&key)
        .map_err(|e| format!("Failed to read setting: {e}"))
}

/// Write a user setting.
#[tauri::command]
pub async fn set_setting(
    state: tauri::State<'_, AppHandleState>,
    key: String,
    value: String,
) -> Result<(), String> {
    if key == "language" {
        state.localizer.set_locale(&value)?;
    }

    state
        .settings
        .set(&key, &value)
        .map_err(|e| format!("Failed to write setting: {e}"))
}

#[tauri::command]
pub async fn get_locale(state: tauri::State<'_, AppHandleState>) -> Result<String, String> {
    Ok(state.localizer.locale())
}

#[tauri::command]
pub async fn set_locale(
    state: tauri::State<'_, AppHandleState>,
    language: String,
) -> Result<String, String> {
    let normalized = state.localizer.set_locale(&language)?;
    state
        .settings
        .set("language", &normalized)
        .map_err(|e| format!("Failed to write setting: {e}"))?;
    Ok(normalized)
}

#[tauri::command]
pub async fn translate_backend(
    state: tauri::State<'_, AppHandleState>,
    key: String,
) -> Result<String, String> {
    Ok(state.localizer.translate(&key))
}

#[tauri::command]
pub async fn get_connection_settings(
    state: tauri::State<'_, AppHandleState>,
) -> Result<ConnectionSettingsDto, String> {
    Ok(ConnectionSettingsDto::load(&state.settings))
}

#[tauri::command]
pub async fn set_connection_settings(
    state: tauri::State<'_, AppHandleState>,
    settings: ConnectionSettingsDto,
) -> Result<(), String> {
    if settings.enable_proxy && !settings.follow_system_proxy {
        normalize_proxy_url(
            settings.custom_proxy.trim(),
            settings.proxy_default_scheme(),
            "CFMS connections",
        )?;
    }
    let proxy_setting = settings.proxy_setting_value();

    state
        .settings
        .set("proxy_settings", &proxy_setting)
        .map_err(|e| format!("Failed to write proxy setting: {e}"))?;
    state
        .settings
        .set("custom_proxy", settings.custom_proxy.trim())
        .map_err(|e| format!("Failed to write custom proxy: {e}"))?;
    state
        .settings
        .set(
            "force_ipv4",
            if settings.force_ipv4 { "true" } else { "false" },
        )
        .map_err(|e| format!("Failed to write IPv4 setting: {e}"))?;
    state
        .settings
        .set("client_cert_path", settings.client_cert_path.trim())
        .map_err(|e| format!("Failed to write client certificate path: {e}"))?;
    state
        .settings
        .set("client_key_path", settings.client_key_path.trim())
        .map_err(|e| format!("Failed to write client key path: {e}"))?;
    state
        .settings
        .set(
            "remember_connection_addresses",
            if settings.remember_connection_addresses {
                "true"
            } else {
                "false"
            },
        )
        .map_err(|e| format!("Failed to write connection history setting: {e}"))?;
    let recent_connection_addresses = if settings.remember_connection_addresses {
        normalize_recent_connection_addresses(settings.recent_connection_addresses)
    } else {
        Vec::new()
    };
    save_recent_connection_addresses(&state.settings, recent_connection_addresses)?;

    Ok(())
}

#[tauri::command]
pub async fn get_ca_certificate_status(
    app_handle: tauri::AppHandle,
) -> Result<CaCertificateStatusDto, String> {
    let ca_dir = ensure_writable_ca_dir(&app_handle)?;
    let manifest = load_ca_manifest(&ca_dir);
    Ok(CaCertificateStatusDto {
        ca_dir: ca_dir.to_string_lossy().to_string(),
        certificate_count: count_ca_certificates(&ca_dir)?,
        last_checked: manifest.last_check,
    })
}

#[tauri::command]
pub async fn update_ca_certificates(
    app_handle: tauri::AppHandle,
) -> Result<CaCertificateUpdateResultDto, String> {
    let ca_dir = ensure_writable_ca_dir(&app_handle)?;
    let mut result = check_and_update_ca_certificates(&ca_dir).await?;
    let last_checked = unix_now() as f64;
    let mut manifest = load_ca_manifest(&ca_dir);
    manifest.last_check = Some(last_checked);
    save_ca_manifest(&ca_dir, &manifest)?;
    result.last_checked = Some(last_checked);

    if result.errors.is_empty() {
        tracing::info!(
            "CA certificate update completed: added={}, updated={}, removed={}, unchanged={}",
            result.added.len(),
            result.updated.len(),
            result.removed.len(),
            result.unchanged.len()
        );
    } else {
        tracing::warn!(
            "CA certificate update completed with {} error(s)",
            result.errors.len()
        );
    }

    Ok(result)
}

fn load_recent_connection_addresses(
    settings: &cfms_service::db::settings::SettingsStore,
) -> Vec<String> {
    let Some(raw) = settings.get("recent_connection_addresses").ok().flatten() else {
        return Vec::new();
    };

    serde_json::from_str::<Vec<String>>(&raw)
        .map(normalize_recent_connection_addresses)
        .unwrap_or_default()
}

fn save_recent_connection_addresses(
    settings: &cfms_service::db::settings::SettingsStore,
    addresses: Vec<String>,
) -> Result<(), String> {
    let encoded = serde_json::to_string(&addresses)
        .map_err(|e| format!("Failed to encode recent server addresses: {e}"))?;
    settings
        .set("recent_connection_addresses", &encoded)
        .map_err(|e| format!("Failed to write recent server addresses: {e}"))
}

fn normalize_recent_connection_addresses(addresses: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for address in addresses {
        let address = normalize_connection_history_address(&address);
        if address.is_empty() || normalized.contains(&address) {
            continue;
        }
        normalized.push(address);
        if normalized.len() >= MAX_RECENT_CONNECTION_ADDRESSES {
            break;
        }
    }
    normalized
}

fn normalize_connection_history_address(address: &str) -> String {
    let trimmed = address.trim();
    let without_scheme = trimmed
        .strip_prefix("wss://")
        .or_else(|| trimmed.strip_prefix("ws://"))
        .unwrap_or(trimmed);
    without_scheme.trim_matches('/').trim().to_string()
}

fn remember_successful_connection(
    settings: &cfms_service::db::settings::SettingsStore,
    url: &str,
) -> Result<(), String> {
    let enabled = settings
        .get("remember_connection_addresses")
        .ok()
        .flatten()
        .map(|value| value == "true")
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }

    let address = normalize_connection_history_address(url);
    if address.is_empty() {
        return Ok(());
    }

    let mut addresses = load_recent_connection_addresses(settings);
    addresses.retain(|item| item != &address);
    addresses.insert(0, address);
    addresses.truncate(MAX_RECENT_CONNECTION_ADDRESSES);
    save_recent_connection_addresses(settings, addresses)
}

fn app_ca_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle
        .path()
        .resolve("ca", tauri::path::BaseDirectory::AppData)
        .map_err(|e| format!("Cannot resolve writable CA directory: {e}"))
}

fn ensure_writable_ca_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let ca_dir = app_ca_dir(app_handle)?;
    std::fs::create_dir_all(&ca_dir)
        .map_err(|e| format!("Failed to create CA directory {}: {e}", ca_dir.display()))?;

    let has_manifest = ca_dir.join(CA_MANIFEST_FILENAME).is_file();
    let has_certificates = count_ca_certificates(&ca_dir)? > 0;

    if !has_manifest && !has_certificates {
        for (name, content) in BUNDLED_CA_FILES {
            std::fs::write(ca_dir.join(name), content)
                .map_err(|e| format!("Failed to initialize bundled CA certificate {name}: {e}"))?;
        }
    }

    if !has_manifest {
        let manifest = CaManifest {
            last_check: Some(unix_now() as f64),
            files: build_local_ca_manifest(&ca_dir)?,
        };
        save_ca_manifest(&ca_dir, &manifest)?;
    }

    Ok(ca_dir)
}

fn count_ca_certificates(ca_dir: &std::path::Path) -> Result<usize, String> {
    let mut count = 0;
    let entries = match std::fs::read_dir(ca_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(format!("Failed to read CA directory: {e}")),
    };

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read CA directory entry: {e}"))?;
        let path = entry.path();
        if path.is_file()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(is_ca_certificate_filename)
        {
            count += 1;
        }
    }

    Ok(count)
}

fn build_local_ca_manifest(
    ca_dir: &std::path::Path,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut files = std::collections::HashMap::new();
    let entries = match std::fs::read_dir(ca_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(files),
        Err(e) => return Err(format!("Failed to read CA directory: {e}")),
    };

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read CA directory entry: {e}"))?;
        let path = entry.path();
        let Some(name) = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| is_ca_certificate_filename(name))
        else {
            continue;
        };
        let content = std::fs::read(&path)
            .map_err(|e| format!("Failed to read CA certificate {}: {e}", path.display()))?;
        files.insert(name.to_string(), git_blob_sha(&content));
    }

    Ok(files)
}

fn load_ca_manifest(ca_dir: &std::path::Path) -> CaManifest {
    let manifest_path = ca_dir.join(CA_MANIFEST_FILENAME);
    let Ok(content) = std::fs::read_to_string(manifest_path) else {
        return CaManifest::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_ca_manifest(ca_dir: &std::path::Path, manifest: &CaManifest) -> Result<(), String> {
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to encode CA manifest: {e}"))?;
    std::fs::write(ca_dir.join(CA_MANIFEST_FILENAME), content)
        .map_err(|e| format!("Failed to write CA manifest: {e}"))
}

async fn check_and_update_ca_certificates(
    ca_dir: &std::path::Path,
) -> Result<CaCertificateUpdateResultDto, String> {
    let mut result = CaCertificateUpdateResultDto::default();
    let mut manifest = load_ca_manifest(ca_dir);

    let response = reqwest::Client::new()
        .get(CA_CERT_API_URL)
        .header(reqwest::header::USER_AGENT, UPDATE_USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch CA certificate listing: {e}"))?
        .error_for_status()
        .map_err(|e| format!("CA certificate listing request failed: {e}"))?;

    let entries = response
        .json::<Vec<GithubContentsEntry>>()
        .await
        .map_err(|e| format!("Invalid CA certificate listing: {e}"))?;

    let remote_files: std::collections::HashMap<String, GithubContentsEntry> = entries
        .into_iter()
        .filter(|entry| entry.entry_type == "file" && is_ca_certificate_filename(&entry.name))
        .map(|entry| (entry.name.clone(), entry))
        .collect();

    for (name, entry) in &remote_files {
        let destination = ca_dir.join(name);
        if manifest.files.get(name) == Some(&entry.sha) && destination.is_file() {
            result.unchanged.push(name.clone());
            continue;
        }

        let Some(download_url) = &entry.download_url else {
            result.errors.push(format!("No download URL for {name}"));
            continue;
        };

        let content = match reqwest::Client::new()
            .get(download_url)
            .header(reqwest::header::USER_AGENT, UPDATE_USER_AGENT)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
        {
            Ok(response) => match response.bytes().await {
                Ok(bytes) => bytes,
                Err(e) => {
                    result.errors.push(format!("Failed to read {name}: {e}"));
                    continue;
                }
            },
            Err(e) => {
                result
                    .errors
                    .push(format!("Failed to download {name}: {e}"));
                continue;
            }
        };

        let actual_sha = git_blob_sha(&content);
        if actual_sha != entry.sha {
            result
                .errors
                .push(format!("Integrity check failed for {name}"));
            continue;
        }

        std::fs::write(&destination, &content)
            .map_err(|e| format!("Failed to write CA certificate {name}: {e}"))?;

        if manifest.files.contains_key(name) {
            result.updated.push(name.clone());
        } else {
            result.added.push(name.clone());
        }
        manifest.files.insert(name.clone(), entry.sha.clone());
    }

    let local_files: std::collections::HashSet<String> = std::fs::read_dir(ca_dir)
        .map_err(|e| format!("Failed to read CA directory: {e}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            path.is_file()
                .then(|| path.file_name()?.to_str().map(ToOwned::to_owned))
                .flatten()
        })
        .filter(|name| is_ca_certificate_filename(name))
        .collect();

    let remote_names: std::collections::HashSet<String> = remote_files.keys().cloned().collect();
    for name in local_files.difference(&remote_names) {
        std::fs::remove_file(ca_dir.join(name))
            .map_err(|e| format!("Failed to remove CA certificate {name}: {e}"))?;
        manifest.files.remove(name);
        result.removed.push(name.clone());
    }

    save_ca_manifest(ca_dir, &manifest)?;
    Ok(result)
}

fn is_ca_certificate_filename(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() >= 10
        && bytes[..8]
            .iter()
            .all(|&b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        && bytes[8] == b'.'
        && bytes[9..].iter().all(u8::is_ascii_digit)
}

fn git_blob_sha(content: &[u8]) -> String {
    let mut sha1 = Sha1::new();
    let header = format!("blob {}\0", content.len());
    sha1.update(header.as_bytes());
    sha1.update(content);
    hex::encode(sha1.finalize())
}

struct Sha1 {
    state: [u32; 5],
    length_bits: u64,
    buffer: Vec<u8>,
}

impl Sha1 {
    fn new() -> Self {
        Self {
            state: [
                0x6745_2301,
                0xefcd_ab89,
                0x98ba_dcfe,
                0x1032_5476,
                0xc3d2_e1f0,
            ],
            length_bits: 0,
            buffer: Vec::with_capacity(64),
        }
    }

    fn update(&mut self, data: &[u8]) {
        self.length_bits = self.length_bits.wrapping_add((data.len() as u64) * 8);
        self.buffer.extend_from_slice(data);

        while self.buffer.len() >= 64 {
            let mut block = [0_u8; 64];
            block.copy_from_slice(&self.buffer[..64]);
            self.process_block(&block);
            self.buffer.drain(..64);
        }
    }

    fn finalize(mut self) -> [u8; 20] {
        self.buffer.push(0x80);
        while self.buffer.len() % 64 != 56 {
            self.buffer.push(0);
        }
        self.buffer
            .extend_from_slice(&self.length_bits.to_be_bytes());

        for chunk in self.buffer.clone().chunks_exact(64) {
            let mut block = [0_u8; 64];
            block.copy_from_slice(chunk);
            self.process_block(&block);
        }

        let mut output = [0_u8; 20];
        for (chunk, word) in output.chunks_exact_mut(4).zip(self.state) {
            chunk.copy_from_slice(&word.to_be_bytes());
        }
        output
    }

    fn process_block(&mut self, block: &[u8; 64]) {
        let mut w = [0_u32; 80];
        for (i, chunk) in block.chunks_exact(4).enumerate().take(16) {
            w[i] = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }

        let [mut a, mut b, mut c, mut d, mut e] = self.state;
        for (i, word) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5a82_7999),
                20..=39 => (b ^ c ^ d, 0x6ed9_eba1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8f1b_bcdc),
                _ => (b ^ c ^ d, 0xca62_c1d6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        self.state[0] = self.state[0].wrapping_add(a);
        self.state[1] = self.state[1].wrapping_add(b);
        self.state[2] = self.state[2].wrapping_add(c);
        self.state[3] = self.state[3].wrapping_add(d);
        self.state[4] = self.state[4].wrapping_add(e);
    }
}

// ---------------------------------------------------------------------------
// Authentication & Connection
// ---------------------------------------------------------------------------

/// Log in with username and password (and optional 2FA token).
///
/// Sends a login request over the established WSS connection to the
/// CFMS server.  The server may:
///
/// - Accept the login (code 200) — auth state is stored.
/// - Request 2FA verification (code 202) — caller must re-invoke with
///   `twofa_token`.
/// - Reject the login (any other code) — an error is returned.
///
/// The Data Encryption Key (DEK) is set up after successful
/// authentication — either decrypted from the server-returned
/// `preference_dek` or generated fresh and uploaded (first login).
#[tauri::command]
pub async fn login(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    password: String,
    twofa_token: Option<String>,
) -> Result<serde_json::Value, String> {
    // --- Obtain the active connection ---
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    // --- Build login request payload ---
    let mut request = serde_json::json!({
        "action": "login",
        "data": {
            "username": &username,
            "password": &password,
        },
    });
    if let Some(ref token) = twofa_token {
        request["data"]["2fa_token"] = serde_json::Value::String(token.clone());
    }

    // --- Send login request over a client stream ---
    let mut stream = conn
        .create_stream()
        .await
        .map_err(|e| format!("Failed to create stream: {e}"))?;

    let request_bytes =
        serde_json::to_vec(&request).map_err(|e| format!("Failed to encode login request: {e}"))?;

    stream
        .send(&conn, request_bytes)
        .await
        .map_err(|e| format!("Failed to send login request: {e}"))?;

    // --- Read response ---
    let response_bytes = stream
        .recv()
        .await
        .ok_or_else(|| "Connection closed before login response".to_string())?;

    let response: cfms_core::Response = serde_json::from_slice(&response_bytes)
        .map_err(|e| format!("Invalid login response from server: {e}"))?;

    tracing::info!(
        "Login response: code={}, message={}",
        response.code,
        response.message
    );

    match response.code {
        // --- Success (no 2FA) ---
        200 => {
            let data = &response.data;

            // Extract token early — needed for the DEK setup calls below.
            let token = data["token"]
                .as_str()
                .ok_or_else(|| "Server did not return a token".to_string())?
                .to_string();

            // Store auth state from server response.
            {
                let mut u = state.inner.username.write().await;
                *u = Some(username.clone());
            }
            {
                let mut t = state.inner.token.write().await;
                *t = Some(token.clone());
            }
            {
                let exp = data["exp"].as_i64().unwrap_or(unix_now() + 3600);
                let mut e = state.inner.token_exp.write().await;
                *e = Some(exp);
            }
            {
                let nickname = data["nickname"].as_str().unwrap_or(&username).to_string();
                let mut n = state.inner.nickname.write().await;
                *n = Some(nickname);
            }
            {
                let perms: Vec<String> = data["permissions"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                let mut p = state.inner.permissions.write().await;
                *p = perms;
            }
            {
                let grps: Vec<String> = data["groups"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                let mut g = state.inner.groups.write().await;
                *g = grps;
            }
            // Clear any pending 2FA flag.
            state
                .inner
                .pending_2fa
                .store(false, std::sync::atomic::Ordering::SeqCst);

            // Set up Data Encryption Key (best-effort, non-fatal).
            // The DEK is either decrypted from the server-returned
            // preference_dek, or generated fresh and uploaded (first login
            // with keyring support).
            let _ = setup_dek(&state.inner, data, &password, &username, &token, &conn).await;

            // Load download tasks for this user.
            // This must happen AFTER DEK setup — the task file is encrypted
            // and requires the DEK to decrypt.
            {
                let server_addr = {
                    let a = state.inner.server_address.read().await;
                    a.clone().unwrap_or_default()
                };
                let server_hash = cfms_core::get_server_hash(&server_addr);
                let dek = {
                    let d = state.inner.dek.read().await;
                    d.clone()
                };
                if let Err(e) = state.tasks.load_for_user(
                    &state.app_data_dir,
                    &server_hash,
                    &username,
                    dek.as_deref(),
                ) {
                    tracing::warn!("Failed to load download tasks after login: {e}");
                }
            }

            let status = build_auth_status(&state.inner).await;
            Ok(status)
        }

        // --- 2FA required ---
        202 => {
            // Mark 2FA as pending so auth status polls don't report as
            // authenticated until 2FA is completed.
            state
                .inner
                .pending_2fa
                .store(true, std::sync::atomic::Ordering::SeqCst);

            // Store partial auth state so the frontend can re-submit with 2FA.
            // No DEK setup here — the real token isn't available yet.
            // DEK setup happens when the frontend re-invokes login with
            // twofa_token and the server returns 200.
            {
                let mut u = state.inner.username.write().await;
                *u = Some(username.clone());
            }
            {
                // Store a placeholder token to indicate partial auth.
                let mut t = state.inner.token.write().await;
                *t = Some("pending_2fa".to_string());
            }
            {
                let mut e = state.inner.token_exp.write().await;
                *e = Some(unix_now() + 300); // 5-minute 2FA window
            }
            {
                let mut n = state.inner.nickname.write().await;
                *n = Some(username.clone());
            }
            {
                let mut p = state.inner.permissions.write().await;
                p.clear();
            }
            {
                let mut g = state.inner.groups.write().await;
                g.clear();
            }

            let method = response
                .data
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("totp")
                .to_string();

            Ok(serde_json::json!({
                "username": &username,
                "nickname": &username,
                "has_token": false,
                "token_exp": null,
                "permissions": [],
                "groups": [],
                "requires_2fa": true,
                "2fa_method": method,
            }))
        }

        // --- Password must be changed before login ---
        //
        // Mirrors the Python reference which shows a PasswdUserDialog for
        // codes 4001 / 4002.
        //
        // The frontend should surface a password-change prompt — we include
        // the server's message so the user knows why.
        4001 | 4002 => Err(format!(
            "Password must be changed before login: {}",
            response.message
        )),

        // --- Server-side error ---
        other => Err(format!("Login failed: ({}) {}", other, response.message)),
    }
}

/// Change a user's password via the server's `set_passwd` action.
///
/// This supports the *self-change* flow used when the server rejects a login
/// with code 4001/4002 ("password must be changed before login").  In that
/// case the user is **not** authenticated yet, so no top-level token is sent —
/// the server takes the self-change path, verifying `old_passwd` directly
/// (see `RequestSetPasswdHandler` in the server reference).
///
/// Mirrors `PasswdDialogController.action_passwd_user` in the Python reference
/// (`controllers/dialogs/passwd.py`) for the `passwd_other = False` case:
/// `username`/`token` are omitted at the top level and the elevated flags
/// (`bypass_passwd_requirements`, `force_update_after_login`) are kept `false`
/// — the server rejects them for a self-change anyway.
#[tauri::command]
pub async fn change_password(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    // --- Obtain the active connection ---
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    let request = serde_json::json!({
        "action": "set_passwd",
        "data": {
            "username": &username,
            "old_passwd": &old_password,
            "new_passwd": &new_password,
            "bypass_passwd_requirements": false,
            "force_update_after_login": false,
        },
    });

    let mut stream = conn
        .create_stream()
        .await
        .map_err(|e| format!("Failed to create stream: {e}"))?;

    let request_bytes = serde_json::to_vec(&request)
        .map_err(|e| format!("Failed to encode change-password request: {e}"))?;

    stream
        .send(&conn, request_bytes)
        .await
        .map_err(|e| format!("Failed to send change-password request: {e}"))?;

    let response_bytes = stream
        .recv()
        .await
        .ok_or_else(|| "Connection closed before change-password response".to_string())?;

    // Politely close the stream.
    let _ = stream.send_final(&conn, vec![]).await;

    let response: cfms_core::Response = serde_json::from_slice(&response_bytes)
        .map_err(|e| format!("Invalid change-password response from server: {e}"))?;

    tracing::info!(
        "set_passwd response: code={}, message={}",
        response.code,
        response.message
    );

    if response.code != 200 {
        return Err(format!("({}) {}", response.code, response.message));
    }

    Ok(())
}

/// Log out and clear all authentication state.
#[tauri::command]
pub async fn logout(state: tauri::State<'_, AppHandleState>) -> Result<(), String> {
    clear_auth_state(&state).await;

    // Close the connection if one is open.
    {
        let mut conn = state.inner.conn.write().await;
        if let Some(c) = conn.take() {
            // Spawn so we don't block the command on close handshake.
            tokio::spawn(async move { c.close().await });
        }
    }

    Ok(())
}

/// Clear authentication state while preserving the current server connection.
#[tauri::command]
pub async fn clear_auth_session(state: tauri::State<'_, AppHandleState>) -> Result<(), String> {
    clear_auth_state(&state).await;
    Ok(())
}

/// Request process termination from the native side.
#[tauri::command]
pub fn quit_application(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

/// Establish a WSS connection to the CFMS server and perform the initial
/// `server_info` handshake.
///
/// Uses the TLS configuration from [`cfms_transport::tls::build_config`]
/// with the local CA certificate store.  When `disable_ssl_enforcement`
/// is `true`, certificate verification is skipped (insecure).
///
/// # Post-connect handshake
///
/// After the WebSocket is established this command immediately sends a
/// `server_info` request to:
///
/// 1. Validate protocol-version compatibility between client and server.
/// 2. Surface the server's display name and lockdown status.
///
/// If the server's protocol version is *higher* than the client's the
/// connection is torn down and an error is returned — the frontend
/// should direct the user to update the client.
///
/// If the server's protocol version is *lower* the connection is also
/// closed — the server is too old and the client cannot downgrade.
///
/// # Returns
///
/// [`ServerInfo`] on success: `{ server_name, protocol_version, lockdown }`.
///
/// # Reference
///
/// Mirrors `ConnectFormController.action_connect` in
/// `reference/src/include/controllers/connect.py`.
#[tauri::command]
pub async fn connect(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    url: String,
    disable_ssl_enforcement: bool,
) -> Result<serde_json::Value, String> {
    clear_auth_state(&state).await;
    close_primary_connection(&state).await;
    clear_connection_state(&state).await;

    // Use a writable CA directory under AppData. On Android, bundled
    // resources live inside the APK and cannot be enumerated through
    // std::fs; ensure_writable_ca_dir seeds AppData from compile-time
    // bundled certificates on first use.
    let ca_dir = ensure_writable_ca_dir(&app_handle)?;

    let connection_settings = ConnectionSettingsDto::load(&state.settings);
    let proxy_addr = connection_settings.proxy_addr()?;
    let (client_cert_path, client_key_path) = connection_settings.client_identity_paths();
    let effective_disable_ssl = disable_ssl_enforcement || is_loopback_wss_url(&url);

    tracing::info!(
        "Connecting to {url} (disable_ssl_enforcement={disable_ssl_enforcement}, effective_disable_ssl={effective_disable_ssl}, proxy={}, force_ipv4={})",
        proxy_addr.as_deref().unwrap_or("none"),
        connection_settings.force_ipv4,
    );

    let tls_config = cfms_transport::tls::build_config_with_identity(
        &ca_dir,
        effective_disable_ssl,
        client_cert_path.as_deref(),
        client_key_path.as_deref(),
    )
    .map_err(|e| format!("TLS config error: {e}"))?;

    // Establish connection.
    let conn = cfms_transport::Connection::connect(
        &url,
        tls_config,
        proxy_addr.as_deref(),
        connection_settings.force_ipv4,
    )
    .await
    .map_err(|e| format!("Connection failed: {e}"))?;

    // --- Post-connect handshake: request server_info ---
    //
    // This request is sent *without* authentication (username / token are
    // empty) because we haven't logged in yet — exactly matching the Python
    // reference which passes `username=None, token=None` in `_request()`.
    let server_info: ServerInfo = {
        let random_bytes: [u8; 16] = rand::thread_rng().r#gen();
        let nonce = hex::encode(random_bytes);

        let request = serde_json::json!({
            "action": "server_info",
            "data": {},
            "username": null,
            "token": null,
            "timestamp": unix_now(),
            "nonce": nonce,
        });

        let request_bytes = serde_json::to_vec(&request)
            .map_err(|e| format!("Failed to encode server_info request: {e}"))?;

        let mut stream = conn
            .create_stream()
            .await
            .map_err(|e| format!("Failed to create stream for server_info: {e}"))?;

        stream
            .send(&conn, request_bytes)
            .await
            .map_err(|e| format!("Failed to send server_info request: {e}"))?;

        let response_bytes = stream
            .recv()
            .await
            .ok_or_else(|| "Connection closed before server_info response".to_string())?;

        let response: cfms_core::Response = serde_json::from_slice(&response_bytes)
            .map_err(|e| format!("Invalid server_info response: {e}"))?;

        if response.code != 200 {
            // Connection is useless without server_info — tear it down.
            // Use close() directly (not spawn) so conn is consumed cleanly.
            conn.close().await;
            return Err(format!(
                "Server returned {} from server_info: {}",
                response.code, response.message
            ));
        }

        serde_json::from_value(response.data)
            .map_err(|e| format!("Invalid server_info data: {e}"))?
    };

    // --- Protocol version compatibility check ---
    //
    // Mirrors the Python reference's protocol-version gate in
    // `ConnectFormController.action_connect`.
    let client_protocol = cfms_core::constants::PROTOCOL_VERSION;

    if server_info.protocol_version != client_protocol {
        // Tear down — cannot communicate with this server.
        conn.close().await;

        if server_info.protocol_version > client_protocol {
            return Err(format!(
                "server_update_required:{}:{}",
                server_info.protocol_version, client_protocol
            ));
        } else {
            return Err(format!(
                "server_too_old:{}:{}",
                server_info.protocol_version, client_protocol
            ));
        }
    }

    // --- Store connection state ---
    {
        let mut c = state.inner.conn.write().await;
        *c = Some(conn);
    }
    {
        let mut addr = state.inner.server_address.write().await;
        *addr = Some(url.clone());
    }
    {
        let mut name = state.inner.server_name.write().await;
        *name = Some(server_info.server_name.clone());
    }
    {
        let mut pv = state.inner.server_protocol_version.write().await;
        *pv = Some(server_info.protocol_version);
    }
    // Apply initial lockdown status from server_info.
    // The server_push background service will also fire Lockdown events
    // for dynamic changes, but this covers the static case during connect.
    {
        let mut dse = state.inner.disable_ssl_enforcement.write().await;
        *dse = effective_disable_ssl;
    }
    {
        let mut force_ipv4 = state.inner.force_ipv4.write().await;
        *force_ipv4 = connection_settings.force_ipv4;
    }
    {
        let mut proxy = state.inner.proxy_addr.write().await;
        *proxy = proxy_addr;
    }
    {
        let mut cert = state.inner.client_cert_path.write().await;
        *cert = client_cert_path;
    }
    {
        let mut key = state.inner.client_key_path.write().await;
        *key = client_key_path;
    }
    // Store the CA directory path so that dedicated transfer connections
    // can rebuild their TLS config on demand.
    {
        let mut ca = state.inner.ca_dir.write().await;
        *ca = Some(ca_dir);
    }
    state
        .inner
        .app_lockdown
        .store(server_info.lockdown, std::sync::atomic::Ordering::SeqCst);
    if let Err(error) = remember_successful_connection(&state.settings, &url) {
        tracing::warn!("Failed to remember server address: {error}");
    }

    tracing::info!(
        "Connected to {url} — server={}, protocol={}, lockdown={}",
        server_info.server_name,
        server_info.protocol_version,
        server_info.lockdown,
    );

    Ok(serde_json::json!({
        "server_name": server_info.server_name,
        "protocol_version": server_info.protocol_version,
        "lockdown": server_info.lockdown,
    }))
}

fn is_loopback_wss_url(url: &str) -> bool {
    let host = url
        .strip_prefix("wss://")
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or("")
        .trim_start_matches('[')
        .split(']')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");

    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn trimmed_path(value: &str) -> Option<std::path::PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(std::path::PathBuf::from(trimmed))
    }
}

fn system_proxy_setting() -> Option<String> {
    env_proxy_setting().or_else(platform_system_proxy_setting)
}

fn env_proxy_setting() -> Option<String> {
    [
        "CFMS_PROXY",
        "ALL_PROXY",
        "all_proxy",
        "HTTPS_PROXY",
        "https_proxy",
    ]
    .iter()
    .find_map(|key| std::env::var(key).ok())
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

#[cfg(windows)]
fn platform_system_proxy_setting() -> Option<String> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let internet_settings = hkcu
        .open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            KEY_READ,
        )
        .ok()?;
    let enabled = internet_settings
        .get_value::<u32, _>("ProxyEnable")
        .unwrap_or(0);
    if enabled == 0 {
        return None;
    }

    internet_settings
        .get_value::<String, _>("ProxyServer")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(not(windows))]
fn platform_system_proxy_setting() -> Option<String> {
    None
}

fn normalize_proxy_url(
    raw: &str,
    default_scheme: &str,
    context: &str,
) -> Result<Option<url::Url>, String> {
    let selected = select_proxy_rule(raw, &["socks", "https", "http"])
        .unwrap_or_else(|| raw.trim().to_string());
    let trimmed = selected.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(None);
    }

    let proxy_url = if trimmed.contains("://") {
        url::Url::parse(trimmed).map_err(|e| format!("Invalid proxy URL for {context}: {e}"))?
    } else {
        let scheme = proxy_rule_scheme(raw).unwrap_or(default_scheme);
        url::Url::parse(&format!("{scheme}://{trimmed}"))
            .map_err(|e| format!("Invalid proxy URL for {context}: {e}"))?
    };

    match proxy_url.scheme() {
        "http" | "https" | "socks4" | "socks4a" | "socks5" | "socks5h" => {
            if proxy_url.host_str().is_none() {
                return Err(format!("Proxy URL for {context} must include a host."));
            }
            if proxy_url.port_or_known_default().is_none() {
                return Err(format!(
                    "Proxy URL for {context} must include a port, e.g. socks5h://127.0.0.1:1080.",
                ));
            }
            Ok(Some(proxy_url))
        }
        _ => Err(format!(
            "Only HTTP, HTTPS and SOCKS proxy URLs are supported for {context}.",
        )),
    }
}

fn select_proxy_rule(raw: &str, preferred_keys: &[&str]) -> Option<String> {
    if !raw.contains('=') {
        return None;
    }

    let entries = raw
        .split(';')
        .filter_map(|entry| {
            let (key, value) = entry.split_once('=')?;
            let key = key.trim().to_ascii_lowercase();
            let value = value.trim();
            (!key.is_empty() && !value.is_empty()).then(|| (key, value.to_string()))
        })
        .collect::<Vec<_>>();

    preferred_keys.iter().find_map(|preferred| {
        entries
            .iter()
            .find(|(key, _)| key == preferred)
            .map(|(_, value)| value.clone())
    })
}

fn proxy_rule_scheme(raw: &str) -> Option<&'static str> {
    if !raw.contains('=') {
        return None;
    }
    if select_proxy_rule(raw, &["socks"]).is_some() {
        Some("socks5h")
    } else if select_proxy_rule(raw, &["https", "http"]).is_some() {
        Some("http")
    } else {
        None
    }
}

/// Close the WSS connection and clear all server/auth metadata.
///
/// Resets the connection, address, server name, protocol version, and
/// lockdown flag so the frontend reflects a clean disconnected state. Auth
/// state is also cleared so credentials never outlive the server session they
/// came from.
#[tauri::command]
pub async fn disconnect(state: tauri::State<'_, AppHandleState>) -> Result<(), String> {
    clear_auth_state(&state).await;
    close_primary_connection(&state).await;
    clear_connection_state(&state).await;

    tracing::info!("Disconnected");
    Ok(())
}

/// Get the current authentication status (username, token, permissions, etc.).
#[tauri::command]
pub async fn get_auth_status(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    Ok(build_auth_status(&state.inner).await)
}

/// Get the current server-connection state (connected, address, lockdown).
#[tauri::command]
pub async fn get_server_state(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    Ok(build_server_state(&state.inner).await)
}

/// Get the authenticated user's two-factor authentication status.
#[tauri::command]
pub async fn get_2fa_status(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "get_2fa_status",
        serde_json::json!({}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("({}) {}", resp.code, resp.message));
    }

    Ok(resp.data)
}

/// Start TOTP setup for the authenticated user.
#[tauri::command]
pub async fn setup_2fa(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "setup_2fa",
        serde_json::json!({"method": "totp"}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("({}) {}", resp.code, resp.message));
    }

    Ok(resp.data)
}

/// Verify the TOTP setup code and enable two-factor authentication.
#[tauri::command]
pub async fn validate_2fa(
    state: tauri::State<'_, AppHandleState>,
    token: String,
) -> Result<(), String> {
    let (conn, username, auth_token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "validate_2fa",
        serde_json::json!({"token": token}),
        &username,
        &auth_token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("({}) {}", resp.code, resp.message));
    }

    Ok(())
}

/// Cancel a pending TOTP setup before verification.
#[tauri::command]
pub async fn cancel_2fa_setup(state: tauri::State<'_, AppHandleState>) -> Result<(), String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "cancel_2fa_setup",
        serde_json::json!({}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("({}) {}", resp.code, resp.message));
    }

    Ok(())
}

/// Disable two-factor authentication for the authenticated user.
#[tauri::command]
pub async fn disable_2fa(
    state: tauri::State<'_, AppHandleState>,
    password: String,
) -> Result<(), String> {
    let (conn, username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "disable_2fa",
        serde_json::json!({"password": password}),
        &username,
        &token,
    )
    .await?;

    if resp.code != 200 {
        return Err(format!("({}) {}", resp.code, resp.message));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Avatar commands (mirrors reference/src/include/util/avatar.py)
// ---------------------------------------------------------------------------

/// Get the avatar task data for a specific user from the server.
///
/// Sends `get_user_avatar` over the active WSS connection.  Returns the
/// `task_data` dict on success (code 200), `null` if the user has no avatar
/// (code 404), or `null` on any other error.
///
/// Mirrors [`get_user_avatar`] in the Python reference.
#[tauri::command]
pub async fn get_user_avatar(
    state: tauri::State<'_, AppHandleState>,
    username: String,
) -> Result<Option<serde_json::Value>, String> {
    let (conn, auth_username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "get_user_avatar",
        serde_json::json!({"username": username}),
        &auth_username,
        &token,
    )
    .await?;

    match resp.code {
        200 => Ok(resp.data.get("task_data").cloned()),
        404 => Ok(None),
        _ => Ok(None),
    }
}

/// Download an avatar file from the server and cache it locally.
///
/// Uses the file transfer protocol (`cfms_transfer::download::receive`) to
/// fetch the avatar and caches it at:
///
/// ```text
/// {app_data}/avatars/{server_hash}/{username_hash}
/// ```
///
/// If the file already exists in the cache and `force_download` is `false`,
/// the cached path is returned immediately.
///
/// Mirrors [`download_avatar_file`] in the Python reference.
#[tauri::command]
pub async fn download_avatar(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    task_data: serde_json::Value,
    username: String,
    force_download: Option<bool>,
) -> Result<Option<String>, String> {
    let force = force_download.unwrap_or(false);

    // Extract task_id from task_data.
    let task_id = task_data["task_id"]
        .as_str()
        .ok_or_else(|| "task_data missing task_id".to_string())?;

    // Build cache path: {app_data}/avatars/{server_hash}/{username_hash}
    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;

    let server_hash = cfms_core::get_server_hash(&server_addr);
    let username_hash = cfms_core::get_username_hash(&username);

    let app_data = app_handle
        .path()
        .resolve("", tauri::path::BaseDirectory::AppData)
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;

    let cache_dir = app_data.join("avatars").join(&server_hash);
    let cache_path = cache_dir.join(&username_hash);

    // Return cached path early if it exists (and not forcing re-download).
    if !force && cache_path.exists() {
        return Ok(Some(cache_path.to_string_lossy().into_owned()));
    }

    // Ensure cache directory exists.
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create avatar cache dir: {e}"))?;

    // Remove stale cache file on force download.
    if force && cache_path.exists() {
        let _ = std::fs::remove_file(&cache_path);
    }

    // Get connection for file transfer (separate connection, matching the
    // reference pattern of creating a dedicated connection for avatar download).
    let conn = {
        let c = state.inner.conn.read().await;
        c.clone()
    }
    .ok_or_else(|| "Not connected to a server".to_string())?;

    // Download using the transfer protocol.
    // Progress is silently consumed (avatars are small; the reference does the same).
    let progress = |_phase: cfms_core::DownloadPhase,
                    _progress: f64,
                    _message: &str,
                    _current: u64,
                    _total: u64| {};
    cfms_transfer::download::receive(&conn, task_id, &cache_path, &progress)
        .await
        .map_err(|e| format!("Avatar download failed: {e}"))?;

    if cache_path.exists() {
        let path_str = cache_path.to_string_lossy().into_owned();
        // Store path in app state.
        {
            let mut a = state.inner.avatar_path.write().await;
            *a = Some(path_str.clone());
        }
        Ok(Some(path_str))
    } else {
        Ok(None)
    }
}

/// Check whether a cached avatar exists locally for a username on the current server.
///
/// Computes the same cache path as [`download_avatar`] and returns it if the
/// file exists, or `null` otherwise.  This is called reactively as the user
/// types a username on the login page, so they see their avatar before logging
/// in — matching [`AvatarPreviewContainer.update_preview`] in the Python
/// reference.
///
/// ```text
/// Cache path: {app_data}/avatars/{server_hash}/{username_hash}
/// ```
#[tauri::command]
pub async fn check_cached_avatar(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppHandleState>,
    username: String,
) -> Result<Option<String>, String> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;

    let server_hash = cfms_core::get_server_hash(&server_addr);
    let username_hash = cfms_core::get_username_hash(trimmed);

    let app_data = app_handle
        .path()
        .resolve("", tauri::path::BaseDirectory::AppData)
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;

    let cache_path = app_data
        .join("avatars")
        .join(&server_hash)
        .join(&username_hash);

    if cache_path.exists() {
        Ok(Some(cache_path.to_string_lossy().into_owned()))
    } else {
        Ok(None)
    }
}

/// Set a user's avatar to a specific document ID on the server.
///
/// Mirrors [`set_user_avatar`] in the Python reference.
#[tauri::command]
pub async fn set_user_avatar(
    state: tauri::State<'_, AppHandleState>,
    username: String,
    document_id: String,
) -> Result<bool, String> {
    let (conn, auth_username, token) = get_connection_auth(&state).await?;

    let resp = send_action_request(
        &conn,
        "set_user_avatar",
        serde_json::json!({"username": username, "document_id": document_id}),
        &auth_username,
        &token,
    )
    .await?;

    Ok(resp.code == 200)
}

// ---------------------------------------------------------------------------
// User preference commands (mirrors reference/src/include/util/userpref.py)
// ---------------------------------------------------------------------------

/// Load the user preference file from disk.
///
/// File path: `{app_data}/user_preferences/{server_hash}_{username}.json`
///
/// Handles three cases:
/// 1. File doesn't exist → returns default `UserPreference`.
/// 2. File is encrypted → decrypts with DEK; returns error if decryption fails.
/// 3. File is plain JSON → parses it; migrates to encrypted if DEK is available.
///
/// Mirrors [`load_user_preference`] in the Python reference.
#[tauri::command]
pub async fn load_user_preference(
    state: tauri::State<'_, AppHandleState>,
) -> Result<serde_json::Value, String> {
    let username = {
        let u = state.inner.username.read().await;
        u.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;

    let server_hash = cfms_core::get_server_hash(&server_addr);
    let dek = {
        let d = state.inner.dek.read().await;
        d.clone()
    };

    let app_data_dir = state.app_data_dir.clone();
    let mut pref = tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::load(&app_data_dir, &server_hash, &username, dek.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Preference load task failed: {e}"))??;

    pref.task_concurrency = pref.task_concurrency.normalized();
    sync_runtime_preferences(&state, &pref);

    serde_json::to_value(pref).map_err(|e| format!("Serialization error: {e}"))
}

/// Save the user preference file to disk.
///
/// Writes the preference encrypted with the DEK when available.  When the DEK
/// is `None`, the file is only written if it doesn't already exist in
/// encrypted form (to prevent data loss and security downgrade).
///
/// Mirrors [`save_user_preference`] in the Python reference.
#[tauri::command]
pub async fn save_user_preference(
    state: tauri::State<'_, AppHandleState>,
    preferences: serde_json::Value,
) -> Result<(), String> {
    let username = {
        let u = state.inner.username.read().await;
        u.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;

    let server_hash = cfms_core::get_server_hash(&server_addr);
    let mut preferences: UserPreference =
        serde_json::from_value(preferences).map_err(|e| format!("Invalid preference data: {e}"))?;
    preferences.task_concurrency = preferences.task_concurrency.normalized();
    sync_runtime_preferences(&state, &preferences);

    let dek = {
        let d = state.inner.dek.read().await;
        d.clone()
    };

    let app_data_dir = state.app_data_dir.clone();
    tokio::task::spawn_blocking(move || {
        cfms_service::user_preferences::save(
            &app_data_dir,
            &server_hash,
            &username,
            dek.as_deref(),
            &preferences,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Preference save task failed: {e}"))?
}

fn sync_runtime_preferences(state: &AppHandleState, preferences: &UserPreference) {
    state.inner.download_max_concurrent.store(
        preferences.task_concurrency.max_downloads as usize,
        std::sync::atomic::Ordering::Relaxed,
    );
}

// ---------------------------------------------------------------------------
// Download task reload (mirrors reference/src/include/classes/services/download.py)
// ---------------------------------------------------------------------------

/// Reload download tasks for the current user.
///
/// Loads tasks from the per-user encrypted JSON file into the in-memory queue.
/// Must be called after login (when username, server_address, and DEK are set).
///
/// Mirrors [`reload_tasks_for_user`] in the Python reference.
#[tauri::command]
pub async fn reload_tasks_for_user(
    state: tauri::State<'_, AppHandleState>,
) -> Result<usize, String> {
    let username = {
        let u = state.inner.username.read().await;
        u.clone()
    }
    .ok_or_else(|| "Not logged in".to_string())?;

    let server_addr = {
        let a = state.inner.server_address.read().await;
        a.clone()
    }
    .ok_or_else(|| "No server address".to_string())?;

    let server_hash = cfms_core::get_server_hash(&server_addr);

    let dek = {
        let d = state.inner.dek.read().await;
        d.clone()
    };

    let count = state
        .tasks
        .load_for_user(&state.app_data_dir, &server_hash, &username, dek.as_deref())
        .map_err(|e| format!("Failed to load download tasks: {e}"))?;

    tracing::info!("Reloaded {count} download tasks for user {username}");
    Ok(count)
}

// ---------------------------------------------------------------------------

/// Convenience helper: extract (connection, username, token) from app state.
async fn get_connection_auth(
    state: &AppHandleState,
) -> Result<(cfms_transport::Connection, String, String), String> {
    let conn = cfms_service::services::connection::ensure_connected(
        &state.inner,
        cfms_service::services::connection::DEFAULT_RECONNECT_ATTEMPTS,
        false,
    )
    .await
    .map_err(|e| format!("Not connected to a server: {e}"))?;
    let username = state
        .inner
        .username
        .read()
        .await
        .clone()
        .ok_or_else(|| "Not logged in".to_string())?;
    let token = state
        .inner
        .token
        .read()
        .await
        .clone()
        .ok_or_else(|| "Not logged in".to_string())?;
    Ok((conn, username, token))
}

fn download_root(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_handle
        .path()
        .resolve("downloads", tauri::path::BaseDirectory::Download)
        .unwrap_or_else(|_| {
            app_handle
                .path()
                .resolve("downloads", tauri::path::BaseDirectory::AppData)
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
        }))
}

async fn create_transfer_connection(
    state: &cfms_service::state::AppState,
) -> Result<cfms_transport::Connection, String> {
    let (url, ca_dir, disable_ssl, proxy_addr, force_ipv4, client_cert_path, client_key_path) = {
        let addr = state.server_address.read().await;
        let ca = state.ca_dir.read().await;
        let dse = state.disable_ssl_enforcement.read().await;
        let proxy = state.proxy_addr.read().await;
        let force_ipv4 = state.force_ipv4.read().await;
        let cert = state.client_cert_path.read().await;
        let key = state.client_key_path.read().await;
        (
            addr.clone(),
            ca.clone(),
            *dse,
            proxy.clone(),
            *force_ipv4,
            cert.clone(),
            key.clone(),
        )
    };

    let url = url.ok_or_else(|| "No server address configured".to_string())?;
    let ca_dir = ca_dir.ok_or_else(|| "No CA directory configured".to_string())?;

    let tls_config = cfms_transport::tls::build_config_with_identity(
        &ca_dir,
        disable_ssl,
        client_cert_path.as_deref(),
        client_key_path.as_deref(),
    )
    .map_err(|e| format!("TLS config error: {e}"))?;

    cfms_transport::Connection::connect(&url, tls_config, proxy_addr.as_deref(), force_ipv4)
        .await
        .map_err(|e| format!("Transfer connection failed: {e}"))
}

async fn create_server_directory(
    state: &AppHandleState,
    parent_id: Option<String>,
    name: String,
    exists_ok: bool,
) -> Result<String, String> {
    let (conn, username, token) = get_connection_auth(state).await?;
    let resp = send_action_request(
        &conn,
        "create_directory",
        serde_json::json!({
            "parent_id": non_empty_optional(parent_id),
            "name": name,
            "exists_ok": exists_ok,
        }),
        &username,
        &token,
    )
    .await?;

    if resp.code == 409
        && exists_ok
        && resp.data.get("type").and_then(|v| v.as_str()) == Some("directory")
        && let Some(id) = resp.data.get("id").and_then(|v| v.as_str())
    {
        return Ok(id.to_string());
    }

    if resp.code != 200 {
        return Err(format!("Server returned {}: {}", resp.code, resp.message));
    }

    resp.data
        .get("id")
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Server response missing directory id".to_string())
}

fn clean_optional_upload_name(name: Option<String>) -> Option<String> {
    name.and_then(|value| {
        let cleaned = value
            .chars()
            .map(|ch| match ch {
                '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'..='\u{1f}' => '_',
                _ => ch,
            })
            .collect::<String>()
            .trim()
            .trim_matches('.')
            .to_string();
        if cleaned.is_empty() {
            None
        } else {
            Some(cleaned)
        }
    })
}

#[cfg(target_os = "android")]
fn prepare_upload_source<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    file_path: String,
) -> Result<PreparedUploadSource, String> {
    let source = std::path::PathBuf::from(&file_path);
    if source.is_file() {
        return Ok(PreparedUploadSource {
            path: source,
            display_name: None,
            cleanup_on_drop: false,
        });
    }

    let importer = app_handle.state::<AndroidUploadFileImporter<R>>();
    let imported = importer
        .handle
        .run_mobile_plugin::<AndroidImportedUploadPath>(
            "importFile",
            serde_json::json!({ "uri": file_path }),
        )
        .map_err(|e| format!("Failed to import selected file: {e}"))?;
    let imported_path = std::path::PathBuf::from(imported.path);
    if !imported_path.is_file() {
        return Err("Selected path is not a file".to_string());
    }

    Ok(PreparedUploadSource {
        path: imported_path,
        display_name: Some(imported.display_name),
        cleanup_on_drop: true,
    })
}

#[cfg(not(target_os = "android"))]
fn prepare_upload_source<R: Runtime>(
    _app_handle: &tauri::AppHandle<R>,
    file_path: String,
) -> Result<PreparedUploadSource, String> {
    let source = std::path::PathBuf::from(file_path);
    if !source.is_file() {
        return Err("Selected path is not a file".to_string());
    }

    Ok(PreparedUploadSource {
        path: source,
        display_name: None,
        cleanup_on_drop: false,
    })
}

#[cfg(target_os = "android")]
fn prepare_upload_directory_source<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    directory_path: String,
) -> Result<PreparedUploadSource, String> {
    let source = std::path::PathBuf::from(&directory_path);
    if source.is_dir() {
        return Ok(PreparedUploadSource {
            path: source,
            display_name: None,
            cleanup_on_drop: false,
        });
    }

    let importer = app_handle.state::<AndroidUploadFileImporter<R>>();
    let imported = importer
        .handle
        .run_mobile_plugin::<AndroidImportedUploadPath>(
            "importDirectory",
            serde_json::json!({ "uri": directory_path }),
        )
        .map_err(|e| format!("Failed to import selected folder: {e}"))?;
    let imported_path = std::path::PathBuf::from(imported.path);
    if !imported_path.is_dir() {
        return Err("Selected path is not a directory".to_string());
    }

    Ok(PreparedUploadSource {
        path: imported_path,
        display_name: Some(imported.display_name),
        cleanup_on_drop: true,
    })
}

#[cfg(not(target_os = "android"))]
fn prepare_upload_directory_source<R: Runtime>(
    _app_handle: &tauri::AppHandle<R>,
    directory_path: String,
) -> Result<PreparedUploadSource, String> {
    let source = std::path::PathBuf::from(directory_path);
    if !source.is_dir() {
        return Err("Selected path is not a directory".to_string());
    }

    Ok(PreparedUploadSource {
        path: source,
        display_name: None,
        cleanup_on_drop: false,
    })
}

async fn upload_local_file<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    state: &AppHandleState,
    parent_id: Option<String>,
    source: std::path::PathBuf,
    upload_name: Option<String>,
    upload_id: String,
    conflict_strategy: UploadConflictStrategy,
) -> Result<UploadFileResult, String> {
    if !source.is_file() {
        return Err("Selected path is not a file".to_string());
    }

    let file_name = upload_name
        .or_else(|| {
            source
                .file_name()
                .and_then(|name| name.to_str())
                .map(ToOwned::to_owned)
        })
        .ok_or_else(|| "Selected file has no valid name".to_string())?;
    let mut upload_control = state.active_uploads.register(&upload_id);

    emit_upload_progress(
        app_handle,
        &upload_id,
        None,
        &file_name,
        0,
        std::fs::metadata(&source).map(|m| m.len()).unwrap_or(0),
        "uploading",
        Some("Preparing upload".to_string()),
    );

    let (conn, username, token) = match get_connection_auth(state).await {
        Ok(auth) => auth,
        Err(err) => {
            state.active_uploads.unregister(&upload_id);
            return Err(err);
        }
    };
    let create_resp = match send_action_request(
        &conn,
        "create_document",
        serde_json::json!({
            "title": file_name,
            "folder_id": non_empty_optional(parent_id.clone()),
            "access_rules": {},
        }),
        &username,
        &token,
    )
    .await
    {
        Ok(response) => response,
        Err(err) => {
            state.active_uploads.unregister(&upload_id);
            return Err(err);
        }
    };

    let mut overwritten = false;
    let (task_id, document_id, skipped) = if create_resp.code == 409 {
        let conflict_type = create_resp
            .data
            .get("type")
            .and_then(|value| value.as_str());
        let conflict_id = create_resp
            .data
            .get("id")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned);

        match (conflict_strategy, conflict_type, conflict_id) {
            (UploadConflictStrategy::Skip, _, _) => {
                emit_upload_progress(
                    app_handle,
                    &upload_id,
                    None,
                    &file_name,
                    0,
                    0,
                    "skipped",
                    Some("Skipped existing document".to_string()),
                );
                state.active_uploads.unregister(&upload_id);
                return Ok(UploadFileResult {
                    upload_id,
                    task_id: None,
                    document_id: None,
                    file_name,
                    skipped: true,
                    overwritten: false,
                });
            }
            (UploadConflictStrategy::Overwrite, Some("document"), Some(document_id)) => {
                let upload_resp = match send_action_request(
                    &conn,
                    "upload_document",
                    serde_json::json!({ "document_id": document_id }),
                    &username,
                    &token,
                )
                .await
                {
                    Ok(response) => response,
                    Err(err) => {
                        state.active_uploads.unregister(&upload_id);
                        return Err(err);
                    }
                };

                if upload_resp.code != 200 {
                    state.active_uploads.unregister(&upload_id);
                    return Err(format!(
                        "Server returned {}: {}",
                        upload_resp.code, upload_resp.message
                    ));
                }

                overwritten = true;
                let task_id = match extract_task_id(&upload_resp.data) {
                    Ok(id) => id,
                    Err(err) => {
                        state.active_uploads.unregister(&upload_id);
                        return Err(err);
                    }
                };
                (task_id, Some(document_id), false)
            }
            _ => {
                state.active_uploads.unregister(&upload_id);
                return Err(format!(
                    "Server returned {}: {}",
                    create_resp.code, create_resp.message
                ));
            }
        }
    } else if create_resp.code != 200 {
        state.active_uploads.unregister(&upload_id);
        return Err(format!(
            "Server returned {}: {}",
            create_resp.code, create_resp.message
        ));
    } else {
        let task_id = match extract_task_id(&create_resp.data) {
            Ok(id) => id,
            Err(err) => {
                state.active_uploads.unregister(&upload_id);
                return Err(err);
            }
        };
        let document_id = create_resp
            .data
            .get("id")
            .or_else(|| create_resp.data.get("document_id"))
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned);
        (task_id, document_id, false)
    };

    if let Some(reason) = *upload_control.borrow() {
        emit_interrupted_upload(app_handle, &upload_id, Some(&task_id), &file_name, reason);
        state.active_uploads.unregister(&upload_id);
        return Err(upload_interruption_message(reason).to_string());
    }

    let transfer_conn = match create_transfer_connection(&state.inner).await {
        Ok(conn) => conn,
        Err(err) => {
            state.active_uploads.unregister(&upload_id);
            return Err(err);
        }
    };
    state
        .active_uploads
        .set_transfer_conn(&upload_id, transfer_conn.clone());
    let emit_handle = app_handle.clone();
    let progress_upload_id = upload_id.clone();
    let progress_task_id = task_id.clone();
    let progress_file_name = file_name.clone();
    let progress = move |current: u64, total: u64| {
        emit_upload_progress(
            &emit_handle,
            &progress_upload_id,
            Some(&progress_task_id),
            &progress_file_name,
            current,
            total,
            "uploading",
            None,
        );
    };

    let result = tokio::select! {
        result = cfms_transfer::upload::send(&transfer_conn, &task_id, &source, &progress) => {
            result.map_err(|err| format!("Upload failed: {err}"))
        }
        changed = upload_control.changed() => {
            let reason = if changed.is_ok() {
                (*upload_control.borrow()).unwrap_or(UploadInterruption::Cancelled)
            } else {
                UploadInterruption::Cancelled
            };
            Err(upload_interruption_message(reason).to_string())
        }
    };
    transfer_conn.close().await;

    if let Err(message) = result {
        if let Some(reason) = *upload_control.borrow() {
            emit_interrupted_upload(app_handle, &upload_id, Some(&task_id), &file_name, reason);
            state.active_uploads.unregister(&upload_id);
            return Err(message);
        }

        emit_upload_progress(
            app_handle,
            &upload_id,
            Some(&task_id),
            &file_name,
            0,
            0,
            "failed",
            Some(message.clone()),
        );
        state.active_uploads.unregister(&upload_id);
        return Err(message);
    }

    emit_upload_progress(
        app_handle,
        &upload_id,
        Some(&task_id),
        &file_name,
        1,
        1,
        "completed",
        Some("Upload completed".to_string()),
    );
    state.active_uploads.unregister(&upload_id);

    Ok(UploadFileResult {
        upload_id,
        task_id: Some(task_id),
        document_id,
        file_name,
        skipped,
        overwritten,
    })
}

fn upload_interruption_message(reason: UploadInterruption) -> &'static str {
    match reason {
        UploadInterruption::Paused => "Upload paused",
        UploadInterruption::Cancelled => "Upload cancelled",
    }
}

fn emit_interrupted_upload<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    upload_id: &str,
    task_id: Option<&str>,
    file_name: &str,
    reason: UploadInterruption,
) {
    let status = match reason {
        UploadInterruption::Paused => "paused",
        UploadInterruption::Cancelled => "cancelled",
    };
    emit_upload_progress(
        app_handle,
        upload_id,
        task_id,
        file_name,
        0,
        0,
        status,
        Some(upload_interruption_message(reason).to_string()),
    );
}

fn emit_upload_progress<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    upload_id: &str,
    task_id: Option<&str>,
    file_name: &str,
    current_bytes: u64,
    total_bytes: u64,
    status: &str,
    message: Option<String>,
) {
    let progress = if total_bytes > 0 {
        current_bytes as f64 / total_bytes as f64
    } else if status == "completed" {
        1.0
    } else {
        0.0
    };

    let _ = app_handle.emit(
        "cfms:upload-progress",
        UploadProgressEvent {
            upload_id: upload_id.to_string(),
            task_id: task_id.map(ToOwned::to_owned),
            file_name: file_name.to_string(),
            current_bytes,
            total_bytes,
            progress,
            status: status.to_string(),
            message,
        },
    );
}

fn extract_task_id(data: &serde_json::Value) -> Result<String, String> {
    data.get("task_data")
        .and_then(|value| value.get("task_id"))
        .or_else(|| data.get("task_id"))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Server response missing task_id".to_string())
}

fn collect_directory_entries(root: &std::path::Path) -> Result<Vec<std::path::PathBuf>, String> {
    let mut entries = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(path) = stack.pop() {
        let children = std::fs::read_dir(&path)
            .map_err(|e| format!("Failed to read directory {}: {e}", path.display()))?;
        for child in children {
            let child = child.map_err(|e| format!("Failed to read directory entry: {e}"))?;
            let child_path = child.path();
            if child_path.is_dir() {
                stack.push(child_path.clone());
            }
            entries.push(child_path);
        }
    }

    entries.sort_by(|a, b| {
        let a_depth = a.components().count();
        let b_depth = b.components().count();
        a_depth.cmp(&b_depth).then_with(|| a.cmp(b))
    });
    Ok(entries)
}

async fn server_action_json(
    state: &AppHandleState,
    action: &str,
    data: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut last_error = None;
    for attempt in 1..=cfms_service::services::connection::DEFAULT_RECONNECT_ATTEMPTS {
        let (conn, username, token) = get_connection_auth(state).await?;
        match send_action_request(&conn, action, data.clone(), &username, &token).await {
            Ok(resp) => {
                if resp.code != 200 {
                    return Err(format!("Server returned {}: {}", resp.code, resp.message));
                }

                return Ok(resp.data);
            }
            Err(error) if is_transient_connection_error(&error) => {
                tracing::warn!(
                    "Request {action} failed on attempt {attempt}; reconnecting: {error}",
                );
                last_error = Some(error);
                cfms_service::services::connection::ensure_connected(
                    &state.inner,
                    cfms_service::services::connection::DEFAULT_RECONNECT_ATTEMPTS,
                    true,
                )
                .await?;
            }
            Err(error) => return Err(error),
        }
    }

    Err(last_error.unwrap_or_else(|| format!("{action} failed after reconnect attempts")))
}

async fn server_action_bool(
    state: &AppHandleState,
    action: &str,
    data: serde_json::Value,
) -> Result<bool, String> {
    server_action_json(state, action, data).await?;
    Ok(true)
}

async fn clear_auth_state(state: &AppHandleState) {
    {
        let mut u = state.inner.username.write().await;
        let mut t = state.inner.token.write().await;
        let mut e = state.inner.token_exp.write().await;
        let mut n = state.inner.nickname.write().await;
        let mut p = state.inner.permissions.write().await;
        let mut g = state.inner.groups.write().await;
        let mut d = state.inner.dek.write().await;
        let mut a = state.inner.avatar_path.write().await;
        *u = None;
        *t = None;
        *e = None;
        *n = None;
        p.clear();
        g.clear();
        *d = None;
        *a = None;
    }

    state.tasks.clear();
    state
        .inner
        .pending_2fa
        .store(false, std::sync::atomic::Ordering::SeqCst);
}

async fn close_primary_connection(state: &AppHandleState) {
    let conn = {
        let mut c = state.inner.conn.write().await;
        c.take()
    };

    if let Some(conn) = conn {
        tokio::spawn(async move { conn.close().await });
    }
}

async fn clear_connection_state(state: &AppHandleState) {
    {
        let mut addr = state.inner.server_address.write().await;
        *addr = None;
    }
    {
        let mut name = state.inner.server_name.write().await;
        *name = None;
    }
    {
        let mut pv = state.inner.server_protocol_version.write().await;
        *pv = None;
    }
    state
        .inner
        .app_lockdown
        .store(false, std::sync::atomic::Ordering::SeqCst);
    {
        let mut ca = state.inner.ca_dir.write().await;
        *ca = None;
    }
    {
        let mut force_ipv4 = state.inner.force_ipv4.write().await;
        *force_ipv4 = false;
    }
    {
        let mut proxy = state.inner.proxy_addr.write().await;
        *proxy = None;
    }
    {
        let mut cert = state.inner.client_cert_path.write().await;
        *cert = None;
    }
    {
        let mut key = state.inner.client_key_path.write().await;
        *key = None;
    }
}

fn non_empty_optional(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

/// Build a JSON auth-status payload (auth fields only — no server state).
async fn build_auth_status(inner: &cfms_service::state::AppState) -> serde_json::Value {
    let username = inner.username.read().await.clone();
    let nickname = inner.nickname.read().await.clone();
    let pending_2fa = inner.pending_2fa.load(std::sync::atomic::Ordering::SeqCst);
    // When 2FA is pending, the token is a placeholder — don't report as
    // authenticated.
    let has_token = !pending_2fa && inner.token.read().await.is_some();
    let token_exp = if pending_2fa {
        None
    } else {
        *inner.token_exp.read().await
    };
    let permissions = inner.permissions.read().await.clone();
    let groups = inner.groups.read().await.clone();

    let mut status = serde_json::json!({
        "username": username,
        "nickname": nickname,
        "has_token": has_token,
        "token_exp": token_exp,
        "permissions": permissions,
        "groups": groups,
        "avatar_path": inner.avatar_path.read().await.clone(),
    });

    if pending_2fa {
        status["requires_2fa"] = serde_json::Value::Bool(true);
        status["2fa_method"] = serde_json::Value::String("totp".to_string());
    }

    status
}

/// Build a JSON server-state payload (connection fields only — no auth data).
async fn build_server_state(inner: &cfms_service::state::AppState) -> serde_json::Value {
    let connected = inner
        .conn
        .read()
        .await
        .as_ref()
        .is_some_and(|conn| !conn.is_closed());
    let server_address = inner.server_address.read().await.clone();
    let server_name = inner.server_name.read().await.clone();
    let protocol_version = inner.server_protocol_version.read().await;
    let lockdown = inner.app_lockdown.load(std::sync::atomic::Ordering::SeqCst);

    serde_json::json!({
        "connected": connected,
        "server_address": server_address,
        "server_name": server_name,
        "protocol_version": *protocol_version,
        "lockdown": lockdown,
    })
}

/// Current Unix timestamp in seconds.
fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
// DEK setup helpers
// ---------------------------------------------------------------------------

/// Send an action request over the connection and return the parsed response.
///
/// Creates a short-lived stream, sends the JSON payload, reads the response,
/// and closes the stream with a conclusion frame.
async fn send_action_request(
    conn: &cfms_transport::Connection,
    action: &str,
    data: serde_json::Value,
    username: &str,
    token: &str,
) -> Result<cfms_core::Response, String> {
    let random_bytes: [u8; 16] = rand::thread_rng().r#gen();
    let nonce = hex::encode(random_bytes);

    let request = serde_json::json!({
        "action": action,
        "data": data,
        "username": username,
        "token": token,
        "timestamp": unix_now(),
        "nonce": nonce,
    });

    let request_bytes = serde_json::to_vec(&request)
        .map_err(|e| format!("Failed to encode {action} request: {e}"))?;

    let mut stream = conn
        .create_stream()
        .await
        .map_err(|e| format!("Failed to create stream for {action}: {e}"))?;

    stream
        .send(conn, request_bytes)
        .await
        .map_err(|e| format!("Failed to send {action} request: {e}"))?;

    let response_bytes = stream
        .recv()
        .await
        .ok_or_else(|| format!("Connection closed before {action} response"))?;

    serde_json::from_slice::<cfms_core::Response>(&response_bytes)
        .map_err(|e| format!("Invalid {action} response: {e}"))
}

fn is_transient_connection_error(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    lower.contains("connection closed")
        || lower.contains("connection failed")
        || lower.contains("failed to create stream")
        || lower.contains("failed to send")
        || lower.contains("send failed")
        || lower.contains("websocket")
        || lower.contains("tcp connect")
        || lower.contains("stream closed")
        || lower.contains("no response")
}

/// Set up the Data Encryption Key after a successful login.
///
/// Mirrors [`_setup_dek`] from the Python reference implementation:
///
/// 1. If the server returned a `preference_dek`, decrypt its `key_content`
///    with the password-derived KEK to recover the DEK.
/// 2. Otherwise, generate a new random DEK, encrypt it, upload it to the
///    server's keyring (`upload_user_key`), and register it as the
///    preference DEK (`set_user_preference_dek`).
///
/// Failures are logged but **not** propagated — DEK setup is best-effort;
/// the user can still log in without encrypted configuration support.
async fn setup_dek(
    inner: &cfms_service::state::AppState,
    login_data: &serde_json::Value,
    password: &str,
    username: &str,
    token: &str,
    conn: &cfms_transport::Connection,
) {
    if password.is_empty() {
        return;
    }

    let result: Result<(), String> = async {
        if let Some(preference_dek) = login_data.get("preference_dek") {
            // --- Server already has an encrypted DEK — decrypt it. ---
            let key_content = preference_dek["key_content"]
                .as_str()
                .ok_or_else(|| "preference_dek missing key_content".to_string())?;

            let decrypted = {
                let kc = key_content.to_owned();
                let pw = password.to_owned();
                tokio::task::spawn_blocking(move || {
                    dek::decrypt_dek(&kc, &pw).map_err(|e| format!("DEK decryption failed: {e}"))
                })
                .await
                .map_err(|e| format!("DEK decryption task panicked: {e}"))?
            }?;

            let mut d = inner.dek.write().await;
            *d = Some(decrypted);
        } else {
            // --- First login with keyring support — generate and upload. ---
            let new_dek = dek::generate_dek();
            let encrypted = {
                let pw = password.to_owned();
                let dk = *new_dek; // copy out of Zeroizing
                tokio::task::spawn_blocking(move || {
                    dek::encrypt_dek(&dk, &pw).map_err(|e| format!("DEK encryption failed: {e}"))
                })
                .await
                .map_err(|e| format!("DEK encryption task panicked: {e}"))?
            }?;

            // Upload the encrypted DEK to the server's keyring.
            let upload_resp = send_action_request(
                conn,
                "upload_user_key",
                serde_json::json!({"content": encrypted, "label": "preference_dek"}),
                username,
                token,
            )
            .await?;

            if upload_resp.code != 200 {
                return Err(format!(
                    "upload_user_key returned {}: {}",
                    upload_resp.code, upload_resp.message
                ));
            }

            let key_id = upload_resp.data["id"]
                .as_str()
                .ok_or_else(|| "upload_user_key response missing id".to_string())?
                .to_string();

            // Register it as the preference DEK for future logins.
            let set_resp = send_action_request(
                conn,
                "set_user_preference_dek",
                serde_json::json!({"id": key_id}),
                username,
                token,
            )
            .await?;

            if set_resp.code != 200 {
                return Err(format!(
                    "set_user_preference_dek returned {}: {}",
                    set_resp.code, set_resp.message
                ));
            }

            // Store the DEK in memory.
            let mut d = inner.dek.write().await;
            *d = Some(new_dek);
        }
        Ok(())
    }
    .await;

    if let Err(e) = result {
        // Non-fatal: encryption is best-effort; login still succeeds.
        tracing::warn!("DEK setup failed (config will not be encrypted this session): {e}");
    }
}
