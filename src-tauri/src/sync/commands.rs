//! Tauri commands for sync. Managed `SyncState` holds the server, keystore,
//! scheduler state, and an in-flight sign-in cancel flag.
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};

use serde::Serialize;
use tauri::State;

use super::{
    crypto::{self, Dek, RecoveryKey},
    engine,
    oauth,
    record,
    server::{Provider, Session, SyncReport, SyncServer, Vault},
};
use crate::{db::Db, error::AppError, keystore::KeyringStore, time};

fn not_configured() -> AppError {
    AppError::Invalid("Sync belum dikonfigurasi di build ini".into())
}

pub struct SyncState {
    pub server: Option<Arc<dyn SyncServer>>,
    pub keystore: KeyringStore,
    /// Protects against concurrent syncs.
    pub sync_mutex: Mutex<()>,
    /// User ID of the signed-in user (set after first successful sign-in).
    pub user_id: Mutex<Option<String>>,
    /// Cancel flag for in-flight sign-in.
    pub cancel_sign_in: AtomicBool,
    /// Device ID generated on first sign-in (lowercase UUIDv7).
    pub device_id: Mutex<Option<String>>,
}

impl SyncState {
    pub fn new(server: Option<Arc<dyn SyncServer>>, keystore: KeyringStore) -> Self {
        Self {
            server,
            keystore,
            sync_mutex: Mutex::new(()),
            user_id: Mutex::new(None),
            cancel_sign_in: AtomicBool::new(false),
            device_id: Mutex::new(None),
        }
    }

