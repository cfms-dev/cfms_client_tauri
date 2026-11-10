use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateChannel {
    Stable,
    Beta,
    Alpha,
}

impl UpdateChannel {
    pub(super) fn parse(value: Option<&str>) -> Self {
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

    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
            Self::Alpha => "alpha",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct GithubReleaseDto {
    pub(super) tag_name: String,
    pub(super) body: Option<String>,
    pub(super) prerelease: bool,
    pub(super) html_url: String,
    pub(super) published_at: Option<String>,
    pub(super) assets: Vec<GithubAssetDto>,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct GithubAssetDto {
    pub(super) name: String,
    #[cfg(not(target_os = "android"))]
    pub(super) label: Option<String>,
    pub(super) browser_download_url: String,
    #[cfg(target_os = "android")]
    pub(super) digest: Option<String>,
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
    pub(super) download_url: String,
    pub(super) file_name: String,
    pub(super) digest: Option<AssetDigest>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone)]
pub(super) struct AssetDigest {
    pub(super) kind: AssetDigestKind,
    pub(super) value: String,
}

#[cfg(target_os = "android")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AssetDigestKind {
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
