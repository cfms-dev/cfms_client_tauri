//! Best-effort CRL checking, shared by every CFMS connection. A positive result
//! always comes from signed, applicable evidence, never from a successful HTTP GET.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use cfms_core::{Error, Result, RevocationState, RevocationStatus};
use dashmap::DashMap;
use rustls::RootCertStore;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, CertificateRevocationListDer, ServerName, UnixTime};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, Semaphore, watch};
use webpki::{
    CertRevocationList, EndEntityCert, ExpirationPolicy, KeyUsage, RevocationOptionsBuilder,
    UnknownStatusPolicy,
};
use x509_parser::extensions::{DistributionPointName, GeneralName, ParsedExtension};
use x509_parser::prelude::{FromDer, X509Certificate};
use x509_parser::revocation_list::CertificateRevocationList;
use x509_parser::x509::SubjectPublicKeyInfo;

use crate::crl_fetch;
pub use crate::crl_fetch::normalize_allowed_hosts;

const REFRESH_SECONDS: u64 = 15 * 60;
const RETRY_SECONDS: u64 = 5 * 60;
const CACHE_LIMIT: u64 = 128 * 1024 * 1024;

pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[derive(Debug, Clone)]
struct Blob {
    der: Arc<[u8]>,
    fetched_at: u64,
    validated: Option<Validated>,
}

#[derive(Serialize, Deserialize)]
struct CacheMetadata {
    fetched_at: u64,
}

#[derive(Debug, Default)]
struct CacheEntry {
    blob: Option<Blob>,
    retry_at: u64,
    used_at: u64,
    failure: Option<&'static str>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Watermark {
    number: Vec<u8>,
    this_update: u64,
    digest: String,
}

#[derive(Debug)]
pub struct CrlService {
    initialized: tokio::sync::OnceCell<()>,
    directory: RwLock<Option<PathBuf>>,
    allowed_hosts: RwLock<Vec<String>>,
    entries: DashMap<String, Arc<Mutex<CacheEntry>>>,
    watermarks: Mutex<HashMap<String, Watermark>>,
    revoked: DashMap<String, u64>,
    permits: Arc<Semaphore>,
    pub(crate) wake: watch::Sender<()>,
}

impl Default for CrlService {
    fn default() -> Self {
        Self::new()
    }
}

impl CrlService {
    pub fn new() -> Self {
        Self {
            initialized: tokio::sync::OnceCell::new(),
            directory: RwLock::new(None),
            allowed_hosts: RwLock::new(vec![]),
            entries: DashMap::new(),
            watermarks: Mutex::new(HashMap::new()),
            revoked: DashMap::new(),
            permits: Arc::new(Semaphore::new(4)),
            wake: watch::channel(()).0,
        }
    }

    /// Call once at startup; failure to read a cache never changes trust decisions.
    pub async fn set_cache_directory(&self, directory: PathBuf) {
        self.initialized
            .get_or_init(|| async {
                if tokio::fs::create_dir_all(&directory).await.is_err() {
                    return;
                }
                if let Ok(bytes) = tokio::fs::read(directory.join("watermarks.json")).await
                    && let Ok(marks) = serde_json::from_slice(&bytes)
                {
                    *self.watermarks.lock().await = marks;
                }
                *self.directory.write().unwrap() = Some(directory);
                self.prune_disk().await;
            })
            .await;
    }

    pub fn set_allowed_hosts(&self, hosts: &[String]) -> std::result::Result<(), String> {
        *self.allowed_hosts.write().unwrap() = normalize_allowed_hosts(hosts)?;
        // Configuration changes invalidate failed-fetch backoff on the next pass.
        for entry in self.entries.iter() {
            if let Ok(mut entry) = entry.value().try_lock() {
                entry.retry_at = 0;
            }
        }
        self.refresh_active();
        Ok(())
    }

    pub fn refresh_active(&self) {
        self.wake.send_replace(());
    }

