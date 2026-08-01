//! Resumable file upload with progress tracking.
//!
//! The protocol 20 upload flow is deliberately asymmetric with downloads:
//!
//! 1. The client hashes the source and sends `upload_file` with all metadata.
//! 2. The server replies with `transfer_file`, including its authoritative
//!    chunk size and resume offset.
//! 3. The client seeks to that offset and sends exact protocol chunks.
//! 4. The server concludes the stream with a normal response envelope.

use cfms_core::Result;
use cfms_transport::Connection;
use serde::Deserialize;
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::verify;

pub const CLIENT_MAX_UPLOAD_CHUNK_SIZE: u64 = 64 * 1024;

/// Progress callback: `(current_bytes, total_bytes)`.
pub type UploadProgressFn = dyn Fn(u64, u64) + Send + Sync;

#[derive(Debug, Deserialize)]
struct UploadNegotiation {
    action: String,
    data: UploadNegotiationData,
}

#[derive(Debug, Deserialize)]
struct UploadNegotiationData {
    file_size: u64,
    chunk_size: u64,
    offset: u64,
    supports_resume: bool,
}

#[derive(Debug, Deserialize)]
struct ServerResponse {
    code: u32,
    message: String,
    #[serde(default)]
    data: ServerResponseData,
}

#[derive(Debug, Default, Deserialize)]
struct ServerResponseData {
    scope: Option<String>,
    limit: Option<u64>,
    retry_after_seconds: Option<u64>,
}

/// Upload a file, resuming from the server's durable checkpoint when present.
///
/// `restart` explicitly tells the server to discard an existing checkpoint.
/// Normal reconnects and user-initiated resumes must pass `false`.
pub async fn send(
    conn: &Connection,
    task_id: &str,
    source: &Path,
    restart: bool,
    on_progress: &UploadProgressFn,
) -> Result<()> {
    let file_size = tokio::fs::metadata(source).await?.len();
    let sha256_hex = if file_size > 0 {
        let hash = verify::compute_sha256_async(source.to_path_buf()).await?;
        Some(
            hash.iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
        )
    } else {
        None
    };

    let mut stream = conn.create_stream().await?;
    let request = upload_request(
        task_id,
        file_size,
        sha256_hex.as_deref(),
        CLIENT_MAX_UPLOAD_CHUNK_SIZE,
        restart,
    );
    stream
        .send(
            conn,
            serde_json::to_vec(&request)
                .map_err(|error| cfms_core::Error::Protocol(error.to_string()))?,
        )
        .await?;

    let negotiation_raw = stream.recv().await.ok_or_else(|| {
        cfms_core::Error::Connection("stream closed before upload negotiation".into())
    })?;
    let negotiation = parse_negotiation(&negotiation_raw)?;
    validate_negotiation(&negotiation, file_size, CLIENT_MAX_UPLOAD_CHUNK_SIZE)?;

    let chunk_size = negotiation.data.chunk_size as usize;
    let mut bytes_sent = negotiation.data.offset;
    on_progress(bytes_sent, file_size);

    if bytes_sent < file_size {
        let mut file = tokio::fs::File::open(source).await?;
        file.seek(std::io::SeekFrom::Start(bytes_sent)).await?;
        let mut buffer = vec![0u8; chunk_size];

        while bytes_sent < file_size {
            let expected = usize::try_from((file_size - bytes_sent).min(chunk_size as u64))
                .map_err(|_| cfms_core::Error::Protocol("upload chunk size overflow".into()))?;
            file.read_exact(&mut buffer[..expected]).await?;
            stream.send(conn, buffer[..expected].to_vec()).await?;
            bytes_sent += expected as u64;
            on_progress(bytes_sent, file_size);
        }
    }

    let confirmation_raw = stream.recv().await.ok_or_else(|| {
        cfms_core::Error::Connection("stream closed before upload confirmation".into())
    })?;
    parse_success_response(&confirmation_raw)?;
    Ok(())
}

fn upload_request(
    task_id: &str,
    file_size: u64,
    sha256_hex: Option<&str>,
    max_chunk_size: u64,
    restart: bool,
) -> serde_json::Value {
    serde_json::json!({
        "action": "upload_file",
        "data": {
            "task_id": task_id,
            "file_size": file_size,
            "sha256": sha256_hex,
            "max_chunk_size": max_chunk_size,
            "restart": restart
        }
    })
}

fn parse_negotiation(raw: &[u8]) -> Result<UploadNegotiation> {
    if let Ok(response) = serde_json::from_slice::<ServerResponse>(raw)
        && response.code != 200
    {
        return Err(server_error(response));
    }

    serde_json::from_slice(raw)
        .map_err(|error| cfms_core::Error::Protocol(format!("invalid upload negotiation: {error}")))
}

