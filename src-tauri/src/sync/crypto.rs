//! Sync encryption and key wrapping. Secret types deliberately do not implement Debug.
//! Callers must zeroize borrowed passphrases and returned KEKs/display strings when done.

use argon2::{Algorithm, Argon2, Block, Params, Version};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{
        Aead, KeyInit, Payload,
        rand_core::{OsRng, RngCore},
    },
};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::error::AppError;

const NONCE_BYTES: usize = 24;
const TAG_BYTES: usize = 16;
const WRAP_AAD: &[u8] = b"anchoa-sync-dek-v1\0";
const RECOVERY_KEK_LABEL: &[u8] = b"anchoa-sync-recovery-kek-v1\0";
const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

pub struct Dek([u8; 32]);

impl Dek {
    pub fn generate() -> Result<Self, AppError> {
        let mut key = Self([0; 32]);
        random_bytes(&mut key.0)?;
        Ok(key)
    }
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl Zeroize for Dek {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for Dek {
    fn drop(&mut self) {
        self.zeroize();
    }
}

impl ZeroizeOnDrop for Dek {}

pub struct RecoveryKey([u8; 16]);

impl RecoveryKey {
    pub fn generate() -> Result<Self, AppError> {
        let mut key = Self([0; 16]);
        random_bytes(&mut key.0)?;
        Ok(key)
    }
    pub fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }
    /// Fixed-width Crockford integer encoding: 128 bits in 32 symbols, padded on the left
    /// with six zero symbols (and two zero bits), grouped into eight blocks of four.
    pub fn display(&self) -> String {
        let mut value = Zeroizing::new(u128::from_be_bytes(self.0));
        let mut digits = Zeroizing::new([b'0'; 32]);
        for digit in digits.iter_mut().rev() {
            *digit = CROCKFORD[(*value & 31) as usize];
            *value >>= 5;
        }
        let mut output = String::with_capacity(39);
        for (index, digit) in digits.iter().enumerate() {
            if index > 0 && index % 4 == 0 {
                output.push('-');
            }
            output.push(char::from(*digit));
        }
        output
    }

    pub fn parse(value: &str) -> Result<Self, AppError> {
        let mut decoded = Zeroizing::new(0_u128);
        let mut count = 0;
        for character in value.chars().filter(|c| !c.is_whitespace() && *c != '-') {
            let character = match character.to_ascii_uppercase() {
                'O' => '0',
                'I' | 'L' => '1',
                other => other,
            };
            let digit = CROCKFORD
                .iter()
                .position(|&byte| char::from(byte) == character)
                .ok_or_else(invalid_recovery_key)?;
            if count == 32 {
                return Err(invalid_recovery_key());
            }
            *decoded = decoded
                .checked_mul(32)
                .and_then(|number| number.checked_add(digit as u128))
                .ok_or_else(invalid_recovery_key)?;
            count += 1;
        }
        if count != 32 {
            return Err(invalid_recovery_key());
        }
        Ok(Self(decoded.to_be_bytes()))
    }
}

impl Zeroize for RecoveryKey {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for RecoveryKey {
    fn drop(&mut self) {
        self.zeroize();
    }
}

impl ZeroizeOnDrop for RecoveryKey {}

#[derive(Debug, Clone)]
pub struct Kdf {
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
    pub salt: [u8; 16],
}

impl Default for Kdf {
    fn default() -> Self {
        let mut salt = [0; 16];
        OsRng.fill_bytes(&mut salt);
        Self {
            m_kib: 65_536,
            t: 3,
            p: 1,
            salt,
        }
    }
}

fn random_bytes(bytes: &mut [u8]) -> Result<(), AppError> {
    OsRng
        .try_fill_bytes(bytes)
        .map_err(|_| AppError::Other("Gagal membuat kunci sync acak".into()))
}

fn invalid_recovery_key() -> AppError {
    AppError::Invalid("Recovery key sync tidak valid".into())
}

pub fn wrap(dek: &Dek, kek: &[u8; 32]) -> Vec<u8> {
    encrypt(kek, WRAP_AAD, dek.as_bytes())
}

pub fn unwrap(blob: &[u8], kek: &[u8; 32]) -> Result<Dek, AppError> {
    let wrong_passphrase = || AppError::Invalid("Frasa sandi sync salah".into());
    if blob.len() != NONCE_BYTES + 32 + TAG_BYTES {
        return Err(wrong_passphrase());
    }
    let plain = Zeroizing::new(decrypt(kek, WRAP_AAD, blob).map_err(|_| wrong_passphrase())?);
    let mut dek = Dek::from_bytes([0; 32]);
    dek.0.copy_from_slice(&plain);
    Ok(dek)
}

pub fn kek_from_passphrase(passphrase: &str, kdf: &Kdf) -> Result<[u8; 32], AppError> {
    let invalid = || AppError::Invalid("Parameter KDF sync tidak valid".into());
    // Parameters come from the server's vault row, which is untrusted: bound them so a
    // hostile server cannot make the client allocate gigabytes or spin for minutes.
    if !(8..=262_144).contains(&kdf.m_kib) || !(1..=8).contains(&kdf.t) || !(1..=4).contains(&kdf.p) {
        return Err(invalid());
    }
    let params = Params::new(kdf.m_kib, kdf.t, kdf.p, Some(32)).map_err(|_| invalid())?;
    // The work memory contains password-derived blocks; clear it as well as the temporary KEK.
    let mut memory = Zeroizing::new(vec![Block::default(); params.block_count()]);
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut kek = Zeroizing::new([0; 32]);
    argon2
        .hash_password_into_with_memory(passphrase.as_bytes(), &kdf.salt, &mut *kek, &mut *memory)
        .map_err(|_| invalid())?;
    Ok(*kek)
}

pub fn kek_from_recovery(key: &RecoveryKey) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(RECOVERY_KEK_LABEL);
    hash.update(key.as_bytes());
    let kek = Zeroizing::new(<[u8; 32]>::from(hash.finalize()));
    *kek
}

/// Encrypt with a fresh random nonce. The output is nonce (24 bytes) followed by
/// ciphertext and its Poly1305 tag (16 bytes).
pub fn seal(dek: &Dek, aad: &[u8], plain: &[u8]) -> Vec<u8> {
    encrypt(dek.as_bytes(), aad, plain)
}

/// Largest ciphertext accepted from the server (spec S9), checked before any work.
pub const MAX_CIPHERTEXT_BYTES: usize = 262_144;

pub fn open(dek: &Dek, aad: &[u8], blob: &[u8]) -> Result<Vec<u8>, AppError> {
    if blob.len() > MAX_CIPHERTEXT_BYTES {
        return Err(AppError::Invalid("Data sync tidak dapat didekripsi".into()));
    }
    decrypt(dek.as_bytes(), aad, blob)
        .map_err(|_| AppError::Invalid("Data sync tidak dapat didekripsi".into()))
}

fn encrypt(key: &[u8; 32], aad: &[u8], plain: &[u8]) -> Vec<u8> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let mut nonce = [0; NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce);
    // Sync's record limit is 256 KiB. RustCrypto can reject encryption only for
    // messages exceeding the ChaCha20 stream's 256 GiB limit.
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: plain, aad })
        .expect("Ukuran data sync melebihi batas kriptografi");
    let mut blob = Vec::with_capacity(NONCE_BYTES + ciphertext.len());
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext);
    blob
}

