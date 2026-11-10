//! Transfer queues, discovery, path policies and retry rules shared by native adapters.

pub mod download_queue;
pub mod retry;
pub mod task_persistence;
pub mod upload_queue;
pub mod upload_task_persistence;

pub const MAX_UPLOAD_RETRIES: u32 = crate::transfers::retry::MAX_BACKGROUND_RETRIES as u32;

pub fn relative_upload_path(path: &std::path::Path) -> String {
    path.components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

pub fn suffixed_upload_name(name: &str, suffix: usize) -> String {
    let path = std::path::Path::new(name);
    let extension = path.extension().and_then(|value| value.to_str());
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(name);
    match extension {
        Some(extension) if !stem.is_empty() => format!("{stem} ({suffix}).{extension}"),
        _ => format!("{name} ({suffix})"),
    }
}

pub fn upload_retry_delay(error: &cfms_core::Error, attempt: u32) -> Option<std::time::Duration> {
    if attempt >= MAX_UPLOAD_RETRIES {
        return None;
    }

    if !crate::transfers::retry::is_transient_error(error) {
        return None;
    }
    Some(crate::transfers::retry::retry_delay(
        attempt as usize + 1,
        crate::transfers::retry::error_retry_after_seconds(error),
    ))
}

pub fn collect_directory_entries(
    root: &std::path::Path,
) -> Result<Vec<std::path::PathBuf>, String> {
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
pub mod download_batches;

pub mod download_task;
