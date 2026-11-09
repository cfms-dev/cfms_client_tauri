//! Bounded, credential-free CRL retrieval. Resolve once and tunnel to the vetted IP,
//! including with remote-DNS proxies; the original name is used only for Host/SNI.
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use bytes::Bytes;
use http_body_util::{BodyExt, Empty};
use hyper::{Request, header};
use hyper_util::rt::TokioIo;
use rustls::pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncWrite};

pub(super) const MAX_CRL_BYTES: usize = 32 * 1024 * 1024;
pub(super) trait IoStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> IoStream for T {}

pub fn normalize_allowed_hosts(hosts: &[String]) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    for input in hosts {
        let input = input.trim();
        if input.is_empty() {
            continue;
        }
        if input.contains(['*', '/', '?', '#', '@']) {
            return Err("CRL allowlist requires exact hostnames or IP addresses".into());
        }
        let normalized = if let Ok(ip) = input.trim_matches(['[', ']']).parse::<IpAddr>() {
            ip.to_string()
        } else {
            let url = url::Url::parse(&format!("http://{input}"))
                .map_err(|_| "Invalid CRL allowlist host")?;
            if url.port().is_some() || url.host_str().is_none() || input.contains(':') {
                return Err("CRL allowlist hosts must not include ports".into());
            }
            url.host_str()
                .unwrap()
                .trim_end_matches('.')
                .to_ascii_lowercase()
        };
        if !result.contains(&normalized) {
            result.push(normalized);
        }
    }
    Ok(result)
}

pub(super) fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            const DENIED: &[&str] = &[
                "0.0.0.0/8",
                "10.0.0.0/8",
                "100.64.0.0/10",
                "127.0.0.0/8",
                "169.254.0.0/16",
                "172.16.0.0/12",
                "192.0.0.0/24",
                "192.0.2.0/24",
                "192.168.0.0/16",
                "198.18.0.0/15",
                "198.51.100.0/24",
                "203.0.113.0/24",
                "224.0.0.0/4",
                "240.0.0.0/4",
            ];
            !DENIED
                .iter()
                .any(|net| net.parse::<ipnet::Ipv4Net>().unwrap().contains(&ip))
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return is_public_ip(v4.into());
            }
            "2000::/3".parse::<ipnet::Ipv6Net>().unwrap().contains(&ip)
                && !["2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20"]
                    .iter()
                    .any(|net| net.parse::<ipnet::Ipv6Net>().unwrap().contains(&ip))
        }
    }
}

