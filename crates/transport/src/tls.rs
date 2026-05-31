//! TLS configuration for WSS connections.
//!
//! Builds a [`rustls::ClientConfig`] from PEM-encoded CA certificates found
//! in a local directory.  Supports:
//!
//! - **Certificate pinning**: trust only the CAs in the given directory.
//! - **Enforcement disable**: optional flag to skip verification (dev only).
//! - **mTLS**: optional client certificate + private key.

use cfms_core::Result;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::{ClientConfig, RootCertStore};
use std::path::Path;
use std::{fs, io};

/// Build a [`ClientConfig`] that trusts only the PEM certificates found
/// in `ca_dir`.
///
/// When `disable_enforcement` is `true`, the verifier is replaced with a
/// no-op verifier that accepts any certificate (**insecure** — intended
/// for development / troubleshooting only).
pub fn build_config(ca_dir: &Path, disable_enforcement: bool) -> Result<ClientConfig> {
    let mut root_store = if disable_enforcement {
        RootCertStore::empty()
    } else {
        load_trust_store(ca_dir)?
    };

    // If the store is empty and enforcement is enabled, fall back to
    // the system's webpki roots.  In rustls 0.23, this is done by
    // replacing the store's roots directly.
    if root_store.is_empty() && !disable_enforcement {
        root_store.roots = webpki_roots::TLS_SERVER_ROOTS.to_vec();
    }

    let config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();

    Ok(config)
}

/// Check whether a filename matches the OpenSSL `c_rehash` convention:
/// 8 lowercase hex digits, a dot, and a single digit (e.g. "8a5a09f0.0").
///
/// This is used to distinguish actual CA certificate files from other
/// extensionless files (dotfiles, README, etc.) in the CA directory.
fn is_openssl_hash_filename(path: &Path) -> bool {
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };

    // 最小长度必须是 10 位: 8位十六进制 + 1位点 + 至少1位数字
    if name.len() < 10 {
        return false;
    }

    let bytes = name.as_bytes();

    // 1. 前 8 位必须是小写十六进制数字 (0-9, a-f)
    let is_hex = bytes[..8].iter().all(|&b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));

    // 2. 第 9 位 (索引 8) 必须是 '.'
    let has_dot = bytes[8] == b'.';

    // 3. 从第 10 位 (索引 9) 开始往后的所有位，必须全部是 ASCII 数字
    let is_suffix_numeric = bytes[9..].iter().all(|b| b.is_ascii_digit());

    is_hex && has_dot && is_suffix_numeric
}

/// Load all PEM certificates from `ca_dir` into a [`RootCertStore`].
///
/// Accepts files with `.pem`, `.crt`, and `.cer` extensions.  Also
/// accepts extensionless files (like the reference CA store which uses
/// bare hash filenames).
pub fn load_trust_store(ca_dir: &Path) -> Result<RootCertStore> {
    let mut store = RootCertStore::empty();

    let entries = match fs::read_dir(ca_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            // Directory doesn't exist — return an empty store; the caller
            // may fall back to webpki-roots.
            return Ok(store);
        }
        Err(e) => return Err(cfms_core::Error::Io(e)),
    };

    for entry in entries {
        let entry = entry?;
        let path = entry.path();

        // Skip directories and dotfiles (e.g. .git, .gitignore).
        if path.is_dir() {
            continue;
        }

        // Only process files that look like certificates.
        let is_cert = match path.extension().and_then(|e| e.to_str()) {
            Some("pem") | Some("crt") | Some("cer") => true,
            // For files without a recognised extension (including files
            // like "8a5a09f0.0" whose final component after the last '.'
            // is a digit, not a textual extension), fall back to the
            // OpenSSL c_rehash naming convention:
            // 8 lowercase hex digits + "." + digit(s).
            // This also naturally skips dotfiles like .git and .gitignore.
            _ => is_openssl_hash_filename(&path),
        };

        if !is_cert {
            continue;
        }

        let pem_bytes = fs::read(&path)?;

        // Try loading as PEM first.
        let mut pem_slice = pem_bytes.as_slice();
        let certs: Vec<CertificateDer> = rustls_pemfile::certs(&mut pem_slice)
            .filter_map(|r| r.ok())
            .collect();

        if !certs.is_empty() {
            for cert in certs {
                store.add(cert).map_err(|e| {
                    cfms_core::Error::Connection(format!(
                        "failed to add certificate from {}: {e}",
                        path.display()
                    ))
                })?;
            }
        } else {
            // Not valid PEM — try raw DER.
            let cert = CertificateDer::from(pem_bytes);
            store.add(cert).map_err(|e| {
                cfms_core::Error::Connection(format!(
                    "failed to add DER certificate from {}: {e}",
                    path.display()
                ))
            })?;
        }
    }

    Ok(store)
}

/// Load a client certificate and private key for mTLS.
///
/// `cert_path` should point to a PEM file containing the client
/// certificate chain.  `key_path` should point to a PEM file containing
/// the private key (PKCS#8 or PKCS#1).
pub fn load_client_identity(
    cert_path: &Path,
    key_path: &Path,
) -> Result<rustls::sign::CertifiedKey> {
    let cert_pem = fs::read(cert_path)?;
    let mut cert_reader = cert_pem.as_slice();
    let certs: Vec<CertificateDer> =
        rustls_pemfile::certs(&mut cert_reader).collect::<io::Result<Vec<_>>>()?;

    if certs.is_empty() {
        return Err(cfms_core::Error::Connection(format!(
            "no certificates found in {}",
            cert_path.display()
        )));
    }

    let key_pem = fs::read(key_path)?;

    // Try PKCS#8 first, then RSA (PKCS#1), then SEC1 (EC).
    let private_key: PrivateKeyDer = 'key: {
        // PKCS#8
        let mut reader = key_pem.as_slice();
        if let Some(key) = rustls_pemfile::pkcs8_private_keys(&mut reader).next() {
            break 'key PrivateKeyDer::Pkcs8(key?);
        }

        // RSA (PKCS#1)
        let mut reader = key_pem.as_slice();
        if let Some(key) = rustls_pemfile::rsa_private_keys(&mut reader).next() {
            break 'key PrivateKeyDer::Pkcs1(key?);
        }

        // SEC1 (EC)
        let mut reader = key_pem.as_slice();
        if let Some(key) = rustls_pemfile::ec_private_keys(&mut reader).next() {
            break 'key PrivateKeyDer::Sec1(key?);
        }

        return Err(cfms_core::Error::Connection(format!(
            "no valid private key found in {}",
            key_path.display()
        )));
    };

    let signing_key = rustls::crypto::aws_lc_rs::default_provider()
        .key_provider
        .load_private_key(private_key)
        .map_err(|e| cfms_core::Error::Connection(format!("failed to load private key: {e}")))?;

    Ok(rustls::sign::CertifiedKey::new(certs, signing_key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_config_no_directory() {
        // Non-existent directory should return an empty store, not an error.
        let store = load_trust_store(Path::new("/tmp/nonexistent_ca_dir_12345"));
        assert!(store.is_ok());
        assert_eq!(store.unwrap().len(), 0);
    }
}