fn decrypt(key: &[u8; 32], aad: &[u8], blob: &[u8]) -> Result<Vec<u8>, chacha20poly1305::Error> {
    if blob.len() < NONCE_BYTES + TAG_BYTES {
        return Err(chacha20poly1305::Error);
    }
    let (nonce, ciphertext) = blob.split_at(NONCE_BYTES);
    XChaCha20Poly1305::new(key.into()).decrypt(
        XNonce::from_slice(nonce),
        Payload {
            msg: ciphertext,
            aad,
        },
    )
}

/// Length-prefixed UTF-8 fields and a big-endian timestamp authenticate the full
/// (user, record, changed_at, device) tuple without ambiguous concatenations.
pub fn aad(user_id: &str, record_id: &str, changed_at: i64, device_id: &str) -> Vec<u8> {
    let mut output = Vec::new();
    for field in [user_id, record_id] {
        output.extend_from_slice(&(field.len() as u64).to_be_bytes());
        output.extend_from_slice(field.as_bytes());
    }
    output.extend_from_slice(&changed_at.to_be_bytes());
    output.extend_from_slice(&(device_id.len() as u64).to_be_bytes());
    output.extend_from_slice(device_id.as_bytes());
    output
}

#[cfg(test)]
mod tests {
    #[test]
    fn open_rejects_oversized_ciphertext_before_decrypting() {
        let dek = Dek::from_bytes([3; 32]);
        let blob = vec![0; MAX_CIPHERTEXT_BYTES + 1];
        assert!(matches!(open(&dek, b"aad", &blob), Err(AppError::Invalid(_))));
    }

