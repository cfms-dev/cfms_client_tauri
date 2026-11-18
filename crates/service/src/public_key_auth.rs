//! OpenSSH decoding and CFMS signatures. CFMS signs raw challenges, not SSHSIG envelopes.
use base64ct::{Base64, Encoding};
use p256::ecdsa::signature::hazmat::PrehashSigner;
use sha2::{Digest, Sha256};
use signature::{SignatureEncoding, Signer};
use ssh_key::{
    PrivateKey,
    private::{EcdsaKeypair, KeypairData},
};

pub use ssh_key::PrivateKey as AuthPrivateKey;

fn rsa_private(pair: &ssh_key::private::RsaKeypair) -> Result<rsa::RsaPrivateKey, String> {
    fn integer(value: &ssh_key::Mpint) -> Result<rsa::BigUint, String> {
        Ok(rsa::BigUint::from_bytes_be(
            value.as_positive_bytes().ok_or("publicKey.invalidFile")?,
        ))
    }
    rsa::RsaPrivateKey::from_components(
        integer(pair.public().n())?,
        integer(pair.public().e())?,
        integer(pair.private().d())?,
        vec![integer(pair.private().p())?, integer(pair.private().q())?],
    )
    .map_err(|_| "publicKey.invalidFile".into())
}

pub fn parse(bytes: &[u8]) -> Result<PrivateKey, String> {
    // OpenSSH writes 70-column armor, while Python cryptography writes 64.
    // Decode the armor independently so both standard representations work.
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "publicKey.invalidFile")?
        .trim();
    let body = text
        .strip_prefix("-----BEGIN OPENSSH PRIVATE KEY-----")
        .and_then(|text| text.strip_suffix("-----END OPENSSH PRIVATE KEY-----"))
        .ok_or("publicKey.invalidFile")?;
    let encoded = zeroize::Zeroizing::new(body.split_ascii_whitespace().collect::<String>());
    let decoded =
        zeroize::Zeroizing::new(Base64::decode_vec(&encoded).map_err(|_| "publicKey.invalidFile")?);
    let key = PrivateKey::from_bytes(&decoded).map_err(|_| "publicKey.invalidFile")?;
    match key.algorithm() {
        ssh_key::Algorithm::Ed25519
        | ssh_key::Algorithm::Rsa { .. }
        | ssh_key::Algorithm::Ecdsa { .. } => Ok(key),
        _ => Err("publicKey.unsupportedAlgorithm".into()),
    }
}

/// The server hashes canonical OpenSSH text (without its optional comment), not the SSH blob.
pub fn fingerprint(key: &PrivateKey) -> Result<String, String> {
    Ok(canonical_public_key_and_fingerprint(key.public_key())?.1)
}

pub fn canonical_public_key_and_fingerprint(
    public_key: &ssh_key::PublicKey,
) -> Result<(String, String), String> {
    let mut public = public_key.clone();
    public.set_comment("");
    let text = public.to_openssh().map_err(|_| "publicKey.invalidFile")?;
    let trimmed = text.trim().to_string();
    let fp = hex::encode(Sha256::digest(trimmed.as_bytes()));
    Ok((trimmed, fp))
}

/// Generate a fresh Ed25519 keypair, returning `(private_key, openssh_public_key, fingerprint)`.
pub fn generate_ed25519() -> Result<(PrivateKey, String, String), String> {
    use rand::RngExt;
    let seed = zeroize::Zeroizing::new(rand::rng().random::<[u8; 32]>());
    let signing = ed25519_dalek::SigningKey::from_bytes(&seed);
    let ed_pair = ssh_key::private::Ed25519Keypair {
        public: ssh_key::public::Ed25519PublicKey(signing.verifying_key().to_bytes()),
        private: ssh_key::private::Ed25519PrivateKey::from_bytes(&seed),
    };
    let key = PrivateKey::from(ed_pair);
    let (public_key, fp) = canonical_public_key_and_fingerprint(key.public_key())?;
    Ok((key, public_key, fp))
}

/// Encode an unencrypted OpenSSH private key into PEM armor for secure vault storage.
pub fn encode_openssh_private_key(key: &PrivateKey) -> Result<zeroize::Zeroizing<String>, String> {
    key.to_openssh(ssh_key::LineEnding::LF)
        .map_err(|_| "publicKey.invalidFile".into())
}

