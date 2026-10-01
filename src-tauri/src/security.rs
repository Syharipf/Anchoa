//! PIN security, authentication, and lock state management.
use std::sync::Mutex;
use std::time::{Duration, Instant};

use argon2::{
    Argon2,
    password_hash::{
        PasswordHash, PasswordHasher, PasswordVerifier, Salt, SaltString,
        rand_core::{OsRng, RngCore},
    },
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Db;
use crate::error::AppError;

pub const PIN_HASH_KEY: &str = "security.pin_hash";
pub const MAX_FAILURES: u32 = 5;
pub const COOLDOWN_SECS: u64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecurityStatus {
    pub pin_enabled: bool,
    pub locked: bool,
}

#[derive(Debug)]
pub struct SecurityState {
    pub locked: Mutex<bool>,
    pub failures: Mutex<(u32, Option<Instant>)>,
}

impl SecurityState {
    pub fn new(locked: bool) -> Self {
        Self {
            locked: Mutex::new(locked),
            failures: Mutex::new((0, None)),
        }
    }

    pub fn is_locked(&self) -> bool {
        *self.locked.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn set_locked(&self, locked: bool) {
        let mut guard = self.locked.lock().unwrap_or_else(|p| p.into_inner());
        *guard = locked;
    }

    fn authenticate_pin(&self, pin: &str, hash: &str, wrong_pin: &str) -> Result<(), AppError> {
        // Holding this mutex reserves the attempt until verification and counting finish.
        // Waiting callers must recheck the cooldown before they can run Argon2.
        let mut guard = self.failures.lock().unwrap_or_else(|p| p.into_inner());
        let (count, cooldown_until) = &mut *guard;
        if let Some(until) = *cooldown_until {
            let now = Instant::now();
            if now < until {
                let remaining = until.duration_since(now).as_secs() + 1;
                return Err(AppError::Invalid(format!(
                    "Terlalu banyak percobaan. Coba lagi dalam {remaining} detik."
                )));
            }
            *cooldown_until = None;
            *count = 0;
        }
        if verify_pin(pin, hash)? {
            *guard = (0, None);
            return Ok(());
        }

        *count += 1;
        if *count >= MAX_FAILURES {
            *cooldown_until = Some(Instant::now() + Duration::from_secs(COOLDOWN_SECS));
            Err(AppError::Invalid(format!(
                "{wrong_pin}. Terlalu banyak percobaan, coba lagi dalam {COOLDOWN_SECS} detik."
            )))
        } else {
            Err(AppError::Invalid(wrong_pin.into()))
        }
    }

    pub fn reset_failures(&self) {
        let mut guard = self.failures.lock().unwrap_or_else(|p| p.into_inner());
        *guard = (0, None);
    }

    pub fn cooldown_remaining(&self) -> Option<Duration> {
        let guard = self.failures.lock().unwrap_or_else(|p| p.into_inner());
        let (_, until) = *guard;
        until.and_then(|t| {
            let now = Instant::now();
            if now < t {
                Some(t.duration_since(now))
            } else {
                None
            }
        })
    }
}

/// Pure function to check whether a command can be invoked while Anchoa is locked.
pub fn is_allowed_while_locked(command: &str) -> bool {
    matches!(
        command,
        "security_status" | "unlock" | "app_status" | "db_status"
    )
}

/// Validate that a PIN consists of 4 to 8 ASCII digits.
pub fn validate_pin(pin: &str) -> Result<(), AppError> {
    if (4..=8).contains(&pin.len()) && pin.chars().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err(AppError::Invalid("PIN harus 4–8 digit angka".into()))
    }
}

/// Hash a PIN using Argon2id with a random salt.
pub fn hash_pin(pin: &str) -> Result<String, AppError> {
    validate_pin(pin)?;
    let mut salt_bytes = [0u8; Salt::RECOMMENDED_LENGTH];
    OsRng
        .try_fill_bytes(&mut salt_bytes)
        .map_err(|e| AppError::Other(format!("Gagal membuat salt PIN: {e}")))?;
    let salt = SaltString::encode_b64(&salt_bytes).map_err(|e| AppError::Other(e.to_string()))?;
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(pin.as_bytes(), &salt)
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(hash.to_string())
}

/// Verify a raw PIN against a stored Argon2id PHC string.
pub fn verify_pin(pin: &str, phc_hash: &str) -> Result<bool, AppError> {
    validate_pin(pin)?;
    let parsed_hash = match PasswordHash::new(phc_hash) {
        Ok(h) => h,
        Err(_) => return Ok(false),
    };
    match Argon2::default().verify_password(pin.as_bytes(), &parsed_hash) {
        Ok(()) => Ok(true),
        Err(argon2::password_hash::Error::Password) => Ok(false),
        Err(e) => Err(AppError::Other(e.to_string())),
    }
}

pub fn get_pin_hash(conn: &Connection) -> Result<Option<String>, AppError> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query([PIN_HASH_KEY])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn has_pin(conn: &Connection) -> Result<bool, AppError> {
    Ok(get_pin_hash(conn)?.is_some())
}

pub fn save_pin_hash(conn: &Connection, hash: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![PIN_HASH_KEY, hash],
    )?;
    Ok(())
}

