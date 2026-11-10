//! Compatibility with existing WebCrypto PBKDF2 app-lock records.
use zeroize::Zeroizing;
pub const ITERATIONS: u32 = 180_000;
pub fn derive(pin: &[u8], salt: &[u8], iterations: u32) -> Zeroizing<[u8; 32]> {
    let mut output = Zeroizing::new([0; 32]);
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(pin, salt, iterations, &mut *output);
    output
}
pub fn equal(a: &[u8; 32], b: &[u8; 32]) -> bool {
    hmac::digest::CtOutput::<sha2::Sha256>::new((*a).into())
        == hmac::digest::CtOutput::<sha2::Sha256>::new((*b).into())
}