/// Validate a 65-byte uncompressed SEC1 NIST P-256 public point (`0x04 || X || Y`)
/// and return `(canonical_openssh_public_key, fingerprint)`.
pub fn p256_public_key_from_sec1(sec1_bytes: &[u8]) -> Result<(String, String), String> {
    let verifying = p256::ecdsa::VerifyingKey::from_sec1_bytes(sec1_bytes)
        .map_err(|_| "publicKey.invalidFile")?;
    let encoded_point = verifying.to_sec1_point(false);
    let ssh_point = ssh_key::sec1::EncodedPoint::from_bytes(encoded_point.as_bytes())
        .map_err(|_| "publicKey.invalidFile")?;
    let public = ssh_key::PublicKey::from(ssh_key::public::KeyData::Ecdsa(
        ssh_key::public::EcdsaPublicKey::NistP256(ssh_point),
    ));
    canonical_public_key_and_fingerprint(&public)
}

pub fn sha256_digest(message: &[u8]) -> [u8; 32] {
    Sha256::digest(message).into()
}

/// Convert a 64-byte IEEE P1363 `(r || s)` P-256 signature (e.g. from Windows CNG TPM)
/// into the canonical ASN.1 DER Base64 format expected by CFMS servers.
pub fn encode_p256_raw_signature(raw_r_s: &[u8]) -> Result<String, String> {
    let sig = p256::ecdsa::Signature::from_slice(raw_r_s).map_err(|_| "publicKey.signingFailed")?;
    Ok(Base64::encode_string(sig.to_der().as_bytes()))
}

/// Validate and normalize an ASN.1 DER P-256 signature (e.g. from Android Keystore)
/// into the canonical ASN.1 DER Base64 format expected by CFMS servers.
pub fn encode_p256_der_signature(der: &[u8]) -> Result<String, String> {
    let sig = p256::ecdsa::Signature::from_der(der).map_err(|_| "publicKey.signingFailed")?;
    Ok(Base64::encode_string(sig.to_der().as_bytes()))
}

pub fn unlock(key: PrivateKey, passphrase: &str) -> Result<PrivateKey, String> {
    if key.is_encrypted() {
        key.decrypt(passphrase)
            .map_err(|_| "publicKey.wrongPassphrase".into())
    } else {
        Ok(key)
    }
}

pub fn decode_challenge(
    data: &serde_json::Value,
    stream_id: u32,
    fingerprint: &str,
    stage: &str,
) -> Result<Vec<u8>, String> {
    let interaction = data["interaction_id"]
        .as_str()
        .ok_or("publicKey.invalidChallenge")?;
    let bytes = Base64::decode_vec(
        data["challenge"]
            .as_str()
            .ok_or("publicKey.invalidChallenge")?,
    )
    .map_err(|_| "publicKey.invalidChallenge")?;
    let details: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "publicKey.invalidChallenge")?;
    if data["method"] != "publickey"
        || data["stage"] != stage
        || details["scope"] != "cfms.auth.publickey"
        || details["stream_id"] != stream_id
        || details["interaction_id"] != interaction
        || details["fingerprint"] != fingerprint
        || details["stage"] != stage
    {
        return Err("publicKey.invalidChallenge".into());
    }
    Ok(bytes)
}