pub fn delete_pin_hash(conn: &Connection) -> Result<(), AppError> {
    conn.execute("DELETE FROM settings WHERE key = ?1", [PIN_HASH_KEY])?;
    Ok(())
}

pub fn get_security_status(
    state: &SecurityState,
    conn: &Connection,
) -> Result<SecurityStatus, AppError> {
    Ok(SecurityStatus {
        pin_enabled: has_pin(conn)?,
        locked: state.is_locked(),
    })
}

pub fn unlock_inner(state: &SecurityState, conn: &Connection, pin: &str) -> Result<(), AppError> {
    validate_pin(pin)?;
    if !state.is_locked() {
        return Ok(());
    }
    let stored_hash = get_pin_hash(conn)?;
    match stored_hash {
        None => {
            state.set_locked(false);
            state.reset_failures();
            Ok(())
        }
        Some(hash) => {
            state.authenticate_pin(pin, &hash, "PIN salah")?;
            state.set_locked(false);
            Ok(())
        }
    }
}

pub fn set_pin_inner(
    state: &SecurityState,
    conn: &Connection,
    old: Option<&str>,
    new: &str,
) -> Result<(), AppError> {
    validate_pin(new)?;
    if let Some(old_pin) = old {
        validate_pin(old_pin)?;
    }
    let current_hash = get_pin_hash(conn)?;
    if let Some(hash) = current_hash {
        let old_pin = old.ok_or_else(|| AppError::Invalid("PIN lama diperlukan".into()))?;
        state.authenticate_pin(old_pin, &hash, "PIN lama salah")?;
    }
    let new_hash = hash_pin(new)?;
    save_pin_hash(conn, &new_hash)?;
    Ok(())
}

pub fn disable_pin_inner(
    state: &SecurityState,
    conn: &Connection,
    pin: &str,
) -> Result<(), AppError> {
    validate_pin(pin)?;
    let hash = get_pin_hash(conn)?.ok_or_else(|| AppError::Invalid("PIN belum diatur".into()))?;
    state.authenticate_pin(pin, &hash, "PIN salah")?;
    delete_pin_hash(conn)?;
    state.set_locked(false);
    Ok(())
}

#[tauri::command]
pub fn security_status(
    state: State<'_, SecurityState>,
    db: State<'_, Db>,
) -> Result<SecurityStatus, AppError> {
    let pin_enabled = match db.conn() {
        Ok(conn) => has_pin(&conn)?,
        Err(_) => false,
    };
    Ok(SecurityStatus {
        pin_enabled,
        locked: state.is_locked(),
    })
}

#[tauri::command]
pub fn unlock(
    state: State<'_, SecurityState>,
    db: State<'_, Db>,
    pin: String,
) -> Result<(), AppError> {
    let conn = db.conn()?;
    unlock_inner(&state, &conn, &pin)
}

#[tauri::command]
pub fn set_pin(
    state: State<'_, SecurityState>,
    db: State<'_, Db>,
    old: Option<String>,
    new: String,
) -> Result<(), AppError> {
    let conn = db.conn()?;
    set_pin_inner(&state, &conn, old.as_deref(), &new)
}

