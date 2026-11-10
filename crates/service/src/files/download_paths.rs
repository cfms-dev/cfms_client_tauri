//! Download destinations are resolved here before any remote task is created.
use std::path::{Path, PathBuf};

pub fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if "\\/:*?\"<>|".contains(c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned = cleaned.trim_end_matches(['.', ' ']);
    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if cleaned.is_empty() {
        "download".into()
    } else if reserved {
        format!("_{cleaned}")
    } else {
        cleaned.into()
    }
}

pub fn prepare_named_file(root: &Path, name: &str) -> Result<PathBuf, String> {
    prepare_file(root, &sanitize_name(name))
}

pub fn relative_parts(relative: &str) -> Result<Vec<String>, String> {
    if relative.starts_with(['/', '\\']) || relative.contains([':', '\0']) {
        return Err("Invalid download relative path".into());
    }
    relative
        .split(['/', '\\'])
        .filter(|part| !part.is_empty() && *part != ".")
        .map(|part| {
            if part.trim() == ".." {
                Err("Invalid download relative path".into())
            } else {
                Ok(sanitize_name(part))
            }
        })
        .collect()
}

pub fn prepare_directory(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let parts = relative_parts(relative)?;
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut current = root.clone();
    for part in parts {
        current.push(part);
        if current.exists() {
            current = current.canonicalize().map_err(|e| e.to_string())?;
            if !current.starts_with(&root) {
                return Err("Download path escapes the download directory".into());
            }
        } else {
            std::fs::create_dir(&current).map_err(|e| e.to_string())?;
        }
    }
    Ok(current)
}

pub fn prepare_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut parts = relative_parts(relative)?;
    let name = parts.pop().ok_or("Download filename is empty")?;
    let parent = prepare_directory(root, &parts.join("/"))?;
    let path = parent.join(name);
    if std::fs::symlink_metadata(&path).is_ok() {
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        if !canonical.starts_with(root) {
            return Err("Download path escapes the download directory".into());
        }
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normal_layout_and_names_are_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let path = prepare_file(temp.path(), "reports/summary.txt").unwrap();
        assert_eq!(
            path,
            temp.path()
                .canonicalize()
                .unwrap()
                .join("reports/summary.txt")
        );
        assert!(path.parent().unwrap().is_dir());
        assert_eq!(sanitize_name("a:*? b.txt"), "a b.txt");
        assert_eq!(sanitize_name("CON.txt"), "_CON.txt");
        assert_eq!(sanitize_name(".."), "download");
    }
    #[test]
    fn untrusted_relative_paths_are_rejected() {
        let temp = tempfile::tempdir().unwrap();
        for path in [
            "../escape",
            "a/../escape",
            "C:\\escape",
            "\\escape",
            "/escape",
            "x\0y",
            "a/ .. /x",
        ] {
            assert!(prepare_file(temp.path(), path).is_err(), "{path:?}");
        }
    }
    #[cfg(unix)]
    #[test]
    fn existing_links_cannot_escape_root() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("link")).unwrap();
        assert!(prepare_file(root.path(), "link/escape").is_err());
        std::os::unix::fs::symlink(outside.path().join("missing"), root.path().join("dangling"))
            .unwrap();
        assert!(prepare_file(root.path(), "dangling").is_err());
    }
}
