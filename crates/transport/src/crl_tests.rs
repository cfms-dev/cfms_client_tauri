use super::*;
use base64ct::Encoding;
use rcgen::{
    BasicConstraints, CertificateParams, CertificateRevocationListParams, CertifiedIssuer,
    CrlDistributionPoint, IsCa, KeyIdMethod, KeyPair, KeyUsagePurpose, RevokedCertParams,
};
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct Authority {
    ca: CertifiedIssuer<'static, KeyPair>,
}
impl Authority {
    fn new(name: &str) -> Self {
        let mut params = CertificateParams::new(vec![]).unwrap();
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, name);
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
        Self {
            ca: CertifiedIssuer::self_signed(params, KeyPair::generate().unwrap()).unwrap(),
        }
    }
    fn issuer(&self) -> Issuer {
        let (_, cert) = X509Certificate::from_der(self.ca.der().as_ref()).unwrap();
        Issuer {
            subject: cert.subject().as_raw().to_vec(),
            spki: cert.public_key().raw.to_vec(),
            crl_sign: true,
        }
    }
    fn leaf(&self, urls: Vec<String>) -> (CertificateDer<'static>, KeyPair) {
        let key = KeyPair::generate().unwrap();
        let mut params = CertificateParams::new(vec!["localhost".into()]).unwrap();
        params.serial_number = Some(42u64.into());
        params.crl_distribution_points = urls
            .into_iter()
            .map(|url| CrlDistributionPoint { uris: vec![url] })
            .collect();
        (params.signed_by(&key, &self.ca).unwrap().der().clone(), key)
    }
    fn crl(
        &self,
        revoked: bool,
        number: u64,
        this: i64,
        next: i64,
    ) -> rcgen::CertificateRevocationList {
        CertificateRevocationListParams {
            this_update: time::OffsetDateTime::from_unix_timestamp(now() as i64 + this).unwrap(),
            next_update: time::OffsetDateTime::from_unix_timestamp(now() as i64 + next).unwrap(),
            crl_number: number.into(),
            issuing_distribution_point: None,
            revoked_certs: if revoked {
                vec![RevokedCertParams {
                    serial_number: 42u64.into(),
                    revocation_time: time::OffsetDateTime::from_unix_timestamp(now() as i64 - 60)
                        .unwrap(),
                    reason_code: None,
                    invalidity_date: None,
                }]
            } else {
                vec![]
            },
            key_identifier_method: KeyIdMethod::Sha256,
        }
        .signed_by(&self.ca)
        .unwrap()
    }
    fn roots(&self) -> Arc<RootCertStore> {
        let mut roots = RootCertStore::empty();
        roots.add(self.ca.der().clone()).unwrap();
        Arc::new(roots)
    }
}

struct HttpFixture {
    url: String,
    bytes: Arc<RwLock<Vec<u8>>>,
    hits: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for HttpFixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl HttpFixture {
    async fn new(bytes: Vec<u8>) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/list.crl", listener.local_addr().unwrap());
        let body = Arc::new(RwLock::new(bytes));
        let bytes = body.clone();
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = hits.clone();
        let task = tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                counter.fetch_add(1, Ordering::SeqCst);
                let mut request = vec![0; 8192];
                let _ = stream.read(&mut request).await;
                let content = body.read().unwrap().clone();
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    content.len()
                );
                let _ = stream.write_all(header.as_bytes()).await;
                let _ = stream.write_all(&content).await;
            }
        });
        Self {
            url,
            bytes,
            hits,
            task,
        }
    }
}

fn provider() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}
fn name() -> ServerName<'static> {
    ServerName::try_from("localhost").unwrap()
}

