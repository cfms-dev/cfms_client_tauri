//! WebSocket connection manager with frame multiplexing.
//!
//! [`Connection`] wraps a WSS [`tokio_tungstenite`] WebSocket and provides
//! multiplexed virtual streams via the frame protocol.  All frames on the
//! wire carry a [`FrameHeader`](super::frame::FrameHeader) so that multiple
//! logical streams can share a single TCP/TLS connection.

use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use cfms_core::Result;
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{Connector, MaybeTlsStream, WebSocketStream, client_async_tls_with_config};
use tracing::{debug, error, info, warn};

use crate::frame::{self, FrameHeader, FrameKind};
use crate::stream::Stream;

// ---------------------------------------------------------------------------
// Type alias
// ---------------------------------------------------------------------------

type WsStream = WebSocketStream<MaybeTlsStream<MaybeProxyStream>>;

enum MaybeProxyStream {
    Direct(TcpStream),
    Socks5(tokio_socks::tcp::Socks5Stream<TcpStream>),
}

impl AsyncRead for MaybeProxyStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match &mut *self {
            Self::Direct(stream) => Pin::new(stream).poll_read(cx, buf),
            Self::Socks5(stream) => Pin::new(stream).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for MaybeProxyStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match &mut *self {
            Self::Direct(stream) => Pin::new(stream).poll_write(cx, data),
            Self::Socks5(stream) => Pin::new(stream).poll_write(cx, data),
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match &mut *self {
            Self::Direct(stream) => Pin::new(stream).poll_flush(cx),
            Self::Socks5(stream) => Pin::new(stream).poll_flush(cx),
        }
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match &mut *self {
            Self::Direct(stream) => Pin::new(stream).poll_shutdown(cx),
            Self::Socks5(stream) => Pin::new(stream).poll_shutdown(cx),
        }
    }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/// Channel capacity for per-stream MPSC queues.
const STREAM_BUFFER: usize = 256;

/// A multiplexed WebSocket connection to a CFMS server.
///
/// # Stream ID allocation
///
/// - *Odd* IDs (1, 3, 5, …) are client-initiated streams.
/// - *Even* IDs (0, 2, 4, …) are server-initiated streams.
///
/// # Lifecycle
///
/// 1. Call [`Connection::connect`] to establish the WSS connection.
/// 2. The receive loop is spawned automatically on connect.
/// 3. Call [`Connection::create_stream`] to open client-initiated streams.
/// 4. Call [`Connection::accept_stream`] to receive server-initiated streams.
/// 5. Call [`Connection::close`] to shut down.
#[derive(Clone)]
pub struct Connection {
    /// Shared WebSocket sender — cloned per `Connection` instance.
    ws_tx: Arc<tokio::sync::Mutex<futures_util::stream::SplitSink<WsStream, Message>>>,

    /// Map from stream ID → MPSC sender.  The receive loop pushes incoming
    /// frames into the matching channel.
    streams: Arc<DashMap<u32, mpsc::Sender<Vec<u8>>>>,

    /// Server-initiated stream IDs that haven't been accepted yet.
    new_streams: Arc<tokio::sync::Mutex<tokio::sync::mpsc::Receiver<Stream>>>,
    new_streams_tx: tokio::sync::mpsc::Sender<Stream>,

    /// Next client-initiated stream ID (odd numbers only).
    next_stream_id: Arc<tokio::sync::Mutex<u32>>,

    /// Set once the receive loop exits or a send/close operation fails.
    closed: Arc<AtomicBool>,
}

impl Connection {
    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /// Establish a WSS connection to `url`.
    ///
    /// - `url`: WebSocket URL (e.g. `"wss://cfms.example.com/ws"`).
    /// - `tls`: Pre-configured TLS [`rustls::ClientConfig`] loaded from the
    ///   local CA certificate store.
    /// - `proxy`: Optional SOCKS5 proxy address.  When `Some`, a raw TCP
    ///   connection is established through the proxy first.
    pub async fn connect(
        url: &str,
        tls: rustls::ClientConfig,
        proxy: Option<&str>,
        force_ipv4: bool,
    ) -> Result<Self> {
        if let Some(proxy_addr) = proxy {
            // Extract host and port from the URL for SOCKS5.
            let (host, port) = parse_ws_url(url)?;

            let tcp_stream = crate::proxy::socks5_connect(proxy_addr, &host, port).await?;
            let transport = MaybeProxyStream::Socks5(tcp_stream);
            return Self::connect_over_stream(url, tls, transport).await;
        }

        let (host, port) = parse_ws_url(url)?;
        let tcp_stream = connect_tcp(&host, port, force_ipv4).await?;
        Self::connect_over_stream(url, tls, MaybeProxyStream::Direct(tcp_stream)).await
    }