    pub(crate) fn known_revoked(&self, chain: &[CertificateDer<'_>]) -> bool {
        let current = now();
        chain.first().is_some_and(|cert| {
            self.revoked
                .get(&hash(cert.as_ref()))
                .is_some_and(|expiry| *expiry > current)
        })
    }

    fn record_revoked(&self, chain: &[CertificateDer<'_>]) {
        // Retain authenticated evidence until the leaf expires, even if later downloads fail.
        // Key by leaf: an unused alternative intermediate must not revoke another connection.
        if let Some(cert) = chain.first() {
            let expires = X509Certificate::from_der(cert.as_ref())
                .ok()
                .and_then(|(_, cert)| u64::try_from(cert.validity().not_after.timestamp()).ok())
                .unwrap_or(now());
            self.revoked.insert(hash(cert.as_ref()), expires);
        }
        self.refresh_active();
    }

    pub(crate) async fn check(
        &self,
        chain: &[CertificateDer<'static>],
        roots: Arc<RootCertStore>,
        name: &ServerName<'_>,
        proxy: Option<&str>,
        force_ipv4: bool,
    ) -> Result<RevocationStatus> {
        if self.known_revoked(chain) {
            return Err(Error::CertificateRevoked("server certificate".into()));
        }
        let mut progress = RevocationStatus::new(RevocationState::Checking, "");
        // Keep partial positive evidence when the overall time budget expires.
        let result = tokio::time::timeout(
            Duration::from_secs(10),
            self.check_inner(chain, roots, name, proxy, force_ipv4, &mut progress),
        )
        .await;
        match result {
            Ok(result) => result,
            Err(_) => {
                progress.state = RevocationState::Unknown;
                progress.reasons.push("timeout".into());
                progress.checked_at = Some(now());
                Ok(progress)
            }
        }
    }

    async fn check_inner(
        &self,
        chain: &[CertificateDer<'static>],
        roots: Arc<RootCertStore>,
        name: &ServerName<'_>,
        proxy: Option<&str>,
        force_ipv4: bool,
        status: &mut RevocationStatus,
    ) -> Result<RevocationStatus> {
        let time = UnixTime::now();
        let algorithms = rustls::crypto::CryptoProvider::get_default()
            .expect("TLS provider installed")
            .signature_verification_algorithms
            .all;
        let leaf = chain
            .first()
            .ok_or_else(|| Error::Connection("missing peer certificate".into()))?;
        let entity = EndEntityCert::try_from(leaf).map_err(tls_error)?;
        entity
            .verify_is_valid_for_subject_name(name)
            .map_err(tls_error)?;
        let path = entity
            .verify_for_usage(
                algorithms,
                &roots.roots,
                &chain[1..],
                time,
                KeyUsage::server_auth(),
                None,
                None,
            )
            .map_err(tls_error)?;
        let mut certs = vec![leaf.clone()];
        certs.extend(
            path.intermediate_certificates()
                .map(|cert| cert.der().into_owned()),
        );
        let mut issuers = Vec::new();
        for cert in certs.iter().skip(1) {
            let (_, parsed) = X509Certificate::from_der(cert.as_ref())
                .map_err(|_| tls_error("invalid issuer"))?;
            let crl_sign = parsed
                .key_usage()
                .map_err(|_| tls_error("invalid issuer key usage"))?
                .is_some_and(|usage| usage.value.crl_sign());
            issuers.push(Issuer {
                subject: parsed.subject().as_raw().to_vec(),
                spki: parsed.public_key().raw.to_vec(),
                crl_sign,
            });
        }
        issuers.push(Issuer {
            subject: wrap_sequence(path.anchor().subject.as_ref()),
            spki: wrap_sequence(path.anchor().subject_public_key_info.as_ref()),
            crl_sign: true,
        });
        let mut crls: Vec<Validated> = Vec::new();
        for (index, cert) in certs.iter().enumerate() {
            let urls = distribution_points(cert.as_ref());
            if urls.is_empty() {
                status.reasons.push("no_distribution_point".into());
            }
            for url in urls {
                match self
                    .obtain(&url, &issuers[index], proxy, force_ipv4, Arc::clone(&roots))
                    .await
                {
                    Ok(crl) => {
                        let refs = [crl.parsed.as_ref()];
                        let options = RevocationOptionsBuilder::new(&refs)
                            .unwrap()
                            .with_status_policy(UnknownStatusPolicy::Allow)
                            .with_expiration_policy(ExpirationPolicy::Enforce)
                            .build();
                        match entity.verify_for_usage(
                            algorithms,
                            &roots.roots,
                            &chain[1..],
                            UnixTime::now(),
                            KeyUsage::server_auth(),
                            Some(options),
                            None,
                        ) {
                            Err(webpki::Error::CertRevoked) => {
                                self.record_revoked(chain);
                                return Err(Error::CertificateRevoked(
                                    "server certificate chain".into(),
                                ));
                            }
                            Ok(_) => crls.push(crl),
                            Err(_) => status.reasons.push("invalid_crl".into()),
                        }
                    }
                    Err(reason) => status.reasons.push(reason.into()),
                }
            }
        }
        status.checked_at = Some(now());
        // Empty CRLs disable checking in rustls, so explicitly handle this case.
        if crls.is_empty() {
            status.state = RevocationState::Unknown;
        } else {
            let refs: Vec<_> = crls.iter().map(|crl| crl.parsed.as_ref()).collect();
            let options = RevocationOptionsBuilder::new(&refs)
                .unwrap()
                .with_expiration_policy(ExpirationPolicy::Enforce)
                .build();
            match entity.verify_for_usage(
                algorithms,
                &roots.roots,
                &chain[1..],
                UnixTime::now(),
                KeyUsage::server_auth(),
                Some(options),
                None,
            ) {
                Ok(_) => {
                    status.state = RevocationState::Checked;
                    status.reasons.clear();
                }
                Err(webpki::Error::CertRevoked) => {
                    self.record_revoked(chain);
                    return Err(Error::CertificateRevoked("server certificate chain".into()));
                }
                Err(_) => {
                    status.state = RevocationState::Unknown;
                    status.reasons.push("incomplete_coverage".into());
                }
            }
            status.valid_until = crls.iter().map(|crl| crl.expires).min();
        }
        status.reasons.sort();
        status.reasons.dedup();
        Ok(status.clone())
    }

    async fn obtain(
        &self,
        url: &url::Url,
        issuer: &Issuer,
        proxy: Option<&str>,
        force_ipv4: bool,
        roots: Arc<RootCertStore>,
    ) -> std::result::Result<Validated, &'static str> {
        let key = hash(format!("{}:{}", hash(&issuer.spki), url).as_bytes());
        let shared = self
            .entries
            .entry(key.clone())
            .or_insert_with(|| Arc::new(Mutex::new(CacheEntry::default())))
            .clone();
        let mut entry = shared.lock().await;
        let current = now();
        entry.used_at = current;
        let directory = self.directory.read().unwrap().clone();
        if entry.blob.is_none()
            && let Some(directory) = &directory
        {
            let path = directory.join(format!("{key}.crl"));
            if tokio::fs::metadata(&path)
                .await
                .is_ok_and(|m| m.len() <= crl_fetch::MAX_CRL_BYTES as u64)
                && let (Ok(der), Ok(metadata)) = (
                    tokio::fs::read(path).await,
                    tokio::fs::read(directory.join(format!("{key}.json"))).await,
                )
                && let Ok(metadata) = serde_json::from_slice::<CacheMetadata>(&metadata)
            {
                entry.blob = Some(Blob {
                    der: der.into(),
                    fetched_at: metadata.fetched_at,
                    validated: None,
                });
            }
        }
        let old = entry
            .blob
            .as_ref()
            .filter(|blob| blob.fetched_at <= current)
            .and_then(|blob| {
                blob.validated
                    .clone()
                    .or_else(|| validate(&blob.der, issuer).ok())
            })
            .filter(|valid| {
                valid.mark.this_update <= current && current < valid.expires && issuer.crl_sign
            });
        let old = if let Some(valid) = old {
            let scope = hash(format!("{}:{}", hash(&issuer.spki), valid.scope).as_bytes());
            let marks = self.watermarks.lock().await;
            if marks
                .get(&scope)
                .is_some_and(|previous| is_rollback(&valid.mark, previous))
            {
                None
            } else {
                Some(valid)
            }
        } else {
            None
        };
        if let (Some(blob), Some(valid)) = (&mut entry.blob, &old) {
            blob.validated = Some(valid.clone());
        }
        if let (Some(blob), Some(valid)) = (&entry.blob, &old) {
            if current
                < blob
                    .fetched_at
                    .saturating_add(REFRESH_SECONDS)
                    .min(valid.expires)
                || current < entry.retry_at
            {
                if let Some(directory) = &directory
                    && let Ok(file) = std::fs::File::open(directory.join(format!("{key}.crl")))
                {
                    let _ =
                        file.set_times(std::fs::FileTimes::new().set_modified(SystemTime::now()));
                }
                return Ok(valid.clone());
            }
        } else if current < entry.retry_at {
            return Err(entry.failure.unwrap_or("download_failed"));
        }
        let allowed = self.allowed_hosts.read().unwrap().clone();
        let download = async {
            let _permit = self
                .permits
                .acquire()
                .await
                .map_err(|_| "download_failed")?;
            crl_fetch::fetch(url, &allowed, proxy, force_ipv4, roots).await
        };
        let fetched = tokio::time::timeout(Duration::from_secs(5), download)
            .await
            .map_err(|_| "timeout")
            .and_then(|v| v);
        let candidate = match fetched.and_then(|bytes| validate(&bytes, issuer)) {
            Ok(valid) => valid,
            Err(reason) => {
                entry.retry_at = current + RETRY_SECONDS;
                entry.failure = Some(reason);
                return old.ok_or(reason);
            }
        };
        let scope = hash(format!("{}:{}", hash(&issuer.spki), candidate.scope).as_bytes());
        let mut marks = self.watermarks.lock().await;
        if marks
            .get(&scope)
            .is_some_and(|previous| is_rollback(&candidate.mark, previous))
        {
            entry.retry_at = current + RETRY_SECONDS;
            entry.failure = Some("rollback");
            return old.ok_or("rollback");
        }
        marks.insert(scope, candidate.mark.clone());
        entry.retry_at = 0;
        entry.failure = None;
        entry.blob = Some(Blob {
            der: candidate.der.clone(),
            fetched_at: current,
            validated: Some(candidate.clone()),
        });
        if let Some(directory) = &directory {
            // Cache failures are availability issues, not successful revocation checks.
            let _ = atomic_json(directory.join("watermarks.json"), &*marks).await;
            let path = directory.join(format!("{key}.crl"));
            let temporary = path.with_extension("tmp");
            if tokio::fs::write(&temporary, &candidate.der).await.is_ok() {
                let _ = tokio::fs::rename(&temporary, path).await;
                let _ = atomic_json(
                    directory.join(format!("{key}.json")),
                    &CacheMetadata {
                        fetched_at: current,
                    },
                )
                .await;
            }
        }
        drop(marks);
        drop(entry);
        self.prune_memory().await;
        self.prune_disk().await;
        Ok(candidate)
    }

    async fn prune_memory(&self) {
        let mut entries = Vec::new();
        let mut total = 0;
        for item in &self.entries {
            if let Ok(entry) = item.value().try_lock() {
                let size = entry.blob.as_ref().map_or(0, |b| b.der.len() as u64);
                total += size;
                entries.push((entry.used_at, item.key().clone(), size));
            }
        }
        entries.sort();
        for (_, key, size) in entries {
            if total <= CACHE_LIMIT && self.entries.len() <= 1024 {
                break;
            }
            self.entries.remove(&key);
            total = total.saturating_sub(size);
        }
    }

    async fn prune_disk(&self) {
        let Some(directory) = self.directory.read().unwrap().clone() else {
            return;
        };
        let Ok(mut reader) = tokio::fs::read_dir(&directory).await else {
            return;
        };
        let mut entries = Vec::new();
        let mut total = 0;
        while let Ok(Some(entry)) = reader.next_entry().await {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.len() != 68
                || !name.ends_with(".crl")
                || !name[..64].bytes().all(|b| b.is_ascii_hexdigit())
            {
                continue;
            }
            if let Ok(meta) = entry.metadata().await {
                total += meta.len();
                entries.push((meta.modified().ok(), entry.path(), meta.len()));
            }
        }
        entries.sort();
        for (_, path, size) in entries {
            if total <= CACHE_LIMIT {
                break;
            }
            if tokio::fs::remove_file(&path).await.is_ok() {
                let _ = tokio::fs::remove_file(path.with_extension("json")).await;
                total = total.saturating_sub(size);
            }
        }
    }
}

fn tls_error(error: impl std::fmt::Display) -> Error {
    Error::Connection(format!("TLS verification failed: {error}"))
}

fn is_rollback(candidate: &Watermark, previous: &Watermark) -> bool {
    candidate.this_update < previous.this_update
        || (candidate.number.len(), &candidate.number) < (previous.number.len(), &previous.number)
        || (candidate.number == previous.number && candidate.digest != previous.digest)
}

async fn atomic_json(path: PathBuf, value: &impl Serialize) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(value)?;
    let temporary = path.with_extension("tmp");
    tokio::fs::write(&temporary, bytes).await?;
    tokio::fs::rename(temporary, path).await
}

#[derive(Clone)]
struct Issuer {
    subject: Vec<u8>,
    spki: Vec<u8>,
    crl_sign: bool,
}

#[derive(Debug, Clone)]
struct Validated {
    der: Arc<[u8]>,
    parsed: Arc<CertRevocationList<'static>>,
    expires: u64,
    scope: String,
    mark: Watermark,
}

fn validate(bytes: &[u8], issuer: &Issuer) -> std::result::Result<Validated, &'static str> {
    let der = if bytes.starts_with(b"-----BEGIN") {
        CertificateRevocationListDer::from_pem_slice(bytes)
            .map_err(|_| "invalid_crl")?
            .as_ref()
            .to_vec()
    } else {
        bytes.to_vec()
    };
    let parsed = webpki::OwnedCertRevocationList::from_der(&der).map_err(|_| "unsupported_crl")?;
    let (rest, crl) = CertificateRevocationList::from_der(&der).map_err(|_| "invalid_crl")?;
    if !rest.is_empty() || crl.issuer().as_raw() != issuer.subject || !issuer.crl_sign {
        return Err("invalid_crl");
    }
    let (_, spki) = SubjectPublicKeyInfo::from_der(&issuer.spki).map_err(|_| "invalid_crl")?;
    crl.verify_signature(&spki).map_err(|_| "invalid_crl")?;
    let this_update = u64::try_from(crl.last_update().timestamp()).map_err(|_| "invalid_crl")?;
    let expires = crl
        .next_update()
        .and_then(|time| u64::try_from(time.timestamp()).ok())
        .ok_or("invalid_crl")?;
    if this_update > now() || this_update >= expires {
        return Err("invalid_crl");
    }
    if now() >= expires {
        return Err("expired_crl");
    }
    let scope = crl
        .extensions()
        .iter()
        .find(|e| {
            matches!(
                e.parsed_extension(),
                ParsedExtension::IssuingDistributionPoint(_)
            )
        })
        .map(|e| hash(e.value))
        .unwrap_or_default();
    let number = crl
        .crl_number()
        .map(|number| number.to_bytes_be())
        .ok_or("unsupported_crl")?;
    let mark = Watermark {
        number,
        this_update,
        digest: hash(&der),
    };
    Ok(Validated {
        der: der.into(),
        parsed: Arc::new(CertRevocationList::from(parsed)),
        expires,
        scope,
        mark,
    })
}

fn distribution_points(der: &[u8]) -> Vec<url::Url> {
    let Ok((_, cert)) = X509Certificate::from_der(der) else {
        return vec![];
    };
    let mut urls = Vec::new();
    for extension in cert.extensions() {
        if let ParsedExtension::CRLDistributionPoints(points) = extension.parsed_extension() {
            for point in &points.points {
                if let Some(DistributionPointName::FullName(names)) = &point.distribution_point {
                    for name in names {
                        if let GeneralName::URI(uri) = name
                            && let Ok(url) = url::Url::parse(uri)
                            && !urls.contains(&url)
                            && urls.len() < 8
                        {
                            urls.push(url);
                        }
                    }
                }
            }
        }
    }
    urls
}

// TrustAnchor stores the contents of the DER SEQUENCE, whereas the parser accepts
// a complete SPKI/Name. Restore only that outer framing; no cryptography is implemented here.
fn wrap_sequence(contents: &[u8]) -> Vec<u8> {
    let mut der = vec![0x30];
    if contents.len() < 128 {
        der.push(contents.len() as u8);
    } else {
        let length = contents.len().to_be_bytes();
        let first = length.iter().position(|b| *b != 0).unwrap();
        der.push(0x80 | (length.len() - first) as u8);
        der.extend_from_slice(&length[first..]);
    }
    der.extend_from_slice(contents);
    der
}

#[cfg(test)]
#[path = "crl_tests.rs"]
mod tests;
