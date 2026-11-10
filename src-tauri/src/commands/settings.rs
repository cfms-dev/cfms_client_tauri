use super::connection_config::ConnectionSettingsDto;
use super::connection_config::normalize_proxy_url;
use super::connection_config::normalize_recent_connection_addresses;
use super::connection_config::save_recent_connection_addresses;
use super::connection_types::CaCertificateStatusDto;
use super::connection_types::CaCertificateUpdateResultDto;
use super::connection_types::CaManifest;
use super::connection_types::GithubContentsEntry;
use super::github_api::GithubApiEndpoint;
use super::github_api::github_api_get;
use super::transfer_helpers::unix_now;
use super::updates::UPDATE_USER_AGENT;
use super::updates::update_http_client;
use super::updates::update_http_client_builder;
use crate::AppHandleState;
use tauri::Manager;

include!(concat!(env!("OUT_DIR"), "/bundled_ca.rs"));

const CA_MANIFEST_FILENAME: &str = ".manifest.json";

pub(super) const CA_CERT_API_URL: &str = "https://api.github.com/repos/cfms-dev/ca/contents/";

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

/// Wake native CRL monitors after foreground restoration; this never relaxes policy.
#[tauri::command]
pub fn refresh_connection_security(state: tauri::State<'_, AppHandleState>) {
    state.inner.crl_service.refresh_active();
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
    let crl_hosts = cfms_transport::crl::normalize_allowed_hosts(&settings.crl_allowed_hosts)
        .map_err(|_| "crl_invalid_hosts".to_string())?;
    state
        .settings
        .set(
            "crl_allowed_hosts",
            &serde_json::to_string(&crl_hosts).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("Failed to write CRL allowed hosts: {e}"))?;
    state.inner.crl_service.set_allowed_hosts(&crl_hosts)?;

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
    let mut result = check_and_update_ca_certificates(&ca_dir, &app_handle).await?;
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

fn app_ca_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle
        .path()
        .resolve("ca", tauri::path::BaseDirectory::AppData)
        .map_err(|e| format!("Cannot resolve writable CA directory: {e}"))
}

pub(super) fn ensure_writable_ca_dir(
    app_handle: &tauri::AppHandle,
) -> Result<std::path::PathBuf, String> {
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
    app_handle: &tauri::AppHandle,
) -> Result<CaCertificateUpdateResultDto, String> {
    let mut result = CaCertificateUpdateResultDto::default();
    let mut manifest = load_ca_manifest(ca_dir);

    let client = update_http_client_builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Failed to initialize GitHub API HTTP client.".to_string())?;
    let response = github_api_get(
        &client,
        GithubApiEndpoint::CaCertificates,
        &app_handle.state::<crate::github_credentials::GithubCredentialState>(),
    )
    .await?;

    let entries = response
        .json::<Vec<GithubContentsEntry>>()
        .await
        .map_err(|e| format!("Invalid CA certificate listing: {e}"))?;

    let remote_files: std::collections::HashMap<String, GithubContentsEntry> = entries
        .into_iter()
        .filter(|entry| entry.entry_type == "file" && is_ca_certificate_filename(&entry.name))
        .map(|entry| (entry.name.clone(), entry))
        .collect();

    // Keep downloads on a separate client with normal redirect handling and
    // no GitHub API authorization header. It also uses the Android TLS roots.
    let download_client = update_http_client(None)?;

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

        let content = match download_client
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
    pub(super) state: [u32; 5],
    pub(super) length_bits: u64,
    pub(super) buffer: Vec<u8>,
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

        for chunk in self.buffer.clone().as_chunks::<64>().0 {
            let mut block = [0_u8; 64];
            block.copy_from_slice(chunk);
            self.process_block(&block);
        }

        let mut output = [0_u8; 20];
        for (chunk, word) in output.as_chunks_mut::<4>().0.iter_mut().zip(self.state) {
            chunk.copy_from_slice(&word.to_be_bytes());
        }
        output
    }

    fn process_block(&mut self, block: &[u8; 64]) {
        let mut w = [0_u32; 80];
        for (i, chunk) in block.as_chunks::<4>().0.iter().enumerate().take(16) {
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
