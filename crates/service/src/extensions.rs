//! Signed, declarative client extension packages.
//!
//! Extension packages contain data only. This module deliberately has no script,
//! dynamic-library, network, or arbitrary filesystem execution surface.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use rand::RngExt;
use rusqlite::{OptionalExtension, params};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::db::settings::SettingsStore;

pub const HOST_API_VERSION: &str = "1.0.0";
pub const DEFAULT_CATALOG_URL: &str =
    "https://cfms-dev.github.io/cfms_client_extensions/v1/catalog.json";
const MAX_PACKAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 50 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_JSON_BYTES: u64 = 2 * 1024 * 1024;
const MAX_FILES: usize = 256;

const ALLOWED_CAPABILITIES: &[&str] = &[
    "files.metadata.read",
    "files.list",
    "files.search",
    "tasks.read",
    "transfers.download.enqueue",
    "account.summary.read",
    "preferences.read",
    "preferences.write",
    "events.subscribe",
    "ui.confirm",
    "ui.notify",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub publisher: String,
    pub version: String,
    pub host_api: String,
    pub min_client_version: String,
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub entrypoints: ExtensionEntrypoints,
    #[serde(default)]
    pub requested_capabilities: Vec<String>,
    #[serde(default)]
    pub background_triggers: Vec<BackgroundTrigger>,
    #[serde(default)]
    pub content_hashes: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExtensionEntrypoints {
    #[serde(default)]
    pub navigation: Vec<ExtensionNavigationEntry>,
    #[serde(default)]
    pub settings: Vec<ExtensionPageEntry>,
    #[serde(default)]
    pub workflows: Vec<ExtensionWorkflowEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionNavigationEntry {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub page: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionPageEntry {
    pub id: String,
    pub label: String,
    pub page: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionWorkflowEntry {
    pub id: String,
    pub label: String,
    pub workflow: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BackgroundTrigger {
    OnEnable { workflow: String },
    OnLogin { workflow: String },
    Interval { workflow: String, minutes: u32 },
    Event { workflow: String, event: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionInstallation {
    pub manifest: ExtensionManifest,
    pub package_digest: String,
    pub install_epoch: String,
    pub state: String,
    pub installed_at: i64,
    pub previous_version: Option<String>,
    pub last_error: Option<String>,
    pub disk_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogDocument {
    pub schema_version: u32,
    pub generated_at: i64,
    #[serde(default)]
    pub extensions: Vec<CatalogExtension>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogExtension {
    pub manifest: ExtensionManifest,
    pub download_url: String,
    pub sha256: String,
    pub signature: String,
    pub key_id: String,
    #[serde(default)]
    pub revoked: bool,
    pub revocation_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FileIndex {
    files: Vec<FileIndexEntry>,
}

#[derive(Debug, Deserialize)]
struct FileIndexEntry {
    path: String,
    sha256: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct SignatureEnvelope {
    key_id: String,
    signature: String,
}

#[derive(Debug)]
struct ValidatedPackage {
    manifest: ExtensionManifest,
    files: BTreeMap<String, Vec<u8>>,
    package_digest: String,
    expanded_bytes: u64,
}

#[derive(Clone)]
pub struct ExtensionStore {
    settings: SettingsStore,
    root: PathBuf,
    client_version: Version,
    trusted_keys: BTreeMap<String, VerifyingKey>,
}

impl ExtensionStore {
    pub fn new(settings: SettingsStore, app_data_dir: &Path, client_version: &str) -> Self {
        Self {
            settings,
            root: app_data_dir.join("extensions"),
            client_version: Version::parse(client_version)
                .unwrap_or_else(|_| Version::new(0, 0, 0)),
            trusted_keys: compiled_trusted_keys(),
        }
    }

    #[cfg(test)]
    fn with_key(
        settings: SettingsStore,
        app_data_dir: &Path,
        client_version: &str,
        key_id: &str,
        key: VerifyingKey,
    ) -> Self {
        let mut store = Self::new(settings, app_data_dir, client_version);
        store.trusted_keys.insert(key_id.to_string(), key);
        store
    }

    pub fn has_trusted_keys(&self) -> bool {
        !self.trusted_keys.is_empty()
    }

    pub fn list_installed(&self) -> Result<Vec<ExtensionInstallation>, String> {
        let db = self
            .settings
            .db
            .lock()
            .map_err(|_| "Extension database lock poisoned")?;
        let mut statement = db
            .prepare(
                "SELECT extension_id, installed_version, package_digest, install_epoch, state, \
                 installed_at, previous_version, last_error FROM extension_installations \
                 ORDER BY extension_id",
            )
            .map_err(|e| format!("Failed to prepare extension query: {e}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            })
            .map_err(|e| format!("Failed to list extensions: {e}"))?;

        let mut result = Vec::new();
        for row in rows {
            let (id, version, digest, epoch, state, installed_at, previous, last_error) =
                row.map_err(|e| format!("Failed to read extension row: {e}"))?;
            let version_dir = self.package_dir(&id, &version)?;
            let manifest = self.validate_installed_dir(&version_dir)?;
            result.push(ExtensionInstallation {
                manifest,
                package_digest: digest,
                install_epoch: epoch,
                state,
                installed_at,
                previous_version: previous,
                last_error,
                disk_bytes: directory_size(&version_dir),
            });
        }
        result.extend(bundled_installations());
        result.sort_by(|left, right| left.manifest.id.cmp(&right.manifest.id));
        Ok(result)
    }

    pub fn get_installed(
        &self,
        extension_id: &str,
    ) -> Result<Option<ExtensionInstallation>, String> {
        validate_extension_id(extension_id)?;
        Ok(self
            .list_installed()?
            .into_iter()
            .find(|item| item.manifest.id == extension_id))
    }

    pub fn install_package(&self, package: &[u8]) -> Result<ExtensionInstallation, String> {
        let validated = self.validate_package(package)?;
        self.install_validated_package(validated)
    }

    pub fn install_catalog_package(
        &self,
        package: &[u8],
        catalog_entry: &CatalogExtension,
    ) -> Result<ExtensionInstallation, String> {
        if catalog_entry.revoked {
            return Err(catalog_entry
                .revocation_reason
                .clone()
                .unwrap_or_else(|| "This extension version has been revoked".into()));
        }
        let validated = self.validate_package(package)?;
        if validated.package_digest != catalog_entry.sha256.to_ascii_lowercase() {
            return Err("Extension package does not match the catalog SHA-256".into());
        }
        if serde_json::to_value(&validated.manifest).map_err(|e| e.to_string())?
            != serde_json::to_value(&catalog_entry.manifest).map_err(|e| e.to_string())?
        {
            return Err("Extension package manifest does not match the catalog entry".into());
        }
        let signature: SignatureEnvelope = serde_json::from_slice(
            validated
                .files
                .get("META-INF/signature.ed25519")
                .ok_or_else(|| "Extension package is missing its signature".to_string())?,
        )
        .map_err(|e| format!("Invalid extension signature envelope: {e}"))?;
        if signature.key_id != catalog_entry.key_id
            || !signature
                .signature
                .eq_ignore_ascii_case(&catalog_entry.signature)
        {
            return Err("Extension package signature does not match the catalog entry".into());
        }
        self.install_validated_package(validated)
    }

    fn install_validated_package(
        &self,
        validated: ValidatedPackage,
    ) -> Result<ExtensionInstallation, String> {
        let id = validated.manifest.id.clone();
        if bundled_installations()
            .iter()
            .any(|item| item.manifest.id == id)
        {
            return Err("A bundled extension already uses this extension id".into());
        }
        let version = validated.manifest.version.clone();
        if let Some(existing) = self.get_installed(&id)? {
            if existing.manifest.version == version {
                if existing.package_digest == validated.package_digest {
                    return Ok(existing);
                }
                return Err("Extension versions are immutable; publish a new version for changed package contents".into());
            }
        }
        let destination = self.package_dir(&id, &version)?;
        let staging_root = self.root.join("staging");
        fs::create_dir_all(&staging_root)
            .map_err(|e| format!("Failed to create extension staging directory: {e}"))?;
        let staging = staging_root.join(random_hex(16));
        fs::create_dir(&staging).map_err(|e| format!("Failed to create staging directory: {e}"))?;

        let write_result = (|| {
            for (relative, contents) in &validated.files {
                let target = safe_join(&staging, relative)?;
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create extension directory: {e}"))?;
                }
                fs::write(&target, contents)
                    .map_err(|e| format!("Failed to write extension file {relative}: {e}"))?;
            }
            if destination.exists() {
                fs::remove_dir_all(&destination).map_err(|e| {
                    format!("Failed to remove an orphaned extension directory: {e}")
                })?;
            }
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create extension package directory: {e}"))?;
            }
            fs::rename(&staging, &destination)
                .map_err(|e| format!("Failed to activate extension package: {e}"))?;
            Ok::<(), String>(())
        })();
        if let Err(error) = write_result {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        if staging.exists() {
            let _ = fs::remove_dir_all(&staging);
        }

        let now = unix_now();
        let db = self
            .settings
            .db
            .lock()
            .map_err(|_| "Extension database lock poisoned")?;
        let previous = db
            .query_row(
                "SELECT installed_version FROM extension_installations WHERE extension_id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to inspect prior extension version: {e}"))?;
        let epoch = db
            .query_row(
                "SELECT install_epoch FROM extension_installations WHERE extension_id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to inspect extension epoch: {e}"))?
            .unwrap_or_else(|| random_hex(16));
        let previous_for_row = previous.filter(|existing| existing != &version);

        db.execute(
            "INSERT INTO extension_installations \
             (extension_id, installed_version, package_digest, install_epoch, state, installed_at, previous_version, last_error) \
             VALUES (?1, ?2, ?3, ?4, 'installed', ?5, ?6, NULL) \
             ON CONFLICT(extension_id) DO UPDATE SET installed_version = excluded.installed_version, \
             package_digest = excluded.package_digest, state = 'installed', installed_at = excluded.installed_at, \
             previous_version = excluded.previous_version, last_error = NULL",
            params![
                id,
                version,
                validated.package_digest,
                epoch,
                now,
                previous_for_row
            ],
        )
        .map_err(|e| format!("Failed to record extension installation: {e}"))?;
        db.execute(
            "INSERT INTO extension_package_versions (extension_id, version, package_digest, installed_at) \
             VALUES (?1, ?2, ?3, ?4) ON CONFLICT(extension_id, version) DO UPDATE SET \
             package_digest = excluded.package_digest, installed_at = excluded.installed_at",
            params![id, version, validated.package_digest, now],
        )
        .map_err(|e| format!("Failed to record extension package version: {e}"))?;
        drop(db);

        tracing::info!(extension_id = %validated.manifest.id, version = %validated.manifest.version, "Extension installed");
        Ok(ExtensionInstallation {
            manifest: validated.manifest,
            package_digest: validated.package_digest,
            install_epoch: epoch,
            state: "installed".into(),
            installed_at: now,
            previous_version: previous_for_row,
            last_error: None,
            disk_bytes: validated.expanded_bytes,
        })
    }

    pub fn rollback(&self, extension_id: &str) -> Result<ExtensionInstallation, String> {
        validate_extension_id(extension_id)?;
        if bundled_installations()
            .iter()
            .any(|item| item.manifest.id == extension_id)
        {
            return Err("Bundled extensions are updated with the client and cannot be rolled back separately".into());
        }
        let db = self
            .settings
            .db
            .lock()
            .map_err(|_| "Extension database lock poisoned")?;
        let (current, previous): (String, Option<String>) = db
            .query_row(
                "SELECT installed_version, previous_version FROM extension_installations WHERE extension_id = ?1",
                params![extension_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| format!("Extension is not installed: {e}"))?;
        let previous =
            previous.ok_or_else(|| "No previous extension version is available".to_string())?;
        let previous_dir = self.package_dir(extension_id, &previous)?;
        self.validate_installed_dir(&previous_dir)?;
        let previous_digest: String = db
            .query_row(
                "SELECT package_digest FROM extension_package_versions WHERE extension_id = ?1 AND version = ?2",
                params![extension_id, previous],
                |row| row.get(0),
            )
            .map_err(|e| format!("Previous extension package metadata is missing: {e}"))?;
        db.execute(
            "UPDATE extension_installations SET installed_version = ?2, previous_version = ?3, package_digest = ?4, state = 'installed', last_error = NULL WHERE extension_id = ?1",
            params![extension_id, previous, current, previous_digest],
        )
        .map_err(|e| format!("Failed to record extension rollback: {e}"))?;
        drop(db);
        tracing::info!(extension_id, "Extension rolled back");
        self.get_installed(extension_id)?
            .ok_or_else(|| "Rolled back extension disappeared".into())
    }

    pub fn uninstall(&self, extension_id: &str) -> Result<(), String> {
        validate_extension_id(extension_id)?;
        if bundled_installations()
            .iter()
            .any(|item| item.manifest.id == extension_id)
        {
            return Err("Bundled extensions cannot be uninstalled".into());
        }
        let extension_root = self.root.join("packages").join(extension_id);
        ensure_within(&extension_root, &self.root.join("packages"))?;
        if extension_root.exists() {
            fs::remove_dir_all(&extension_root)
                .map_err(|e| format!("Failed to remove extension files: {e}"))?;
        }
        let db = self
            .settings
            .db
            .lock()
            .map_err(|_| "Extension database lock poisoned")?;
        db.execute(
            "DELETE FROM extension_installations WHERE extension_id = ?1",
            params![extension_id],
        )
        .map_err(|e| format!("Failed to remove extension installation record: {e}"))?;
        db.execute(
            "DELETE FROM extension_package_versions WHERE extension_id = ?1",
            params![extension_id],
        )
        .map_err(|e| format!("Failed to remove extension version records: {e}"))?;
        tracing::info!(extension_id, "Extension uninstalled");
        Ok(())
    }

    pub fn read_page(&self, extension_id: &str, page: &str) -> Result<serde_json::Value, String> {
        validate_entry_id(page)?;
        if extension_id == "org.cfms.bundled.file-stats" && page == "overview" {
            return Ok(serde_json::json!({
                "schema_version": 1,
                "title": "File statistics",
                "description": "A bundled optional module demonstrating the same account-scoped extension lifecycle.",
                "blocks": [
                    { "type": "status_card", "title": "Module source", "value": "Bundled", "description": "Updated together with CFMS Client", "tone": "success" },
                    { "type": "status_card", "title": "Host API", "value": HOST_API_VERSION, "description": "Uses the same permission broker as installed extensions" },
                    { "type": "text", "style": "body", "text": "This optional module is compiled into the client but remains disabled until the current account grants its requested capability." },
                    { "type": "actions", "actions": [{ "id": "account", "label": "Check account context", "workflow": "account-check", "tone": "primary" }] }
                ]
            }));
        }
        let installation = self
            .get_installed(extension_id)?
            .ok_or_else(|| "Extension is not installed".to_string())?;
        let path = self
            .package_dir(extension_id, &installation.manifest.version)?
            .join("pages")
            .join(format!("{page}.json"));
        let bytes = fs::read(&path).map_err(|e| format!("Failed to read extension page: {e}"))?;
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid extension page: {e}"))
    }

    pub fn read_workflow(
        &self,
        extension_id: &str,
        workflow: &str,
    ) -> Result<serde_json::Value, String> {
        validate_entry_id(workflow)?;
        if extension_id == "org.cfms.bundled.file-stats" && workflow == "account-check" {
            return Ok(serde_json::json!({
                "schema_version": 1,
                "start": "account",
                "nodes": [
                    { "id": "account", "type": "host_call", "capability": "account.summary.read", "arguments": {}, "result": "account", "next": "message" },
                    { "id": "message", "type": "transform", "expression": { "op": "concat", "args": ["Signed in as ", "$results.account.username"] }, "result": "message", "next": "notify" },
                    { "id": "notify", "type": "notify", "tone": "success", "message": "$results.message", "next": "done" },
                    { "id": "done", "type": "result", "value": "$results.account" }
                ]
            }));
        }
        let installation = self
            .get_installed(extension_id)?
            .ok_or_else(|| "Extension is not installed".to_string())?;
        let path = self
            .package_dir(extension_id, &installation.manifest.version)?
            .join("workflows")
            .join(format!("{workflow}.json"));
        let bytes =
            fs::read(&path).map_err(|e| format!("Failed to read extension workflow: {e}"))?;
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid extension workflow: {e}"))
    }

    pub fn verify_catalog(
        &self,
        catalog_bytes: &[u8],
        signature_envelope: &str,
    ) -> Result<CatalogDocument, String> {
        let signature: SignatureEnvelope = serde_json::from_str(signature_envelope)
            .map_err(|e| format!("Invalid catalog signature envelope: {e}"))?;
        self.verify_signature(&signature.key_id, &signature.signature, catalog_bytes)?;
        let catalog: CatalogDocument = serde_json::from_slice(catalog_bytes)
            .map_err(|e| format!("Invalid extension catalog: {e}"))?;
        if catalog.schema_version != 1 {
            return Err(format!(
                "Unsupported extension catalog schema {}",
                catalog.schema_version
            ));
        }
        for entry in &catalog.extensions {
            self.validate_manifest(&entry.manifest)?;
            if !entry.download_url.starts_with("https://") {
                return Err(format!(
                    "Extension {} uses a non-HTTPS URL",
                    entry.manifest.id
                ));
            }
            validate_sha256(&entry.sha256)?;
            validate_hex(&entry.signature, 64, "catalog package signature")?;
            if !self.trusted_keys.contains_key(&entry.key_id) {
                return Err(format!("Unknown catalog package key {}", entry.key_id));
            }
        }
        Ok(catalog)
    }

    pub fn cache_catalog(
        &self,
        catalog_url: &str,
        etag: Option<&str>,
        catalog: &str,
        signature: &str,
    ) -> Result<(), String> {
        let db = self
            .settings
            .db
            .lock()
            .map_err(|_| "Extension database lock poisoned")?;
        db.execute(
            "INSERT INTO extension_catalog_state (catalog_url, etag, last_success_at, signed_catalog, signature) \
             VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(catalog_url) DO UPDATE SET \
             etag = excluded.etag, last_success_at = excluded.last_success_at, \
             signed_catalog = excluded.signed_catalog, signature = excluded.signature",
            params![catalog_url, etag, unix_now(), catalog, signature],
        )
        .map_err(|e| format!("Failed to cache extension catalog: {e}"))?;
        Ok(())
    }

    pub fn cached_catalog(&self, catalog_url: &str) -> Result<Option<CatalogDocument>, String> {
        let db = self
            .settings
            .db
            .lock()
            .map_err(|_| "Extension database lock poisoned")?;
        let row = db
            .query_row(
                "SELECT signed_catalog, signature FROM extension_catalog_state WHERE catalog_url = ?1",
                params![catalog_url],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|e| format!("Failed to read cached extension catalog: {e}"))?;
        drop(db);
        row.map(|(catalog, signature)| self.verify_catalog(catalog.as_bytes(), &signature))
            .transpose()
    }

    pub fn revocation_reason(
        &self,
        extension_id: &str,
        version: &str,
    ) -> Result<Option<String>, String> {
        let Some(catalog) = self.cached_catalog(DEFAULT_CATALOG_URL)? else {
            return Ok(None);
        };
        Ok(catalog
            .extensions
            .into_iter()
            .find(|entry| {
                entry.manifest.id == extension_id
                    && entry.manifest.version == version
                    && entry.revoked
            })
            .map(|entry| {
                entry
                    .revocation_reason
                    .unwrap_or_else(|| "This extension version has been revoked".into())
            }))
    }

    fn validate_package(&self, package: &[u8]) -> Result<ValidatedPackage, String> {
        if package.is_empty() || package.len() > MAX_PACKAGE_BYTES {
            return Err(format!(
                "Extension package must be between 1 byte and {MAX_PACKAGE_BYTES} bytes"
            ));
        }
        let package_digest = hex::encode(Sha256::digest(package));
        let mut archive = zip::ZipArchive::new(Cursor::new(package))
            .map_err(|e| format!("Invalid extension ZIP package: {e}"))?;
        if archive.len() > MAX_FILES {
            return Err(format!(
                "Extension package contains more than {MAX_FILES} files"
            ));
        }

        let mut files = BTreeMap::new();
        let mut expanded_bytes = 0_u64;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|e| format!("Failed to inspect extension ZIP entry: {e}"))?;
            if entry.is_dir() {
                continue;
            }
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("Extension packages cannot contain symbolic links".into());
            }
            let enclosed = entry
                .enclosed_name()
                .ok_or_else(|| "Extension package contains an unsafe path".to_string())?;
            let relative = normalized_relative_path(&enclosed)?;
            validate_package_path(&relative)?;
            let max_for_file = if relative.ends_with(".json") {
                MAX_JSON_BYTES
            } else {
                MAX_FILE_BYTES
            };
            if entry.size() > max_for_file {
                return Err(format!("Extension file {relative} exceeds its size limit"));
            }
            expanded_bytes = expanded_bytes
                .checked_add(entry.size())
                .ok_or_else(|| "Extension expanded size overflow".to_string())?;
            if expanded_bytes > MAX_EXPANDED_BYTES {
                return Err(format!(
                    "Extension package expands beyond {MAX_EXPANDED_BYTES} bytes"
                ));
            }
            if files.contains_key(&relative) {
                return Err(format!(
                    "Extension package contains duplicate path {relative}"
                ));
            }
            let mut contents = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut contents)
                .map_err(|e| format!("Failed to read extension file {relative}: {e}"))?;
            files.insert(relative, contents);
        }

        let index_bytes = files
            .get("META-INF/files.json")
            .ok_or_else(|| "Extension package is missing META-INF/files.json".to_string())?;
        let signature_bytes = files
            .get("META-INF/signature.ed25519")
            .ok_or_else(|| "Extension package is missing META-INF/signature.ed25519".to_string())?;
        let signature: SignatureEnvelope = serde_json::from_slice(signature_bytes)
            .map_err(|e| format!("Invalid extension signature envelope: {e}"))?;
        self.verify_signature(&signature.key_id, &signature.signature, index_bytes)?;
        let file_index: FileIndex = serde_json::from_slice(index_bytes)
            .map_err(|e| format!("Invalid extension file index: {e}"))?;
        validate_file_index(&files, &file_index)?;

        let manifest_bytes = files
            .get("manifest.json")
            .ok_or_else(|| "Extension package is missing manifest.json".to_string())?;
        let manifest: ExtensionManifest = serde_json::from_slice(manifest_bytes)
            .map_err(|e| format!("Invalid extension manifest: {e}"))?;
        self.validate_manifest(&manifest)?;
        validate_declarative_documents(&files, &manifest)?;

        Ok(ValidatedPackage {
            manifest,
            files,
            package_digest,
            expanded_bytes,
        })
    }

    fn validate_installed_dir(&self, version_dir: &Path) -> Result<ExtensionManifest, String> {
        let index_bytes = fs::read(version_dir.join("META-INF/files.json"))
            .map_err(|e| format!("Installed extension is missing its file index: {e}"))?;
        let signature_bytes = fs::read(version_dir.join("META-INF/signature.ed25519"))
            .map_err(|e| format!("Installed extension is missing its signature: {e}"))?;
        let signature: SignatureEnvelope = serde_json::from_slice(&signature_bytes)
            .map_err(|e| format!("Invalid installed extension signature: {e}"))?;
        self.verify_signature(&signature.key_id, &signature.signature, &index_bytes)?;
        let index: FileIndex = serde_json::from_slice(&index_bytes)
            .map_err(|e| format!("Invalid installed extension file index: {e}"))?;
        if index.files.len() > MAX_FILES {
            return Err("Installed extension file index exceeds the file limit".into());
        }
        let mut indexed_paths = BTreeSet::new();
        for entry in &index.files {
            validate_package_path(&entry.path)?;
            if !indexed_paths.insert(entry.path.as_str()) {
                return Err("Installed extension file index contains duplicates".into());
            }
            let path = safe_join(version_dir, &entry.path)?;
            let metadata = fs::symlink_metadata(&path)
                .map_err(|e| format!("Installed extension file {} is missing: {e}", entry.path))?;
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() != entry.size
            {
                return Err(format!(
                    "Installed extension file {} has invalid metadata",
                    entry.path
                ));
            }
            let bytes = fs::read(&path).map_err(|e| {
                format!(
                    "Failed to verify installed extension file {}: {e}",
                    entry.path
                )
            })?;
            if hex::encode(Sha256::digest(&bytes)) != entry.sha256.to_ascii_lowercase() {
                return Err(format!(
                    "Installed extension file {} failed integrity verification",
                    entry.path
                ));
            }
        }
        let manifest = read_manifest(version_dir)?;
        self.validate_manifest(&manifest)?;
        Ok(manifest)
    }

    fn validate_manifest(&self, manifest: &ExtensionManifest) -> Result<(), String> {
        if manifest.schema_version != 1 {
            return Err(format!(
                "Unsupported extension manifest schema {}",
                manifest.schema_version
            ));
        }
        validate_extension_id(&manifest.id)?;
        if manifest.name.trim().is_empty() || manifest.publisher.trim().is_empty() {
            return Err("Extension name and publisher are required".into());
        }
        Version::parse(&manifest.version).map_err(|e| format!("Invalid extension version: {e}"))?;
        let minimum = Version::parse(&manifest.min_client_version)
            .map_err(|e| format!("Invalid minimum client version: {e}"))?;
        if self.client_version < minimum {
            return Err(format!(
                "Extension requires client version {minimum} or newer"
            ));
        }
        if !manifest.host_api.starts_with('1') {
            return Err(format!(
                "Extension requires unsupported host API {}",
                manifest.host_api
            ));
        }
        let current_platform = current_platform();
        if !manifest.platforms.is_empty()
            && !manifest.platforms.iter().any(|p| p == current_platform)
        {
            return Err(format!("Extension does not support {current_platform}"));
        }
        let mut capabilities = BTreeSet::new();
        for capability in &manifest.requested_capabilities {
            if !ALLOWED_CAPABILITIES.contains(&capability.as_str()) {
                return Err(format!("Unsupported extension capability {capability}"));
            }
            if !capabilities.insert(capability) {
                return Err(format!("Duplicate extension capability {capability}"));
            }
        }
        for trigger in &manifest.background_triggers {
            match trigger {
                BackgroundTrigger::Interval { minutes, .. } if *minutes < 15 => {
                    return Err("Extension interval triggers must be at least 15 minutes".into());
                }
                BackgroundTrigger::Event { event, .. }
                    if !matches!(event.as_str(), "connection.changed" | "tasks.changed") =>
                {
                    return Err(format!("Unsupported extension event trigger {event}"));
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn verify_signature(
        &self,
        key_id: &str,
        signature_hex: &str,
        bytes: &[u8],
    ) -> Result<(), String> {
        let key = self
            .trusted_keys
            .get(key_id)
            .ok_or_else(|| format!("Unknown extension signing key {key_id}"))?;
        let signature_bytes = decode_fixed_hex::<64>(signature_hex, "Ed25519 signature")?;
        key.verify(bytes, &Signature::from_bytes(&signature_bytes))
            .map_err(|_| "Extension signature verification failed".to_string())
    }

    fn package_dir(&self, extension_id: &str, version: &str) -> Result<PathBuf, String> {
        validate_extension_id(extension_id)?;
        Version::parse(version).map_err(|e| format!("Invalid extension version path: {e}"))?;
        let base = self.root.join("packages");
        let path = base.join(extension_id).join(version);
        ensure_within(&path, &base)?;
        Ok(path)
    }
}

fn bundled_installations() -> Vec<ExtensionInstallation> {
    vec![ExtensionInstallation {
        manifest: ExtensionManifest {
            schema_version: 1,
            id: "org.cfms.bundled.file-stats".into(),
            name: "File statistics".into(),
            description: "Optional read-only file statistics and account context tools.".into(),
            publisher: "CFMS".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            host_api: "1.x".into(),
            min_client_version: env!("CARGO_PKG_VERSION").into(),
            platforms: vec![current_platform().into()],
            entrypoints: ExtensionEntrypoints {
                navigation: vec![ExtensionNavigationEntry {
                    id: "overview".into(),
                    label: "File statistics".into(),
                    icon: "extensions".into(),
                    page: "overview".into(),
                }],
                settings: Vec::new(),
                workflows: vec![ExtensionWorkflowEntry {
                    id: "account-check".into(),
                    label: "Check account context".into(),
                    workflow: "account-check".into(),
                }],
            },
            requested_capabilities: vec!["account.summary.read".into()],
            background_triggers: Vec::new(),
            content_hashes: BTreeMap::new(),
        },
        package_digest: "bundled".into(),
        install_epoch: format!("bundled:{}", env!("CARGO_PKG_VERSION")),
        state: "bundled".into(),
        installed_at: 0,
        previous_version: None,
        last_error: None,
        disk_bytes: 0,
    }]
}

fn compiled_trusted_keys() -> BTreeMap<String, VerifyingKey> {
    let mut keys = BTreeMap::new();
    if let Some(raw) = option_env!("CFMS_EXTENSION_TRUSTED_KEYS") {
        for entry in raw.split(',').filter(|entry| !entry.trim().is_empty()) {
            let Some((id, hex_key)) = entry.split_once(':') else {
                continue;
            };
            if let Ok(bytes) = decode_fixed_hex::<32>(hex_key.trim(), "Ed25519 public key") {
                if let Ok(key) = VerifyingKey::from_bytes(&bytes) {
                    keys.insert(id.trim().to_string(), key);
                }
            }
        }
    }
    keys
}

fn validate_file_index(files: &BTreeMap<String, Vec<u8>>, index: &FileIndex) -> Result<(), String> {
    let indexed_paths = index
        .files
        .iter()
        .map(|entry| entry.path.as_str())
        .collect::<BTreeSet<_>>();
    if indexed_paths.len() != index.files.len() {
        return Err("Extension file index contains duplicate paths".into());
    }
    let actual_paths = files
        .keys()
        .filter(|path| !path.starts_with("META-INF/"))
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if indexed_paths != actual_paths {
        return Err("Extension file index does not exactly match package contents".into());
    }
    for entry in &index.files {
        validate_package_path(&entry.path)?;
        validate_sha256(&entry.sha256)?;
        let contents = files
            .get(&entry.path)
            .ok_or_else(|| format!("Indexed extension file {} is missing", entry.path))?;
        if contents.len() as u64 != entry.size {
            return Err(format!(
                "Extension file {} has an unexpected size",
                entry.path
            ));
        }
        let actual = hex::encode(Sha256::digest(contents));
        if actual != entry.sha256.to_ascii_lowercase() {
            return Err(format!(
                "Extension file {} failed SHA-256 verification",
                entry.path
            ));
        }
    }
    Ok(())
}

fn validate_declarative_documents(
    files: &BTreeMap<String, Vec<u8>>,
    manifest: &ExtensionManifest,
) -> Result<(), String> {
    for entry in &manifest.entrypoints.navigation {
        validate_entry_id(&entry.id)?;
        validate_entry_id(&entry.page)?;
        ensure_json_object(files, &format!("pages/{}.json", entry.page))?;
    }
    for entry in &manifest.entrypoints.settings {
        validate_entry_id(&entry.id)?;
        validate_entry_id(&entry.page)?;
        ensure_json_object(files, &format!("pages/{}.json", entry.page))?;
    }
    for entry in &manifest.entrypoints.workflows {
        validate_entry_id(&entry.id)?;
        validate_entry_id(&entry.workflow)?;
        ensure_json_object(files, &format!("workflows/{}.json", entry.workflow))?;
    }
    for trigger in &manifest.background_triggers {
        let workflow = match trigger {
            BackgroundTrigger::OnEnable { workflow }
            | BackgroundTrigger::OnLogin { workflow }
            | BackgroundTrigger::Interval { workflow, .. }
            | BackgroundTrigger::Event { workflow, .. } => workflow,
        };
        validate_entry_id(workflow)?;
        ensure_json_object(files, &format!("workflows/{workflow}.json"))?;
    }
    Ok(())
}

fn ensure_json_object(files: &BTreeMap<String, Vec<u8>>, path: &str) -> Result<(), String> {
    let bytes = files
        .get(path)
        .ok_or_else(|| format!("Extension entrypoint {path} is missing"))?;
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|e| format!("Invalid declarative document {path}: {e}"))?;
    if !value.is_object() {
        return Err(format!("Declarative document {path} must be an object"));
    }
    Ok(())
}

fn validate_package_path(path: &str) -> Result<(), String> {
    let allowed = path == "manifest.json"
        || path == "META-INF/files.json"
        || path == "META-INF/signature.ed25519"
        || (path.starts_with("pages/") && path.ends_with(".json"))
        || (path.starts_with("workflows/") && path.ends_with(".json"))
        || (path.starts_with("i18n/") && path.ends_with(".json"))
        || (path.starts_with("assets/")
            && matches!(
                Path::new(path)
                    .extension()
                    .and_then(|v| v.to_str())
                    .map(str::to_ascii_lowercase)
                    .as_deref(),
                Some("png" | "jpg" | "jpeg" | "webp" | "gif" | "ico")
            ));
    if !allowed {
        return Err(format!("Extension package contains forbidden file {path}"));
    }
    Ok(())
}

fn validate_extension_id(value: &str) -> Result<(), String> {
    if value.len() < 3 || value.len() > 128 || !value.contains('.') {
        return Err("Extension id must be a reverse-domain identifier".into());
    }
    if !value.split('.').all(|part| {
        !part.is_empty()
            && part.len() <= 63
            && part
                .chars()
                .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
            && !part.starts_with('-')
            && !part.ends_with('-')
    }) {
        return Err("Extension id contains invalid characters".into());
    }
    Ok(())
}

fn validate_entry_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '_')
    {
        return Err(format!("Invalid extension entrypoint id {value}"));
    }
    Ok(())
}

fn normalized_relative_path(path: &Path) -> Result<String, String> {
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Extension package path must be relative and normalized".into());
    }
    Ok(path
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

fn safe_join(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    let normalized = normalized_relative_path(relative_path)?;
    let target = base.join(normalized.replace('/', std::path::MAIN_SEPARATOR_STR));
    ensure_within(&target, base)?;
    Ok(target)
}

fn ensure_within(path: &Path, base: &Path) -> Result<(), String> {
    let path = absolute_lexical(path)?;
    let base = absolute_lexical(base)?;
    if !path.starts_with(&base) || path == base {
        return Err("Extension path escaped its storage root".into());
    }
    Ok(())
}

fn absolute_lexical(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("Failed to resolve current directory: {e}"))?
            .join(path)
    };
    let mut result = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                result.push(component.as_os_str())
            }
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
        }
    }
    Ok(result)
}

fn read_manifest(version_dir: &Path) -> Result<ExtensionManifest, String> {
    let bytes = fs::read(version_dir.join("manifest.json"))
        .map_err(|e| format!("Failed to read installed extension manifest: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Invalid installed extension manifest: {e}"))
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            entry.metadata().ok().map_or(0, |metadata| {
                if metadata.is_dir() {
                    directory_size(&entry.path())
                } else {
                    metadata.len()
                }
            })
        })
        .sum()
}

fn validate_sha256(value: &str) -> Result<(), String> {
    validate_hex(value, 32, "SHA-256")
}

fn validate_hex(value: &str, byte_length: usize, label: &str) -> Result<(), String> {
    if value.len() != byte_length * 2 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("Invalid {label}"));
    }
    Ok(())
}

