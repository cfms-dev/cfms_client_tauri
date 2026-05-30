//! Parallel local filesystem scanner built on the `ignore` crate.

use std::path::Path;

use cfms_core::{FileEntry, Result};

/// Recursively scan a directory for files and subdirectories.
///
/// Uses the `ignore` crate's parallel walker for multi-threaded traversal.
/// If `pattern` is provided, only entries matching the glob pattern are
/// included (matched against the entry's filename, not full path).
pub fn scan_directory(path: &Path, pattern: Option<&str>) -> Result<Vec<FileEntry>> {
    use ignore::WalkBuilder;

    let num_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

    let mut builder = WalkBuilder::new(path);
    builder.hidden(false).threads(num_threads);

    let owned_pattern: Option<String> = pattern.map(|s| s.to_string());
    if let Some(ref pat) = owned_pattern {
        let pat = pat.clone();
        builder.filter_entry(move |entry| {
            // Always include directories so we can descend into them.
            if entry.file_type().map_or(false, |ft| ft.is_dir()) {
                return true;
            }
            entry
                .file_name()
                .to_str()
                .map_or(false, |name| glob_match::glob_match(&pat, name))
        });
    }

    let mut entries = Vec::new();

    for result in builder.build() {
        let entry = result.map_err(|e| {
            cfms_core::Error::Other(format!("scan error: {e}"))
        })?;

        let metadata = entry.metadata().ok();

        let is_dir = entry.file_type().map_or(false, |ft| ft.is_dir());
        let size = metadata.as_ref().map_or(0, |m| m.len());
        let modified = metadata.and_then(|m| {
            m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        }).map(|d| d.as_secs() as i64);

        entries.push(FileEntry {
            path: entry.path().to_string_lossy().into_owned(),
            size,
            is_dir,
            modified,
        });
    }

    Ok(entries)
}

// ---------------------------------------------------------------------------
// Tiny glob matcher (avoids pulling in the `glob` crate for one function)
// ---------------------------------------------------------------------------

mod glob_match {
    /// Simple glob pattern match against a filename.
    /// Supports `*` (any sequence) and `?` (any single char).
    pub fn glob_match(pattern: &str, name: &str) -> bool {
        let pat = pattern.as_bytes();
        let text = name.as_bytes();
        let (mut pi, mut ti) = (0usize, 0usize);
        let mut star_idx = None;
        let mut match_idx = 0usize;

        while ti < text.len() || pi < pat.len() {
            if pi < pat.len() && pat[pi] == b'*' {
                star_idx = Some(pi);
                match_idx = ti;
                pi += 1;
            } else if pi < pat.len() && ti < text.len()
                && (pat[pi] == b'?' || pat[pi] == text[ti])
            {
                pi += 1;
                ti += 1;
            } else if let Some(si) = star_idx {
                if ti < text.len() {
                    // More text to consume — let the star eat one char.
                    pi = si + 1;
                    match_idx += 1;
                    ti = match_idx;
                } else {
                    // Text exhausted — star matches zero chars; skip it.
                    pi = si + 1;
                    star_idx = None;
                }
            } else {
                return false;
            }
        }

        true
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_glob() {
            assert!(glob_match("*.txt", "hello.txt"));
            assert!(glob_match("*.txt", "foo.txt"));
            assert!(!glob_match("*.txt", "hello.md"));
            assert!(glob_match("file?.rs", "file1.rs"));
            assert!(glob_match("file?.rs", "fileX.rs"));
            assert!(!glob_match("file?.rs", "file10.rs"));
            // Wildcard matches empty string.
            assert!(glob_match("a*c", "ac"));
            assert!(glob_match("a*c", "abc"));
            assert!(glob_match("a*c", "abbbbc"));
            // Multiple wildcards.
            assert!(glob_match("*.tar.gz", "backup.tar.gz"));
            assert!(!glob_match("*.tar.gz", "backup.zip"));
            // Prefix/suffix matching.
            assert!(glob_match("abc*", "abcdef"));
            assert!(glob_match("*def", "abcdef"));
        }
    }
}
