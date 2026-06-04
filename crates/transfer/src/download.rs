//! Encrypted file download.
//!
//! Implements the client side of the CFMS download protocol:
//!
//! 1. Send `download_file` request → receive file metadata
//! 2. Server pushes encrypted chunks → store in SQLite
//! 3. Server delivers AES key → decrypt chunks in order
//! 4. Verify file size and SHA-256 hash

use base64ct::Encoding;
use cfms_core::constants::KEY_LEN;
use cfms_core::{DownloadPhase, Result};
use cfms_transport::Connection;
use serde::Deserialize;
use std::io::Write;
use std::path::Path;

use crate::chunks::ChunkStore;
use crate::decrypt::decrypt_chunk;
use crate::verify;

/// Progress callback: `(phase, progress, message, current_bytes, total_bytes)`.
///
/// - `phase` — which download stage we are in.
/// - `progress` — a value in `[0.0, 1.0]` indicating completion percentage.
/// - `message` — a human-readable description for the current step.
/// - `current_bytes` — bytes processed so far in this phase.
/// - `total_bytes` — total bytes expected for this phase (0 when unknown).
pub type ProgressFn = dyn Fn(DownloadPhase, f64, &str, u64, u64) + Send + Sync;

/// Expected shape of the `download_file` / `transfer_file` server response.
#[derive(Debug, Deserialize)]
struct FileMetadataResponse {
    action: String,
    data: FileMetadataData,
}

#[derive(Debug, Deserialize)]
struct FileMetadataData {
    file_size: Option<u64>,
    chunk_size: Option<u32>,
    total_chunks: Option<u32>,
}

/// Expected shape of the decryption info message.
#[derive(Debug, Deserialize)]
struct DecryptionInfo {
    #[allow(dead_code)]
    action: String,
    data: DecryptionInfoData,
}

#[derive(Debug, Deserialize)]
struct DecryptionInfoData {
    key: String, // base64-encoded
}

/// Named chunk data from the server.
#[derive(Debug, Deserialize)]
struct ChunkMessage {
    #[allow(dead_code)]
    action: String,
    data: ChunkData,
}

#[derive(Debug, Deserialize)]
struct ChunkData {
    index: u32,
    prefix: Option<String>, // base64
    tag: Option<String>,    // base64
    chunk: String,          // base64
}

