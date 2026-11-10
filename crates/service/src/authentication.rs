//! Protocol authentication tokens. Claims are decoded for local lifecycle/display;
//! only the server can verify their signature and authorize requests.

pub mod token_refresh;

use base64ct::{Base64UrlUnpadded, Encoding};
use serde::Deserialize;

use crate::sensitive::SecretString;

pub const AUTH: u8 = 1;
pub const POST_AUTH: u8 = 2;
pub const GENERAL: u8 = 4;
pub const ESCALATION: u8 = 8;
pub const ESCALATED: u8 = GENERAL | ESCALATION;

#[derive(Clone, Deserialize)]
pub struct TokenClaims {
    pub sub: String,
    pub purpose: u8,
    pub exp: f64,
}

pub struct IssuedToken {
    pub secret: SecretString,
    pub claims: TokenClaims,
}

impl IssuedToken {
    pub fn from_response(data: &mut serde_json::Value, purpose: u8) -> Result<Self, String> {
        let secret = match data.get_mut("token").map(std::mem::take) {
            Some(serde_json::Value::String(token)) => SecretString::new(token),
            _ => return Err("Server did not return a token".into()),
        };
        let claims = decode_claims(&secret)?;
        if claims.purpose != purpose || data["purpose"].as_u64() != Some(purpose.into()) {
            return Err("Server returned an unexpected token purpose".into());
        }
        if claims.exp <= unix_now() {
            return Err("Server returned an expired token".into());
        }
        Ok(Self { secret, claims })
    }
}

pub struct PendingAuthentication {
    pub username: String,
    pub issued: IssuedToken,
    pub methods: Vec<String>,
}

pub fn decode_claims(token: &str) -> Result<TokenClaims, String> {
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|part| part.is_empty()) {
        return Err("Invalid server token".into());
    }
    let payload = zeroize::Zeroizing::new(
        Base64UrlUnpadded::decode_vec(parts[1]).map_err(|_| "Invalid token payload")?,
    );
    let claims: TokenClaims =
        serde_json::from_slice(&payload).map_err(|_| "Invalid token claims")?;
    if claims.sub.is_empty() || !claims.exp.is_finite() || claims.exp <= 0.0 {
        return Err("Invalid token claims".into());
    }
    Ok(claims)
}

pub fn unix_now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(purpose: u8, exp: f64) -> serde_json::Value {
        let payload = Base64UrlUnpadded::encode_string(
            serde_json::json!({"sub":"user-id", "purpose":purpose, "exp":exp})
                .to_string()
                .as_bytes(),
        );
        serde_json::json!({"token":format!("header.{payload}.signature"), "purpose":purpose, "exp":1})
    }

    #[test]
    fn expiry_comes_from_fractional_jwt_claim_not_response_field() {
        let exp = unix_now().floor() + 300.125;
        let issued = IssuedToken::from_response(&mut response(ESCALATED, exp), ESCALATED).unwrap();
        assert_eq!(issued.claims.exp, exp);
    }

    #[test]
    fn rejects_wrong_purpose_expired_and_malformed_tokens() {
        assert!(
            IssuedToken::from_response(&mut response(AUTH, unix_now() + 60.0), GENERAL).is_err()
        );
        assert!(IssuedToken::from_response(&mut response(ESCALATED, 1.0), ESCALATED).is_err());
        assert!(decode_claims("not-a-jwt").is_err());
    }

    #[test]
    fn purposes_match_the_server_flags_and_reject_legacy_escalation() {
        assert_eq!(
            (AUTH, POST_AUTH, GENERAL, ESCALATION, ESCALATED),
            (1, 2, 4, 8, 12)
        );
        for purpose in [AUTH, POST_AUTH, GENERAL, ESCALATED] {
            assert!(
                IssuedToken::from_response(&mut response(purpose, unix_now() + 60.0), purpose)
                    .is_ok()
            );
        }
        assert!(
            IssuedToken::from_response(&mut response(6, unix_now() + 60.0), ESCALATED).is_err()
        );
        let mut mismatched = response(GENERAL, unix_now() + 60.0);
        mismatched["purpose"] = serde_json::json!(POST_AUTH);
        assert!(IssuedToken::from_response(&mut mismatched, GENERAL).is_err());
    }
}