fn decode_fixed_hex<const N: usize>(value: &str, label: &str) -> Result<[u8; N], String> {
    validate_hex(value, N, label)?;
    let decoded = hex::decode(value).map_err(|_| format!("Invalid {label}"))?;
    decoded
        .try_into()
        .map_err(|_| format!("Invalid {label} length"))
}

fn random_hex(bytes: usize) -> String {
    let mut random = vec![0_u8; bytes];
    rand::rng().fill(&mut random[..]);
    hex::encode(random)
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn current_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(target_os = "android")]
    {
        "android"
    }
    #[cfg(target_os = "ios")]
    {
        "ios"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use rusqlite::Connection;
    use std::io::Write;

    fn store(temp: &tempfile::TempDir, signing: &SigningKey) -> ExtensionStore {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(crate::db::schema::SCHEMA_V1).unwrap();
        db.execute_batch(crate::db::schema::SCHEMA_V2).unwrap();
        ExtensionStore::with_key(
            SettingsStore::new(db),
            temp.path(),
            "1.0.0",
            "test",
            signing.verifying_key(),
        )
    }

    fn package(signing: &SigningKey, traversal: bool) -> Vec<u8> {
        package_version(signing, traversal, "1.0.0")
    }

    fn package_version(signing: &SigningKey, traversal: bool, version: &str) -> Vec<u8> {
        let manifest = serde_json::json!({
            "schema_version": 1,
            "id": "org.cfms.file-stats",
            "name": "File statistics",
            "description": "Read-only statistics",
            "publisher": "CFMS",
            "version": version,
            "host_api": "1.x",
            "min_client_version": "0.1.0",
            "platforms": [current_platform()],
            "entrypoints": { "navigation": [{ "id": "stats", "label": "Statistics", "icon": "analytics", "page": "stats" }] },
            "requested_capabilities": ["account.summary.read"],
            "background_triggers": [],
            "content_hashes": {}
        }).to_string().into_bytes();
        let page = br#"{"schema_version":1,"title":"Statistics","blocks":[]}"#.to_vec();
        let indexed = [("manifest.json", &manifest), ("pages/stats.json", &page)];
        let index =
            serde_json::json!({ "files": indexed.iter().map(|(path, bytes)| serde_json::json!({
            "path": path,
            "sha256": hex::encode(Sha256::digest(bytes)),
            "size": bytes.len()
        })).collect::<Vec<_>>() })
            .to_string()
            .into_bytes();
        let signature = signing.sign(&index);
        let envelope =
            serde_json::json!({ "key_id": "test", "signature": hex::encode(signature.to_bytes()) })
                .to_string()
                .into_bytes();

        let mut output = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut output);
            let options = zip::write::SimpleFileOptions::default();
            for (path, bytes) in indexed {
                zip.start_file(path, options).unwrap();
                zip.write_all(bytes).unwrap();
            }
            zip.start_file("META-INF/files.json", options).unwrap();
            zip.write_all(&index).unwrap();
            zip.start_file("META-INF/signature.ed25519", options)
                .unwrap();
            zip.write_all(&envelope).unwrap();
            if traversal {
                zip.start_file("../evil.json", options).unwrap();
                zip.write_all(b"{}").unwrap();
            }
            zip.finish().unwrap();
        }
        output.into_inner()
    }

    #[test]
    fn signed_package_installs_and_lists() {
        let temp = tempfile::tempdir().unwrap();
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let store = store(&temp, &signing);
        let installed = store.install_package(&package(&signing, false)).unwrap();
        assert_eq!(installed.manifest.id, "org.cfms.file-stats");
        assert!(
            store
                .list_installed()
                .unwrap()
                .iter()
                .any(|item| item.manifest.id == "org.cfms.file-stats")
        );
        assert!(
            store
                .read_page("org.cfms.file-stats", "stats")
                .unwrap()
                .is_object()
        );
    }

    #[test]
    fn catalog_install_requires_exact_manifest_and_signature_match() {
        let temp = tempfile::tempdir().unwrap();
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let store = store(&temp, &signing);
        let package = package(&signing, false);
        let validated = store.validate_package(&package).unwrap();
        let signature: SignatureEnvelope =
            serde_json::from_slice(validated.files.get("META-INF/signature.ed25519").unwrap())
                .unwrap();
        let mut entry = CatalogExtension {
            manifest: validated.manifest.clone(),
            download_url: "https://example.invalid/file-stats.cfmsext".into(),
            sha256: validated.package_digest.clone(),
            signature: signature.signature,
            key_id: signature.key_id,
            revoked: false,
            revocation_reason: None,
        };

        entry.manifest.name = "A mismatched catalog name".into();
        assert!(store.install_catalog_package(&package, &entry).is_err());
        assert!(
            store
                .get_installed("org.cfms.file-stats")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn wrong_signature_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let trusted = SigningKey::from_bytes(&[7_u8; 32]);
        let untrusted = SigningKey::from_bytes(&[8_u8; 32]);
        let store = store(&temp, &trusted);
        assert!(store.install_package(&package(&untrusted, false)).is_err());
    }

    #[test]
    fn traversal_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let store = store(&temp, &signing);
        assert!(store.install_package(&package(&signing, true)).is_err());
        assert!(!temp.path().join("evil.json").exists());
    }

    #[test]
    fn installed_file_tampering_is_detected() {
        let temp = tempfile::tempdir().unwrap();
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let store = store(&temp, &signing);
        store.install_package(&package(&signing, false)).unwrap();
        fs::write(
            temp.path()
                .join("extensions/packages/org.cfms.file-stats/1.0.0/pages/stats.json"),
            b"{}",
        )
        .unwrap();
        assert!(store.list_installed().is_err());
    }

    #[test]
    fn rollback_restores_previous_version_and_digest() {
        let temp = tempfile::tempdir().unwrap();
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let store = store(&temp, &signing);
        let version_one = package_version(&signing, false, "1.0.0");
        let version_one_digest = hex::encode(Sha256::digest(&version_one));
        store.install_package(&version_one).unwrap();
        store
            .install_package(&package_version(&signing, false, "1.1.0"))
            .unwrap();

        let rolled_back = store.rollback("org.cfms.file-stats").unwrap();
        assert_eq!(rolled_back.manifest.version, "1.0.0");
        assert_eq!(rolled_back.package_digest, version_one_digest);
    }
}
