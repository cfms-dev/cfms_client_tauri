//! SOCKS5 proxy support.
//!
//! Establishes a TCP connection through a SOCKS5 proxy server.

use cfms_core::Result;
use tokio::net::TcpStream;
use tokio_socks::tcp::Socks5Stream;

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
) -> Result<Socks5Stream<TcpStream>> {
    // Connect via tokio-socks
    let stream = Socks5Stream::connect(proxy_addr, (target_host, target_port))
        .await
        .map_err(|e| cfms_core::Error::Connection(format!("SOCKS5 connection failed: {e}")))?;

    Ok(stream)
}