pub(super) async fn fetch(
    url: &url::Url,
    allowed: &[String],
    proxy: Option<&str>,
    force_ipv4: bool,
    roots: Arc<rustls::RootCertStore>,
) -> Result<Vec<u8>, &'static str> {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("unsupported_url");
    }
    let host = match url.host().ok_or("unsupported_url")? {
        url::Host::Domain(host) => host.trim_end_matches('.').to_ascii_lowercase(),
        url::Host::Ipv4(ip) => ip.to_string(),
        url::Host::Ipv6(ip) => ip.to_string(),
    };
    let port = url.port_or_known_default().ok_or("unsupported_url")?;
    let authorized = allowed.contains(&host);
    let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| "download_failed")?
        .filter(|address| !force_ipv4 || address.is_ipv4())
        .collect();
    // Reject the complete resolution if it mixes public and forbidden addresses.
    if addresses.is_empty() || (!authorized && addresses.iter().any(|a| !is_public_ip(a.ip()))) {
        return Err("blocked_address");
    }
    let mut io: Option<Box<dyn IoStream>> = None;
    for address in addresses {
        let attempt: Result<Box<dyn IoStream>, _> = if let Some(proxy) = proxy {
            crate::proxy::connect_proxy(proxy, &address.ip().to_string(), port)
                .await
                .map(|stream| Box::new(stream) as Box<dyn IoStream>)
        } else {
            tokio::net::TcpStream::connect(address)
                .await
                .map(|stream| Box::new(stream) as Box<dyn IoStream>)
                .map_err(cfms_core::Error::Io)
        };
        if let Ok(stream) = attempt {
            io = Some(stream);
            break;
        }
    }
    let mut io = io.ok_or("download_failed")?;
    if url.scheme() == "https" {
        let mut download_roots = (*roots).clone();
        download_roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let config = rustls::ClientConfig::builder()
            .with_root_certificates(download_roots)
            .with_no_client_auth();
        let name = ServerName::try_from(host.clone()).map_err(|_| "unsupported_url")?;
        io = Box::new(
            tokio_rustls::TlsConnector::from(Arc::new(config))
                .connect(name, io)
                .await
                .map_err(|_| "download_failed")?,
        );
    }
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(io))
        .await
        .map_err(|_| "download_failed")?;
    let driver = tokio::spawn(async move {
        let _ = connection.await;
    });
    // Aborting the request future must also close its socket and connection driver.
    struct Driver(tokio::task::JoinHandle<()>);
    impl Drop for Driver {
        fn drop(&mut self) {
            self.0.abort();
        }
    }
    let _driver = Driver(driver);
    let authority = &url[url::Position::BeforeHost..url::Position::AfterPort];
    let path = &url[url::Position::BeforePath..url::Position::AfterQuery];
    let request = Request::get(path)
        .header(header::HOST, authority)
        .header(
            header::USER_AGENT,
            concat!("CFMS/", env!("CARGO_PKG_VERSION")),
        )
        .header(header::CONNECTION, "close")
        .body(Empty::<Bytes>::new())
        .map_err(|_| "unsupported_url")?;
    let response = sender
        .send_request(request)
        .await
        .map_err(|_| "download_failed")?;
    if !response.status().is_success() {
        return Err("download_failed");
    }
    if response.headers().contains_key(header::CONTENT_ENCODING) {
        return Err("unsupported_crl");
    }
    if response
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|h| h.to_str().ok())
        .and_then(|n| n.parse::<u64>().ok())
        .is_some_and(|n| n > MAX_CRL_BYTES as u64)
    {
        return Err("size_limit");
    }
    let mut body = response.into_body();
    let mut bytes = Vec::new();
    while let Some(frame) = body.frame().await {
        let frame = frame.map_err(|_| "download_failed")?;
        if let Ok(data) = frame.into_data() {
            if bytes.len().saturating_add(data.len()) > MAX_CRL_BYTES {
                return Err("size_limit");
            }
            bytes.extend_from_slice(&data);
        }
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_private_special_and_embedded_addresses() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "100.100.100.200",
            "169.254.169.254",
            "192.168.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "fe80::1",
            "64:ff9b::a00:1",
            "2001:db8::1",
            "2002:7f00:1::",
        ] {
            assert!(!is_public_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            assert!(is_public_ip(ip.parse().unwrap()));
        }
    }

    #[test]
    fn allowlist_is_exact_and_canonical() {
        assert_eq!(
            normalize_allowed_hosts(&["CA.Example.".into(), "ca.example".into(), "[::1]".into()])
                .unwrap(),
            vec!["ca.example", "::1"]
        );
        for host in [
            "*.example",
            "http://ca.example",
            "ca.example:443",
            "user@ca.example",
            "ca.example/path",
            "ca.example#x",
        ] {
            assert!(normalize_allowed_hosts(&[host.into()]).is_err(), "{host}");
        }
    }

    #[tokio::test]
    async fn refuses_redirects_and_oversize_before_following_or_reading() {
        for response in [
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/\r\nContent-Length: 0\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 33554433\r\n\r\n",
        ] {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = url::Url::parse(&format!(
                "http://{}/list.crl",
                listener.local_addr().unwrap()
            ))
            .unwrap();
            let task = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0; 1024];
                assert!(stream.read(&mut request).await.unwrap() > 0);
                stream.write_all(response.as_bytes()).await.unwrap();
            });
            let result = fetch(
                &url,
                &["127.0.0.1".into()],
                None,
                false,
                Arc::new(rustls::RootCertStore::empty()),
            )
            .await;
            assert!(result.is_err());
            task.await.unwrap();
        }
    }

    #[tokio::test]
    async fn cancellation_closes_the_download_socket() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = url::Url::parse(&format!(
            "http://{}/list.crl",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            assert!(socket.read(&mut request).await.unwrap() > 0);
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n")
                .await
                .unwrap();
            let _ = seen_tx.send(());
            assert_eq!(socket.read(&mut request).await.unwrap(), 0);
        });
        let download = tokio::spawn(async move {
            fetch(
                &url,
                &["127.0.0.1".into()],
                None,
                false,
                Arc::new(rustls::RootCertStore::empty()),
            )
            .await
        });
        seen_rx.await.unwrap();
        download.abort();
        let _ = download.await;
        tokio::time::timeout(std::time::Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn ipv6_literal_preserves_bracketed_host_header() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let Ok(listener) = tokio::net::TcpListener::bind("[::1]:0").await else {
            return;
        };
        let address = listener.local_addr().unwrap();
        let url = url::Url::parse(&format!("http://{address}/list.crl")).unwrap();
        let task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 4096];
            let n = stream.read(&mut bytes).await.unwrap();
            assert!(
                String::from_utf8_lossy(&bytes[..n])
                    .to_ascii_lowercase()
                    .contains(&format!("host: {address}"))
            );
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
                .await
                .unwrap();
        });
        assert!(
            fetch(
                &url,
                &["::1".into()],
                None,
                false,
                Arc::new(rustls::RootCertStore::empty())
            )
            .await
            .unwrap()
            .is_empty()
        );
        task.await.unwrap();
    }
}
