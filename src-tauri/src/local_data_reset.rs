//! Device-local data reset coordination.
//!
//! A reset is scheduled while the application is running and completed on
//! the next launch, before the persistent database and file logger are opened.
//! The marker intentionally stores no filesystem paths: every cleanup target
//! is resolved again through Tauri's path resolver.

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime};

const RESET_MARKER_VERSION: u8 = 1;
const RESET_MARKER_NAME: &str = ".cfms-local-data-reset.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalDataResetFailure {
    pub target: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct LocalDataResetStatus {
    pub pending: bool,
    pub failures: Vec<LocalDataResetFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct LocalDataResetMarker {
    version: u8,
    delete_downloads: bool,
}

pub struct LocalDataResetRuntime {
    marker_path: PathBuf,
    status: Mutex<LocalDataResetStatus>,
    pub in_progress: std::sync::atomic::AtomicBool,
}

impl LocalDataResetRuntime {
    pub fn new(marker_path: PathBuf, status: LocalDataResetStatus) -> Self {
        Self {
            marker_path,
            status: Mutex::new(status),
            in_progress: std::sync::atomic::AtomicBool::new(false),
        }
    }

    pub fn status(&self) -> LocalDataResetStatus {
        self.status.lock().unwrap().clone()
    }

    pub fn set_status(&self, status: LocalDataResetStatus) {
        *self.status.lock().unwrap() = status;
    }

    pub fn marker_path(&self) -> &Path {
        &self.marker_path
    }
}

pub fn marker_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join(RESET_MARKER_NAME))
        .map_err(|e| format!("Failed to resolve the reset marker location: {e}"))
}

pub fn schedule_reset(path: &Path, delete_downloads: bool) -> Result<(), String> {
    let marker = LocalDataResetMarker {
        version: RESET_MARKER_VERSION,
        delete_downloads,
    };
    let bytes = serde_json::to_vec(&marker)
        .map_err(|e| format!("Failed to encode the local data reset request: {e}"))?;
    atomic_write(path, &bytes)
}

pub fn cancel_scheduled_reset(path: &Path) {
    let _ = fs::remove_file(path);
}

/// Preserve a valid request for retry, but replace a corrupt/unsupported
/// marker with the safest option (keep downloaded files).
pub fn ensure_retryable_marker(path: &Path) -> Result<(), String> {
    if !path.exists() || read_marker(path).is_err() {
        schedule_reset(path, false)?;
    }
    Ok(())
}

pub fn complete_pending_reset<R: Runtime>(
    app: &tauri::AppHandle<R>,
    marker_path: &Path,
) -> LocalDataResetStatus {
    if !marker_path.exists() {
        return LocalDataResetStatus::default();
    }

    let marker = match read_marker(marker_path) {
        Ok(marker) => marker,
        Err(message) => {
            return LocalDataResetStatus {
                pending: true,
                failures: vec![LocalDataResetFailure {
                    target: "reset-marker".into(),
                    message,
                }],
            };
        }
    };

    let mut failures = Vec::new();
    let download_root = match resolve_download_root(app) {
        Ok(root) => root,
        Err(message) => {
            return LocalDataResetStatus {
                pending: true,
                failures: vec![LocalDataResetFailure {
                    target: "downloads".into(),
                    message,
                }],
            };
        }
    };
    if let Err(message) = validate_download_root(app, &download_root) {
        return LocalDataResetStatus {
            pending: true,
            failures: vec![LocalDataResetFailure {
                target: "downloads".into(),
                message,
            }],
        };
    }
    let mut protected = vec![marker_path.to_path_buf()];
    if !marker.delete_downloads {
        protected.push(download_root.clone());
    }

    match resolve_cleanup_roots(app) {
        Ok(roots) => {
            for (label, root) in roots {
                if let Err(message) = validate_cleanup_root(app, &root) {
                    failures.push(LocalDataResetFailure {
                        target: label,
                        message,
                    });
                    continue;
                }
                collect_result(
                    &mut failures,
                    &label,
                    clear_directory_contents(&root, &protected),
                );
            }
        }
        Err(message) => failures.push(LocalDataResetFailure {
            target: "application-storage".into(),
            message,
        }),
    }

    if marker.delete_downloads {
        collect_result(
            &mut failures,
            "downloads",
            clear_directory_contents(&download_root, &[marker_path.to_path_buf()]),
        );
    } else {
        collect_result(
            &mut failures,
            "download-resume-data",
            remove_download_artifacts(&download_root),
        );
    }

    if failures.is_empty() {
        if let Err(e) = fs::remove_file(marker_path)
            && e.kind() != std::io::ErrorKind::NotFound
        {
            failures.push(LocalDataResetFailure {
                target: "reset-marker".into(),
                message: format!("Failed to finalize the reset request: {e}"),
            });
        }
    }

    LocalDataResetStatus {
        pending: !failures.is_empty(),
        failures,
    }
}

