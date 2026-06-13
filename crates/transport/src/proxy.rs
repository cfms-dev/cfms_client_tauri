//! Proxy support for WebSocket transports.
//!
//! Establishes a raw tunnel to the target server through HTTP(S) CONNECT,
//! SOCKS4/SOCKS4a, or SOCKS5/SOCKS5h proxies.

use base64ct::Encoding;
use cfms_core::Result;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::TcpStream;
use tokio_rustls::client::TlsStream;
use tokio_socks::tcp::socks4::Socks4Stream;
use tokio_socks::tcp::socks5::Socks5Stream;

const HTTP_CONNECT_RESPONSE_LIMIT: usize = 16 * 1024;

pub enum ProxyStream {
    Http(TcpStream),
    Https(Box<TlsStream<TcpStream>>),
    Socks4(Socks4Stream<TcpStream>),
    Socks5(Socks5Stream<TcpStream>),
}

impl AsyncRead for ProxyStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match &mut *self {
            Self::Http(stream) => Pin::new(stream).poll_read(cx, buf),
            Self::Https(stream) => Pin::new(&mut **stream).poll_read(cx, buf),
            Self::Socks4(stream) => Pin::new(stream).poll_read(cx, buf),
            Self::Socks5(stream) => Pin::new(stream).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for ProxyStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match &mut *self {
            Self::Http(stream) => Pin::new(stream).poll_write(cx, data),
            Self::Https(stream) => Pin::new(&mut **stream).poll_write(cx, data),
            Self::Socks4(stream) => Pin::new(stream).poll_write(cx, data),
            Self::Socks5(stream) => Pin::new(stream).poll_write(cx, data),
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match &mut *self {
            Self::Http(stream) => Pin::new(stream).poll_flush(cx),
            Self::Https(stream) => Pin::new(&mut **stream).poll_flush(cx),
            Self::Socks4(stream) => Pin::new(stream).poll_flush(cx),
            Self::Socks5(stream) => Pin::new(stream).poll_flush(cx),
        }
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match &mut *self {
            Self::Http(stream) => Pin::new(stream).poll_shutdown(cx),
            Self::Https(stream) => Pin::new(&mut **stream).poll_shutdown(cx),
            Self::Socks4(stream) => Pin::new(stream).poll_shutdown(cx),
            Self::Socks5(stream) => Pin::new(stream).poll_shutdown(cx),
        }
    }
}

struct ProxyConfig {
    scheme: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
}

pub async fn connect_tcp(host: &str, port: u16, force_ipv4: bool) -> Result<TcpStream> {
    if !force_ipv4 {
        return TcpStream::connect(format_host_port(host, port))
            .await
            .map_err(|e| cfms_core::Error::Connection(format!("TCP connect failed: {e}")));
    }

    let addrs = tokio::net::lookup_host(format_host_port(host, port))
        .await
        .map_err(|e| cfms_core::Error::Connection(format!("DNS lookup failed: {e}")))?;

    let mut last_error = None;
    for addr in addrs.filter(|addr| addr.is_ipv4()) {
        match TcpStream::connect(addr).await {
            Ok(stream) => return Ok(stream),
            Err(err) => last_error = Some(err),
        }
    }

    Err(cfms_core::Error::Connection(
        last_error
            .map(|err| format!("IPv4 TCP connect failed: {err}"))
            .unwrap_or_else(|| format!("no IPv4 address found for {host}")),
    ))
}

pub async fn connect_proxy(
    proxy_url: &str,
    target_host: &str,
    target_port: u16,
) -> Result<ProxyStream> {
    let proxy = parse_proxy_url(proxy_url)?;
    match proxy.scheme.as_str() {
        "http" => http_connect(proxy, target_host, target_port, false).await,
        "https" => http_connect(proxy, target_host, target_port, true).await,
        "socks4" | "socks4a" => socks4_connect(proxy, target_host, target_port).await,
        "socks5" | "socks5h" => socks5_connect(proxy, target_host, target_port).await,
        _ => Err(cfms_core::Error::Connection(format!(
            "unsupported proxy scheme: {}",
            proxy.scheme
        ))),
    }
}