/// Receive an encrypted file from the server.
///
/// This is a high-level async function that orchestrates the full download
/// protocol.  Progress updates are delivered via `on_progress`.
///
/// # Arguments
/// - `conn` — established multiplexed connection.
/// - `task_id` — server-side task identifier.
/// - `dest` — path where the decrypted file will be written.
/// - `on_progress` — called with `(phase, progress, message)` at each step.
pub async fn receive(
    conn: &Connection,
    task_id: &str,
    dest: &Path,
    on_progress: &ProgressFn,
) -> Result<()> {
    let mut stream = conn.create_stream().await?;

    // --- Step 1: request file metadata ---
    let request = serde_json::json!({
        "action": "download_file",
        "data": { "task_id": task_id }
    });
    stream
        .send(
            conn,
            serde_json::to_vec(&request).map_err(|e| cfms_core::Error::Protocol(e.to_string()))?,
        )
        .await?;

    let response_raw = stream
        .recv()
        .await
        .ok_or_else(|| cfms_core::Error::Connection("stream closed before metadata".into()))?;

    let metadata: FileMetadataResponse = serde_json::from_slice(&response_raw)
        .map_err(|e| cfms_core::Error::Protocol(format!("invalid metadata response: {e}")))?;

    if metadata.action != "transfer_file" {
        return Err(cfms_core::Error::Protocol(format!(
            "unexpected action: {}",
            metadata.action
        )));
    }

    let file_size = metadata.data.file_size.unwrap_or(0);
    let chunk_size = metadata.data.chunk_size.unwrap_or(8192);
    let total_chunks = metadata.data.total_chunks.unwrap_or(0);

    // --- Step 2: send ready ---
    stream.send(conn, b"ready".to_vec()).await?;

    // --- Handle empty files ---
    if file_size == 0 || total_chunks == 0 {
        tokio::fs::write(dest, [])
            .await
            .map_err(cfms_core::Error::Io)?;
        on_progress(
            DownloadPhase::Verifying,
            1.0,
            "empty file, nothing to download",
            0,
            0,
        );
        return Ok(());
    }

    // --- Step 3: receive chunks into SQLite ---
    let temp_dir = tempfile::tempdir()?;
    let db_path = temp_dir.path().join("chunks.db");
    let store = ChunkStore::open(&db_path)?;

    let mut received_chunks: u32 = 0;

    while received_chunks < total_chunks {
        let chunk_raw = stream.recv().await.ok_or_else(|| {
            cfms_core::Error::Connection("stream closed during chunk transfer".into())
        })?;

        let chunk_msg: ChunkMessage = serde_json::from_slice(&chunk_raw)
            .map_err(|e| cfms_core::Error::Protocol(format!("invalid chunk message: {e}")))?;

        let prefix = chunk_msg
            .data
            .prefix
            .as_deref()
            .map(base64ct::Base64::decode_vec)
            .transpose()
            .map_err(|e| cfms_core::Error::Protocol(format!("invalid prefix base64: {e}")))?
            .unwrap_or_default();

        let mut prefix_arr = [0u8; 8];
        let prefix_len = prefix.len().min(8);
        prefix_arr[..prefix_len].copy_from_slice(&prefix[..prefix_len]);

        let tag = chunk_msg
            .data
            .tag
            .as_deref()
            .map(base64ct::Base64::decode_vec)
            .transpose()
            .map_err(|e| cfms_core::Error::Protocol(format!("invalid tag base64: {e}")))?
            .unwrap_or_default();

        let mut tag_arr = [0u8; 16];
        let tag_len = tag.len().min(16);
        tag_arr[..tag_len].copy_from_slice(&tag[..tag_len]);

        let chunk_data = base64ct::Base64::decode_vec(&chunk_msg.data.chunk)
            .map_err(|e| cfms_core::Error::Protocol(format!("invalid chunk base64: {e}")))?;

        store.insert(chunk_msg.data.index, &prefix_arr, &tag_arr, &chunk_data)?;

        received_chunks += 1;

        let received_bytes = if received_chunks < total_chunks {
            chunk_size as u64 * received_chunks as u64
        } else {
            file_size
        };

        let progress = if file_size > 0 {
            received_bytes as f64 / file_size as f64
        } else {
            0.0
        };
        on_progress(
            DownloadPhase::Downloading,
            progress,
            "receiving encrypted chunks",
            received_bytes,
            file_size,
        );
    }

    store.commit()?;

    // --- Step 4: receive decryption key ---
    let key_raw = stream
        .recv()
        .await
        .ok_or_else(|| cfms_core::Error::Connection("stream closed before key delivery".into()))?;

    let key_info: DecryptionInfo = serde_json::from_slice(&key_raw)
        .map_err(|e| cfms_core::Error::Protocol(format!("invalid key info: {e}")))?;

    let aes_key_bytes = base64ct::Base64::decode_vec(&key_info.data.key)
        .map_err(|e| cfms_core::Error::Protocol(format!("invalid key base64: {e}")))?;

    if aes_key_bytes.len() != KEY_LEN {
        return Err(cfms_core::Error::Protocol(format!(
            "unexpected AES key length: {} (expected {KEY_LEN})",
            aes_key_bytes.len()
        )));
    }

    let mut aes_key = [0u8; KEY_LEN];
    aes_key.copy_from_slice(&aes_key_bytes);

    // --- Step 5: decrypt and write chunks ---
    //
    // IMPORTANT: the decrypt loop performs CPU-bound AES-256-GCM operations
    // and synchronous file I/O for every chunk.  Running this on a Tokio
    // async worker thread would block the runtime and starve other tasks
    // (including progress-event delivery to the frontend).  We therefore
    // move the entire phase onto a blocking thread via `block_in_place`,
    // which frees the async worker to process other work while the current
    // thread does the heavy lifting.
    let dest = dest.to_path_buf();
    tokio::task::block_in_place(move || {
        let chunks = store.ordered_chunks()?;

        // Ensure the destination directory exists.
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut out_file = std::fs::File::create(&dest).map_err(cfms_core::Error::Io)?;

        let mut accumulated_bytes: u64 = 0;

        for chunk_row in chunks.iter() {
            let decrypted = decrypt_chunk(
                &aes_key,
                &chunk_row.prefix,
                chunk_row.idx,
                &chunk_row.data,
                &chunk_row.tag,
            )?;

            std::io::Write::write_all(&mut out_file, &decrypted)?;

            accumulated_bytes += decrypted.len() as u64;

            let progress = if file_size > 0 {
                accumulated_bytes as f64 / file_size as f64
            } else {
                0.0
            };
            on_progress(
                DownloadPhase::Decrypting,
                progress,
                "decrypting chunks",
                accumulated_bytes,
                file_size,
            );
        }

        // Flush and sync.
        out_file.flush()?;

        drop(out_file);

        // --- Step 6: clean up ---
        on_progress(
            DownloadPhase::Cleaning,
            1.0,
            "cleaning up temporary storage",
            file_size,
            file_size,
        );
        store.purge()?;

        // --- Step 7: verify ---
        on_progress(
            DownloadPhase::Verifying,
            1.0,
            "verifying file integrity",
            file_size,
            file_size,
        );
        verify::size_matches(&dest, file_size)?;

        Ok::<_, cfms_core::Error>(())
    })?;

    Ok(())
}
