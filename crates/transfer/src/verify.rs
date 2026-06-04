//! File integrity verification.
//!
//! After a download completes, the received file is checked against the
//! expected size and SHA-256 hash.

use cfms_core::Result;
use sha2::{Digest, Sha256};
use std::path::Path;

/// Verify that the file at `path` has the expected size.
///
/// # Errors
/// Returns [`Error::Protocol`] if the sizes do not match.
pub fn size_matches(path: &Path, expected: u64) -> Result<()> {
    let actual = std::fs::metadata(path)?.len();
    if actual != expected {
        return Err(cfms_core::Error::Protocol(format!(
            "file size mismatch: expected {expected} bytes, got {actual} bytes"
        )));
    }
    Ok(())
}

/// Verify that the file at `path` has the expected SHA-256 hash.
///
/// Uses memory-mapped I/O for efficient hashing of large files.
///
/// # Errors
/// Returns [`Error::Protocol`] if the hashes do not match.
pub fn sha256_matches(path: &Path, expected: &[u8; 32]) -> Result<()> {
    let file = std::fs::File::open(path)?;

    // Safety: memory-mapping a file is safe when the file is not modified
    // concurrently.  We only read from the mapping.
    let mmap = unsafe {
        memmap2::Mmap::map(&file).map_err(|e| cfms_core::Error::Io(std::io::Error::other(e)))?
    };

    let mut hasher = Sha256::new();
    hasher.update(&mmap);
    let actual: [u8; 32] = hasher.finalize().into();

    if &actual != expected {
        let actual_hex: String = actual.iter().map(|b| format!("{b:02x}")).collect();
        let expected_hex: String = expected.iter().map(|b| format!("{b:02x}")).collect();
        return Err(cfms_core::Error::Protocol(format!(
            "file hash mismatch: expected {expected_hex}, got {actual_hex}"
        )));
    }

    Ok(())
}

/// Compute the SHA-256 hash of a file via memory-mapped I/O.
pub fn compute_sha256(path: &Path) -> Result<[u8; 32]> {
    let file = std::fs::File::open(path)?;
    let mmap = unsafe {
        memmap2::Mmap::map(&file).map_err(|e| cfms_core::Error::Io(std::io::Error::other(e)))?
    };

    let mut hasher = Sha256::new();
    hasher.update(&mmap);
    Ok(hasher.finalize().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn size_matches_ok() {
        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        tmp.write_all(b"hello").unwrap();
        assert!(size_matches(tmp.path(), 5).is_ok());
    }

    #[test]
    fn size_matches_fail() {
        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        tmp.write_all(b"hello").unwrap();
        assert!(size_matches(tmp.path(), 999).is_err());
    }

    #[test]
    fn sha256_matches_ok() {
        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        tmp.write_all(b"test data").unwrap();
        tmp.flush().unwrap();

        let hash = compute_sha256(tmp.path()).unwrap();
        assert!(sha256_matches(tmp.path(), &hash).is_ok());
    }

    #[test]
    fn sha256_matches_fail() {
        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        tmp.write_all(b"test data").unwrap();
        tmp.flush().unwrap();

        let wrong_hash = [0x00u8; 32];
        assert!(sha256_matches(tmp.path(), &wrong_hash).is_err());
    }
}