#[test]
fn validates_signatures_times_pem_and_rollback() {
    provider();
    let ca = Authority::new("CA");
    let issuer = ca.issuer();
    let crl = ca.crl(false, 4, -60, 3600);
    assert!(validate(crl.der().as_ref(), &issuer).is_ok());
    assert!(validate(crl.pem().unwrap().as_bytes(), &issuer).is_ok());
    assert!(validate(crl.der().as_ref(), &Authority::new("CA").issuer()).is_err());
    let mut tampered = crl.der().as_ref().to_vec();
    *tampered.last_mut().unwrap() ^= 1;
    assert!(validate(&tampered, &issuer).is_err());
    assert_eq!(
        validate(ca.crl(false, 4, 60, 3600).der().as_ref(), &issuer).err(),
        Some("invalid_crl")
    );
    assert_eq!(
        validate(ca.crl(false, 4, -3600, -1).der().as_ref(), &issuer).err(),
        Some("expired_crl")
    );
    let old = validate(ca.crl(false, 3, -120, 3600).der().as_ref(), &issuer).unwrap();
    let new = validate(crl.der().as_ref(), &issuer).unwrap();
    assert!(is_rollback(&old.mark, &new.mark));
    assert!(!is_rollback(&new.mark, &new.mark));
}

#[tokio::test]
async fn missing_distribution_point_and_blocked_private_host_are_unknown() {
    provider();
    let ca = Authority::new("CA");
    let service = CrlService::new();
    let (cert, _) = ca.leaf(vec![]);
    let status = service
        .check(&[cert], ca.roots(), &name(), None, false)
        .await
        .unwrap();
    assert_eq!(status.state, RevocationState::Unknown);
    let http = HttpFixture::new(ca.crl(false, 1, -60, 3600).der().as_ref().to_vec()).await;
    let (cert, _) = ca.leaf(vec![http.url.clone()]);
    let status = service
        .check(&[cert], ca.roots(), &name(), None, false)
        .await
        .unwrap();
    assert!(status.reasons.contains(&"blocked_address".into()));
    assert_eq!(http.hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn shared_download_cache_and_disk_restart_revalidate_evidence() {
    provider();
    let ca = Authority::new("CA");
    let http = HttpFixture::new(ca.crl(false, 1, -60, 3600).der().as_ref().to_vec()).await;
    let (cert, _) = ca.leaf(vec![http.url.clone()]);
    let chain = vec![cert];
    let service = CrlService::new();
    let directory = tempfile::tempdir().unwrap();
    service.set_cache_directory(directory.path().into()).await;
    service.set_allowed_hosts(&["127.0.0.1".into()]).unwrap();
    let server_name = name();
    let (a, b) = tokio::join!(
        service.check(&chain, ca.roots(), &server_name, None, false),
        service.check(&chain, ca.roots(), &server_name, None, false)
    );
    assert_eq!(a.unwrap().state, RevocationState::Checked);
    assert_eq!(b.unwrap().state, RevocationState::Checked);
    assert_eq!(http.hits.load(Ordering::SeqCst), 1);
    let restarted = CrlService::new();
    restarted.set_cache_directory(directory.path().into()).await;
    assert_eq!(
        restarted
            .check(&chain, ca.roots(), &name(), None, false)
            .await
            .unwrap()
            .state,
        RevocationState::Checked
    );
    assert_eq!(http.hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn invalid_crl_cannot_mask_valid_revocation_and_retry_stays_blocked() {
    provider();
    let ca = Authority::new("CA");
    let bad = HttpFixture::new(vec![0, 1, 2]).await;
    let revoked = HttpFixture::new(ca.crl(true, 1, -60, 3600).der().as_ref().to_vec()).await;
    let (cert, _) = ca.leaf(vec![bad.url.clone(), revoked.url.clone()]);
    let service = CrlService::new();
    service.set_allowed_hosts(&["127.0.0.1".into()]).unwrap();
    assert!(matches!(
        service
            .check(
                std::slice::from_ref(&cert),
                ca.roots(),
                &name(),
                None,
                false
            )
            .await,
        Err(Error::CertificateRevoked(_))
    ));
    revoked.bytes.write().unwrap().clear();
    assert!(matches!(
        service
            .check(&[cert], ca.roots(), &name(), None, false)
            .await,
        Err(Error::CertificateRevoked(_))
    ));
}

#[tokio::test]
async fn wrong_name_and_untrusted_chain_fail_before_crl_requests() {
    provider();
    let ca = Authority::new("CA");
    let http = HttpFixture::new(vec![]).await;
    let (cert, _) = ca.leaf(vec![http.url.clone()]);
    let service = CrlService::new();
    let wrong_name = ServerName::try_from("example.com").unwrap();
    assert!(
        service
            .check(
                std::slice::from_ref(&cert),
                ca.roots(),
                &wrong_name,
                None,
                false
            )
            .await
            .is_err()
    );
    assert!(
        service
            .check(
                &[cert],
                Authority::new("untrusted").roots(),
                &name(),
                None,
                false
            )
            .await
            .is_err()
    );
    assert_eq!(http.hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn tls_revocation_gate_precedes_websocket_upgrade() {
    provider();
    let ca = Authority::new("CA");
    let http = HttpFixture::new(ca.crl(true, 1, -60, 3600).der().as_ref().to_vec()).await;
    let (cert, key) = ca.leaf(vec![http.url.clone()]);
    let server = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![cert],
            rustls::pki_types::PrivatePkcs8KeyDer::from(key.serialize_der()).into(),
        )
        .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let mut tls = tokio_rustls::TlsAcceptor::from(Arc::new(server))
            .accept(socket)
            .await
            .unwrap();
        let mut byte = [0];
        // TLS close/EOF is allowed; no HTTP upgrade bytes may be received.
        !matches!(tls.read(&mut byte).await, Ok(1))
    });
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("ca.pem"), ca.ca.pem()).unwrap();
    let service = Arc::new(CrlService::new());
    service.set_allowed_hosts(&["127.0.0.1".into()]).unwrap();
    let tls = crate::tls::build_config_with_identity(directory.path(), false, None, None, service)
        .unwrap();
    let result = crate::Connection::connect(
        &format!("wss://localhost:{}", address.port()),
        tls,
        None,
        true,
    )
    .await;
    assert!(matches!(result, Err(Error::CertificateRevoked(_))));
    assert!(
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap()
    );
}

#[tokio::test]
async fn validates_selected_intermediate_path_and_rejects_intermediate_revocation() {
    provider();
    let root = Authority::new("Root");
    let root_http = HttpFixture::new(root.crl(false, 1, -60, 3600).der().as_ref().to_vec()).await;
    let mut params = CertificateParams::new(vec![]).unwrap();
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "Intermediate");
    params.serial_number = Some(42u64.into());
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    params.crl_distribution_points = vec![CrlDistributionPoint {
        uris: vec![root_http.url.clone()],
    }];
    let intermediate = Authority {
        ca: CertifiedIssuer::signed_by(params, KeyPair::generate().unwrap(), &root.ca).unwrap(),
    };
    let leaf_http = HttpFixture::new(
        intermediate
            .crl(false, 1, -60, 3600)
            .der()
            .as_ref()
            .to_vec(),
    )
    .await;
    let (leaf, _) = intermediate.leaf(vec![leaf_http.url.clone()]);
    let unrelated = Authority::new("Unused");
    let chain = vec![
        leaf.clone(),
        unrelated.ca.der().clone(),
        intermediate.ca.der().clone(),
    ];
    let service = CrlService::new();
    service.set_allowed_hosts(&["127.0.0.1".into()]).unwrap();
    assert_eq!(
        service
            .check(&chain, root.roots(), &name(), None, true)
            .await
            .unwrap()
            .state,
        RevocationState::Checked
    );
    *root_http.bytes.write().unwrap() = root.crl(true, 2, -30, 3600).der().as_ref().to_vec();
    for entry in &service.entries {
        entry.value().lock().await.blob.as_mut().unwrap().fetched_at = now() - REFRESH_SECONDS;
    }
    assert!(matches!(
        service
            .check(&chain, root.roots(), &name(), None, true)
            .await,
        Err(Error::CertificateRevoked(_))
    ));
}

#[tokio::test]
async fn wrong_scope_does_not_create_positive_revocation_or_checked_status() {
    provider();
    let ca = Authority::new("CA");
    let params = CertificateRevocationListParams {
        this_update: time::OffsetDateTime::from_unix_timestamp(now() as i64 - 60).unwrap(),
        next_update: time::OffsetDateTime::from_unix_timestamp(now() as i64 + 3600).unwrap(),
        crl_number: 1u64.into(),
        issuing_distribution_point: Some(rcgen::CrlIssuingDistributionPoint {
            distribution_point: CrlDistributionPoint {
                uris: vec!["http://example.com/unrelated".into()],
            },
            scope: None,
        }),
        revoked_certs: vec![RevokedCertParams {
            serial_number: 42u64.into(),
            revocation_time: time::OffsetDateTime::now_utc(),
            reason_code: None,
            invalidity_date: None,
        }],
        key_identifier_method: KeyIdMethod::Sha256,
    };
    let http = HttpFixture::new(params.signed_by(&ca.ca).unwrap().der().as_ref().to_vec()).await;
    let (cert, _) = ca.leaf(vec![http.url.clone()]);
    let service = CrlService::new();
    service.set_allowed_hosts(&["127.0.0.1".into()]).unwrap();
    assert_eq!(
        service
            .check(&[cert], ca.roots(), &name(), None, true)
            .await
            .unwrap()
            .state,
        RevocationState::Unknown
    );
}

#[tokio::test]
async fn long_lived_connections_close_on_refresh_with_and_without_mtls() {
    provider();
    for mutual in [false, true] {
        let ca = Authority::new("CA");
        let http = HttpFixture::new(ca.crl(false, 1, -60, 3600).der().as_ref().to_vec()).await;
        let (cert, key) = ca.leaf(vec![http.url.clone()]);
        let builder = rustls::ServerConfig::builder();
        let builder = if mutual {
            builder.with_client_cert_verifier(
                rustls::server::WebPkiClientVerifier::builder(ca.roots())
                    .build()
                    .unwrap(),
            )
        } else {
            builder.with_no_client_auth()
        };
        let server = builder
            .with_single_cert(
                vec![cert],
                rustls::pki_types::PrivatePkcs8KeyDer::from(key.serialize_der()).into(),
            )
            .unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server_task = tokio::spawn(async move {
            let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(server));
            let mut workers = tokio::task::JoinSet::new();
            for _ in 0..2 {
                let (socket, _) = listener.accept().await.unwrap();
                let acceptor = acceptor.clone();
                workers.spawn(async move {
                    let tls = acceptor.accept(socket).await.unwrap();
                    if mutual {
                        assert!(!tls.get_ref().1.peer_certificates().unwrap().is_empty());
                    }
                    let mut ws = tokio_tungstenite::accept_async(tls).await.unwrap();
                    use futures_util::StreamExt;
                    while let Some(Ok(message)) = ws.next().await {
                        if message.is_close() {
                            break;
                        }
                    }
                });
            }
            while let Some(result) = workers.join_next().await {
                result.unwrap();
            }
        });
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("ca.pem"), ca.ca.pem()).unwrap();
        let (client, key) = ca.leaf(vec![]);
        let client_path = directory.path().join("client.identity");
        let key_path = directory.path().join("client.key");
        // Keep the mTLS leaf outside the CA filename filter.
        let client_pem = format!(
            "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n",
            base64ct::Base64::encode_string(client.as_ref())
        );
        std::fs::write(&client_path, client_pem).unwrap();
        std::fs::write(&key_path, key.serialize_pem()).unwrap();
        let service = Arc::new(CrlService::new());
        service.set_allowed_hosts(&["127.0.0.1".into()]).unwrap();
        let tls = crate::tls::build_config_with_identity(
            directory.path(),
            false,
            mutual.then_some(client_path.as_path()),
            mutual.then_some(key_path.as_path()),
            service.clone(),
        )
        .unwrap();
        let conn = crate::Connection::connect(
            &format!("wss://localhost:{}", address.port()),
            tls.clone(),
            None,
            true,
        )
        .await
        .unwrap();
        assert_eq!(conn.revocation_status().state, RevocationState::Checked);
        let second = crate::Connection::connect(
            &format!("wss://localhost:{}", address.port()),
            tls,
            None,
            true,
        )
        .await
        .unwrap();
        let mut second_status = second.security_updates();
        let mut status = conn.security_updates();
        *http.bytes.write().unwrap() = ca.crl(true, 2, -30, 3600).der().as_ref().to_vec();
        for entry in &service.entries {
            entry.value().lock().await.blob.as_mut().unwrap().fetched_at = now() - REFRESH_SECONDS;
        }
        tokio::task::yield_now().await;
        service.refresh_active();
        tokio::time::timeout(Duration::from_secs(2), async {
            while status.borrow().state != RevocationState::Revoked {
                status.changed().await.unwrap();
            }
            while second_status.borrow().state != RevocationState::Revoked {
                second_status.changed().await.unwrap();
            }
        })
        .await
        .unwrap();
        assert!(conn.is_closed());
        assert!(second.is_closed());
        assert!(matches!(
            conn.create_stream().await,
            Err(Error::CertificateRevoked(_))
        ));
        assert!(matches!(
            conn.send_raw(1, crate::frame::FrameKind::Conclusion, &[])
                .await,
            Err(Error::CertificateRevoked(_))
        ));
        conn.close().await;
        second.close().await;
        tokio::time::timeout(Duration::from_secs(2), server_task)
            .await
            .unwrap()
            .unwrap();
    }
}