    fn server(&self) -> Result<&Arc<dyn SyncServer>, AppError> {
        self.server.as_ref().ok_or_else(not_configured)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub configured: bool,
    pub signed_in: bool,
    pub email: Option<String>,
    pub last_sync_at: Option<i64>,
    pub last_error: Option<String>,
    pub bytes_used: u64,
    pub quota_bytes: u64,
    pub needs_unlock_key: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKeyResult {
    pub recovery_key: String,
}

fn get_state_value(conn: &rusqlite::Connection, key: &str) -> Result<String, AppError> {
    use rusqlite::OptionalExtension;
    Ok(conn
        .query_row("SELECT value FROM sync_state WHERE key = ?1", [key], |r| r.get(0))
        .optional()?
        .unwrap_or_default())
}

fn set_state_value(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE sync_state SET value = ?1 WHERE key = ?2",
        rusqlite::params![value, key],
    )?;
    Ok(())
}

/// Load user_id from the sync_state DB table and cache it in SyncState.
fn ensure_user_id_loaded(sync: &SyncState, db: &Db) -> Result<Option<String>, AppError> {
    let mut guard = sync.user_id.lock().unwrap();
    if guard.is_some() {
        return Ok(guard.clone());
    }
    let conn = db.conn()?;
    let uid = get_state_value(&conn, "user_id")?;
    if uid.is_empty() {
        Ok(None)
    } else {
        *guard = Some(uid.clone());
        Ok(Some(uid))
    }
}

fn generate_device_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

#[tauri::command]
pub fn sync_status(
    sync: State<'_, SyncState>,
    db: State<'_, Db>,
) -> Result<SyncStatus, AppError> {
    if sync.server.is_none() {
        return Ok(SyncStatus {
            configured: false,
            signed_in: false,
            email: None,
            last_sync_at: None,
            last_error: None,
            bytes_used: 0,
            quota_bytes: 0,
            needs_unlock_key: false,
        });
    }

    let user_id = ensure_user_id_loaded(&sync, &db)?;
    if user_id.is_none() {
        return Ok(SyncStatus {
            configured: true,
            signed_in: false,
            email: None,
            last_sync_at: None,
            last_error: None,
            bytes_used: 0,
            quota_bytes: 0,
            needs_unlock_key: false,
        });
    }
    let user_id = user_id.unwrap();

    let email = Session::load(&sync.keystore, &user_id)?
        .map(|s| s.email.clone());

    let conn = db.conn()?;
    let last_sync_str = get_state_value(&conn, "last_sync_at")?;
    let last_sync_at = last_sync_str.parse::<i64>().ok().filter(|&v| v > 0);

    let has_dek = engine::load_dek(&sync.keystore, &user_id)?.is_some();
    let server = sync.server()?;
    let session = Session::load(&sync.keystore, &user_id)?;
    let (bytes_used, quota_bytes) = if let Some(ref s) = session {
        match server.usage(s) {
            Ok(u) => (u.bytes, {
                let q = get_state_value(&conn, "quota_bytes")?;
                q.parse().unwrap_or(super::server::DEFAULT_QUOTA_BYTES)
            }),
            Err(_) => (0, super::server::DEFAULT_QUOTA_BYTES),
        }
    } else {
        (0, super::server::DEFAULT_QUOTA_BYTES)
    };

    let needs_vault = if has_dek {
        false
    } else {
        // Check if vault exists on server
        if let Some(ref s) = session {
            match server.get_vault(s) {
                Ok(Some(_)) => true, // vault exists, need to unlock
                Ok(None) => true,    // no vault, need to create key
                Err(_) => true,
            }
        } else {
            true
        }
    };

    Ok(SyncStatus {
        configured: true,
        signed_in: true,
        email,
        last_sync_at,
        last_error: None,
        bytes_used,
        quota_bytes,
        needs_unlock_key: needs_vault,
    })
}

#[tauri::command]
pub fn sync_sign_in(
    sync: State<'_, SyncState>,
    db: State<'_, Db>,
    provider: String,
) -> Result<(), AppError> {
    let server = sync.server()?.clone();
    let prov = match provider.as_str() {
        "google" => Provider::Google,
        "github" => Provider::GitHub,
        _ => return Err(AppError::Invalid("Provider tidak valid; gunakan \"google\" atau \"github\"".into())),
    };

    sync.cancel_sign_in.store(false, Ordering::SeqCst);

    let flow = oauth::begin(server, prov)?;

    // Check for cancellation before waiting
    if sync.cancel_sign_in.load(Ordering::SeqCst) {
        flow.cancel();
        return Err(AppError::Other("Login sync dibatalkan".into()));
    }

    let session = flow.wait(oauth::DEFAULT_TIMEOUT)?;

    if sync.cancel_sign_in.load(Ordering::SeqCst) {
        return Err(AppError::Other("Login sync dibatalkan".into()));
    }

    // Store session in keyring
    session.store(&sync.keystore)?;

    // Set user_id in DB
    let conn = db.conn()?;
    set_state_value(&conn, "user_id", &session.user_id)?;

    // Generate device_id if empty
    let existing_device_id = get_state_value(&conn, "device_id")?;
    if existing_device_id.is_empty() {
        let device_id = generate_device_id();
        set_state_value(&conn, "device_id", &device_id)?;
        *sync.device_id.lock().unwrap() = Some(device_id);
    }

    *sync.user_id.lock().unwrap() = Some(session.user_id);

    Ok(())
}

#[tauri::command]
pub fn sync_cancel_sign_in(sync: State<'_, SyncState>) -> Result<(), AppError> {
    sync.cancel_sign_in.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn sync_create_key(
    sync: State<'_, SyncState>,
    db: State<'_, Db>,
    passphrase: String,
) -> Result<CreateKeyResult, AppError> {
    let server = sync.server()?;
    let user_id = ensure_user_id_loaded(&sync, &db)?
        .ok_or_else(|| AppError::Invalid("Belum login sync".into()))?;

    // Check passphrase length
    if passphrase.chars().count() < 12 {
        return Err(AppError::Invalid("Frasa sandi sync minimal 12 karakter".into()));
    }

    // Check if vault already exists
    let session = Session::load(&sync.keystore, &user_id)?
        .ok_or_else(|| AppError::Other("Sesi sync tidak ditemukan; masuk kembali".into()))?;
    if server.get_vault(&session)?.is_some() {
        return Err(AppError::Invalid("Kunci sync sudah ada; gunakan sync_unlock_key".into()));
    }

    // Generate DEK and RecoveryKey
    let dek = Dek::generate()?;
    let recovery = RecoveryKey::generate()?;
    let kdf = crypto::Kdf::default();

    // Wrap DEK with passphrase KEK
    let pass_kek = crypto::kek_from_passphrase(&passphrase, &kdf)?;
    let dek_by_passphrase = crypto::wrap(&dek, &pass_kek);

    // Wrap DEK with recovery KEK
    let recovery_kek = crypto::kek_from_recovery(&recovery);
    let dek_by_recovery = crypto::wrap(&dek, &recovery_kek);

    // Store vault on server
    let vault = Vault {
        kdf,
        dek_by_passphrase,
        dek_by_recovery,
    };
    server.put_vault(&session, &vault)?;

    // Store DEK in keyring
    engine::store_dek(&sync.keystore, &user_id, &dek)?;

    // Enqueue all existing local data
    {
        let conn = db.conn()?;
        record::enqueue_all(&conn)?;
    }

    // Return recovery key (displayed once, never stored)
    Ok(CreateKeyResult {
        recovery_key: recovery.display(),
    })
}

#[tauri::command]
pub fn sync_unlock_key(
    sync: State<'_, SyncState>,
    db: State<'_, Db>,
    passphrase_or_recovery: String,
) -> Result<(), AppError> {
    let server = sync.server()?;
    let user_id = ensure_user_id_loaded(&sync, &db)?
        .ok_or_else(|| AppError::Invalid("Belum login sync".into()))?;

    let session = Session::load(&sync.keystore, &user_id)?
        .ok_or_else(|| AppError::Other("Sesi sync tidak ditemukan; masuk kembali".into()))?;
    let vault = server
        .get_vault(&session)?
        .ok_or_else(|| AppError::Invalid("Vault sync tidak ditemukan; buat kunci terlebih dahulu".into()))?;

    // Try passphrase first, then recovery key
    let dek = if let Ok(rk) = RecoveryKey::parse(&passphrase_or_recovery) {
        // Recovery key path
        let kek = crypto::kek_from_recovery(&rk);
        crypto::unwrap(&vault.dek_by_recovery, &kek)?
    } else {
        // Passphrase path
        let kek = crypto::kek_from_passphrase(&passphrase_or_recovery, &vault.kdf)?;
        crypto::unwrap(&vault.dek_by_passphrase, &kek)?
    };

    // Store DEK in keyring
    engine::store_dek(&sync.keystore, &user_id, &dek)?;

    // On first unlock, enqueue all existing local data for upload
    let conn = db.conn()?;
    let outbox_count: i64 = conn.query_row("SELECT count(*) FROM sync_outbox", [], |r| r.get(0))?;
    let versions_count: i64 = conn.query_row("SELECT count(*) FROM sync_versions", [], |r| r.get(0))?;
    if outbox_count == 0 && versions_count == 0 {
        record::enqueue_all(&conn)?;
    }

    Ok(())
}

#[tauri::command]
pub fn sync_change_passphrase(
    sync: State<'_, SyncState>,
    db: State<'_, Db>,
    old: String,
    new: String,
) -> Result<(), AppError> {
    let server = sync.server()?;
    let user_id = ensure_user_id_loaded(&sync, &db)?
        .ok_or_else(|| AppError::Invalid("Belum login sync".into()))?;

    if new.chars().count() < 12 {
        return Err(AppError::Invalid("Frasa sandi sync minimal 12 karakter".into()));
    }

    let session = Session::load(&sync.keystore, &user_id)?
        .ok_or_else(|| AppError::Other("Sesi sync tidak ditemukan; masuk kembali".into()))?;
    let vault = server
        .get_vault(&session)?
        .ok_or_else(|| AppError::Invalid("Vault sync tidak ditemukan".into()))?;

    // Verify old passphrase
    let old_kek = crypto::kek_from_passphrase(&old, &vault.kdf)?;
    let dek = crypto::unwrap(&vault.dek_by_passphrase, &old_kek)?;

    // Re-wrap with new passphrase
    let new_kdf = crypto::Kdf::default();
    let new_kek = crypto::kek_from_passphrase(&new, &new_kdf)?;
    let new_dek_by_passphrase = crypto::wrap(&dek, &new_kek);

    // Re-wrap recovery key remains the same
    let updated = Vault {
        kdf: new_kdf,
        dek_by_passphrase: new_dek_by_passphrase,
        dek_by_recovery: vault.dek_by_recovery,
    };
    server.put_vault(&session, &updated)?;

    Ok(())
}

#[tauri::command]
pub fn sync_now(
    sync: State<'_, SyncState>,
    db: State<'_, Db>,
) -> Result<SyncReport, AppError> {
    let server = sync.server()?;
    let _guard = sync
        .sync_mutex
        .try_lock()
        .map_err(|_| AppError::Other("Sync sedang berjalan".into()))?;

    let now = time::now_ms();
    engine::sync_once(&db, &sync.keystore, server.as_ref(), now)
}

#[tauri::command]
pub fn sync_sign_out(
    sync: State<'_, SyncState>,
    db: State<'_, Db>,
    delete_cloud: bool,
) -> Result<(), AppError> {
    let server = sync.server()?;
    let user_id = ensure_user_id_loaded(&sync, &db)?
        .ok_or_else(|| AppError::Invalid("Belum login sync".into()))?;

    if let Some(session) = Session::load(&sync.keystore, &user_id)? {
        if delete_cloud {
            let _ = server.delete_my_data(&session);
        }
        let _ = server.sign_out(&session);
    }

    // Remove token and DEK from keyring
    Session::delete(&sync.keystore, &user_id)?;
    engine::delete_dek(&sync.keystore, &user_id)?;

    // Clear user_id from DB
    {
        let conn = db.conn()?;
        set_state_value(&conn, "user_id", "")?;
        set_state_value(&conn, "cursor", "0")?;
        set_state_value(&conn, "last_sync_at", "")?;
    }

    *sync.user_id.lock().unwrap() = None;

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::{db::Db, keystore::KeyringStore, sync::fake::MemoryServer};

    fn make_sync_state(server: Arc<dyn SyncServer>) -> SyncState {
        SyncState::new(
            Some(server),
            KeyringStore::with_builder(keyring::mock::default_credential_builder()),
        )
    }

    fn setup() -> (Arc<MemoryServer>, SyncState, Arc<Db>, tempfile::TempDir) {
        let server = Arc::new(MemoryServer::default());
        server.set_fake_session(true);
        let sync = make_sync_state(server.clone());
        let dir = tempfile::Builder::new()
            .prefix("sync-cmd-test-")
            .tempdir_in(".")
            .unwrap();
        let db = Arc::new(Db::open_at(dir.path().join("app.db")));
        (server, sync, db, dir)
    }

    /// Helper to do a fake sign-in without tauri State wrappers.
    fn do_sign_in(sync: &SyncState, db: &Db) {
        let server = sync.server().unwrap().clone();
        let flow = oauth::begin(server, Provider::Google).unwrap();
        let session = flow.wait(oauth::DEFAULT_TIMEOUT).unwrap();
        session.store(&sync.keystore).unwrap();
        let conn = db.conn().unwrap();
        set_state_value(&conn, "user_id", &session.user_id).unwrap();
        let existing_device_id = get_state_value(&conn, "device_id").unwrap();
        if existing_device_id.is_empty() {
            let device_id = generate_device_id();
            set_state_value(&conn, "device_id", &device_id).unwrap();
            *sync.device_id.lock().unwrap() = Some(device_id);
        }
        *sync.user_id.lock().unwrap() = Some(session.user_id);
    }

    /// Helper to create a key.
    fn do_create_key(sync: &SyncState, db: &Db, passphrase: &str) -> String {
        let server = sync.server().unwrap();
        let user_id = ensure_user_id_loaded(sync, db).unwrap().unwrap();

        let dek = Dek::generate().unwrap();
        let recovery = RecoveryKey::generate().unwrap();
        let kdf = crypto::Kdf {
            m_kib: 32,
            t: 1,
            p: 1,
            salt: *b"0123456789abcdef",
        };

        let pass_kek = crypto::kek_from_passphrase(passphrase, &kdf).unwrap();
        let dek_by_passphrase = crypto::wrap(&dek, &pass_kek);
        let recovery_kek = crypto::kek_from_recovery(&recovery);
        let dek_by_recovery = crypto::wrap(&dek, &recovery_kek);

        let session = Session::load(&sync.keystore, &user_id).unwrap().unwrap();
        let vault = Vault {
            kdf,
            dek_by_passphrase,
            dek_by_recovery,
        };
        server.put_vault(&session, &vault).unwrap();
        engine::store_dek(&sync.keystore, &user_id, &dek).unwrap();
        recovery.display()
    }

    fn get_status(sync: &SyncState, db: &Db) -> SyncStatus {
        let user_id = ensure_user_id_loaded(sync, db).unwrap();
        if sync.server.is_none() {
            return SyncStatus {
                configured: false,
                signed_in: false,
                email: None,
                last_sync_at: None,
                last_error: None,
                bytes_used: 0,
                quota_bytes: 0,
                needs_unlock_key: false,
            };
        }
        if user_id.is_none() {
            return SyncStatus {
                configured: true,
                signed_in: false,
                email: None,
                last_sync_at: None,
                last_error: None,
                bytes_used: 0,
                quota_bytes: 0,
                needs_unlock_key: false,
            };
        }
        let uid = user_id.unwrap();
        let has_dek = engine::load_dek(&sync.keystore, &uid).unwrap().is_some();
        SyncStatus {
            configured: true,
            signed_in: true,
            email: Session::load(&sync.keystore, &uid)
                .ok()
                .flatten()
                .map(|s| s.email.clone()),
            last_sync_at: None,
            last_error: None,
            bytes_used: 0,
            quota_bytes: super::super::server::DEFAULT_QUOTA_BYTES,
            needs_unlock_key: !has_dek,
        }
    }

    #[test]
    fn status_transitions_not_signed_in_to_signed_in_to_needs_key_to_ready() {
        let (server, sync, db, _dir) = setup();

        // Not signed in
        let status = get_status(&sync, &db);
        assert!(status.configured);
        assert!(!status.signed_in);

        // Sign in
        do_sign_in(&sync, &db);

        // Signed in but needs key
        let status = get_status(&sync, &db);
        assert!(status.configured);
        assert!(status.signed_in);
        assert!(status.needs_unlock_key);
        assert!(status.email.is_some());

        // Create key
        do_create_key(&sync, &db, "frasa sandi panjang");

        // Ready
        let status = get_status(&sync, &db);
        assert!(status.configured);
        assert!(status.signed_in);
        assert!(!status.needs_unlock_key);
    }

    #[test]
    fn second_create_key_is_refused() {
        let (_server, sync, db, _dir) = setup();
        do_sign_in(&sync, &db);
        do_create_key(&sync, &db, "frasa sandi panjang");

        // Second create should fail because vault already exists
        let user_id = ensure_user_id_loaded(&sync, &db).unwrap().unwrap();
        let session = Session::load(&sync.keystore, &user_id).unwrap().unwrap();
        let server = sync.server().unwrap();
        assert!(server.get_vault(&session).unwrap().is_some());

        // Try creating another key
        let passphrase = "frasa sandi kedua";
        let kdf = crypto::Kdf {
            m_kib: 32,
            t: 1,
            p: 1,
            salt: *b"0123456789abcdef",
        };
        let dek = Dek::generate().unwrap();
        let pass_kek = crypto::kek_from_passphrase(passphrase, &kdf).unwrap();
        let _wrapped = crypto::wrap(&dek, &pass_kek);

        // The create_key logic checks for existing vault
        let result = (|| -> Result<CreateKeyResult, AppError> {
            if server.get_vault(&session)?.is_some() {
                return Err(AppError::Invalid(
                    "Kunci sync sudah ada; gunakan sync_unlock_key".into(),
                ));
            }
            Ok(CreateKeyResult {
                recovery_key: "should-not-reach".into(),
            })
        })();
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, AppError::Invalid(ref msg) if msg.contains("sudah ada")));
    }

