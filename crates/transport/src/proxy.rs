//! SOCKS5 proxy support.
//!
//! Establishes a TCP connection through a SOCKS5 proxy server.

use cfms_core::Result;
use std::net::SocketAddr;
use tokio::net::TcpStream;

/// Connect to `target_host:target_port` through a SOCKS5 proxy at `proxy_addr`.
///
/// `proxy_addr` can be an IP:port string or a hostname:port string.
///
/// # Errors
/// Returns [`Error::Connection`] if the proxy connection fails or the SOCKS5
/// handshake is rejected.
pub async fn socks5_connect(
    proxy_addr: &str,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream> {
    // Resolve proxy address
    let proxy_socket: SocketAddr = proxy_addr
        .parse()
        .map_err(|e| cfms_core::Error::Connection(format!("invalid proxy address: {e}")))?;

    // Connect via tokio-socks
    let stream = tokio_socks::tcp::Socks5Stream::connect(proxy_socket, (target_host, target_port))
        .await
        .map_err(|e| cfms_core::Error::Connection(format!("SOCKS5 connection failed: {e}")))?;

    Ok(stream.into_inner())
}