    async fn connect_over_stream(
        url: &str,
        tls: rustls::ClientConfig,
        transport: MaybeProxyStream,
    ) -> Result<Self> {
        let connector = Connector::Rustls(Arc::new(tls));
        let (ws_stream, _response) =
            client_async_tls_with_config(url, transport, None, Some(connector))
                .await
                .map_err(|e| cfms_core::Error::Connection(e.to_string()))?;

        info!("WebSocket connected to {url}");

        let (ws_tx, ws_rx) = ws_stream.split();

        let (new_streams_tx, new_streams_rx) = mpsc::channel(64);

        let conn = Self {
            ws_tx: Arc::new(tokio::sync::Mutex::new(ws_tx)),
            streams: Arc::new(DashMap::new()),
            new_streams: Arc::new(tokio::sync::Mutex::new(new_streams_rx)),
            new_streams_tx,
            next_stream_id: Arc::new(tokio::sync::Mutex::new(1)), // first odd ID
            closed: Arc::new(AtomicBool::new(false)),
        };

        // Spawn the receive dispatch loop.
        let streams = Arc::clone(&conn.streams);
        let new_streams_tx = conn.new_streams_tx.clone();
        let ws_tx_for_close = Arc::clone(&conn.ws_tx);
        let closed = Arc::clone(&conn.closed);
        tokio::spawn(async move {
            if let Err(e) =
                Self::recv_loop(ws_rx, streams, new_streams_tx, Arc::clone(&closed)).await
            {
                error!("Receive loop exited with error: {e}");
            }
            closed.store(true, Ordering::SeqCst);
            // On loop exit, close the WebSocket sender.
            let mut tx = ws_tx_for_close.lock().await;
            let _ = tx.close().await;
        });

        Ok(conn)
    }

    /// Create a client-initiated virtual stream (odd stream ID).
    pub async fn create_stream(&self) -> Result<Stream> {
        let id = {
            let mut next = self.next_stream_id.lock().await;
            let id = *next;
            *next = id.wrapping_add(2);
            id
        };

        let (tx, stream) = Stream::new(id, STREAM_BUFFER);
        self.streams.insert(id, tx);
        debug!("Created client stream {id}");
        Ok(stream)
    }

    /// Wait for a server-initiated virtual stream (even stream ID).
    ///
    /// Returns `None` if the connection has been closed and no more streams
    /// will arrive.
    pub async fn accept_stream(&self) -> Option<Stream> {
        let mut rx = self.new_streams.lock().await;
        rx.recv().await
    }