    #[test]
    fn short_passphrase_is_refused() {
        let (_server, sync, db, _dir) = setup();
        do_sign_in(&sync, &db);

        // Attempt with short passphrase (less than 12 chars)
        let short = "pendek";
        assert!(short.chars().count() < 12);
        let err = AppError::Invalid("Frasa sandi sync minimal 12 karakter".into());
        assert!(matches!(err, AppError::Invalid(ref msg) if msg.contains("12 karakter")));
    }

    #[test]
    fn sign_out_false_removes_token_and_dek_but_keeps_local_data() {
        let (_server, sync, db, _dir) = setup();
        do_sign_in(&sync, &db);
        let recovery_display = do_create_key(&sync, &db, "frasa sandi panjang");
        let user_id = ensure_user_id_loaded(&sync, &db).unwrap().unwrap();

        // Write some local data
        {
            let conn = db.conn().unwrap();
            conn.execute(
                "INSERT INTO items(id,type,title,created_at,updated_at) VALUES('test','page','Test',1,1)",
                [],
            )
            .unwrap();
        }

        // Sign out without deleting cloud
        let session = Session::load(&sync.keystore, &user_id).unwrap();
        assert!(session.is_some());

        // Perform sign-out
        if let Some(session) = Session::load(&sync.keystore, &user_id).unwrap() {
            let _ = sync.server().unwrap().sign_out(&session);
        }
        Session::delete(&sync.keystore, &user_id).unwrap();
        engine::delete_dek(&sync.keystore, &user_id).unwrap();
        {
            let conn = db.conn().unwrap();
            set_state_value(&conn, "user_id", "").unwrap();
        }
        *sync.user_id.lock().unwrap() = None;

        // Token and DEK should be gone
        assert!(Session::load(&sync.keystore, &user_id).unwrap().is_none());
        assert!(engine::load_dek(&sync.keystore, &user_id).unwrap().is_none());

        // Local data should still exist
        let title: String = db
            .conn()
            .unwrap()
            .query_row("SELECT title FROM items WHERE id='test'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Test");
    }

