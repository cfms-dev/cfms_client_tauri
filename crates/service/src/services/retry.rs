//! Shared retry classification and bounded backoff for background services.

use std::time::Duration;

use rand::RngExt;

pub const MAX_BACKGROUND_RETRIES: usize = 3;
const MAX_BACKOFF_SECONDS: u64 = 30;

pub fn response_retry_after_seconds(response: &cfms_core::Response) -> Option<u64> {
    response
        .data
        .get("retry_after_seconds")
        .and_then(serde_json::Value::as_u64)
        .filter(|seconds| *seconds > 0)
}

pub fn is_transient_response(response: &cfms_core::Response) -> bool {
    matches!(response.code, 429 | 503)
}

pub fn error_retry_after_seconds(error: &cfms_core::Error) -> Option<u64> {
    match error {
        cfms_core::Error::ConnectionRejected {
            status: 429 | 503,
            retry_after_seconds,
            ..
        }
        | cfms_core::Error::Server {
            code: 429 | 503,
            retry_after_seconds,
            ..
        } => *retry_after_seconds,
        _ => None,
    }
}

pub fn is_transient_error(error: &cfms_core::Error) -> bool {
    matches!(
        error,
        cfms_core::Error::Connection(_)
            | cfms_core::Error::ConnectionRejected { status: 429, .. }
            | cfms_core::Error::ConnectionRejected { status: 503, .. }
            | cfms_core::Error::Server {
                code: 429 | 503,
                ..
            }
    )
}

/// Return a retry delay using a server hint or equal-jitter exponential backoff.
///
/// Attempts are one-based. Without a server hint, attempts 1, 2, and 3 use
/// bases of 1, 2, and 4 seconds, randomized within the upper half of the base.
pub fn retry_delay(attempt: usize, retry_after_seconds: Option<u64>) -> Duration {
    if let Some(seconds) = retry_after_seconds.filter(|seconds| *seconds > 0) {
        return Duration::from_secs(seconds);
    }

    let base_seconds = (1u64 << attempt.saturating_sub(1).min(5)).min(MAX_BACKOFF_SECONDS);
    let base_millis = base_seconds * 1_000;
    let floor = (base_millis / 2).max(1);
    let jittered = rand::rng().random_range(floor..=base_millis);
    Duration::from_millis(jittered)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_delay_takes_priority() {
        assert_eq!(retry_delay(3, Some(17)), Duration::from_secs(17));
    }

    #[test]
    fn fallback_delay_stays_inside_equal_jitter_window() {
        for attempt in 1..=3 {
            let delay = retry_delay(attempt, None);
            let base = Duration::from_secs(1 << (attempt - 1));
            assert!(delay >= base / 2);
            assert!(delay <= base);
        }
    }

    #[test]
    fn classifies_only_protocol_twenty_one_transient_responses() {
        let response = |code| cfms_core::Response {
            code,
            message: String::new(),
            data: serde_json::json!({"retry_after_seconds": 5}),
            timestamp: 0.0,
        };
        assert!(is_transient_response(&response(429)));
        assert!(is_transient_response(&response(503)));
        assert!(!is_transient_response(&response(403)));
        assert_eq!(response_retry_after_seconds(&response(429)), Some(5));
    }

    #[test]
    fn classifies_rate_limits_capacity_closes_and_connection_failures() {
        let rejected = |status| cfms_core::Error::ConnectionRejected {
            status,
            message: String::new(),
            retry_after_seconds: Some(9),
        };
        let server = |code| cfms_core::Error::Server {
            code,
            message: String::new(),
            scope: None,
            limit: None,
            retry_after_seconds: Some(4),
        };

        assert!(is_transient_error(&rejected(429)));
        assert!(is_transient_error(&rejected(503)));
        assert!(is_transient_error(&server(429)));
        assert!(is_transient_error(&server(503)));
        assert!(is_transient_error(&cfms_core::Error::Connection(
            String::new()
        )));
        assert!(!is_transient_error(&rejected(403)));
        assert!(!is_transient_error(&server(400)));
        assert!(!is_transient_error(&cfms_core::Error::Protocol(
            String::new()
        )));
        assert_eq!(error_retry_after_seconds(&rejected(503)), Some(9));
        assert_eq!(error_retry_after_seconds(&server(429)), Some(4));
    }
}