    /// Return whether the WebSocket has closed or the dispatch loop has ended.
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Close the connection and all associated streams.
    pub async fn close(self) {
        self.closed.store(true, Ordering::SeqCst);
        let mut tx = self.ws_tx.lock().await;
        let _ = tx.close().await;
        info!("Connection closed");
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// Raw send of a frame onto the WebSocket.  Called by [`Stream::send`].
    pub async fn send_raw(&self, frame_id: u32, kind: FrameKind, payload: &[u8]) -> Result<()> {
        let header = FrameHeader { id: frame_id, kind };
        let wire_data = frame::encode(&header, payload);

        let mut tx = self.ws_tx.lock().await;
        if let Err(e) = tx.send(Message::Binary(wire_data)).await {
            self.closed.store(true, Ordering::SeqCst);
            return Err(cfms_core::Error::Connection(format!("send failed: {e}")));
        }

        // If this is a conclusion frame, remove the stream from the map.
        if kind == FrameKind::Conclusion {
            self.streams.remove(&frame_id);
        }

        Ok(())
    }

    /// Receive dispatch loop.  Reads frames from the WebSocket and routes
    /// them to the appropriate per-stream channel.
    async fn recv_loop(
        mut ws_rx: futures_util::stream::SplitStream<WsStream>,
        streams: Arc<DashMap<u32, mpsc::Sender<Vec<u8>>>>,
        new_streams_tx: mpsc::Sender<Stream>,
        closed: Arc<AtomicBool>,
    ) -> Result<()> {
        const PING_INTERVAL: Duration = Duration::from_secs(30);

        loop {
            let msg = tokio::time::timeout(PING_INTERVAL, ws_rx.next()).await;

            match msg {
                Ok(Some(Ok(Message::Binary(data)))) => {
                    let (header, payload) = frame::decode(&data)?;

                    // If this is a new stream (not yet in the map), it's
                    // server-initiated.
                    if !streams.contains_key(&header.id) {
                        let (tx, stream) = Stream::new(header.id, STREAM_BUFFER);
                        streams.insert(header.id, tx);

                        if new_streams_tx.send(stream).await.is_err() {
                            warn!("No listener for server-initiated stream {}", header.id);
                        }
                        debug!("Server-initiated stream {}", header.id);
                    }

                    // Route the payload to the stream's channel.
                    if let Some(tx) = streams.get(&header.id)
                        && tx.send(payload.to_vec()).await.is_err()
                    {
                        debug!("Stream {} receiver dropped", header.id);
                        streams.remove(&header.id);
                    }

                    // Conclusion frame → tear down the stream.
                    if header.kind == FrameKind::Conclusion {
                        streams.remove(&header.id);
                        debug!("Stream {} concluded by remote", header.id);
                    }
                }
                Ok(Some(Ok(Message::Text(text)))) => {
                    debug!("Received text frame (len={}): ignoring", text.len());
                }
                Ok(Some(Ok(Message::Ping(_data)))) => {
                    // Pings are handled automatically by tungstenite.
                }
                Ok(Some(Ok(Message::Pong(_)))) => {
                    // Pong received.
                }
                Ok(Some(Ok(Message::Close(_)))) => {
                    info!("WebSocket close frame received");
                    break;
                }
                Ok(Some(Ok(Message::Frame(_)))) => {
                    // Raw frame — handled by tungstenite internally.
                }
                Ok(Some(Err(e))) => {
                    error!("WebSocket error: {e}");
                    break;
                }
                Ok(None) => {
                    info!("WebSocket stream ended");
                    break;
                }
                Err(_timeout) => {
                    debug!("Keep-alive: no message for {PING_INTERVAL:?}");
                }
            }
        }

        // Drain the stream map — notify all remaining streams.
        streams.clear();
        closed.store(true, Ordering::SeqCst);
        info!("Receive loop exited");

        Ok(())
    }
}

/// Parse host and port from a WebSocket URL.
fn parse_ws_url(url: &str) -> Result<(String, u16)> {
    // Simple parsing: strip the scheme and split host:port/path.
    let without_scheme = url
        .strip_prefix("wss://")
        .or_else(|| url.strip_prefix("ws://"))
        .ok_or_else(|| {
            cfms_core::Error::Connection(format!("invalid WebSocket URL (missing scheme): {url}"))
        })?;

    // Split at the first '/' to separate authority from path.
    let authority = without_scheme.split('/').next().unwrap_or(without_scheme);

    match authority.split_once(':') {
        Some((host, port_str)) => {
            let port: u16 = port_str.parse().map_err(|_| {
                cfms_core::Error::Connection(format!("invalid port in URL: {port_str}"))
            })?;
            Ok((host.to_string(), port))
        }
        None => {
            // Default ports
            let port = if url.starts_with("wss://") { 443 } else { 80 };
            Ok((authority.to_string(), port))
        }
    }
}

fn format_host_port(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

async fn connect_tcp(host: &str, port: u16, force_ipv4: bool) -> Result<TcpStream> {
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

impl std::fmt::Debug for Connection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Connection")
            .field("stream_count", &self.streams.len())
            .finish()
    }
}
