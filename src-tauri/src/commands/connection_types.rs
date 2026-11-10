use serde::{Deserialize, Serialize};

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
pub(super) struct CaManifest {
    #[serde(default)]
    pub(super) last_check: Option<f64>,
    #[serde(default)]
    pub(super) files: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct GithubContentsEntry {
    pub(super) name: String,
    pub(super) sha: String,
    pub(super) download_url: Option<String>,
    #[serde(rename = "type")]
    pub(super) entry_type: String,
}
