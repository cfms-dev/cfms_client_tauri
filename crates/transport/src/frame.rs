//! Multiplexed frame protocol.
//!
//! Every message on the wire carries a 5-byte header followed by a payload:
//!
//! ```text
//! ┌───────────────┬────────────┬──────────────────────┐
//! │ frame_id (4 B)│ type (1 B) │ payload (variable)   │
//! └───────────────┴────────────┴──────────────────────┘
//! ```
//!
//! `frame_id` is a big-endian `u32`.  Odd IDs are client-initiated streams;
//! even IDs are server-initiated streams.
//!
//! `type` is a [`FrameKind`] tag.

use cfms_core::Result;

/// Size of the fixed frame header on the wire.
pub const HEADER_SIZE: usize = cfms_core::constants::FRAME_HEADER_LEN; // 5

/// Frame kind tags sent as the 5th byte of the header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameKind {
    /// Data is in transit; more frames may follow on this stream.
    Process = 0x00,
    /// The stream is finished; no more frames will arrive on this ID.
    Conclusion = 0x01,
}

impl TryFrom<u8> for FrameKind {
    type Error = cfms_core::Error;

    fn try_from(value: u8) -> Result<Self> {
        match value {
            0x00 => Ok(Self::Process),
            0x01 => Ok(Self::Conclusion),
            other => Err(cfms_core::Error::Protocol(format!(
                "unknown frame kind: 0x{other:02x}"
            ))),
        }
    }
}

/// Parsed frame header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameHeader {
    /// Stream identifier.
    pub id: u32,
    /// Frame kind tag.
    pub kind: FrameKind,
}

/// Encode a frame header + payload into wire-format bytes.
///
/// Returns an owned `Vec<u8>` suitable for passing to the WebSocket `send`
/// method.
pub fn encode(header: &FrameHeader, payload: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(HEADER_SIZE + payload.len());
    buf.extend_from_slice(&header.id.to_be_bytes());
    buf.push(header.kind as u8);
    buf.extend_from_slice(payload);
    buf
}

/// Decode a frame header from wire-format bytes.
///
/// On success returns `(header, payload_slice)` where `payload_slice` is a
/// **borrowed** view into `data` — no allocation is performed.
///
/// # Errors
/// Returns [`Error::Protocol`] if `data` is shorter than [`HEADER_SIZE`] or
/// if the frame kind byte is unrecognised.
pub fn decode(data: &[u8]) -> Result<(FrameHeader, &[u8])> {
    if data.len() < HEADER_SIZE {
        return Err(cfms_core::Error::Protocol(format!(
            "frame too short: {} bytes (need at least {HEADER_SIZE})",
            data.len()
        )));
    }

    let id = u32::from_be_bytes(data[..4].try_into().unwrap());
    let kind = FrameKind::try_from(data[4])?;
    let payload = &data[HEADER_SIZE..];

    Ok((FrameHeader { id, kind }, payload))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_empty_payload() {
        let header = FrameHeader {
            id: 1,
            kind: FrameKind::Process,
        };
        let encoded = encode(&header, b"");
        assert_eq!(encoded.len(), HEADER_SIZE);

        let (decoded_header, payload) = decode(&encoded).unwrap();
        assert_eq!(decoded_header, header);
        assert!(payload.is_empty());
    }

    #[test]
    fn roundtrip_with_payload() {
        let header = FrameHeader {
            id: 0xDEAD_BEEF,
            kind: FrameKind::Process,
        };
        let payload = b"Hello multiplexed world!";
        let encoded = encode(&header, payload);

        let (decoded_header, decoded_payload) = decode(&encoded).unwrap();
        assert_eq!(decoded_header, header);
        assert_eq!(decoded_payload, payload);
    }

    #[test]
    fn roundtrip_conclusion_frame() {
        let header = FrameHeader {
            id: 7,
            kind: FrameKind::Conclusion,
        };
        let payload = b"{\"status\":\"done\"}";
        let encoded = encode(&header, payload);

        let (decoded_header, decoded_payload) = decode(&encoded).unwrap();
        assert_eq!(decoded_header, header);
        assert_eq!(decoded_payload, payload);
    }

    #[test]
    fn decode_too_short() {
        assert!(decode(b"\x00\x00\x00\x01").is_err()); // missing kind byte
        assert!(decode(b"").is_err());
        assert!(decode(b"\x00\x00").is_err());
    }

    #[test]
    fn decode_bad_kind() {
        let mut buf = vec![0u8; HEADER_SIZE];
        buf[4] = 0xFF; // invalid kind
        assert!(decode(&buf).is_err());
    }

    #[test]
    fn max_frame_id() {
        let header = FrameHeader {
            id: u32::MAX,
            kind: FrameKind::Process,
        };
        let encoded = encode(&header, b"max");
        let (decoded_header, payload) = decode(&encoded).unwrap();
        assert_eq!(decoded_header.id, u32::MAX);
        assert_eq!(payload, b"max");
    }

    #[test]
    fn payload_not_copied() {
        // Verify that decode returns a borrowed slice, not a copy.
        let data = vec![0x00, 0x00, 0x00, 0x01, 0x00, b'x', b'y', b'z'];
        let (_, payload) = decode(&data).unwrap();
        assert_eq!(payload.as_ptr(), data[HEADER_SIZE..].as_ptr());
    }
}