#[tokio::test]
async fn proxy_tunnels_pin_dns_addresses_without_leaking_target_credentials() {
    provider();
    let ca = Authority::new("CA");
    let http = HttpFixture::new(ca.crl(false, 1, -60, 3600).der().as_ref().to_vec()).await;
    let url = url::Url::parse(&http.url.replace("127.0.0.1", "localhost")).unwrap();
    for scheme in ["http", "socks4", "socks4a", "socks5", "socks5h"] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy = format!("{scheme}://{}", listener.local_addr().unwrap());
        let target_port = url.port().unwrap();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut version = [0];
            socket.read_exact(&mut version).await.unwrap();
            match version[0] {
                b'C' => {
                    let mut request = vec![b'C'];
                    while !request.ends_with(b"\r\n\r\n") {
                        let mut byte = [0];
                        socket.read_exact(&mut byte).await.unwrap();
                        request.push(byte[0]);
                    }
                    let text = String::from_utf8(request).unwrap();
                    assert!(
                        text.starts_with(&format!("CONNECT 127.0.0.1:{target_port} ")),
                        "{text}"
                    );
                    assert!(!text.to_ascii_lowercase().contains("authorization"));
                    socket
                        .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                        .await
                        .unwrap();
                }
                4 => {
                    let mut header = [0; 7];
                    socket.read_exact(&mut header).await.unwrap();
                    assert_eq!(header[0], 1);
                    assert_eq!(&header[3..7], &[127, 0, 0, 1]);
                    let mut byte = [1];
                    while byte[0] != 0 {
                        socket.read_exact(&mut byte).await.unwrap();
                    }
                    socket.write_all(&[0, 90, 0, 0, 0, 0, 0, 0]).await.unwrap();
                }
                5 => {
                    let mut count = [0];
                    socket.read_exact(&mut count).await.unwrap();
                    let mut methods = vec![0; count[0] as usize];
                    socket.read_exact(&mut methods).await.unwrap();
                    socket.write_all(&[5, 0]).await.unwrap();
                    let mut request = [0; 10];
                    socket.read_exact(&mut request).await.unwrap();
                    assert_eq!(&request[..4], &[5, 1, 0, 1]);
                    assert_eq!(&request[4..8], &[127, 0, 0, 1]);
                    socket
                        .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 0])
                        .await
                        .unwrap();
                }
                _ => panic!("unexpected proxy protocol"),
            }
            let mut target = tokio::net::TcpStream::connect(("127.0.0.1", target_port))
                .await
                .unwrap();
            let _ = tokio::io::copy_bidirectional(&mut socket, &mut target).await;
        });
        let bytes =
            crate::crl_fetch::fetch(&url, &["localhost".into()], Some(&proxy), true, ca.roots())
                .await
                .unwrap();
        assert!(validate(&bytes, &ca.issuer()).is_ok());
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap();
    }
}
