use std::fmt;

use rusqlite::{OptionalExtension, params};
use serde::Serialize;
use zeroize::{Zeroize, Zeroizing};

use super::client::MailClient;
use crate::{db::Db, error::AppError, keystore, time};

const ADDRESS_KEY: &str = "email.address";

#[derive(Clone)]
pub struct AppPassword(String);

impl Drop for AppPassword {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl fmt::Debug for AppPassword {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AppPassword([REDACTED])")
    }
}

impl AppPassword {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        let mut value: String = value.chars().filter(|c| !c.is_whitespace()).collect();
        if value.len() != 16 || !value.bytes().all(|c| c.is_ascii_alphabetic()) {
            value.zeroize();
            return Err(AppError::Invalid(
                "App Password harus berisi 16 huruf".into(),
            ));
        }
        Ok(Self(value))
    }

    pub(super) fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone)]
pub struct Credentials {
    pub address: String,
    pub password: AppPassword,
}

impl Credentials {
    pub fn new(address: &str, password: &str) -> Result<Self, AppError> {
        let address = address.trim().to_ascii_lowercase();
        if address.chars().any(char::is_whitespace) || address.parse::<lettre::Address>().is_err() {
            return Err(AppError::Invalid("Alamat email tidak valid".into()));
        }
        Ok(Self {
            address,
            password: AppPassword::parse(password)?,
        })
    }
}

// Preserve email's typed password API and its original error messages.
#[derive(Default)]
pub struct KeyringStore(keystore::KeyringStore);

fn keyring_error() -> AppError {
    AppError::Other("Keyring email tidak tersedia; periksa layanan penyimpanan kredensial".into())
}

impl KeyringStore {
    #[cfg(any(test, debug_assertions))]
    pub fn with_builder(builder: Box<keyring::credential::CredentialBuilder>) -> Self {
        Self(keystore::KeyringStore::with_builder(builder))
    }

    pub fn get(&self, address: &str) -> Result<AppPassword, AppError> {
        self.optional(address)?.ok_or_else(|| {
            AppError::Invalid("Sambungkan Gmail kembali; App Password tidak ditemukan".into())
        })
    }

    fn optional(&self, address: &str) -> Result<Option<AppPassword>, AppError> {
        self.0
            .get(address)
            .map_err(|_| keyring_error())?
            .map(|value| AppPassword::parse(&Zeroizing::new(value)))
            .transpose()
    }

    fn set(&self, address: &str, password: &AppPassword) -> Result<(), AppError> {
        self.0
            .set(address, password.as_str())
            .map_err(|_| keyring_error())
    }

    fn delete(&self, address: &str) -> Result<(), AppError> {
        self.0.delete(address).map_err(|_| keyring_error())
    }

    #[cfg(test)]
    pub fn entry_for_test(&self, address: &str) -> std::sync::Arc<keyring::Entry> {
        self.0.entry_for_test(address)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: bool,
    pub address: Option<String>,
}

pub fn status(db: &Db) -> Result<Status, AppError> {
    let address = db
        .conn()?
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [ADDRESS_KEY],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    Ok(Status {
        connected: address.is_some(),
        address,
    })
}

pub fn credentials(db: &Db, keys: &KeyringStore) -> Result<Credentials, AppError> {
    let address = status(db)?
        .address
        .ok_or_else(|| AppError::Invalid("Sambungkan Gmail terlebih dahulu".into()))?;
    Ok(Credentials {
        password: keys.get(&address)?,
        address,
    })
}

pub fn connect(
    db: &Db,
    keys: &KeyringStore,
    address: &str,
    app_password: &str,
    client: &dyn MailClient,
) -> Result<Status, AppError> {
    let candidate = Credentials::new(address, app_password)?;
    if status(db)?
        .address
        .is_some_and(|old| old != candidate.address)
    {
        return Err(AppError::Invalid(
            "Putuskan akun Gmail saat ini sebelum mengganti akun".into(),
        ));
    }
    client.login(&candidate)?;
    let previous = keys.optional(&candidate.address)?;
    keys.set(&candidate.address, &candidate.password)?;
    let saved = (|| -> Result<(), AppError> {
        db.conn()?.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![ADDRESS_KEY, candidate.address])?;
        Ok(())
    })();
    if let Err(error) = saved {
        match previous {
            Some(password) => keys.set(&candidate.address, &password)?,
            None => keys.delete(&candidate.address)?,
        }
        return Err(error);
    }
    status(db)
}

pub fn disconnect(db: &Db, keys: &KeyringStore) -> Result<(), AppError> {
    let address = status(db)?.address;
    let previous = address
        .as_deref()
        .map(|a| keys.optional(a))
        .transpose()?
        .flatten();
    if let Some(address) = &address {
        keys.delete(address)?;
    }
    let removed = (|| -> Result<(), AppError> {
        let mut conn = db.conn()?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM settings WHERE key = ?1 OR key LIKE 'email.uidvalidity.%'",
            [ADDRESS_KEY],
        )?;
        tx.execute("UPDATE items SET deleted_at = ?1, updated_at = ?1 WHERE type = 'email' AND deleted_at IS NULL", [time::now_ms()])?;
        tx.commit()?;
        Ok(())
    })();
    if removed.is_err()
        && let (Some(address), Some(password)) = (&address, previous)
    {
        keys.set(address, &password)?;
    }
    removed
}