fn format_host_port(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn parse_proxy_url(raw: &str) -> Result<ProxyConfig> {
    let url = url::Url::parse(raw)
        .map_err(|e| cfms_core::Error::Connection(format!("invalid proxy URL: {e}")))?;
    let scheme = url.scheme().to_ascii_lowercase();
    let host = url
        .host_str()
        .ok_or_else(|| cfms_core::Error::Connection("proxy URL is missing a host".to_string()))?
        .to_string();
    let port = url.port_or_known_default().ok_or_else(|| {
        cfms_core::Error::Connection(format!("proxy URL is missing a port: {raw}"))
    })?;

    Ok(ProxyConfig {
        scheme,
        host,
        port,
        username: percent_decode(url.username()),
        password: url.password().map(percent_decode),
    })
}

async fn http_connect(
    proxy: ProxyConfig,
    target_host: &str,
    target_port: u16,
    secure_proxy: bool,
) -> Result<ProxyStream> {
    let tcp_stream = connect_tcp(&proxy.host, proxy.port, false).await?;

    if secure_proxy {
        let mut root_store = rustls::RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let tls_config = rustls::ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth();
        let connector = tokio_rustls::TlsConnector::from(Arc::new(tls_config));
        let server_name = rustls::pki_types::ServerName::try_from(proxy.host.clone())
            .map_err(|_| cfms_core::Error::Connection("invalid HTTPS proxy host".to_string()))?;
        let mut tls_stream = connector
            .connect(server_name, tcp_stream)
            .await
            .map_err(|e| cfms_core::Error::Connection(format!("HTTPS proxy TLS failed: {e}")))?;
        write_http_connect(&mut tls_stream, &proxy, target_host, target_port).await?;
        Ok(ProxyStream::Https(Box::new(tls_stream)))
    } else {
        let mut tcp_stream = tcp_stream;
        write_http_connect(&mut tcp_stream, &proxy, target_host, target_port).await?;
        Ok(ProxyStream::Http(tcp_stream))
    }
}

async fn write_http_connect<S>(
    stream: &mut S,
    proxy: &ProxyConfig,
    target_host: &str,
    target_port: u16,
) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let target = format_host_port(target_host, target_port);
    let mut request =
        format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\nProxy-Connection: Keep-Alive\r\n");
    if !proxy.username.is_empty() {
        let credentials = format!(
            "{}:{}",
            proxy.username,
            proxy.password.as_deref().unwrap_or_default()
        );
        let auth = base64ct::Base64::encode_string(credentials.as_bytes());
        request.push_str(&format!("Proxy-Authorization: Basic {auth}\r\n"));
    }
    request.push_str("\r\n");

    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| cfms_core::Error::Connection(format!("HTTP proxy CONNECT failed: {e}")))?;
    stream
        .flush()
        .await
        .map_err(|e| cfms_core::Error::Connection(format!("HTTP proxy flush failed: {e}")))?;

    let mut response = Vec::new();
    let mut buffer = [0_u8; 1024];
    while !response.windows(4).any(|window| window == b"\r\n\r\n") {
        if response.len() >= HTTP_CONNECT_RESPONSE_LIMIT {
            return Err(cfms_core::Error::Connection(
                "HTTP proxy response headers are too large".to_string(),
            ));
        }
        let read = stream
            .read(&mut buffer)
            .await
            .map_err(|e| cfms_core::Error::Connection(format!("HTTP proxy read failed: {e}")))?;
        if read == 0 {
            return Err(cfms_core::Error::Connection(
                "HTTP proxy closed before CONNECT response".to_string(),
            ));
        }
        response.extend_from_slice(&buffer[..read]);
    }

    let text = String::from_utf8_lossy(&response);
    let status_line = text.lines().next().unwrap_or_default();
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(0);
    if status != 200 {
        return Err(cfms_core::Error::Connection(format!(
            "HTTP proxy CONNECT rejected: {status_line}"
        )));
    }

    Ok(())
}

async fn socks4_connect(
    proxy: ProxyConfig,
    target_host: &str,
    target_port: u16,
) -> Result<ProxyStream> {
    let proxy_stream = connect_tcp(&proxy.host, proxy.port, false).await?;
    let target = (target_host, target_port);
    let stream = if proxy.username.is_empty() {
        Socks4Stream::connect_with_socket(proxy_stream, target).await
    } else {
        Socks4Stream::connect_with_userid_and_socket(proxy_stream, target, &proxy.username).await
    }
    .map_err(|e| cfms_core::Error::Connection(format!("SOCKS4 connection failed: {e}")))?;

    Ok(ProxyStream::Socks4(stream))
}

async fn socks5_connect(
    proxy: ProxyConfig,
    target_host: &str,
    target_port: u16,
) -> Result<ProxyStream> {
    let proxy_stream = connect_tcp(&proxy.host, proxy.port, false).await?;
    let target = (target_host, target_port);
    let stream = if proxy.username.is_empty() {
        Socks5Stream::connect_with_socket(proxy_stream, target).await
    } else {
        Socks5Stream::connect_with_password_and_socket(
            proxy_stream,
            target,
            &proxy.username,
            proxy.password.as_deref().unwrap_or_default(),
        )
        .await
    }
    .map_err(|e| cfms_core::Error::Connection(format!("SOCKS5 connection failed: {e}")))?;

    Ok(ProxyStream::Socks5(stream))
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
        {
            decoded.push((high << 4) | low);
            index += 3;
            continue;
        }

        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
