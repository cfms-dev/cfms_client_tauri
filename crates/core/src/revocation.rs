//! Revocation results cross the service/IPC boundary without exposing certificate contents.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RevocationState {
    Checking,
    Checked,
    Unknown,
    Revoked,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RevocationStatus {
    pub state: RevocationState,
    /// Stable, localizable reason codes. Network diagnostics stay in backend logs.
    pub reasons: Vec<String>,
    pub checked_at: Option<u64>,
    pub valid_until: Option<u64>,
}

impl RevocationStatus {
    pub fn new(state: RevocationState, reason: &str) -> Self {
        Self {
            state,
            reasons: if reason.is_empty() {
                vec![]
            } else {
                vec![reason.into()]
            },
            checked_at: None,
            valid_until: None,
        }
    }
}