pub fn sign(key: &PrivateKey, message: &[u8]) -> Result<String, String> {
    let result: Result<Vec<u8>, signature::Error> = match key.key_data() {
        KeypairData::Ed25519(pair) => {
            use ed25519_dalek::Signer as _;
            Ok(ed25519_dalek::SigningKey::from_bytes(pair.private.as_ref())
                .sign(message)
                .to_bytes()
                .to_vec())
        }
        KeypairData::Rsa(pair) => {
            let private = rsa_private(pair)?;
            rsa::pkcs1v15::SigningKey::<sha2_legacy::Sha256>::new(private)
                .try_sign(message)
                .map(|sig| sig.to_vec())
        }
        KeypairData::Ecdsa(pair) => {
            let digest = Sha256::digest(message);
            match pair {
                EcdsaKeypair::NistP256 { private, .. } => {
                    let signing = p256::ecdsa::SigningKey::from_slice(private.as_slice())
                        .map_err(|_| "publicKey.invalidFile")?;
                    let sig: p256::ecdsa::Signature = signing
                        .sign_prehash(&digest)
                        .map_err(|_| "publicKey.signingFailed")?;
                    Ok(sig.to_der().as_bytes().to_vec())
                }
                EcdsaKeypair::NistP384 { private, .. } => {
                    let signing = p384::ecdsa::SigningKey::from_slice(private.as_slice())
                        .map_err(|_| "publicKey.invalidFile")?;
                    let sig: p384::ecdsa::Signature = signing
                        .sign_prehash(&digest)
                        .map_err(|_| "publicKey.signingFailed")?;
                    Ok(sig.to_der().as_bytes().to_vec())
                }
                EcdsaKeypair::NistP521 { private, .. } => {
                    let signing = p521::ecdsa::SigningKey::from_slice(private.as_slice())
                        .map_err(|_| "publicKey.invalidFile")?;
                    // SHA-256 is the server's digest even on P-521. Left-pad its integer.
                    let mut padded = [0u8; 66];
                    padded[34..].copy_from_slice(&digest);
                    let sig: p521::ecdsa::Signature = signing
                        .sign_prehash(&padded)
                        .map_err(|_| "publicKey.signingFailed")?;
                    Ok(sig.to_der().as_bytes().to_vec())
                }
            }
        }
        _ => return Err("publicKey.unsupportedAlgorithm".into()),
    };
    result
        .map(|bytes| Base64::encode_string(&bytes))
        .map_err(|_| "publicKey.signingFailed".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::signature::hazmat::PrehashVerifier;
    use signature::Verifier;

    fn vectors() -> Vec<serde_json::Value> {
        // Synthetic keys and signatures generated with the server's Python cryptography library.
        serde_json::from_str(include_str!("../tests/fixtures/auth-keys.json")).unwrap()
    }
    fn verify(key: &PrivateKey, message: &[u8], signature: &[u8]) -> bool {
        let digest = Sha256::digest(message);
        match key.key_data() {
            KeypairData::Ed25519(pair) => {
                ed25519_dalek::VerifyingKey::from_bytes(pair.public.as_ref())
                    .unwrap()
                    .verify_strict(
                        message,
                        &ed25519_dalek::Signature::from_slice(signature).unwrap(),
                    )
                    .is_ok()
            }
            KeypairData::Rsa(pair) => {
                let private = rsa_private(pair).unwrap();
                rsa::pkcs1v15::VerifyingKey::<sha2_legacy::Sha256>::new(rsa::RsaPublicKey::from(
                    &private,
                ))
                .verify(
                    message,
                    &rsa::pkcs1v15::Signature::try_from(signature).unwrap(),
                )
                .is_ok()
            }
            KeypairData::Ecdsa(EcdsaKeypair::NistP256 { private, .. }) => {
                p256::ecdsa::SigningKey::from_slice(private.as_slice())
                    .unwrap()
                    .verifying_key()
                    .verify_prehash(
                        &digest,
                        &p256::ecdsa::Signature::from_der(signature).unwrap(),
                    )
                    .is_ok()
            }
            KeypairData::Ecdsa(EcdsaKeypair::NistP384 { private, .. }) => {
                p384::ecdsa::SigningKey::from_slice(private.as_slice())
                    .unwrap()
                    .verifying_key()
                    .verify_prehash(
                        &digest,
                        &p384::ecdsa::Signature::from_der(signature).unwrap(),
                    )
                    .is_ok()
            }
            KeypairData::Ecdsa(EcdsaKeypair::NistP521 { private, .. }) => {
                let signing = p521::ecdsa::SigningKey::from_slice(private.as_slice()).unwrap();
                let mut padded = [0u8; 66];
                padded[34..].copy_from_slice(&digest);
                p521::ecdsa::VerifyingKey::from(&signing)
                    .verify_prehash(
                        &padded,
                        &p521::ecdsa::Signature::from_der(signature).unwrap(),
                    )
                    .is_ok()
            }
            _ => false,
        }
    }
    #[test]
    fn canonical_fingerprints_and_raw_signatures_match_the_server_on_every_curve() {
        for vector in vectors() {
            let key = parse(vector["private_key"].as_str().unwrap().as_bytes()).unwrap();
            assert_eq!(fingerprint(&key).unwrap(), vector["fingerprint"]);
            let message = Base64::decode_vec(vector["message"].as_str().unwrap()).unwrap();
            let python_signature =
                Base64::decode_vec(vector["server_signature"].as_str().unwrap()).unwrap();
            assert!(
                verify(&key, &message, &python_signature),
                "server signature: {}",
                vector["name"]
            );
            let signature = Base64::decode_vec(&sign(&key, &message).unwrap()).unwrap();
            assert!(
                verify(&key, &message, &signature),
                "client signature: {}",
                vector["name"]
            );
            assert!(!verify(&key, b"tampered challenge", &signature));
        }
    }
    #[test]
    fn encrypted_openssh_keys_require_the_correct_passphrase_and_retain_identity() {
        for vector in vectors() {
            let key = parse(vector["encrypted_key"].as_str().unwrap().as_bytes()).unwrap();
            assert!(key.is_encrypted());
            assert!(unlock(key.clone(), "wrong").is_err());
            let unlocked = unlock(key, "test-passphrase")
                .unwrap_or_else(|error| panic!("{}: {error}", vector["name"]));
            assert_eq!(fingerprint(&unlocked).unwrap(), vector["fingerprint"]);
        }
    }
    #[test]
    fn public_files_and_non_openssh_formats_are_rejected() {
        assert!(parse(b"-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----").is_err());
        assert!(parse(vectors()[0]["public_key"].as_str().unwrap().as_bytes()).is_err());
    }
    #[test]
    fn challenges_are_bound_to_the_stream_key_stage_and_interaction() {
        let challenge = serde_json::json!({"scope":"cfms.auth.publickey", "stream_id":7,"fingerprint":"abc","stage":"login","interaction_id":"step-1","nonce":"test"});
        let data = serde_json::json!({"method":"publickey","stage":"login","interaction_id":"step-1","challenge":Base64::encode_string(&serde_json::to_vec(&challenge).unwrap())});
        assert!(decode_challenge(&data, 7, "abc", "login").is_ok());
        assert!(decode_challenge(&data, 9, "abc", "login").is_err());
        assert!(decode_challenge(&data, 7, "different-key", "login").is_err());
        assert!(decode_challenge(&data, 7, "abc", "mfa").is_err());
        let mut replay = data.clone();
        replay["interaction_id"] = "step-2".into();
        assert!(decode_challenge(&replay, 7, "abc", "login").is_err());
    }
    #[test]
    fn generated_ed25519_keys_roundtrip_openssh_and_sign_challenges() {
        let (key, public_key, fp) = generate_ed25519().unwrap();
        assert!(public_key.starts_with("ssh-ed25519 "));
        assert_eq!(fingerprint(&key).unwrap(), fp);
        let encoded = encode_openssh_private_key(&key).unwrap();
        let parsed = parse(encoded.as_bytes()).unwrap();
        assert_eq!(fingerprint(&parsed).unwrap(), fp);
        let msg = b"test challenge payload";
        let sig_b64 = sign(&parsed, msg).unwrap();
        let sig_bytes = Base64::decode_vec(&sig_b64).unwrap();
        assert!(verify(&key, msg, &sig_bytes));
    }
    #[test]
    fn hardware_p256_sec1_public_keys_and_signatures_match_server_vectors() {
        let vector = vectors().into_iter().find(|v| v["name"] == "p256").unwrap();
        let key = parse(vector["private_key"].as_str().unwrap().as_bytes()).unwrap();
        let KeypairData::Ecdsa(EcdsaKeypair::NistP256 { public, .. }) = key.key_data() else {
            panic!("expected p256 vector");
        };
        let (openssh_pub, fp) = p256_public_key_from_sec1(public.as_bytes()).unwrap();
        assert_eq!(openssh_pub, vector["public_key"].as_str().unwrap());
        assert_eq!(fp, vector["fingerprint"].as_str().unwrap());

        let msg = Base64::decode_vec(vector["message"].as_str().unwrap()).unwrap();
        let server_der = Base64::decode_vec(vector["server_signature"].as_str().unwrap()).unwrap();
        let normalized_b64 = encode_p256_der_signature(&server_der).unwrap();
        let normalized_bytes = Base64::decode_vec(&normalized_b64).unwrap();
        assert!(verify(&key, &msg, &normalized_bytes));

        let parsed_sig = p256::ecdsa::Signature::from_der(&server_der).unwrap();
        let raw_r_s = parsed_sig.to_bytes();
        let from_raw_b64 = encode_p256_raw_signature(&raw_r_s).unwrap();
        let from_raw_bytes = Base64::decode_vec(&from_raw_b64).unwrap();
        assert!(verify(&key, &msg, &from_raw_bytes));
    }
}