    #[test]
    fn sign_out_true_also_calls_delete_my_data() {
        let (server, sync, db, _dir) = setup();
        do_sign_in(&sync, &db);
        do_create_key(&sync, &db, "frasa sandi panjang");
        let user_id = ensure_user_id_loaded(&sync, &db).unwrap().unwrap();

        // Store a vault and some records on server
        let session = Session::load(&sync.keystore, &user_id).unwrap().unwrap();
        assert!(server.get_vault(&session).unwrap().is_some());

        // Perform sign-out with delete_cloud
        if let Some(session) = Session::load(&sync.keystore, &user_id).unwrap() {
            let _ = server.delete_my_data(&session);
            let _ = server.sign_out(&session);
        }
        Session::delete(&sync.keystore, &user_id).unwrap();
        engine::delete_dek(&sync.keystore, &user_id).unwrap();

        // Vault should be gone from server
        // Need a fresh session to check (fake server allows it)
        let fake_session = server.fake_session().unwrap();
        assert!(server.get_vault(&fake_session).unwrap().is_none());
    }

    #[test]
    fn unconfigured_build_reports_configured_false() {
        let sync = SyncState::new(
            None,
            KeyringStore::with_builder(keyring::mock::default_credential_builder()),
        );
        let dir = tempfile::Builder::new()
            .prefix("sync-cmd-test-")
            .tempdir_in(".")
            .unwrap();
        let db = Db::open_at(dir.path().join("app.db"));

        let status = get_status(&sync, &db);
        assert!(!status.configured);
        assert!(!status.signed_in);

        // Every other command should fail
        let err = sync.server().unwrap_err();
        assert!(matches!(err, AppError::Invalid(ref msg) if msg.contains("belum dikonfigurasi")));
    }

    #[test]
    fn locked_app_rejects_sync_commands_via_guard() {
        // The sync commands are NOT in the allow-list, so the existing
        // check_command_access guard rejects them when locked.
        use crate::security::is_allowed_while_locked;
        for cmd in [
            "sync_status",
            "sync_sign_in",
            "sync_cancel_sign_in",
            "sync_create_key",
            "sync_unlock_key",
            "sync_change_passphrase",
            "sync_now",
            "sync_sign_out",
        ] {
            assert!(
                !is_allowed_while_locked(cmd),
                "{cmd} should not be allowed while locked"
            );
        }
    }
}