#[tauri::command]
pub fn disable_pin(
    state: State<'_, SecurityState>,
    db: State<'_, Db>,
    pin: String,
) -> Result<(), AppError> {
    let conn = db.conn()?;
    disable_pin_inner(&state, &conn, &pin)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn pin_hash_verifies_and_rejects_wrong_pin() {
        let hash = hash_pin("1234").expect("hash_pin should succeed for 1234");
        assert_ne!(hash, "1234");
        assert!(hash.starts_with("$argon2id$"));

        assert!(verify_pin("1234", &hash).unwrap());
        assert!(!verify_pin("1235", &hash).unwrap());
        assert!(!verify_pin("0000", &hash).unwrap());
        assert!(matches!(verify_pin("", &hash), Err(AppError::Invalid(_))));
        assert!(matches!(
            verify_pin("invalid", &hash),
            Err(AppError::Invalid(_))
        ));
    }

    #[test]
    fn invalid_pins_are_rejected() {
        for invalid in [
            "",
            "1",
            "12",
            "123",
            "123456789",
            "123a",
            "abcd",
            "12 34",
            "12.34",
            "1234567890",
        ] {
            assert!(
                matches!(validate_pin(invalid), Err(AppError::Invalid(_))),
                "expected {invalid} to be rejected"
            );
            assert!(
                matches!(hash_pin(invalid), Err(AppError::Invalid(_))),
                "expected hash_pin({invalid}) to be rejected"
            );
        }

        for valid in ["1234", "0000", "12345", "123456", "1234567", "12345678"] {
            assert!(
                validate_pin(valid).is_ok(),
                "expected {valid} to be accepted"
            );
        }
    }

    #[test]
    fn every_entry_point_rejects_invalid_pins_before_authentication() {
        let conn = db::open_in_memory();
        let state = SecurityState::new(true);
        let hash = hash_pin("1234").unwrap();
        save_pin_hash(&conn, &hash).unwrap();

        for invalid in ["", "123", "123456789", "12a4", "１２３４"] {
            for result in [
                verify_pin(invalid, &hash).map(|_| ()),
                unlock_inner(&state, &conn, invalid),
                set_pin_inner(&state, &conn, Some(invalid), "5678"),
                set_pin_inner(&state, &conn, Some("0000"), invalid),
                disable_pin_inner(&state, &conn, invalid),
            ] {
                assert!(matches!(result, Err(AppError::Invalid(ref message))
                    if message == "PIN harus 4–8 digit angka"));
            }
            assert!(state.is_locked());
            assert_eq!(*state.failures.lock().unwrap(), (0, None));
            assert_eq!(get_pin_hash(&conn).unwrap().as_deref(), Some(hash.as_str()));
        }

        state.set_locked(false);
        assert!(matches!(
            unlock_inner(&state, &conn, ""),
            Err(AppError::Invalid(_))
        ));
        delete_pin_hash(&conn).unwrap();
        assert!(matches!(
            set_pin_inner(&state, &conn, Some(""), "1234"),
            Err(AppError::Invalid(_))
        ));
        assert!(!has_pin(&conn).unwrap());
    }

    #[test]
    fn disable_without_a_pin_preserves_lock_and_failures() {
        let conn = db::open_in_memory();
        let state = SecurityState::new(true);
        *state.failures.lock().unwrap() = (2, None);

        assert!(matches!(
            disable_pin_inner(&state, &conn, "1234"),
            Err(AppError::Invalid(_))
        ));
        assert!(state.is_locked());
        assert_eq!(*state.failures.lock().unwrap(), (2, None));
    }

    #[test]
    fn changing_and_disabling_share_the_unlock_cooldown() {
        let conn = db::open_in_memory();
        let hash = hash_pin("1234").unwrap();
        save_pin_hash(&conn, &hash).unwrap();

        for changing in [true, false] {
            let state = SecurityState::new(true);
            for attempt in 1..=MAX_FAILURES {
                let result = if changing {
                    set_pin_inner(&state, &conn, Some("0000"), "5678")
                } else {
                    disable_pin_inner(&state, &conn, "0000")
                };
                assert!(matches!(result, Err(AppError::Invalid(_))));
                assert_eq!(
                    state.cooldown_remaining().is_some(),
                    attempt == MAX_FAILURES
                );
            }

            let before = *state.failures.lock().unwrap();
            for result in [
                unlock_inner(&state, &conn, "1234"),
                set_pin_inner(&state, &conn, Some("1234"), "5678"),
                disable_pin_inner(&state, &conn, "1234"),
            ] {
                assert!(matches!(result, Err(AppError::Invalid(ref message))
                    if message.contains("Terlalu banyak percobaan")));
            }
            assert_eq!(*state.failures.lock().unwrap(), before);
            assert_eq!(get_pin_hash(&conn).unwrap().as_deref(), Some(hash.as_str()));
            assert!(state.is_locked());
        }
    }

    #[test]
    fn successes_reset_shared_failures_and_expired_cooldowns() {
        let conn = db::open_in_memory();
        let state = SecurityState::new(true);
        save_pin_hash(&conn, &hash_pin("1234").unwrap()).unwrap();

        unlock_inner(&state, &conn, "0000").unwrap_err();
        set_pin_inner(&state, &conn, Some("0000"), "5678").unwrap_err();
        disable_pin_inner(&state, &conn, "0000").unwrap_err();
        assert_eq!(state.failures.lock().unwrap().0, 3);

        set_pin_inner(&state, &conn, Some("1234"), "5678").unwrap();
        assert_eq!(*state.failures.lock().unwrap(), (0, None));
        assert!(verify_pin("5678", &get_pin_hash(&conn).unwrap().unwrap()).unwrap());

        *state.failures.lock().unwrap() =
            (MAX_FAILURES, Some(Instant::now() - Duration::from_secs(1)));
        disable_pin_inner(&state, &conn, "0000").unwrap_err();
        assert_eq!(*state.failures.lock().unwrap(), (1, None));
        disable_pin_inner(&state, &conn, "5678").unwrap();
        assert_eq!(*state.failures.lock().unwrap(), (0, None));
        assert!(!has_pin(&conn).unwrap());
        assert!(!state.is_locked());
    }

    #[test]
    fn concurrent_attempts_stop_after_five_failures() {
        use std::sync::Barrier;

        const ATTEMPTS: usize = 12;
        let hash = hash_pin("1234").unwrap();
        let state = SecurityState::new(true);
        let barrier = Barrier::new(ATTEMPTS);
        let errors = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..ATTEMPTS)
                .map(|attempt| {
                    let hash = &hash;
                    let state = &state;
                    let barrier = &barrier;
                    scope.spawn(move || {
                        // Each thread has its own DB connection so the attempt mutex is tested.
                        let conn = db::open_in_memory();
                        save_pin_hash(&conn, hash).unwrap();
                        barrier.wait();
                        match attempt % 3 {
                            0 => unlock_inner(state, &conn, "0000"),
                            1 => set_pin_inner(state, &conn, Some("0000"), "5678"),
                            _ => disable_pin_inner(state, &conn, "0000"),
                        }
                        .unwrap_err()
                        .to_string()
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect::<Vec<_>>()
        });

        assert_eq!(
            errors
                .iter()
                .filter(|message| message.starts_with("PIN "))
                .count(),
            MAX_FAILURES as usize
        );
        assert_eq!(
            errors
                .iter()
                .filter(|message| message.starts_with("Terlalu banyak percobaan"))
                .count(),
            ATTEMPTS - MAX_FAILURES as usize
        );
        assert!(state.cooldown_remaining().is_some());
        assert!(state.is_locked());
    }

    #[test]
    fn cooldown_rejects_before_password_verification() {
        let conn = db::open_in_memory();
        let state = SecurityState::new(true);
        // This parses as PHC but the unsupported algorithm makes verification fail with Other.
        let hash = hash_pin("1234")
            .unwrap()
            .replace("$argon2id$", "$unsupported$");
        assert!(matches!(verify_pin("1234", &hash), Err(AppError::Other(_))));
        save_pin_hash(&conn, &hash).unwrap();
        *state.failures.lock().unwrap() = (
            MAX_FAILURES,
            Some(Instant::now() + Duration::from_secs(COOLDOWN_SECS)),
        );

        for result in [
            unlock_inner(&state, &conn, "1234"),
            set_pin_inner(&state, &conn, Some("1234"), "5678"),
            disable_pin_inner(&state, &conn, "1234"),
        ] {
            assert!(matches!(result, Err(AppError::Invalid(ref message))
                if message.starts_with("Terlalu banyak percobaan")));
        }
    }

    #[test]
    fn set_pin_requires_old_pin_when_enabled() {
        let conn = db::open_in_memory();
        let state = SecurityState::new(false);

        // When no PIN exists, old PIN is not required.
        assert!(set_pin_inner(&state, &conn, None, "1234").is_ok());
        assert!(has_pin(&conn).unwrap());

        // When PIN is enabled, missing old PIN fails.
        let err_missing = set_pin_inner(&state, &conn, None, "5678").unwrap_err();
        assert!(
            matches!(err_missing, AppError::Invalid(ref msg) if msg.contains("PIN lama diperlukan"))
        );

        // Wrong old PIN fails.
        let err_wrong = set_pin_inner(&state, &conn, Some("0000"), "5678").unwrap_err();
        assert!(matches!(err_wrong, AppError::Invalid(ref msg) if msg.contains("PIN lama salah")));

        // Correct old PIN succeeds and updates the hash.
        assert!(set_pin_inner(&state, &conn, Some("1234"), "5678").is_ok());
        let updated_hash = get_pin_hash(&conn).unwrap().unwrap();
        assert!(verify_pin("5678", &updated_hash).unwrap());
        assert!(!verify_pin("1234", &updated_hash).unwrap());
    }

    #[test]
    fn disable_requires_correct_pin() {
        let conn = db::open_in_memory();
        let state = SecurityState::new(false);

        // Setup PIN
        set_pin_inner(&state, &conn, None, "1234").unwrap();
        assert!(has_pin(&conn).unwrap());

        // Attempt disable with wrong PIN
        let err = disable_pin_inner(&state, &conn, "9999").unwrap_err();
        assert!(matches!(err, AppError::Invalid(ref msg) if msg.contains("PIN salah")));
        assert!(has_pin(&conn).unwrap());

        // Disable with correct PIN
        assert!(disable_pin_inner(&state, &conn, "1234").is_ok());
        assert!(!has_pin(&conn).unwrap());
        assert!(!state.is_locked());
    }

    #[test]
    fn five_failures_start_a_cooldown() {
        let conn = db::open_in_memory();
        let state = SecurityState::new(true);

        // Setup a PIN in the database
        set_pin_inner(&state, &conn, None, "1234").unwrap();
        state.set_locked(true);

        assert!(state.cooldown_remaining().is_none());

        // 4 failed attempts: no cooldown yet
        for i in 1..=4 {
            let err = unlock_inner(&state, &conn, "0000").unwrap_err();
            assert!(
                matches!(err, AppError::Invalid(ref msg) if msg == "PIN salah"),
                "attempt {i} should report 'PIN salah'"
            );
            assert!(state.cooldown_remaining().is_none());
            assert!(state.is_locked());
        }

        // 5th failed attempt: triggers 30s cooldown
        let err5 = unlock_inner(&state, &conn, "0000").unwrap_err();
        assert!(
            matches!(err5, AppError::Invalid(ref msg) if msg.contains("Terlalu banyak percobaan")),
            "5th attempt should start cooldown"
        );
        let rem = state.cooldown_remaining();
        assert!(rem.is_some());
        let secs = rem.unwrap().as_secs();
        assert!((28..=30).contains(&secs));

        // 6th attempt, even with correct PIN, must be rejected while in cooldown
        let err6 = unlock_inner(&state, &conn, "1234").unwrap_err();
        assert!(
            matches!(err6, AppError::Invalid(ref msg) if msg.contains("Terlalu banyak percobaan")),
            "attempt during cooldown should be rejected"
        );
        assert!(state.is_locked());
    }

    #[test]
    fn guard_allows_only_listed_commands_while_locked() {
        // Allowed commands
        assert!(is_allowed_while_locked("security_status"));
        assert!(is_allowed_while_locked("unlock"));
        assert!(is_allowed_while_locked("app_status"));
        assert!(is_allowed_while_locked("db_status"));

        // Rejected commands
        assert!(!is_allowed_while_locked("get_dashboard"));
        assert!(!is_allowed_while_locked("capture_note"));
        assert!(!is_allowed_while_locked("set_pin"));
        assert!(!is_allowed_while_locked("disable_pin"));
        assert!(!is_allowed_while_locked("list_accounts"));
        assert!(!is_allowed_while_locked("projects_overview"));
        assert!(!is_allowed_while_locked("open_item"));
        assert!(!is_allowed_while_locked("delete_item"));
        assert!(!is_allowed_while_locked(""));
        assert!(!is_allowed_while_locked("any_arbitrary_command"));
    }

    #[test]
    fn unlock_succeeds_with_correct_pin_and_resets_failures() {
        let conn = db::open_in_memory();
        let state = SecurityState::new(true);

        set_pin_inner(&state, &conn, None, "1234").unwrap();
        state.set_locked(true);

        // 2 failures
        unlock_inner(&state, &conn, "0000").unwrap_err();
        unlock_inner(&state, &conn, "0000").unwrap_err();

        // Correct unlock
        assert!(unlock_inner(&state, &conn, "1234").is_ok());
        assert!(!state.is_locked());

        // Failures should be reset
        let guard = state.failures.lock().unwrap();
        assert_eq!(*guard, (0, None));
    }
}
