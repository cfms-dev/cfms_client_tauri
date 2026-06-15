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
use crate::{
    AndroidApkInstaller, AndroidAppLifecycle, AndroidFileOpener, AndroidPasskey,
    AndroidSecureScreen, AndroidUpdateNotification,
};
use crate::{AppHandleState, UploadInterruption};

const UPDATE_RELEASES_API: &str =
    "https://api.github.com/repos/cfms-dev/cfms_client_tauri/releases";
const UPDATE_USER_AGENT: &str = "cfms-client-tauri-updater";
const CA_CERT_API_URL: &str = "https://api.github.com/repos/cfms-dev/ca/contents/";
const CA_MANIFEST_FILENAME: &str = ".manifest.json";
const MAX_RECENT_CONNECTION_ADDRESSES: usize = 5;

include!(concat!(env!("OUT_DIR"), "/bundled_ca.rs"));

include!("commands/types.rs");
include!("commands/health.rs");
include!("commands/passkeys.rs");
include!("commands/mobile.rs");
include!("commands/updates.rs");
include!("commands/downloads.rs");
include!("commands/documents.rs");
include!("commands/admin.rs");
include!("commands/browsing.rs");
include!("commands/settings.rs");
include!("commands/auth_connection.rs");
include!("commands/avatars.rs");
include!("commands/preferences.rs");
include!("commands/task_reload.rs");
include!("commands/transfer_helpers.rs");
include!("commands/shared_helpers.rs");
