//! Frame protocol integration tests.
//!
//! Validates that the frame encode/decode pipeline works correctly across
//! a range of payload sizes and frame IDs.

use cfms_transport::frame::{self, FrameHeader, FrameKind};

#[test]
fn encode_decode_all_frame_kinds() {
    let test_cases = [FrameKind::Process, FrameKind::Conclusion];

    for kind in &test_cases {
        let header = FrameHeader {
            id: 42,
            kind: *kind,
        };
        let payload = b"integration test payload";

        let encoded = frame::encode(&header, payload);
        let (decoded_header, decoded_payload) = frame::decode(&encoded).unwrap();

        assert_eq!(decoded_header, header);
        assert_eq!(decoded_payload, payload);
    }
}

#[test]
fn payload_sizes_from_0_to_64k() {
    for size in [0, 1, 255, 256, 1024, 4096, 65535] {
        let header = FrameHeader {
            id: 1,
            kind: FrameKind::Process,
        };
        let payload = vec![0xAAu8; size];

        let encoded = frame::encode(&header, &payload);
        assert_eq!(encoded.len(), frame::HEADER_SIZE + size);

        let (decoded_header, decoded_payload) = frame::decode(&encoded).unwrap();
        assert_eq!(decoded_header, header);
        assert_eq!(decoded_payload.len(), size);
        assert!(decoded_payload.iter().all(|&b| b == 0xAA));
    }
}

#[test]
fn frame_ids_span_full_u32_range() {
    let ids = [0u32, 1, u16::MAX as u32, u32::MAX / 2, u32::MAX];

    for &id in &ids {
        let header = FrameHeader {
            id,
            kind: FrameKind::Process,
        };
        let payload = b"test";

        let encoded = frame::encode(&header, payload);
        let (decoded_header, _) = frame::decode(&encoded).unwrap();

        assert_eq!(decoded_header.id, id);
    }
}

#[test]
fn conclusion_frame_id_remains_intact() {
    let header = FrameHeader {
        id: 0xDEAD_BEEF,
        kind: FrameKind::Conclusion,
    };
    let payload = b"{\"status\":\"done\"}";

    let encoded = frame::encode(&header, payload);
    let (decoded, _) = frame::decode(&encoded).unwrap();

    assert_eq!(decoded.id, 0xDEAD_BEEF);
    assert_eq!(decoded.kind, FrameKind::Conclusion);
}

#[test]
fn decode_garbage_data() {
    // Random bytes that are too short / invalid should fail gracefully.
    assert!(frame::decode(b"").is_err());
    assert!(frame::decode(b"\x00").is_err());
    assert!(frame::decode(b"\x00\x00\x00\x00").is_err());

    // 5 bytes with an invalid frame kind.
    let mut bad = vec![0u8; 5];
    bad[4] = 0xFF;
    assert!(frame::decode(&bad).is_err());
}