    #[test]
    fn rejects_out_of_range_kdf_parameters_from_the_server() {
        for (m_kib, t, p) in [
            (1_048_576, 3, 1), // 1 GiB excessive for remote parameter
            (262_145, 3, 1),   // Above 256 MiB max
            (65_536, 9, 1),    // Above t=8 max
            (65_536, 0, 1),
            (65_536, 3, 64),
        ] {
            let kdf = Kdf { m_kib, t, p, salt: [7; 16] };
            assert!(matches!(kek_from_passphrase("frasa sandi panjang", &kdf), Err(AppError::Invalid(_))));
        }
    }

    use super::*;
    use zeroize::Zeroizing;

    fn kdf() -> Kdf {
        Kdf {
            m_kib: 32,
            t: 1,
            p: 1,
            salt: *b"0123456789abcdef",
        }
    }

    #[test]
    fn seal_open_round_trip_uses_24_byte_random_nonces() {
        let dek = Dek::from_bytes([17; 32]);
        let aad = aad("user", "record", 123, "device");
        for plain in [b"".as_slice(), b"catatan pribadi\0", &[0xff, 0, 1, 2]] {
            let first = seal(&dek, &aad, plain);
            let second = seal(&dek, &aad, plain);
            assert_eq!(first.len(), 24 + plain.len() + 16);
            assert_ne!(&first[..24], &second[..24]);
            assert_eq!(open(&dek, &aad, &first).unwrap(), plain);
            assert_eq!(open(&dek, &aad, &second).unwrap(), plain);
        }
    }

    #[test]
    fn aad_authenticates_user_record_timestamp_and_device() {
        let dek = Dek::from_bytes([17; 32]);
        let original = aad("user", "record", 123, "device");
        let blob = seal(&dek, &original, b"secret record");
        for altered in [
            aad("other-user", "record", 123, "device"),
            aad("user", "other-record", 123, "device"),
            aad("user", "record", 124, "device"),
            aad("user", "record", 123, "other-device"),
        ] {
            assert!(open(&dek, &altered, &blob).is_err());
        }
        assert_ne!(aad("ab", "c", 123, "d"), aad("a", "bc", 123, "d"));
        assert_ne!(aad("a\0", "b", -1, "d"), aad("a", "\0b", -1, "d"));
        assert_ne!(aad("a", "b", -1, "d"), aad("a", "b", i64::MAX, "d"));
    }

    #[test]
    fn open_rejects_tampered_nonce_ciphertext_tag_and_wrong_dek() {
        let dek = Dek::from_bytes([17; 32]);
        let blob = seal(&dek, b"aad", b"secret record");
        for offset in [0, 23, 24, blob.len() - 1] {
            let mut changed = blob.clone();
            changed[offset] ^= 1;
            assert!(open(&dek, b"aad", &changed).is_err());
        }
        assert!(open(&Dek::from_bytes([18; 32]), b"aad", &blob).is_err());
        for len in 0..blob.len() {
            assert!(open(&dek, b"aad", &blob[..len]).is_err());
        }
    }

    #[test]
    fn wrapped_dek_round_trips_with_both_keks_and_new_nonces() {
        let dek = Dek::from_bytes([29; 32]);
        let recovery = RecoveryKey::from_bytes([7; 16]);
        for kek in [
            Zeroizing::new(kek_from_passphrase("frasa sandi pribadi", &kdf()).unwrap()),
            Zeroizing::new(kek_from_recovery(&recovery)),
        ] {
            let first = wrap(&dek, &kek);
            let second = wrap(&dek, &kek);
            assert_eq!(first.len(), 24 + 32 + 16);
            assert_ne!(&first[..24], &second[..24]);
            assert_eq!(unwrap(&first, &kek).unwrap().as_bytes(), dek.as_bytes());
        }
    }

    #[test]
    fn wrong_passphrase_returns_the_required_error_without_secrets() {
        let dek = Dek::from_bytes(*b"0123456789abcdef0123456789abcdef");
        let kek = Zeroizing::new(kek_from_passphrase("frasa sandi pribadi", &kdf()).unwrap());
        let wrong = Zeroizing::new(kek_from_passphrase("frasa sandi salah", &kdf()).unwrap());
        let error = unwrap(&wrap(&dek, &kek), &wrong).err().unwrap();
        assert!(
            matches!(&error, AppError::Invalid(message) if message == "Frasa sandi sync salah")
        );
        for output in [
            error.to_string(),
            format!("{error:?}"),
            serde_json::to_string(&error).unwrap(),
        ] {
            for secret in [
                "frasa sandi pribadi",
                "frasa sandi salah",
                "0123456789abcdef0123456789abcdef",
            ] {
                assert!(!output.contains(secret));
            }
        }
    }

