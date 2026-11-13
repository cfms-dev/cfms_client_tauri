//! A convenience screen lock. It deliberately does not authorize remote operations.
use crate::rpc::SessionIdentity;
use base64ct::{Base64UrlUnpadded, Encoding};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Clone, Serialize, Deserialize, zeroize::Zeroize, zeroize::ZeroizeOnDrop)]
pub struct PinRecord {
    pub salt: String,
    pub hash: String,
    pub iterations: u32,
    pub length: usize,
}
impl PinRecord {
    pub fn create(pin: &str) -> Result<Self, String> {
        validate_pin(pin)?;
        let salt = cfms_crypto::generate_salt();
        let hash = cfms_crypto::pin::derive(pin.as_bytes(), &salt, cfms_crypto::pin::ITERATIONS);
        Ok(Self {
            salt: Base64UrlUnpadded::encode_string(&salt),
            hash: Base64UrlUnpadded::encode_string(&*hash),
            iterations: cfms_crypto::pin::ITERATIONS,
            length: 4,
        })
    }
    pub fn verify(&self, pin: &str) -> Result<bool, String> {
        validate_pin(pin)?;
        if self.iterations == 0 || self.iterations > 1_000_000 {
            return Err("Invalid PIN iteration count".into());
        }
        let salt = Base64UrlUnpadded::decode_vec(&self.salt).map_err(|e| e.to_string())?;
        let expected = zeroize::Zeroizing::new(
            Base64UrlUnpadded::decode_vec(&self.hash).map_err(|e| e.to_string())?,
        );
        let expected: &[u8; 32] = expected
            .as_slice()
            .try_into()
            .map_err(|_| "Invalid PIN verifier")?;
        let actual = cfms_crypto::pin::derive(pin.as_bytes(), &salt, self.iterations);
        Ok(cfms_crypto::pin::equal(&actual, expected))
    }
}
fn validate_pin(pin: &str) -> Result<(), String> {
    if pin.len() == 4 && pin.bytes().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err("PIN must be 4 digits".into())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCredential {
    pub id: String,
    pub label: String,
    pub created_at: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub version: u8,
    pub enabled: bool,
    pub pin: Option<PinRecord>,
    pub biometric_enabled: bool,
    pub platform_credentials: Vec<PlatformCredential>,
    pub timed_lock_enabled: bool,
    pub timed_lock_ms: u64,
    pub updated_at: u64,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: false,
            pin: None,
            biometric_enabled: false,
            platform_credentials: vec![],
            timed_lock_enabled: false,
            timed_lock_ms: 300_000,
            updated_at: now_ms(),
        }
    }
}
impl Settings {
    pub fn parse(value: &serde_json::Value) -> Self {
        let mut settings = Self {
            enabled: value
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            pin: value
                .get("pin")
                .and_then(|v| serde_json::from_value(v.clone()).ok()),
            biometric_enabled: value
                .get("biometricEnabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            platform_credentials: value
                .get("platformCredentials")
                .and_then(|v| v.as_array())
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|v| serde_json::from_value(v.clone()).ok())
                        .collect()
                })
                .unwrap_or_default(),
            timed_lock_enabled: value
                .get("timedLockEnabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            timed_lock_ms: value
                .get("timedLockMs")
                .and_then(|v| v.as_u64())
                .unwrap_or(300_000),
            updated_at: value
                .get("updatedAt")
                .and_then(|v| v.as_u64())
                .unwrap_or_else(now_ms),
            ..Default::default()
        };
        if ![60_000, 300_000, 1_800_000, 3_600_000, 7_200_000].contains(&settings.timed_lock_ms) {
            settings.timed_lock_ms = 300_000;
        }
        settings.version = 1;
        settings
    }
    fn has_method(&self) -> bool {
        self.pin.is_some() || self.biometric_enabled || !self.platform_credentials.is_empty()
    }
    fn can_lock(&self) -> bool {
        self.enabled && self.has_method()
    }
    pub fn public(&self) -> serde_json::Value {
        serde_json::json!({"version": 1, "enabled": self.enabled, "pin": self.pin.as_ref().map(|p| serde_json::json!({"length": p.length})), "biometricEnabled": self.biometric_enabled,
            "platformCredentials": self.platform_credentials, "timedLockEnabled": self.timed_lock_enabled, "timedLockMs": self.timed_lock_ms, "updatedAt": self.updated_at})
    }
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum Change {
    Enabled { enabled: bool },
    Pin { pin: String },
    RemovePin,
    Biometric { enabled: bool },
    Credential { credential: PlatformCredential },
    RemoveCredential { id: String },
    Timed { enabled: bool, timeout: u64 },
    Reset,
}
impl Change {
    pub fn apply(self, settings: &mut Settings) -> Result<(), String> {
        match self {
            Self::Enabled { enabled } => {
                if enabled && !settings.has_method() {
                    return Err("Set up at least one unlock method first".into());
                }
                settings.enabled = enabled;
            }
            Self::Pin { pin } => {
                let pin = zeroize::Zeroizing::new(pin);
                settings.pin = Some(PinRecord::create(&pin)?);
                settings.enabled = true;
            }
            Self::RemovePin => settings.pin = None,
            Self::Biometric { enabled } => {
                settings.biometric_enabled = enabled;
                if enabled {
                    settings.enabled = true;
                }
            }
            Self::Credential { credential } => {
                if credential.id.is_empty() {
                    return Err("Invalid platform credential".into());
                }
                settings
                    .platform_credentials
                    .retain(|c| c.id != credential.id);
                settings.platform_credentials.push(credential);
                settings.enabled = true;
            }
            Self::RemoveCredential { id } => settings.platform_credentials.retain(|c| c.id != id),
            Self::Timed { enabled, timeout } => {
                settings.timed_lock_enabled = enabled;
                settings.timed_lock_ms =
                    if [60_000, 300_000, 1_800_000, 3_600_000, 7_200_000].contains(&timeout) {
                        timeout
                    } else {
                        300_000
                    };
            }
            Self::Reset => *settings = Settings::default(),
        }
        if !settings.has_method() {
            settings.enabled = false;
        }
        settings.updated_at = now_ms();
        Ok(())
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub settings: serde_json::Value,
    pub locked: bool,
    pub failed_attempts: u32,
    pub lockout_until: u64,
    pub disconnect_required: bool,
}
struct State {
    revision: u64,
    identity: SessionIdentity,
    settings: Settings,
    locked: bool,
    failed: u32,
    lockout_until: u64,
    deadline: Option<u64>,
    pending: Option<(u64, String)>,
}
#[derive(Default)]
pub struct Runtime {
    inner: Mutex<Option<State>>,
}
impl Runtime {
    pub fn initialize(&self, identity: SessionIdentity, settings: Settings) -> Snapshot {
        let mut inner = self.inner.lock().unwrap();
        if inner
            .as_ref()
            .is_none_or(|state| state.identity != identity)
        {
            *inner = Some(State {
                revision: 0,
                identity,
                settings: settings.clone(),
                locked: false,
                failed: 0,
                lockout_until: 0,
                deadline: None,
                pending: None,
            });
        }
        let state = inner.as_mut().unwrap();
        state.settings = settings;
        state.pending = None;
        if !state.settings.can_lock() {
            state.locked = false;
            state.failed = 0;
            state.lockout_until = 0;
        }
        schedule(state, now_ms());
        snapshot(state)
    }
    pub fn reset(&self) {
        self.inner.lock().unwrap().take();
    }
    pub fn tick(&self) -> bool {
        let mut inner = self.inner.lock().unwrap();
        if let Some(state) = inner.as_mut() {
            let before = state.locked;
            tick(state, now_ms());
            return before != state.locked;
        }
        false
    }
    pub fn current(&self, identity: &SessionIdentity) -> Result<Snapshot, String> {
        let mut inner = self.inner.lock().unwrap();
        let state = current(&mut inner, identity)?;
        tick(state, now_ms());
        Ok(snapshot(state))
    }
    pub fn activity(
        &self,
        identity: &SessionIdentity,
        background: bool,
    ) -> Result<Snapshot, String> {
        let mut inner = self.inner.lock().unwrap();
        let state = current(&mut inner, identity)?;
        tick(state, now_ms());
        if background && state.settings.timed_lock_enabled && state.settings.can_lock() {
            state.locked = true;
            state.deadline = None;
        } else if !state.locked {
            schedule(state, now_ms());
        }
        Ok(snapshot(state))
    }
    pub fn lock(&self, identity: &SessionIdentity) -> Result<Snapshot, String> {
        let mut inner = self.inner.lock().unwrap();
        let state = current(&mut inner, identity)?;
        if state.settings.can_lock() {
            state.locked = true;
            state.deadline = None;
        }
        Ok(snapshot(state))
    }
    pub fn begin(
        &self,
        identity: &SessionIdentity,
        method: &str,
    ) -> Result<(u64, Option<PinRecord>), String> {
        let mut inner = self.inner.lock().unwrap();
        let state = current(&mut inner, identity)?;
        tick(state, now_ms());
        if !state.locked
            || state.lockout_until > now_ms()
            || state.failed >= 5
            || state.pending.is_some()
        {
            return Err("Unlock attempt is unavailable".into());
        }
        let available = match method {
            "pin" => state.settings.pin.is_some(),
            "biometric" => state.settings.biometric_enabled,
            "platform" => !state.settings.platform_credentials.is_empty(),
            _ => false,
        };
        if !available {
            return Err("Unlock method is not configured".into());
        }
        let ticket = rand::random::<u64>() >> 12;
        state.pending = Some((ticket, method.into()));
        Ok((ticket, state.settings.pin.clone()))
    }
    pub fn finish(
        &self,
        identity: &SessionIdentity,
        ticket: u64,
        outcome: &str,
        pin: bool,
    ) -> Result<Snapshot, String> {
        let mut inner = self.inner.lock().unwrap();
        let state = current(&mut inner, identity)?;
        let (expected, method) = state
            .pending
            .as_ref()
            .ok_or("Unlock attempt is no longer active")?;
        if *expected != ticket || (method == "pin") != pin {
            return Err("Invalid unlock attempt".into());
        }
        if !["accepted", "failed", "cancelled"].contains(&outcome) {
            return Err("Invalid unlock outcome".into());
        }
        state.pending = None;
        finish(state, outcome, now_ms());
        Ok(snapshot(state))
    }
}
fn current<'a>(
    inner: &'a mut Option<State>,
    identity: &SessionIdentity,
) -> Result<&'a mut State, String> {
    inner
        .as_mut()
        .filter(|s| s.identity == *identity)
        .ok_or_else(|| "Application lock is not initialized for this session".into())
}
fn schedule(state: &mut State, now: u64) {
    state.deadline =
        (state.settings.can_lock() && state.settings.timed_lock_enabled && !state.locked)
            .then_some(now.saturating_add(state.settings.timed_lock_ms));
}
fn tick(state: &mut State, now: u64) {
    if state.deadline.is_some_and(|deadline| now >= deadline) {
        state.locked = true;
        state.deadline = None;
    }
}
fn finish(state: &mut State, outcome: &str, now: u64) {
    if outcome == "accepted" {
        state.locked = false;
        state.failed = 0;
        state.lockout_until = 0;
        schedule(state, now);
    } else if outcome == "failed" {
        state.failed += 1;
        if state.failed >= 3 {
            state.lockout_until = now.saturating_add(30_000);
        }
    }
}
fn snapshot(state: &mut State) -> Snapshot {
    state.revision = state.revision.saturating_add(1);
    Snapshot {
        revision: state.revision,
        settings: state.settings.public(),
        locked: state.locked,
        failed_attempts: state.failed,
        lockout_until: state.lockout_until,
        disconnect_required: state.failed >= 5,
    }
}
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn attempts_cool_down_and_require_disconnect_without_counting_cancel() {
        let mut state = State {
            revision: 0,
            identity: SessionIdentity {
                server: "s".into(),
                user_id: "u".into(),
                generation: 1,
            },
            settings: Settings::default(),
            locked: true,
            failed: 0,
            lockout_until: 0,
            deadline: None,
            pending: None,
        };
        finish(&mut state, "cancelled", 100);
        assert_eq!(state.failed, 0);
        for _ in 0..3 {
            finish(&mut state, "failed", 100);
        }
        assert_eq!(state.lockout_until, 30_100);
        finish(&mut state, "failed", 30_101);
        finish(&mut state, "failed", 60_102);
        assert!(snapshot(&mut state).disconnect_required);
    }
    #[test]
    fn pin_verifiers_remain_private_and_validate_existing_algorithm() {
        // Independent Python/WebCrypto PBKDF2-SHA256 compatibility vector.
        let existing = PinRecord {
            salt: "AAECAwQFBgcICQoLDA0ODw".into(),
            hash: "wUBPOJm8VNLYJww0_LmDBnV1Ctr-mhyjPkcX-RhHqqQ".into(),
            iterations: 180_000,
            length: 4,
        };
        assert!(existing.verify("1234").unwrap());
        let record = PinRecord::create("1234").unwrap();
        assert!(record.verify("1234").unwrap());
        assert!(!record.verify("4321").unwrap());
        let settings = Settings {
            pin: Some(record),
            ..Default::default()
        };
        let json = settings.public().to_string();
        assert!(!json.contains("hash"));
        assert!(!json.contains("salt"));
    }
    #[test]
    fn session_bound_prompt_tickets_cannot_be_replayed_or_used_for_pin() {
        let runtime = Runtime::default();
        let identity = SessionIdentity {
            server: "s".into(),
            user_id: "u".into(),
            generation: 1,
        };
        runtime.initialize(
            identity.clone(),
            Settings {
                enabled: true,
                biometric_enabled: true,
                ..Default::default()
            },
        );
        runtime.lock(&identity).unwrap();
        let (ticket, _) = runtime.begin(&identity, "biometric").unwrap();
        assert!(runtime.begin(&identity, "biometric").is_err());
        assert!(runtime.finish(&identity, ticket, "accepted", true).is_err());
        let mut other = identity.clone();
        other.generation += 1;
        assert!(runtime.finish(&other, ticket, "accepted", false).is_err());
        assert!(
            !runtime
                .finish(&identity, ticket, "accepted", false)
                .unwrap()
                .locked
        );
        assert!(
            runtime
                .finish(&identity, ticket, "accepted", false)
                .is_err()
        );
    }
    #[test]
    fn native_idle_deadline_locks_at_the_boundary_and_cancel_keeps_attempts() {
        let mut state = State {
            revision: 0,
            identity: SessionIdentity {
                server: "s".into(),
                user_id: "u".into(),
                generation: 1,
            },
            settings: Settings {
                enabled: true,
                biometric_enabled: true,
                timed_lock_enabled: true,
                timed_lock_ms: 60_000,
                ..Default::default()
            },
            locked: false,
            failed: 2,
            lockout_until: 0,
            deadline: None,
            pending: None,
        };
        schedule(&mut state, 10);
        tick(&mut state, 60_009);
        assert!(!state.locked);
        tick(&mut state, 60_010);
        assert!(state.locked);
        finish(&mut state, "cancelled", 60_010);
        assert_eq!(state.failed, 2);
        finish(&mut state, "accepted", 60_011);
        assert!(!state.locked);
        assert_eq!(state.failed, 0);
        assert_eq!(state.deadline, Some(120_011));
    }
    #[test]
    fn malformed_credential_metadata_does_not_discard_an_existing_pin() {
        let settings = Settings::parse(
            &serde_json::json!({"enabled":true,"pin":{"salt":"AA","hash":"AA","iterations":180000,"length":4},"platformCredentials":[{"invalid":true}]}),
        );
        assert!(settings.enabled);
        assert!(settings.pin.is_some());
        assert!(settings.platform_credentials.is_empty());
    }
}
