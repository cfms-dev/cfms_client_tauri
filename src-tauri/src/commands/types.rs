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

const SERVER_CURSOR_PAGE_SIZE: u32 = 128;

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ListingCursorPage {
    #[serde(default)]
    items: Vec<cfms_core::ServerListingItem>,
    #[serde(default)]
    page_size: u32,
    #[serde(default)]
    next_cursor: Option<String>,
    #[serde(default)]
    has_more: bool,
    #[serde(default)]
    parent_id: Option<String>,
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

    fn updater_proxy_url(&self) -> Result<Option<url::Url>, String> {
        let configured = self.configured_updater_proxy_setting();
        let Some((raw, default_scheme)) = configured else {
            return Ok(None);
        };

        normalize_proxy_url(&raw, default_scheme, "update checks")
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

    fn configured_updater_proxy_setting(&self) -> Option<(String, &'static str)> {
        let (raw, default_scheme) = if !self.enable_proxy || self.follow_system_proxy {
            (system_proxy_setting(), "http")
        } else {
            (Some(self.custom_proxy.trim().to_string()), "socks5h")
        };

        let raw = raw?;
        let trimmed = raw.trim();
        (!trimmed.is_empty()).then(|| (trimmed.to_string(), default_scheme))
    }

    fn client_identity_paths(&self) -> (Option<std::path::PathBuf>, Option<std::path::PathBuf>) {
        let cert = trimmed_path(&self.client_cert_path);
        let key = trimmed_path(&self.client_key_path);
        (cert, key)
    }
}

// ---------------------------------------------------------------------------