    #[test]
    fn unwrap_rejects_malformed_and_tampered_wrapped_deks() {
        let dek = Dek::from_bytes([29; 32]);
        let kek = Zeroizing::new([31; 32]);
        let blob = wrap(&dek, &kek);
        for len in 0..blob.len() {
            assert!(unwrap(&blob[..len], &kek).is_err());
        }
        let mut changed = blob;
        changed[24] ^= 1;
        assert!(unwrap(&changed, &kek).is_err());
        // A valid record ciphertext must not be accepted as a wrapped DEK.
        let record = seal(&Dek::from_bytes(*kek), b"", dek.as_bytes());
        assert!(unwrap(&record, &kek).is_err());
    }

    #[test]
    fn kdf_defaults_have_a_random_salt_and_required_costs() {
        let first = Kdf::default();
        let second = Kdf::default();
        assert_eq!((first.m_kib, first.t, first.p), (65_536, 3, 1));
        assert_ne!(first.salt, second.salt);
    }

    #[test]
    fn passphrase_kdf_is_repeatable_and_uses_the_supplied_parameters() {
        let base = kdf();
        let first = Zeroizing::new(kek_from_passphrase("frasa sandi pribadi", &base).unwrap());
        assert_eq!(
            *first,
            kek_from_passphrase("frasa sandi pribadi", &base).unwrap()
        );
        for different in [
            Kdf {
                salt: [1; 16],
                ..base.clone()
            },
            Kdf {
                m_kib: 64,
                ..base.clone()
            },
            Kdf {
                t: 2,
                ..base.clone()
            },
            Kdf { p: 2, ..base },
        ] {
            assert_ne!(
                *first,
                kek_from_passphrase("frasa sandi pribadi", &different).unwrap()
            );
        }
    }

    #[test]
    fn invalid_kdf_parameters_return_redacted_app_errors() {
        for invalid in [
            Kdf { m_kib: 0, ..kdf() },
            Kdf { t: 0, ..kdf() },
            Kdf { p: 0, ..kdf() },
        ] {
            let error = kek_from_passphrase("secret passphrase", &invalid).unwrap_err();
            assert!(matches!(error, AppError::Invalid(_)));
            assert!(!format!("{error:?} {error}").contains("secret passphrase"));
        }
    }

    #[test]
    fn passphrase_kdf_matches_a_fixed_argon2id_v19_vector() {
        assert_eq!(
            kek_from_passphrase("frasa sandi pribadi", &kdf()).unwrap(),
            [
                0x22, 0x7c, 0x17, 0x7f, 0xc5, 0x3a, 0xe0, 0x1d, 0x73, 0xb9, 0x2c, 0xfd, 0xd4, 0xfe,
                0x99, 0xe2, 0xac, 0x24, 0xce, 0x02, 0x12, 0x4c, 0x50, 0x1a, 0xc6, 0xc4, 0xdb, 0xaa,
                0xdb, 0x39, 0x24, 0xb5,
            ]
        );
    }

    #[test]
    fn recovery_display_has_eight_crockford_groups_and_round_trips() {
        for bytes in [[0; 16], [255; 16], *b"0123456789abcdef"] {
            let key = RecoveryKey::from_bytes(bytes);
            let displayed = Zeroizing::new(key.display());
            let groups: Vec<_> = displayed.split('-').collect();
            assert_eq!(groups.len(), 8);
            assert!(groups.iter().all(|group| group.len() == 4));
            assert!(
                groups
                    .iter()
                    .flat_map(|group| group.bytes())
                    .all(|byte| b"0123456789ABCDEFGHJKMNPQRSTVWXYZ".contains(&byte))
            );
            let parsed = RecoveryKey::parse(&displayed).unwrap();
            assert_eq!(parsed.as_bytes(), key.as_bytes());
            let messy = Zeroizing::new(format!(
                " \t{}\n",
                displayed.to_ascii_lowercase().replace('-', " - \t")
            ));
            assert_eq!(
                RecoveryKey::parse(&messy).unwrap().as_bytes(),
                key.as_bytes()
            );
        }
    }