fn read_marker(path: &Path) -> Result<LocalDataResetMarker, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read the reset request: {e}"))?;
    let marker: LocalDataResetMarker =
        serde_json::from_slice(&bytes).map_err(|e| format!("The reset request is invalid: {e}"))?;
    if marker.version != RESET_MARKER_VERSION {
        return Err(format!(
            "Unsupported reset request version: {}",
            marker.version
        ));
    }
    Ok(marker)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The reset marker has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create the reset marker directory: {e}"))?;
    let temporary = parent.join(format!("{RESET_MARKER_NAME}.tmp"));
    fs::write(&temporary, bytes).map_err(|e| format!("Failed to write the reset request: {e}"))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|e| format!("Failed to replace the previous reset request: {e}"))?;
    }
    fs::rename(&temporary, path).map_err(|e| format!("Failed to commit the reset request: {e}"))
}

fn resolve_cleanup_roots<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<(String, PathBuf)>, String> {
    let resolver = app.path();
    let candidates = [
        ("app-data", resolver.app_data_dir()),
        ("app-local-data", resolver.app_local_data_dir()),
        ("app-config", resolver.app_config_dir()),
        ("app-cache", resolver.app_cache_dir()),
        ("app-logs", resolver.app_log_dir()),
    ];
    let mut roots = Vec::new();
    let mut seen = HashSet::new();
    for (label, result) in candidates {
        let root = result.map_err(|e| format!("Failed to resolve {label}: {e}"))?;
        let normalized = absolute_lexical(&root)?;
        if seen.insert(normalized.clone()) {
            roots.push((label.to_string(), normalized));
        }
    }
    roots.sort_by_key(|(_, path)| path.components().count());
    Ok(roots)
}

fn resolve_download_root<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .resolve("downloads", tauri::path::BaseDirectory::Download)
        .or_else(|_| {
            app.path()
                .resolve("downloads", tauri::path::BaseDirectory::AppData)
        })
        .map_err(|e| format!("Failed to resolve the CFMS download directory: {e}"))
        .and_then(|path| absolute_lexical(&path))
}

fn validate_cleanup_root<R: Runtime>(app: &tauri::AppHandle<R>, root: &Path) -> Result<(), String> {
    validate_narrow_absolute(root)?;
    if let Ok(home) = app.path().home_dir()
        && same_lexical_path(root, &home)
    {
        return Err("Refusing to clear the user home directory".into());
    }
    if let Ok(downloads) = app.path().download_dir()
        && same_lexical_path(root, &downloads)
    {
        return Err("Refusing to clear the system download directory".into());
    }
    Ok(())
}

fn validate_download_root<R: Runtime>(
    app: &tauri::AppHandle<R>,
    root: &Path,
) -> Result<(), String> {
    validate_cleanup_root(app, root)?;
    if root.file_name().and_then(|name| name.to_str()) != Some("downloads") {
        return Err("The CFMS download root did not resolve to its dedicated directory".into());
    }
    Ok(())
}

fn validate_narrow_absolute(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Refusing to clear a relative path".into());
    }
    let count = path
        .components()
        .filter(|component| matches!(component, Component::Normal(_)))
        .count();
    if count < 2 || path.parent().is_none() {
        return Err("Refusing to clear a broad filesystem path".into());
    }
    Ok(())
}

fn clear_directory_contents(root: &Path, protected: &[PathBuf]) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    let entries =
        fs::read_dir(root).map_err(|e| format!("Failed to read {}: {e}", root.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read a directory entry: {e}"))?;
        let path = entry.path();
        let contains_protected = protected.iter().any(|item| item.starts_with(&path));
        if protected.iter().any(|item| same_lexical_path(item, &path)) {
            continue;
        }
        if contains_protected {
            clear_directory_contents(&path, protected)?;
        } else {
            remove_entry(&path)?;
        }
    }
    Ok(())
}

