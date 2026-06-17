//! File upload with progress tracking.
//!
//! Implements the client side of the CFMS upload protocol:
//!
//! 1. Send `upload_file` request → server responds with `transfer_file`
//! 2. Client sends file metadata (SHA-256, file size)
//! 3. Server responds with `ready <chunk_size>` → client streams raw chunks
//! 4. Server sends final confirmation

use cfms_core::Result;
use cfms_transport::Connection;
use serde::Deserialize;
use std::path::Path;
use tokio::io::AsyncReadExt;

use crate::verify;

/// Progress callback: `(current_bytes, total_bytes)`.
pub type UploadProgressFn = dyn Fn(u64, u64) + Send + Sync;

/// Server response to an upload initiation.
#[derive(Debug, Deserialize)]
struct UploadResponse {
    action: String,
    #[allow(dead_code)]
    data: Option<serde_json::Value>,
}

/// Upload a file to the server.
///
/// # Arguments
/// - `conn` — established multiplexed connection.
/// - `task_id` — server-side task identifier.
/// - `source` — path to the local file to upload.
/// - `on_progress` — called with `(current_bytes, total_bytes)`.
pub async fn send(
    conn: &Connection,
    task_id: &str,
    source: &Path,
    on_progress: &UploadProgressFn,
) -> Result<()> {
    let mut stream = conn.create_stream().await?;

    // --- Step 1: initiate upload ---
    let request = serde_json::json!({
        "action": "upload_file",
        "data": { "task_id": task_id }
    });
    stream
        .send(
            conn,
            serde_json::to_vec(&request).map_err(|e| cfms_core::Error::Protocol(e.to_string()))?,
        )
        .await?;

    let response_raw = stream.recv().await.ok_or_else(|| {
        cfms_core::Error::Connection("stream closed before upload metadata".into())
    })?;

    let response: UploadResponse = serde_json::from_slice(&response_raw)
        .map_err(|e| cfms_core::Error::Protocol(format!("invalid upload response: {e}")))?;

    if response.action != "transfer_file" {
        return Err(cfms_core::Error::Protocol(format!(
            "unexpected upload action: {}",
            response.action
        )));
    }

    // --- Step 2: send file metadata ---
    let file_size = std::fs::metadata(source)?.len();
    let sha256_hex = if file_size > 0 {
        // Offload SHA-256 hashing to a blocking thread — hashing a large
        // file on the async worker would stall all concurrent tasks.
        let hash = verify::compute_sha256_async(source.to_path_buf()).await?;
        hash.iter().map(|b| format!("{b:02x}")).collect::<String>()
    } else {
        String::new()
    };

    let metadata_msg = serde_json::json!({
        "action": "transfer_file",
        "data": {
            "sha256": sha256_hex,
            "file_size": file_size
        }
    });
    stream
        .send(
            conn,
            serde_json::to_vec(&metadata_msg)
                .map_err(|e| cfms_core::Error::Protocol(e.to_string()))?,
        )
        .await?;

    // --- Step 3: wait for ready signal ---
    let ready_raw = stream
        .recv()
        .await
        .ok_or_else(|| cfms_core::Error::Connection("stream closed before ready signal".into()))?;

    let ready_str =
        String::from_utf8(ready_raw).map_err(|e| cfms_core::Error::Protocol(e.to_string()))?;

    let Some(chunk_size) = parse_ready_signal(&ready_str, file_size)? else {
        on_progress(0, file_size);
        return Ok(());
    };

    // --- Step 4: stream the file ---
    let mut file = tokio::fs::File::open(source).await?;
    let mut buffer = vec![0u8; chunk_size];
    let mut bytes_sent: u64 = 0;

    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }

        stream.send(conn, buffer[..n].to_vec()).await?;

        bytes_sent += n as u64;
        on_progress(bytes_sent, file_size);

        if n < chunk_size {
            break;
        }
    }

    // --- Step 5: wait for server confirmation ---
    let _confirmation = stream.recv().await.ok_or_else(|| {
        cfms_core::Error::Connection("stream closed before upload confirmation".into())
    })?;

    Ok(())
}

fn parse_ready_signal(ready_str: &str, file_size: u64) -> Result<Option<usize>> {
    if ready_str == "stop" {
        return if file_size == 0 {
            Ok(None)
        } else {
            Err(cfms_core::Error::Protocol(
                "server sent stop for a non-empty upload".into(),
            ))
        };
    }

    Ok(Some(
        ready_str
            .strip_prefix("ready ")
            .and_then(|s| s.split_whitespace().next())
            .and_then(|n| n.parse().ok())
            .unwrap_or(8192),
    ))
}

#[cfg(test)]
mod tests {
    use super::parse_ready_signal;

    #[test]
    fn stop_completes_zero_byte_upload() {
        assert_eq!(parse_ready_signal("stop", 0).unwrap(), None);
    }

    #[test]
    fn stop_rejects_non_empty_upload() {
        let err = parse_ready_signal("stop", 1).unwrap_err().to_string();
        assert!(err.contains("server sent stop for a non-empty upload"));
    }

    #[test]
    fn ready_signal_uses_server_chunk_size() {
        assert_eq!(parse_ready_signal("ready 16384", 42).unwrap(), Some(16384));
    }
}
