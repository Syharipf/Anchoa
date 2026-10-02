//! Shared string credentials in the OS keyring. Callers should zeroize returned secrets.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use keyring::{Entry, credential::CredentialBuilder};

use crate::error::AppError;

pub const SERVICE: &str = "io.github.syharipf.anchoa";

#[derive(Default)]
pub struct KeyringStore {
    // Cache entries: the mock builder persists credentials only within an Entry.
    // Do not implement Debug: mock Entry formatting exposes its secret.
    entries: Mutex<HashMap<String, Arc<Entry>>>,
    builder: Option<Box<CredentialBuilder>>,
}

fn keyring_error() -> AppError {
    AppError::Other("Keyring tidak tersedia; periksa layanan penyimpanan kredensial".into())
}

impl KeyringStore {
    pub fn with_builder(builder: Box<CredentialBuilder>) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            builder: Some(builder),
        }
    }

    fn entry(&self, user: &str) -> Result<Arc<Entry>, AppError> {
        let mut entries = self.entries.lock().map_err(|_| keyring_error())?;
        if let Some(entry) = entries.get(user) {
            return Ok(Arc::clone(entry));
        }
        let entry = if let Some(builder) = &self.builder {
            Entry::new_with_credential(
                builder
                    .build(None, SERVICE, user)
                    .map_err(|_| keyring_error())?,
            )
        } else {
            Entry::new(SERVICE, user).map_err(|_| keyring_error())?
        };
        let entry = Arc::new(entry);
        entries.insert(user.into(), Arc::clone(&entry));
        Ok(entry)
    }

    pub fn get(&self, user: &str) -> Result<Option<String>, AppError> {
        match self.entry(user)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(keyring_error()),
        }
    }

    pub fn set(&self, user: &str, secret: &str) -> Result<(), AppError> {
        self.entry(user)?
            .set_password(secret)
            .map_err(|_| keyring_error())
    }

    pub fn delete(&self, user: &str) -> Result<(), AppError> {
        match self.entry(user)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(keyring_error()),
        }
    }

    #[cfg(test)]
    pub(crate) fn entry_for_test(&self, user: &str) -> Arc<Entry> {
        self.entry(user).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "opaque-token-1234/+/=🗝";

    fn store() -> KeyringStore {
        KeyringStore::with_builder(keyring::mock::default_credential_builder())
    }

    #[test]
    fn arbitrary_strings_round_trip_and_missing_entries_are_optional() {
        let keys = store();
        assert_eq!(keys.get("sync-dek:user-1").unwrap(), None);
        keys.set("sync-dek:user-1", SECRET).unwrap();
        keys.set("sync-refresh:user-1", "refresh-token").unwrap();
        assert_eq!(
            keys.get("sync-dek:user-1").unwrap().as_deref(),
            Some(SECRET)
        );
        assert_eq!(
            keys.get("sync-refresh:user-1").unwrap().as_deref(),
            Some("refresh-token")
        );
        keys.set("sync-dek:user-1", "").unwrap();
        assert_eq!(keys.get("sync-dek:user-1").unwrap().as_deref(), Some(""));
        keys.delete("sync-dek:user-1").unwrap();
        keys.delete("sync-dek:user-1").unwrap();
        assert_eq!(keys.get("sync-dek:user-1").unwrap(), None);
        assert_eq!(
            keys.get("sync-refresh:user-1").unwrap().as_deref(),
            Some("refresh-token")
        );
    }

    #[test]
    fn every_keyring_operation_redacts_backend_errors() {
        let keys = store();
        let entry = keys.entry_for_test("sync-dek:user-1");
        let mock = entry
            .get_credential()
            .downcast_ref::<keyring::mock::MockCredential>()
            .unwrap();
        for operation in 0..3 {
            mock.set_error(keyring::Error::Invalid("secret".into(), SECRET.into()));
            let error = match operation {
                0 => keys.get("sync-dek:user-1").unwrap_err(),
                1 => keys.set("sync-dek:user-1", SECRET).unwrap_err(),
                _ => keys.delete("sync-dek:user-1").unwrap_err(),
            };
            assert_eq!(
                error.to_string(),
                "Keyring tidak tersedia; periksa layanan penyimpanan kredensial"
            );
            for output in [
                error.to_string(),
                format!("{error:?}"),
                serde_json::to_string(&error).unwrap(),
            ] {
                assert!(!output.contains(SECRET));
            }
        }
    }
}