fn remove_entry(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to inspect {}: {e}", path.display()))?;
    let result = if metadata.file_type().is_symlink() {
        fs::remove_file(path).or_else(|_| fs::remove_dir(path))
    } else if metadata.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    result.map_err(|e| format!("Failed to remove {}: {e}", path.display()))
}

fn remove_download_artifacts(root: &Path) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    let entries =
        fs::read_dir(root).map_err(|e| format!("Failed to inspect the download directory: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to inspect a download entry: {e}"))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|e| format!("Failed to inspect {}: {e}", path.display()))?;
        let temporary_dir = metadata.is_dir() && name.starts_with(".cfms-download-");
        let resume_file = metadata.is_file()
            && name.starts_with(".cfms-download-")
            && (name.contains(".chunks.db") || name.ends_with("-wal") || name.ends_with("-shm"));
        if temporary_dir || resume_file {
            remove_entry(&path)?;
        } else if metadata.is_dir() && !metadata.file_type().is_symlink() {
            remove_download_artifacts(&path)?;
        }
    }
    Ok(())
}

fn collect_result(
    failures: &mut Vec<LocalDataResetFailure>,
    target: &str,
    result: Result<(), String>,
) {
    if let Err(message) = result {
        failures.push(LocalDataResetFailure {
            target: target.into(),
            message,
        });
    }
}

fn absolute_lexical(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("Failed to resolve the current directory: {e}"))?
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

fn same_lexical_path(left: &Path, right: &Path) -> bool {
    absolute_lexical(left).ok() == absolute_lexical(right).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_contains_options_but_no_paths() {
        let temp = tempfile::tempdir().unwrap();
        let marker_path = temp.path().join(RESET_MARKER_NAME);
        schedule_reset(&marker_path, true).unwrap();
        let raw = fs::read_to_string(&marker_path).unwrap();
        assert!(raw.contains("delete_downloads"));
        assert!(!raw.contains(temp.path().to_string_lossy().as_ref()));
        assert_eq!(read_marker(&marker_path).unwrap().delete_downloads, true);
    }

    #[test]
    fn retry_repairs_an_invalid_marker_without_enabling_download_deletion() {
        let temp = tempfile::tempdir().unwrap();
        let marker_path = temp.path().join(RESET_MARKER_NAME);
        fs::write(&marker_path, b"not-json").unwrap();

        ensure_retryable_marker(&marker_path).unwrap();

        assert!(!read_marker(&marker_path).unwrap().delete_downloads);
    }

    #[test]
    fn cleanup_preserves_nested_download_root_and_marker() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("app").join("data");
        let downloads = root.join("downloads");
        let marker = root.join(RESET_MARKER_NAME);
        fs::create_dir_all(&downloads).unwrap();
        fs::write(downloads.join("kept.txt"), b"kept").unwrap();
        fs::write(root.join("removed.txt"), b"removed").unwrap();
        fs::write(&marker, b"marker").unwrap();

        clear_directory_contents(&root, &[downloads.clone(), marker.clone()]).unwrap();

        assert!(downloads.join("kept.txt").exists());
        assert!(marker.exists());
        assert!(!root.join("removed.txt").exists());
    }

    #[test]
    fn resume_cleanup_keeps_completed_downloads() {
        let temp = tempfile::tempdir().unwrap();
        let nested = temp.path().join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("report.pdf"), b"report").unwrap();
        fs::write(nested.join(".cfms-download-id.chunks.db"), b"state").unwrap();
        fs::create_dir(nested.join(".cfms-download-temp")).unwrap();

        remove_download_artifacts(temp.path()).unwrap();

        assert!(nested.join("report.pdf").exists());
        assert!(!nested.join(".cfms-download-id.chunks.db").exists());
        assert!(!nested.join(".cfms-download-temp").exists());
    }

    #[test]
    fn broad_paths_are_rejected() {
        #[cfg(unix)]
        assert!(validate_narrow_absolute(Path::new("/")).is_err());
        assert!(validate_narrow_absolute(Path::new("relative/path")).is_err());
    }
}
