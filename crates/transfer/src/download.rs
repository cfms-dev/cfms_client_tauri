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
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use tempfile::TempDir;

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

/// Expected shape of the empty-file completion message.
#[derive(Debug, Deserialize)]
struct EmptyFileMessage {
    action: String,
    data: EmptyFileData,
}

#[derive(Debug, Deserialize)]
struct EmptyFileData {
    flag: String,
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
///
/// # Returns
/// The total file size (in bytes) on success so the caller can
/// record accurate completion metadata.
pub async fn receive(
    conn: &Connection,
    task_id: &str,
    dest: &Path,
    on_progress: &ProgressFn,
) -> Result<u64> {
    receive_with_resume(conn, task_id, dest, 0, None, on_progress).await
}

/// Normal response envelope used by request handlers when a transfer cannot
/// be started (for example, because a one-shot task was already consumed).
#[derive(Debug, Deserialize)]
struct ServerErrorResponse {
    code: u32,
    message: String,
}

/// Receive an encrypted file, optionally resuming from a byte offset.
///
/// When `chunk_store_path` is provided, encrypted chunks are stored in that
/// stable SQLite file instead of an auto-deleted temporary directory. This lets
/// the caller pause midway, keep already received chunks, then call this
/// function again with the server-supported `offset`.
pub async fn receive_with_resume(
    conn: &Connection,
    task_id: &str,
    dest: &Path,
    offset: u64,
    chunk_store_path: Option<&Path>,
    on_progress: &ProgressFn,
) -> Result<u64> {
    let mut stream = conn.create_stream().await?;

    // --- Step 1: request file metadata ---
    let request = serde_json::json!({
        "action": "download_file",
        "data": { "task_id": task_id, "offset": offset }
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

    let metadata = parse_metadata_response(&response_raw)?;

    if metadata.action != "transfer_file" {
        return Err(cfms_core::Error::Protocol(format!(
            "unexpected action: {}",
            metadata.action
        )));
    }

    let file_size = metadata.data.file_size.unwrap_or(0);
    let chunk_size = metadata.data.chunk_size.unwrap_or(8192);
    let total_chunks = metadata.data.total_chunks.unwrap_or(0);

    if offset > file_size {
        return Err(cfms_core::Error::Protocol(format!(
            "resume offset {offset} exceeds file size {file_size}"
        )));
    }

    if offset > 0 && offset % chunk_size as u64 != 0 {
        return Err(cfms_core::Error::Protocol(format!(
            "resume offset {offset} is not aligned to chunk size {chunk_size}"
        )));
    }

    // --- Step 2: send ready ---
    stream.send(conn, b"ready".to_vec()).await?;

    // --- Handle empty files ---
    if file_size == 0 {
        let marker_raw = stream.recv().await.ok_or_else(|| {
            cfms_core::Error::Connection("stream closed before empty-file marker".into())
        })?;
        parse_empty_file_marker(&marker_raw)?;

        ensure_destination_parent(dest)?;
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
        return Ok(0);
    }

    if total_chunks == 0 {
        return Err(cfms_core::Error::Protocol(
            "metadata reported zero chunks for a non-empty file".into(),
        ));
    }

    // --- Step 3: receive chunks into SQLite ---
    let store_owner = prepare_chunk_store(dest, chunk_store_path, offset)?;
    let db_path = store_owner.path();
    let store = ChunkStore::open(&db_path)?;

    let start_chunk = (offset / chunk_size as u64) as u32;
    if start_chunk > total_chunks {
        return Err(cfms_core::Error::Protocol(format!(
            "resume chunk {start_chunk} exceeds total chunks {total_chunks}"
        )));
    }

    let remaining_chunks = total_chunks - start_chunk;
    let mut received_chunks: u32 = 0;

    if offset > 0 {
        on_progress(
            DownloadPhase::Downloading,
            offset as f64 / file_size as f64,
            "resuming encrypted chunks",
            offset,
            file_size,
        );
    }

    while received_chunks < remaining_chunks {
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

        let total_received_chunks = start_chunk + received_chunks;
        let received_bytes = if total_received_chunks < total_chunks {
            chunk_size as u64 * total_received_chunks as u64
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
    //
    // PERFORMANCE NOTES:
    // - Chunks are streamed from SQLite via `for_each_ordered_chunk` instead
    //   of materializing a full `Vec` — peak memory stays O(chunk_size), not
    //   O(file_size).
    // - File I/O is wrapped in a `std::io::BufWriter` (64 KiB) to coalesce
    //   many small `write(2)` calls into fewer, larger ones, dramatically
    //   reducing system-call overhead.
    // - For optimal AES-256-GCM throughput on x86_64, ensure the `aes-gcm`
    //   crate is compiled with hardware AES-NI + SSSE3 support.  See
    //   `.cargo/config.toml` for per-target rustflags.
    let dest = dest.to_path_buf();
    tokio::task::block_in_place(move || {
        // Ensure the destination directory exists.
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let out_file = std::fs::File::create(&dest).map_err(cfms_core::Error::Io)?;
        let mut writer = BufWriter::with_capacity(64 * 1024, out_file);

        let mut accumulated_bytes: u64 = 0;

        // Lazy iteration: each chunk is read, decrypted, written, and dropped
        // before the next row is fetched — no full Vec materialization.
        store.for_each_ordered_chunk(|chunk| {
            let decrypted =
                decrypt_chunk(&aes_key, &chunk.prefix, chunk.idx, &chunk.data, &chunk.tag)?;

            writer.write_all(&decrypted)?;

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
            Ok(())
        })?;

        // Flush remaining buffered data and sync to disk.
        writer.flush()?;

        drop(writer);

        // --- Step 6: clean up ---
        on_progress(
            DownloadPhase::Cleaning,
            1.0,
            "cleaning up temporary storage",
            file_size,
            file_size,
        );
        store.purge()?;
        store_owner.cleanup()?;

        // --- Step 7: verify ---
        on_progress(
            DownloadPhase::Verifying,
            1.0,
            "verifying file integrity",
            file_size,
            file_size,
        );
        verify::size_matches(&dest, file_size)?;

        // Completion is signalled by the function returning successfully —
        // the caller (download queue) is responsible for marking the task
        // as completed and emitting the DownloadCompleted event.
        Ok::<_, cfms_core::Error>(())
    })?;

    Ok(file_size)
}

fn parse_metadata_response(raw: &[u8]) -> Result<FileMetadataResponse> {
    // Error envelopes do not contain `action`, so detect them before parsing
    // the transfer metadata. Previously these surfaced as the misleading
    // "missing field `action`" protocol error and were retried repeatedly.
    if let Ok(response) = serde_json::from_slice::<ServerErrorResponse>(raw)
        && response.code != 200
    {
        return Err(cfms_core::Error::Server {
            code: response.code,
            message: response.message,
        });
    }

    serde_json::from_slice(raw)
        .map_err(|e| cfms_core::Error::Protocol(format!("invalid metadata response: {e}")))
}

enum ChunkStoreOwner {
    Temporary(TempDir),
    Persistent(PathBuf),
}

impl ChunkStoreOwner {
    fn path(&self) -> PathBuf {
        match self {
            Self::Temporary(temp_dir) => temp_dir.path().join("chunks.db"),
            Self::Persistent(path) => path.clone(),
        }
    }

    fn cleanup(&self) -> Result<()> {
        if let Self::Persistent(path) = self {
            remove_sqlite_sidecars(path)?;
        }
        Ok(())
    }
}

fn prepare_chunk_store(
    dest: &Path,
    chunk_store_path: Option<&Path>,
    offset: u64,
) -> Result<ChunkStoreOwner> {
    if let Some(path) = chunk_store_path {
        if offset == 0 {
            remove_sqlite_sidecars(path)?;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        return Ok(ChunkStoreOwner::Persistent(path.to_path_buf()));
    }

    Ok(ChunkStoreOwner::Temporary(create_download_temp_dir(dest)?))
}

fn remove_sqlite_sidecars(path: &Path) -> Result<()> {
    remove_file_if_exists(path)?;
    remove_file_if_exists(&PathBuf::from(format!("{}-wal", path.display())))?;
    remove_file_if_exists(&PathBuf::from(format!("{}-shm", path.display())))?;
    Ok(())
}

fn remove_file_if_exists(path: &Path) -> Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(cfms_core::Error::Io(e)),
    }
}

fn create_download_temp_dir(dest: &Path) -> Result<TempDir> {
    let Some(parent) = dest.parent() else {
        return tempfile::tempdir().map_err(cfms_core::Error::Io);
    };

    ensure_destination_parent(dest)?;
    tempfile::Builder::new()
        .prefix(".cfms-download-")
        .tempdir_in(parent)
        .map_err(cfms_core::Error::Io)
}

fn ensure_destination_parent(dest: &Path) -> Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn parse_empty_file_marker(raw: &[u8]) -> Result<()> {
    let marker: EmptyFileMessage = serde_json::from_slice(raw)
        .map_err(|e| cfms_core::Error::Protocol(format!("invalid empty-file marker: {e}")))?;

    if marker.action == "transfer_file" && marker.data.flag == "empty_file" {
        return Ok(());
    }

    Err(cfms_core::Error::Protocol(format!(
        "unexpected empty-file marker: action={}, flag={}",
        marker.action, marker.data.flag
    )))
}

#[cfg(test)]
mod tests {
    use super::{parse_empty_file_marker, parse_metadata_response};

    #[test]
    fn empty_file_marker_accepts_reference_protocol() {
        let raw = br#"{"action":"transfer_file","data":{"flag":"empty_file"}}"#;
        assert!(parse_empty_file_marker(raw).is_ok());
    }

    #[test]
    fn empty_file_marker_rejects_unexpected_flag() {
        let raw = br#"{"action":"transfer_file","data":{"flag":"done"}}"#;
        let err = parse_empty_file_marker(raw).unwrap_err().to_string();
        assert!(err.contains("unexpected empty-file marker"));
    }

    #[test]
    fn metadata_parser_preserves_server_rejection() {
        let raw = br#"{"code":400,"data":{},"message":"Task is not in a valid state for download","timestamp":1781931222.0}"#;
        let err = parse_metadata_response(raw).unwrap_err();

        assert!(matches!(
            err,
            cfms_core::Error::Server { code: 400, ref message }
                if message == "Task is not in a valid state for download"
        ));
    }

    #[test]
    fn metadata_parser_accepts_transfer_metadata() {
        let raw = br#"{"action":"transfer_file","data":{"file_size":12,"chunk_size":8,"total_chunks":2}}"#;
        let metadata = parse_metadata_response(raw).unwrap();

        assert_eq!(metadata.action, "transfer_file");
        assert_eq!(metadata.data.file_size, Some(12));
    }
}
