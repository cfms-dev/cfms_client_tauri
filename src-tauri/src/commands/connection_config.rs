use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConnectionSettingsDto {
    pub enable_proxy: bool,
    pub follow_system_proxy: bool,
    pub custom_proxy: String,
    pub force_ipv4: bool,
    pub client_cert_path: String,
    pub client_key_path: String,
    #[serde(default)]
    pub crl_allowed_hosts: Vec<String>,
    pub remember_connection_addresses: bool,
    pub recent_connection_addresses: Vec<String>,
}

impl ConnectionSettingsDto {
    pub(super) fn load(settings: &cfms_service::db::settings::SettingsStore) -> Self {
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
            crl_allowed_hosts: settings
                .get("crl_allowed_hosts")
                .ok()
                .flatten()
                .and_then(|value| serde_json::from_str(&value).ok())
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

    pub(super) fn proxy_setting_value(&self) -> String {
        if !self.enable_proxy {
            String::new()
        } else if self.follow_system_proxy {
            "system".to_string()
        } else {
            self.custom_proxy.trim().to_string()
        }
    }

    pub(super) fn proxy_addr(&self) -> Result<Option<String>, String> {
        let raw = self.configured_proxy_setting();
        let Some(raw) = raw else {
            return Ok(None);
        };

        normalize_proxy_url(&raw, self.proxy_default_scheme(), "CFMS connections")
            .map(|proxy_url| proxy_url.map(|url| url.to_string()))
    }

    pub(super) fn updater_proxy_url(&self) -> Result<Option<url::Url>, String> {
        let configured = self.configured_updater_proxy_setting();
        let Some((raw, default_scheme)) = configured else {
            return Ok(None);
        };

        normalize_proxy_url(&raw, default_scheme, "update checks")
    }

    pub(super) fn proxy_default_scheme(&self) -> &'static str {
        if self.follow_system_proxy {
            "http"
        } else {
            "socks5h"
        }
    }

    pub(super) fn configured_proxy_setting(&self) -> Option<String> {
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

    pub(super) fn configured_updater_proxy_setting(&self) -> Option<(String, &'static str)> {
        let (raw, default_scheme) = if !self.enable_proxy || self.follow_system_proxy {
            (system_proxy_setting(), "http")
        } else {
            (Some(self.custom_proxy.trim().to_string()), "socks5h")
        };

        let raw = raw?;
        let trimmed = raw.trim();
        (!trimmed.is_empty()).then(|| (trimmed.to_string(), default_scheme))
    }

    pub(super) fn client_identity_paths(
        &self,
    ) -> (Option<std::path::PathBuf>, Option<std::path::PathBuf>) {
        let cert = trimmed_path(&self.client_cert_path);
        let key = trimmed_path(&self.client_key_path);
        (cert, key)
    }
}

pub(super) fn trimmed_path(value: &str) -> Option<std::path::PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(std::path::PathBuf::from(trimmed))
    }
}

pub(super) fn system_proxy_setting() -> Option<String> {
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

pub(super) fn normalize_proxy_url(
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

pub(super) fn load_recent_connection_addresses(
    settings: &cfms_service::db::settings::SettingsStore,
) -> Vec<String> {
    let Some(raw) = settings.get("recent_connection_addresses").ok().flatten() else {
        return Vec::new();
    };

    serde_json::from_str::<Vec<String>>(&raw)
        .map(normalize_recent_connection_addresses)
        .unwrap_or_default()
}

pub(super) fn save_recent_connection_addresses(
    settings: &cfms_service::db::settings::SettingsStore,
    addresses: Vec<String>,
) -> Result<(), String> {
    let encoded = serde_json::to_string(&addresses)
        .map_err(|e| format!("Failed to encode recent server addresses: {e}"))?;
    settings
        .set("recent_connection_addresses", &encoded)
        .map_err(|e| format!("Failed to write recent server addresses: {e}"))
}

pub(super) fn normalize_recent_connection_addresses(addresses: Vec<String>) -> Vec<String> {
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

pub(super) fn normalize_connection_history_address(address: &str) -> String {
    let trimmed = address.trim();
    let without_scheme = trimmed
        .strip_prefix("wss://")
        .or_else(|| trimmed.strip_prefix("ws://"))
        .unwrap_or(trimmed);
    without_scheme.trim_matches('/').trim().to_string()
}

pub(super) fn remember_successful_connection(
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

const MAX_RECENT_CONNECTION_ADDRESSES: usize = 5;