    #[test]
    fn recovery_parse_rejects_bad_length_characters_and_overflow() {
        for invalid in [
            "",
            "0000",
            "0000000000000000000000000000000",
            "000000000000000000000000000000000",
            "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ",
            "0000-0000-0000-0000-0000-0000-0000-000U",
            "0000-0000-0000-0000-0000-0000-0000-000!",
            "0000-0000-0000-0000-0000-0000-0000-000é",
        ] {
            let error = RecoveryKey::parse(invalid).err().unwrap();
            assert!(matches!(error, AppError::Invalid(_)));
            if !invalid.is_empty() {
                assert!(!format!("{error:?} {error}").contains(invalid));
            }
        }
    }

    #[test]
    fn recovery_kek_is_stable_and_depends_on_all_key_bytes() {
        let first = RecoveryKey::from_bytes([7; 16]);
        let displayed = Zeroizing::new(first.display());
        let parsed = RecoveryKey::parse(&displayed).unwrap();
        let expected = Zeroizing::new(kek_from_recovery(&first));
        assert_eq!(*expected, kek_from_recovery(&parsed));
        for offset in 0..16 {
            let mut changed = [7; 16];
            changed[offset] ^= 1;
            assert_ne!(
                *expected,
                kek_from_recovery(&RecoveryKey::from_bytes(changed))
            );
        }
    }

    #[test]
    fn recovery_kek_has_a_fixed_domain_separated_sha256_vector() {
        let key = RecoveryKey::from_bytes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        assert_eq!(
            kek_from_recovery(&key),
            [
                0x12, 0x3e, 0x1c, 0x8a, 0x07, 0x7c, 0x75, 0x48, 0xa6, 0xdd, 0x4d, 0xe3, 0xdf, 0x97,
                0xab, 0x93, 0xaa, 0x3e, 0x9a, 0xbb, 0xe6, 0x6d, 0x0a, 0xcc, 0xca, 0x11, 0x04, 0x17,
                0xc3, 0x9c, 0x1a, 0x45,
            ]
        );
    }

    #[test]
    fn crypto_types_and_keystore_cannot_format_secrets_with_debug() {
        // If a type implements Debug, inference becomes ambiguous and this test fails to compile.
        trait AmbiguousIfDebug<A> {
            fn check() {}
        }
        impl<T: ?Sized> AmbiguousIfDebug<()> for T {}
        impl<T: ?Sized + std::fmt::Debug> AmbiguousIfDebug<u8> for T {}
        let _ = <Dek as AmbiguousIfDebug<_>>::check;
        let _ = <RecoveryKey as AmbiguousIfDebug<_>>::check;
        let _ = <crate::keystore::KeyringStore as AmbiguousIfDebug<_>>::check;
    }

    #[test]
    fn decryption_errors_do_not_expose_keys_or_plaintext() {
        let dek = Dek::from_bytes(*b"secret-dek-0123456789abcdef01234");
        let recovery = RecoveryKey::from_bytes(*b"secret-recovery!");
        let displayed = Zeroizing::new(recovery.display());
        let mut blob = seal(&dek, b"aad", b"secret plaintext");
        blob[24] ^= 1;
        let error = open(&dek, b"aad", &blob).unwrap_err();
        for output in [
            error.to_string(),
            format!("{error:?}"),
            serde_json::to_string(&error).unwrap(),
        ] {
            for secret in [
                "secret-dek-0123456789abcdef01234",
                "secret-recovery!",
                displayed.as_str(),
                "secret plaintext",
            ] {
                assert!(!output.contains(secret));
            }
        }
    }

    #[test]
    fn secret_types_have_the_required_size_and_zeroize() {
        fn assert_zeroize_on_drop<T: Zeroize + ZeroizeOnDrop>() {}
        assert_zeroize_on_drop::<Dek>();
        assert_zeroize_on_drop::<RecoveryKey>();
        assert_eq!(std::mem::size_of::<Dek>(), 32);
        assert_eq!(std::mem::size_of::<RecoveryKey>(), 16);
        assert!(std::mem::needs_drop::<Dek>());
        assert!(std::mem::needs_drop::<RecoveryKey>());
        let mut dek = Dek::from_bytes([17; 32]);
        let mut key = RecoveryKey::from_bytes([7; 16]);
        dek.zeroize();
        key.zeroize();
        assert_eq!(dek.as_bytes(), &[0; 32]);
        assert_eq!(key.as_bytes(), &[0; 16]);
    }

    #[test]
    fn generated_deks_and_recovery_keys_are_random() {
        let first = Dek::generate().unwrap();
        let second = Dek::generate().unwrap();
        assert_ne!(first.as_bytes(), second.as_bytes());
        let first = RecoveryKey::generate().unwrap();
        let second = RecoveryKey::generate().unwrap();
        assert_ne!(first.as_bytes(), second.as_bytes());
    }
}