fn validate_negotiation(
    negotiation: &UploadNegotiation,
    expected_file_size: u64,
    max_chunk_size: u64,
) -> Result<()> {
    if negotiation.action != "transfer_file" {
        return Err(cfms_core::Error::Protocol(format!(
            "unexpected upload action: {}",
            negotiation.action
        )));
    }
    if negotiation.data.file_size != expected_file_size {
        return Err(cfms_core::Error::Protocol(format!(
            "server returned file size {}, expected {expected_file_size}",
            negotiation.data.file_size
        )));
    }
    if negotiation.data.chunk_size == 0 || negotiation.data.chunk_size > max_chunk_size {
        return Err(cfms_core::Error::Protocol(format!(
            "server selected invalid upload chunk size {}",
            negotiation.data.chunk_size
        )));
    }
    if negotiation.data.offset > expected_file_size {
        return Err(cfms_core::Error::Protocol(format!(
            "upload resume offset {} exceeds file size {expected_file_size}",
            negotiation.data.offset
        )));
    }
    if negotiation.data.offset > 0 && !negotiation.data.supports_resume {
        return Err(cfms_core::Error::Protocol(
            "server returned a resume offset for a non-resumable upload".into(),
        ));
    }
    if negotiation.data.offset != expected_file_size
        && !negotiation
            .data
            .offset
            .is_multiple_of(negotiation.data.chunk_size)
    {
        return Err(cfms_core::Error::Protocol(format!(
            "upload resume offset {} is not aligned to chunk size {}",
            negotiation.data.offset, negotiation.data.chunk_size
        )));
    }
    Ok(())
}

fn parse_success_response(raw: &[u8]) -> Result<()> {
    let response: ServerResponse = serde_json::from_slice(raw)
        .map_err(|error| cfms_core::Error::Protocol(format!("invalid upload response: {error}")))?;
    if response.code != 200 {
        return Err(server_error(response));
    }
    Ok(())
}

fn server_error(response: ServerResponse) -> cfms_core::Error {
    cfms_core::Error::Server {
        code: response.code,
        message: response.message,
        scope: response.data.scope,
        limit: response.data.limit,
        retry_after_seconds: response.data.retry_after_seconds,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CLIENT_MAX_UPLOAD_CHUNK_SIZE, parse_negotiation, parse_success_response, upload_request,
        validate_negotiation,
    };

    #[test]
    fn request_contains_protocol_20_upload_metadata() {
        let request = upload_request("task-1", 42, Some("abc"), 64 * 1024, false);
        assert_eq!(
            request,
            serde_json::json!({
                "action": "upload_file",
                "data": {
                    "task_id": "task-1",
                    "file_size": 42,
                    "sha256": "abc",
                    "max_chunk_size": 64 * 1024,
                    "restart": false
                }
            })
        );
    }

    #[test]
    fn negotiation_accepts_authoritative_resume_offset() {
        let raw = br#"{"action":"transfer_file","data":{"file_size":131076,"chunk_size":65536,"offset":131072,"supports_resume":true}}"#;
        let negotiation = parse_negotiation(raw).unwrap();
        validate_negotiation(&negotiation, 131_076, CLIENT_MAX_UPLOAD_CHUNK_SIZE).unwrap();
        assert_eq!(negotiation.data.offset, 131_072);
    }

    #[test]
    fn negotiation_rejects_misaligned_resume_offset() {
        let raw = br#"{"action":"transfer_file","data":{"file_size":70000,"chunk_size":65536,"offset":32768,"supports_resume":true}}"#;
        let negotiation = parse_negotiation(raw).unwrap();
        let error = validate_negotiation(&negotiation, 70_000, CLIENT_MAX_UPLOAD_CHUNK_SIZE)
            .unwrap_err()
            .to_string();
        assert!(error.contains("not aligned"));
    }

    #[test]
    fn negotiation_preserves_server_conflict() {
        let raw = br#"{"code":409,"message":"Upload metadata does not match the resumable task","data":{"chunk_size":1024}}"#;
        let error = parse_negotiation(raw).unwrap_err();
        assert!(matches!(error, cfms_core::Error::Server { code: 409, .. }));
    }

    #[test]
    fn confirmation_requires_success_code() {
        let raw = br#"{"code":400,"message":"SHA256 mismatch","data":{}}"#;
        let error = parse_success_response(raw).unwrap_err();
        assert!(matches!(error, cfms_core::Error::Server { code: 400, .. }));
    }
}
