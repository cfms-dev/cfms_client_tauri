//! Virtual stream abstraction over a multiplexed connection.
//!
//! Each [`Stream`] represents one logical channel identified by its
//! `frame_id`.  Incoming frames are queued via a Tokio MPSC channel fed by
//! the owning [`Connection`](super::connector::Connection).  Outgoing
//! frames are sent through the connection's `send_raw` method.

use cfms_core::Result;
use tokio::sync::mpsc;

use crate::connector::Connection;
use crate::frame::FrameKind;

/// A logical stream within a multiplexed WebSocket connection.
///
/// Created by [`Connection::create_stream`] (client-initiated, odd IDs) or
/// received via [`Connection::accept_stream`] (server-initiated, even IDs).
///
/// # Sending
/// Call [`send`](Stream::send) with a reference to the owning [`Connection`]
/// to transmit a payload.  The connection layer prepends the frame header.
///
/// # Receiving
/// Call [`recv`](Stream::recv).  Returns `None` when the stream is closed
/// (remote sent a [`FrameKind::Conclusion`] or the connection dropped).
pub struct Stream {
    /// Stream identifier (matches the frame `id` field).
    pub id: u32,

    /// Receiver side — the connection's dispatch loop feeds incoming
    /// frame payloads here.
    rx: mpsc::Receiver<Vec<u8>>,
}

impl Stream {
    /// Create a new stream pair.
    ///
    /// Returns the sender (to be held by the connection's dispatch loop)
    /// and the [`Stream`] (to be given to the consumer).
    ///
    /// `buffer` controls how many frames can be queued before backpressure
    /// kicks in on the dispatch loop.
    pub(crate) fn new(id: u32, buffer: usize) -> (mpsc::Sender<Vec<u8>>, Self) {
        let (tx, rx) = mpsc::channel(buffer);
        (tx, Self { id, rx })
    }

    /// Send a payload on this stream through `conn`.
    ///
    /// The connection prepends the frame header (with [`FrameKind::Process`])
    /// before writing to the WebSocket.
    pub async fn send(&self, conn: &Connection, data: Vec<u8>) -> Result<()> {
        conn.send_raw(self.id, FrameKind::Process, &data).await
    }

    /// Receive the next data frame on this stream.
    ///
    /// Returns `None` when the stream has been closed (remote sent a
    /// [`FrameKind::Conclusion`] or the connection was dropped).
    pub async fn recv(&mut self) -> Option<Vec<u8>> {
        self.rx.recv().await
    }

    /// Send a final frame and close the stream.
    pub async fn send_final(&self, conn: &Connection, data: Vec<u8>) -> Result<()> {
        conn.send_raw(self.id, FrameKind::Conclusion, &data).await
    }
}

impl std::fmt::Debug for Stream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Stream").field("id", &self.id).finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn send_recv_ordering() {
        let (tx, mut stream) = Stream::new(1, 16);

        tx.send(b"first".to_vec()).await.unwrap();
        tx.send(b"second".to_vec()).await.unwrap();
        tx.send(b"third".to_vec()).await.unwrap();
        drop(tx); // close sender — the Stream no longer holds a clone

        assert_eq!(stream.recv().await.unwrap(), b"first");
        assert_eq!(stream.recv().await.unwrap(), b"second");
        assert_eq!(stream.recv().await.unwrap(), b"third");
        assert!(stream.recv().await.is_none());
    }

    #[tokio::test]
    async fn closed_sender_returns_none() {
        let (tx, mut stream) = Stream::new(1, 4);
        drop(tx);
        assert!(stream.recv().await.is_none());
    }
}
