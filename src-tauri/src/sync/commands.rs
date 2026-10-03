//! Sync commands and the background schedule. The commands are thin async wrappers
//! (network and keyring work runs on the blocking pool, like the email commands);
//! the logic lives in plain functions over `&SyncState` and `&Db` so tests can drive
//! it with the fake server.
use std::{
    sync::{
        Arc, Mutex, TryLockError,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroizing;

use super::{
    crypto::{self, Dek, Kdf, RecoveryKey},
    engine, oauth, record,
    server::{DEFAULT_QUOTA_BYTES, Provider, Session, SyncReport, SyncServer, Vault},
};
use crate::{db::Db, error::AppError, keystore::KeyringStore, security::SecurityState, time};

type SecretInput = Zeroizing<String>;

const MIN_PASSPHRASE_CHARS: usize = 12;
const DEBOUNCE: Duration = Duration::from_secs(2);
const FOCUSED_INTERVAL: Duration = Duration::from_secs(60);
const BACKGROUND_INTERVAL: Duration = Duration::from_secs(300);

fn not_configured() -> AppError {
    AppError::Invalid("Sync belum dikonfigurasi di build ini".into())
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|p| p.into_inner())
}

pub struct SyncState {
    server: Option<Arc<dyn SyncServer>>,
    keys: KeyringStore,
    /// Held for the whole of a sync: never two at once.
    running: Mutex<()>,
    cancel_sign_in: AtomicBool,
    focused: AtomicBool,
    /// Asks the scheduler to sync on its next tick (focus regained, key just unlocked).
    wake: AtomicBool,
    last_error: Mutex<Option<String>>,
}

impl SyncState {
    pub fn new(server: Option<Arc<dyn SyncServer>>, keys: KeyringStore) -> Self {
        Self {
            server,
            keys,
            running: Mutex::new(()),
            cancel_sign_in: AtomicBool::new(false),
            focused: AtomicBool::new(true),
            wake: AtomicBool::new(false),
            last_error: Mutex::new(None),
        }
    }

    fn server(&self) -> Result<&Arc<dyn SyncServer>, AppError> {
        self.server.as_ref().ok_or_else(not_configured)
    }

    pub fn set_focused(&self, focused: bool) {
        if self.focused.swap(focused, Ordering::SeqCst) != focused && focused {
            self.wake.store(true, Ordering::SeqCst);
        }
    }
}

#[derive(Debug, Default, Serialize)]
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
    /// Only known while a key is needed: the UI offers "create" or "unlock" from it.
    pub vault_exists: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKeyResult {
    pub recovery_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignOutResult {
    pub remote_revoked: bool,
}

fn get_state(conn: &Connection, key: &str) -> Result<String, AppError> {
    Ok(conn
        .query_row("SELECT value FROM sync_state WHERE key = ?1", [key], |r| r.get(0))
        .optional()?
        .unwrap_or_default())
}

fn set_state(conn: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    engine::set_state(conn,key,value)
}

fn signed_in_user(db: &Db) -> Result<Option<String>, AppError> {
    let user_id = get_state(&*db.conn()?, "user_id")?;
    Ok(Some(user_id).filter(|u| !u.is_empty()))
}

fn require_user(db: &Db) -> Result<String, AppError> {
    signed_in_user(db)?.ok_or_else(|| AppError::Invalid("Belum masuk sync".into()))
}

/// Refresh before expiry so a data request has time to complete.
fn session_for(sync: &SyncState, user_id: &str) -> Result<Session, AppError> {
    let mut session = Session::load(&sync.keys, user_id)?
        .ok_or_else(|| AppError::Other("Sesi sync tidak ditemukan; masuk kembali".into()))?;
    super::server::refresh_if_expiring(
        sync.server()?.as_ref(),
        &sync.keys,
        &mut session,
        time::now_ms(),
    )?;
    Ok(session)
}

fn call_server<T>(
    sync: &SyncState,
    session: &mut Session,
    call: impl FnMut(&Session) -> Result<T, AppError>,
) -> Result<T, AppError> {
    super::server::call_with_refresh(sync.server()?.as_ref(), &sync.keys, session, call)
}

/// Cursor, versions, deferred content, and diagnostics belong to one account/vault.
fn reset_account_state(conn: &Connection) -> Result<(), AppError> {
    for (key, value) in [
        ("cursor", "0"),
        ("last_sync_at", "0"),
        ("bytes_used", "0"),
        ("last_error", ""),
        ("vault_fingerprint", ""),
    ] {
        set_state(conn, key, value)?;
    }
    conn.execute_batch("DELETE FROM sync_versions; DELETE FROM sync_pending; DELETE FROM sync_state WHERE key LIKE 'warning:%';")?;
    Ok(())
}

fn check_passphrase(passphrase: &str) -> Result<(), AppError> {
    if passphrase.chars().count() < MIN_PASSPHRASE_CHARS {
        return Err(AppError::Invalid(format!(
            "Frasa sandi sync minimal {MIN_PASSPHRASE_CHARS} karakter"
        )));
    }
    Ok(())
}

/// Data that exists before the first sync has no outbox row (triggers only see later
/// edits), so queue everything once. After that the outbox and versions take over.
fn enqueue_if_never_synced(conn: &Connection) -> Result<(), AppError> {
    let synced: i64 = conn.query_row("SELECT count(*) FROM sync_versions", [], |r| r.get(0))?;
    if synced == 0 {
        record::enqueue_all(conn)?;
    }
    Ok(())
}

pub(crate) fn status(sync: &SyncState, db: &Db) -> Result<SyncStatus, AppError> {
    let mut out = SyncStatus::default();
    if sync.server.is_none() {
        return Ok(out);
    }
    out.configured = true;
    out.quota_bytes = DEFAULT_QUOTA_BYTES;
    let Some(user_id) = signed_in_user(db)? else {
        return Ok(out);
    };
    {
        let conn = db.conn()?;
        out.last_sync_at = get_state(&conn, "last_sync_at")?.parse().ok().filter(|&t| t > 0);
        out.quota_bytes = get_state(&conn, "quota_bytes")?.parse().unwrap_or(DEFAULT_QUOTA_BYTES);
        out.bytes_used = get_state(&conn,"bytes_used")?.parse().unwrap_or(0);
        let persisted_error = get_state(&conn,"last_error")?;
        out.last_error = lock(&sync.last_error).clone().or(Some(persisted_error).filter(|s|!s.is_empty()));
        if out.last_error.is_none() {
            let mut stmt = conn.prepare("SELECT value FROM sync_state WHERE key LIKE 'warning:%' ORDER BY key")?;
            let warnings = stmt.query_map([],|r|r.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
            if !warnings.is_empty() { out.last_error = Some(warnings.join("; ")); }
        }
    }
    let session = Session::load(&sync.keys, &user_id)?;
    out.signed_in = session.is_some();
    out.email = session.map(|s|s.email.clone());
    out.needs_unlock_key = engine::load_dek(&sync.keys, &user_id)?.is_none();
    if out.needs_unlock_key {
        // Network: an unreachable server leaves this unknown instead of failing the card.
        out.vault_exists = session_for(sync, &user_id)
            .and_then(|mut s| call_server(sync, &mut s, |s| sync.server()?.get_vault(s)))
            .ok()
            .map(|v| v.is_some());
    }
    Ok(out)
}

pub(crate) fn sign_in(sync: &SyncState, db: &Db, provider: &str) -> Result<(), AppError> {
    let _running = lock(&sync.running);
    let server = sync.server()?;
    let provider = match provider {
        "google" => Provider::Google,
        "github" => Provider::GitHub,
        _ => return Err(AppError::Invalid("Provider login sync tidak dikenal".into())),
    };
    if let Some(user) = signed_in_user(db)?
        && Session::load(&sync.keys,&user)?.is_some() {
        return Err(AppError::Invalid("Sudah masuk sync; keluar dulu untuk ganti akun".into()));
    }
    sync.cancel_sign_in.store(false, Ordering::SeqCst);
    let flow = oauth::begin(Arc::clone(server), provider)?;
    let session = flow.wait_cancellable(oauth::DEFAULT_TIMEOUT, &sync.cancel_sign_in)?;
    let previous = signed_in_user(db)?;
    if let Some(previous) = previous.as_deref().filter(|u| *u != session.user_id) {
        Session::delete(&sync.keys, previous)?;
        engine::delete_dek(&sync.keys, previous)?;
    }
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    if previous.as_deref() != Some(session.user_id.as_str()) {
        reset_account_state(&tx)?;
        *lock(&sync.last_error) = None;
    }
    session.store(&sync.keys)?;
    if get_state(&tx, "device_id")?.is_empty() {
        set_state(&tx, "device_id", &uuid::Uuid::now_v7().to_string())?;
    }
    set_state(&tx, "user_id", &session.user_id)?;
    tx.commit()?;
    Ok(())
}

pub(crate) fn create_key(
    sync: &SyncState,
    db: &Db,
    passphrase: &str,
    kdf: Kdf,
) -> Result<CreateKeyResult, AppError> {
    let _running = lock(&sync.running);
    let server = sync.server()?;
    let user_id = require_user(db)?;
    check_passphrase(passphrase)?;
    let mut session = session_for(sync, &user_id)?;
    if call_server(sync, &mut session, |s| server.get_vault(s))?.is_some() {
        return Err(AppError::Invalid(
            "Kunci sync sudah ada di akun ini; buka dengan frasa sandi atau recovery key".into(),
        ));
    }
    let dek = Dek::generate()?;
    let recovery = RecoveryKey::generate()?;
    let passphrase_kek = Zeroizing::new(crypto::kek_from_passphrase(passphrase, &kdf)?);
    let recovery_kek = Zeroizing::new(crypto::kek_from_recovery(&recovery));
    let vault = Vault {
        dek_by_passphrase: crypto::wrap(&dek, &passphrase_kek),
        dek_by_recovery: crypto::wrap(&dek, &recovery_kek),
        kdf,
    };
    call_server(sync, &mut session, |s| server.put_vault(s, &vault))?;
    engine::store_dek(&sync.keys, &user_id, &dek)?;
    {
        let mut conn = db.conn()?;
        let tx = conn.transaction()?;
        reset_account_state(&tx)?;
        set_state(&tx, "vault_fingerprint", &engine::vault_fingerprint(&vault))?;
        record::enqueue_all(&tx)?;
        tx.commit()?;
    }
    *lock(&sync.last_error) = None;
    sync.wake.store(true, Ordering::SeqCst);
    // Shown once by the UI; never stored here.
    Ok(CreateKeyResult { recovery_key: recovery.display() })
}

pub(crate) fn unlock_key(sync: &SyncState, db: &Db, secret: &str) -> Result<(), AppError> {
    let _running = lock(&sync.running);
    let server = sync.server()?;
    let user_id = require_user(db)?;
    let mut session = session_for(sync, &user_id)?;
    let vault = call_server(sync, &mut session, |s| server.get_vault(s))?
        .ok_or_else(|| AppError::Invalid("Belum ada kunci sync di akun ini; buat kunci dulu".into()))?;
    let by_passphrase = crypto::kek_from_passphrase(secret, &vault.kdf)
        .map(Zeroizing::new)
        .and_then(|kek| crypto::unwrap(&vault.dek_by_passphrase, &kek));
    let dek = match by_passphrase {
        Ok(dek) => dek,
        Err(first) => match RecoveryKey::parse(secret) {
            Ok(key) => {
                let kek = Zeroizing::new(crypto::kek_from_recovery(&key));
                crypto::unwrap(&vault.dek_by_recovery, &kek)?
            }
            Err(_) => return Err(first),
        },
    };
    engine::store_dek(&sync.keys, &user_id, &dek)?;
    let fingerprint = engine::vault_fingerprint(&vault);
    let reset_state = {
        let mut conn = db.conn()?;
        let tx = conn.transaction()?;
        let previous = get_state(&tx, "vault_fingerprint")?;
        let reset_state = previous != fingerprint
            && (!previous.is_empty()
                || tx.query_row("SELECT EXISTS(SELECT 1 FROM sync_versions)", [], |r| {
                    r.get::<_, bool>(0)
                })?);
        if reset_state {
            reset_account_state(&tx)?;
        }
        set_state(&tx, "vault_fingerprint", &fingerprint)?;
        if reset_state {
            record::enqueue_all(&tx)?;
        } else {
            enqueue_if_never_synced(&tx)?;
        }
        tx.commit()?;
        reset_state
    };
    if reset_state {
        *lock(&sync.last_error) = None;
    }
    sync.wake.store(true, Ordering::SeqCst);
    Ok(())
}

pub(crate) fn change_passphrase(
    sync: &SyncState,
    db: &Db,
    old: &str,
    new: &str,
    kdf: Kdf,
) -> Result<(), AppError> {
    let _running = lock(&sync.running);
    let server = sync.server()?;
    let user_id = require_user(db)?;
    check_passphrase(new)?;
    let mut session = session_for(sync, &user_id)?;
    let vault = call_server(sync, &mut session, |s| server.get_vault(s))?
        .ok_or_else(|| AppError::Invalid("Belum ada kunci sync di akun ini".into()))?;
    let old_kek = Zeroizing::new(crypto::kek_from_passphrase(old, &vault.kdf)?);
    let dek = crypto::unwrap(&vault.dek_by_passphrase, &old_kek)?;
    let new_kek = Zeroizing::new(crypto::kek_from_passphrase(new, &kdf)?);
    let updated = Vault {
        dek_by_passphrase: crypto::wrap(&dek, &new_kek),
        kdf,
        dek_by_recovery: vault.dek_by_recovery,
    };
    call_server(sync, &mut session, |s| server.update_vault(s, &updated))?;
    set_state(&*db.conn()?,"vault_fingerprint",&engine::vault_fingerprint(&updated))
}

/// `None` when another sync is already running.
pub(crate) fn run_sync(sync: &SyncState, db: &Db) -> Result<Option<SyncReport>, AppError> {
    let server = sync.server()?;
    let _running = match sync.running.try_lock() {
        Ok(guard) => guard,
        Err(TryLockError::Poisoned(p)) => p.into_inner(),
        Err(TryLockError::WouldBlock) => return Ok(None),
    };
    let result = engine::sync_once(db, &sync.keys, server.as_ref(), time::now_ms());
    match &result {
        Ok(report) => {
            *lock(&sync.last_error) = None;
            set_state(&*db.conn()?,"last_error","")?;
            set_state(&*db.conn()?,"bytes_used",&report.bytes_used.to_string())?;
        }
        Err(e) => {
            *lock(&sync.last_error) = Some(e.to_string());
            set_state(&*db.conn()?,"last_error",&e.to_string())?;
        }
    }
    result.map(Some)
}

pub(crate) fn sign_out(sync: &SyncState, db: &Db, delete_cloud: bool) -> Result<SignOutResult, AppError> {
    let _running = lock(&sync.running);
    let server = sync.server()?;
    let user_id = require_user(db)?;
    let mut session = session_for(sync, &user_id);
    if delete_cloud {
        // Fail instead of signing out silently: the user asked for the cloud copy gone.
        let session = session.as_mut().map_err(|_| {
            AppError::Other("Sesi sync tidak tersedia; masuk kembali untuk menghapus data cloud".into())
        })?;
        call_server(sync, session, |s| server.delete_my_data(s))?;
    }
    let remote_revoked = match &session {
        Ok(s) => server.sign_out(s).is_ok(),
        Err(_) => false,
    };
    Session::delete(&sync.keys, &user_id)?;
    engine::delete_dek(&sync.keys, &user_id)?;
    {
        // Local data stays. Versions and cursor belong to the account, so the next
        // sign-in starts clean (and queues everything again).
        let mut conn = db.conn()?;
        let tx = conn.transaction()?;
        reset_account_state(&tx)?;
        set_state(&tx, "user_id", "")?;
        tx.commit()?;
    }
    *lock(&sync.last_error) = None;
    Ok(SignOutResult { remote_revoked })
}

fn ready(sync: &SyncState, db: &Db) -> bool {
    matches!(signed_in_user(db), Ok(Some(user)) if matches!(engine::load_dek(&sync.keys, &user), Ok(Some(_))))
}

// ---- background schedule ----

/// Decides when the scheduler thread syncs. Pure, so the timing is testable.
#[derive(Default)]
struct Schedule {
    last_run: Option<Instant>,
    outbox: (i64, i64),
    debounce_until: Option<Instant>,
}

impl Schedule {
    fn due(&mut self, now: Instant, focused: bool, wake: bool, outbox: (i64, i64)) -> bool {
        if outbox != self.outbox {
            self.outbox = outbox;
            self.debounce_until = Some(now + DEBOUNCE);
        }
        let interval = if focused { FOCUSED_INTERVAL } else { BACKGROUND_INTERVAL };
        let due = wake
            || self.last_run.is_none_or(|t| now.duration_since(t) >= interval)
            || self.debounce_until.is_some_and(|t| now >= t);
        if due {
            self.last_run = Some(now);
            self.debounce_until = None;
        }
        due
    }
}

fn outbox_signature(db: &Db) -> Result<(i64, i64), AppError> {
    Ok(db.conn()?.query_row(
        "SELECT count(*), coalesce(max(changed_at), 0) FROM sync_outbox",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}

fn notify(app: &AppHandle, report: &SyncReport) {
    if report.pulled > 0 {
        let _ = app.emit("sync-changed", ());
    }
}

fn tick(app: &AppHandle, schedule: &mut Schedule) {
    // Locked (or no security state yet): do nothing, so the first sync happens right after unlock.
    if app.try_state::<SecurityState>().is_none_or(|s| s.is_locked()) {
        return;
    }
    let (Some(sync), Some(db)) = (app.try_state::<SyncState>(), app.try_state::<Db>()) else {
        return;
    };
    if sync.server.is_none() {
        return;
    }
    let Ok(outbox) = outbox_signature(&db) else { return };
    let wake = sync.wake.swap(false, Ordering::SeqCst);
    let focused = sync.focused.load(Ordering::SeqCst);
    if schedule.due(Instant::now(), focused, wake, outbox)
        && ready(&sync, &db)
        && let Ok(Some(report)) = run_sync(&sync, &db)
    {
        notify(app, &report);
    }
}

/// One thread, one tick a second. ponytail: polls the outbox instead of hooking every write; fine at this size.
pub fn spawn_scheduler(app: AppHandle) {
    std::thread::spawn(move || {
        let mut schedule = Schedule::default();
        loop {
            std::thread::sleep(Duration::from_secs(1));
            tick(&app, &mut schedule);
        }
    });
}

// ---- commands ----

async fn run<T: Send + 'static>(
    app: AppHandle,
    action: impl FnOnce(&SyncState, &Db) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let sync = app.try_state::<SyncState>().ok_or_else(not_configured)?;
        let db = app.try_state::<Db>().ok_or(AppError::DbUnavailable)?;
        action(&sync, &db)
    })
    .await
    .map_err(|_| AppError::Other("Operasi sync tidak dapat diselesaikan".into()))?
}

#[tauri::command]
pub async fn sync_status(app: AppHandle) -> Result<SyncStatus, AppError> {
    run(app, status).await
}

#[tauri::command]
pub async fn sync_sign_in(app: AppHandle, provider: String) -> Result<(), AppError> {
    run(app, move |sync, db| sign_in(sync, db, &provider)).await
}

#[tauri::command]
pub fn sync_cancel_sign_in(sync: State<'_, SyncState>) {
    sync.cancel_sign_in.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn sync_create_key(app: AppHandle, passphrase: String) -> Result<CreateKeyResult, AppError> {
    let passphrase = SecretInput::new(passphrase);
    run(app, move |sync, db| create_key(sync, db, &passphrase, Kdf::default())).await
}

#[tauri::command]
pub async fn sync_unlock_key(app: AppHandle, passphrase_or_recovery: String) -> Result<(), AppError> {
    let passphrase_or_recovery = SecretInput::new(passphrase_or_recovery);
    run(app, move |sync, db| unlock_key(sync, db, &passphrase_or_recovery)).await
}

#[tauri::command]
pub async fn sync_change_passphrase(app: AppHandle, old: String, new: String) -> Result<(), AppError> {
    let old = SecretInput::new(old);
    let new = SecretInput::new(new);
    run(app, move |sync, db| change_passphrase(sync, db, &old, &new, Kdf::default())).await
}

#[tauri::command]
pub async fn sync_now(app: AppHandle) -> Result<SyncReport, AppError> {
    let handle = app.clone();
    let report = run(app, |sync, db| {
        run_sync(sync, db)?.ok_or_else(|| AppError::Other("Sync sedang berjalan".into()))
    })
    .await?;
    notify(&handle, &report);
    Ok(report)
}

#[tauri::command]
pub async fn sync_sign_out(app: AppHandle, delete_cloud: bool) -> Result<SignOutResult, AppError> {
    run(app, move |sync, db| sign_out(sync, db, delete_cloud)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::fake::MemoryServer;

    const PASS: &str = "frasa sandi panjang";

    fn cheap_kdf() -> Kdf {
        Kdf { m_kib: 32, t: 1, p: 1, salt: *b"0123456789abcdef" }
    }

    struct Fixture {
        server: Arc<MemoryServer>,
        sync: SyncState,
        db: Db,
        _dir: tempfile::TempDir,
    }

    fn fixture() -> Fixture {
        let server = Arc::new(MemoryServer::default());
        server.set_fake_session(true);
        let sync = SyncState::new(
            Some(server.clone()),
            KeyringStore::with_builder(keyring::mock::default_credential_builder()),
        );
        let dir = tempfile::Builder::new().prefix("sync-cmd-test-").tempdir_in(".").unwrap();
        let db = Db::open_at(dir.path().join("app.db"));
        Fixture { server, sync, db, _dir: dir }
    }

    fn fake_session(f: &Fixture) -> Session {
        f.server.fake_session().unwrap()
    }

    fn dek_present(f: &Fixture) -> bool {
        let user = signed_in_user(&f.db).unwrap().unwrap();
        engine::load_dek(&f.sync.keys, &user).unwrap().is_some()
    }

    #[test]
    fn status_goes_from_signed_out_to_ready() {
        let f = fixture();
        let s = status(&f.sync, &f.db).unwrap();
        assert!(s.configured && !s.signed_in && !s.needs_unlock_key);

        sign_in(&f.sync, &f.db, "google").unwrap();
        let s = status(&f.sync, &f.db).unwrap();
        assert!(s.signed_in && s.needs_unlock_key);
        assert_eq!(s.vault_exists, Some(false));
        assert_eq!(s.email.as_deref(), Some("sync@example.test"));
        assert!(!get_state(&f.db.conn().unwrap(), "device_id").unwrap().is_empty());

        create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        let s = status(&f.sync, &f.db).unwrap();
        assert!(s.signed_in && !s.needs_unlock_key);
        assert_eq!(s.vault_exists, None);
        assert_eq!(s.quota_bytes, DEFAULT_QUOTA_BYTES);
    }

    #[test]
    fn sign_in_rejects_unknown_provider_and_a_second_sign_in() {
        let f = fixture();
        assert!(matches!(sign_in(&f.sync, &f.db, "facebook"), Err(AppError::Invalid(_))));
        sign_in(&f.sync, &f.db, "github").unwrap();
        assert!(matches!(sign_in(&f.sync, &f.db, "github"), Err(AppError::Invalid(_))));
    }

    #[test]
    fn create_key_returns_a_recovery_key_that_unlocks_on_another_device() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        let created = create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        assert_eq!(created.recovery_key.len(), 39); // 32 digits in 8 groups of 4
        let dek = {
            let user = signed_in_user(&f.db).unwrap().unwrap();
            engine::load_dek(&f.sync.keys, &user).unwrap().unwrap()
        };

        // A second device: same server, empty keyring.
        let other = SyncState::new(
            Some(f.server.clone()),
            KeyringStore::with_builder(keyring::mock::default_credential_builder()),
        );
        let dir = tempfile::Builder::new().prefix("sync-cmd-test-").tempdir_in(".").unwrap();
        let other_db = Db::open_at(dir.path().join("app.db"));
        sign_in(&other, &other_db, "github").unwrap();
        assert!(matches!(unlock_key(&other, &other_db, "salah salah salah"), Err(AppError::Invalid(_))));
        unlock_key(&other, &other_db, &created.recovery_key).unwrap();
        let user = signed_in_user(&other_db).unwrap().unwrap();
        let got = engine::load_dek(&other.keys, &user).unwrap().unwrap();
        assert_eq!(got.as_bytes(), dek.as_bytes());

        engine::delete_dek(&other.keys, &user).unwrap();
        unlock_key(&other, &other_db, PASS).unwrap();
        assert!(engine::load_dek(&other.keys, &user).unwrap().is_some());
    }

    #[test]
    fn second_create_key_is_refused() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        let err = create_key(&f.sync, &f.db, "frasa sandi kedua", cheap_kdf()).err().unwrap();
        assert!(matches!(err, AppError::Invalid(ref m) if m.contains("sudah ada")));
    }

    #[test]
    fn short_passphrase_is_refused_and_nothing_is_created() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        let err = create_key(&f.sync, &f.db, "pendek", cheap_kdf()).err().unwrap();
        assert!(matches!(err, AppError::Invalid(ref m) if m.contains("12 karakter")));
        assert!(f.server.get_vault(&fake_session(&f)).unwrap().is_none());
        assert!(!dek_present(&f));
        assert!(change_passphrase(&f.sync, &f.db, PASS, "pendek", cheap_kdf()).is_err());
    }

    #[test]
    fn change_passphrase_needs_the_old_one() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        assert!(change_passphrase(&f.sync, &f.db, "bukan frasa lama", "frasa sandi baru 1", cheap_kdf()).is_err());
        change_passphrase(&f.sync, &f.db, PASS, "frasa sandi baru 1", cheap_kdf()).unwrap();
        let user = signed_in_user(&f.db).unwrap().unwrap();
        engine::delete_dek(&f.sync.keys, &user).unwrap();
        assert!(unlock_key(&f.sync, &f.db, PASS).is_err());
        unlock_key(&f.sync, &f.db, "frasa sandi baru 1").unwrap();
    }

    #[test]
    fn first_unlock_queues_existing_local_data() {
        let f = fixture();
        f.db.conn()
            .unwrap()
            .execute("INSERT INTO items(id,type,title,created_at,updated_at) VALUES('old','page','Lama',1,1)", [])
            .unwrap();
        f.db.conn().unwrap().execute("DELETE FROM sync_outbox", []).unwrap();
        sign_in(&f.sync, &f.db, "google").unwrap();
        create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        let queued: i64 = f
            .db
            .conn()
            .unwrap()
            .query_row("SELECT count(*) FROM sync_outbox WHERE record_id='old'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(queued, 1);
        // And it really uploads.
        assert_eq!(run_sync(&f.sync, &f.db).unwrap().unwrap().pushed, 1);
    }

    #[test]
    fn sign_out_without_cloud_removes_token_and_key_but_keeps_data() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        f.db.conn()
            .unwrap()
            .execute("INSERT INTO items(id,type,title,created_at,updated_at) VALUES('x','page','Tetap',1,1)", [])
            .unwrap();
        let user = signed_in_user(&f.db).unwrap().unwrap();

        sign_out(&f.sync, &f.db, false).unwrap();

        assert!(Session::load(&f.sync.keys, &user).unwrap().is_none());
        assert!(engine::load_dek(&f.sync.keys, &user).unwrap().is_none());
        assert!(signed_in_user(&f.db).unwrap().is_none());
        let title: String = f.db.conn().unwrap().query_row("SELECT title FROM items WHERE id='x'", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "Tetap");
        // The cloud copy is untouched.
        assert!(f.server.get_vault(&fake_session(&f)).unwrap().is_some());
    }

    #[test]
    fn sign_out_when_remote_fails_reports_revocation_unconfirmed_but_cleans_up_locally() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        let user = signed_in_user(&f.db).unwrap().unwrap();

        f.server.set_offline(true);
        let result = sign_out(&f.sync, &f.db, false).unwrap();
        assert!(!result.remote_revoked, "remote revocation must not be reported as confirmed when server fails");

        // Local state MUST be cleaned up even if remote fails:
        assert!(Session::load(&f.sync.keys, &user).unwrap().is_none());
        assert!(engine::load_dek(&f.sync.keys, &user).unwrap().is_none());
        assert!(signed_in_user(&f.db).unwrap().is_none());
    }

    #[test]
    fn sign_out_with_cloud_calls_delete_my_data() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        sign_out(&f.sync, &f.db, true).unwrap();
        assert!(f.server.get_vault(&fake_session(&f)).unwrap().is_none());
    }

    #[test]
    fn sign_out_with_cloud_failure_keeps_the_session() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        f.server.set_offline(true);
        assert!(sign_out(&f.sync, &f.db, true).is_err());
        assert!(signed_in_user(&f.db).unwrap().is_some());
        assert!(dek_present(&f));
    }

    #[test]
    fn sync_now_runs_once_at_a_time_and_records_errors() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        {
            let _busy = f.sync.running.lock().unwrap();
            assert!(run_sync(&f.sync, &f.db).unwrap().is_none());
        }
        f.server.set_offline(true);
        assert!(run_sync(&f.sync, &f.db).is_err());
        assert!(status(&f.sync, &f.db).unwrap().last_error.is_some());
        f.server.set_offline(false);
        run_sync(&f.sync, &f.db).unwrap().unwrap();
        let s = status(&f.sync, &f.db).unwrap();
        assert!(s.last_error.is_none() && s.last_sync_at.is_some());
    }

    #[test]
    fn unconfigured_build_reports_it_and_refuses_every_command() {
        let sync = SyncState::new(
            None,
            KeyringStore::with_builder(keyring::mock::default_credential_builder()),
        );
        let dir = tempfile::Builder::new().prefix("sync-cmd-test-").tempdir_in(".").unwrap();
        let db = Db::open_at(dir.path().join("app.db"));
        let s = status(&sync, &db).unwrap();
        assert!(!s.configured && !s.signed_in);
        let msg = |e: AppError| matches!(e, AppError::Invalid(m) if m == "Sync belum dikonfigurasi di build ini");
        assert!(msg(sign_in(&sync, &db, "google").unwrap_err()));
        assert!(msg(create_key(&sync, &db, PASS, cheap_kdf()).err().unwrap()));
        assert!(msg(unlock_key(&sync, &db, PASS).unwrap_err()));
        assert!(msg(change_passphrase(&sync, &db, PASS, PASS, cheap_kdf()).unwrap_err()));
        assert!(msg(run_sync(&sync, &db).err().unwrap()));
        assert!(msg(sign_out(&sync, &db, false).unwrap_err()));
    }

    #[test]
    fn locked_app_rejects_every_sync_command() {
        for command in [
            "sync_status",
            "sync_sign_in",
            "sync_cancel_sign_in",
            "sync_create_key",
            "sync_unlock_key",
            "sync_change_passphrase",
            "sync_now",
            "sync_sign_out",
        ] {
            assert!(matches!(crate::check_command_access(command, Some(true)), Err(AppError::Locked)), "{command}");
        }
    }

    #[test]
    fn cancelling_stops_a_waiting_sign_in() {
        // Real transports need a browser; use a bound listener with no callback.
        let server = Arc::new(MemoryServer::default());
        let flow = oauth::begin_with_opener(server, Provider::Google, |_| Ok(())).unwrap();
        let cancel = AtomicBool::new(true);
        let err = flow.wait_cancellable(Duration::from_secs(30), &cancel).err().unwrap();
        assert!(matches!(err, AppError::Other(m) if m.contains("dibatalkan")));
    }

    #[test]
    fn schedule_syncs_at_start_then_by_interval_and_debounces_edits() {
        let t0 = Instant::now();
        let sec = Duration::from_secs;
        let mut s = Schedule::default();
        assert!(s.due(t0, true, false, (0, 0)), "on start");
        assert!(!s.due(t0 + sec(1), true, false, (0, 0)));
        assert!(!s.due(t0 + sec(59), true, false, (0, 0)));
        assert!(s.due(t0 + sec(60), true, false, (0, 0)), "focused: every 60 s");
        assert!(!s.due(t0 + sec(100), false, false, (0, 0)), "background: not yet");
        assert!(s.due(t0 + sec(360), false, false, (0, 0)), "background: every 5 min");

        let t = t0 + sec(400);
        assert!(!s.due(t, true, false, (1, 5)), "edit seen, waiting");
        assert!(!s.due(t + sec(1), true, false, (2, 6)), "more edits push it back");
        assert!(!s.due(t + sec(2), true, false, (2, 6)));
        assert!(s.due(t + sec(3), true, false, (2, 6)), "2 s after the last edit");
        assert!(!s.due(t + sec(4), true, false, (2, 6)));

        assert!(s.due(t + sec(5), true, true, (2, 6)), "wake (focus regained)");
    }

    #[test]
    fn sign_out_waits_for_inflight_sync_then_clears_all_account_state() {
        let f = fixture();
        sign_in(&f.sync,&f.db,"google").unwrap();
        create_key(&f.sync,&f.db,PASS,cheap_kdf()).unwrap();
        f.db.conn().unwrap().execute("INSERT INTO items(id,type,title,created_at,updated_at) VALUES('p','page','Queued',1,1)",[]).unwrap();
        let (entered_tx,entered_rx) = std::sync::mpsc::channel();
        let (release_tx,release_rx) = std::sync::mpsc::channel();
        let release_rx = Mutex::new(release_rx);
        let once = AtomicBool::new(false);
        f.server.set_hook(Arc::new(move || {
            if !once.swap(true,Ordering::SeqCst) {
                entered_tx.send(()).unwrap();
                release_rx.lock().unwrap().recv_timeout(Duration::from_secs(5)).unwrap();
            }
        }));
        std::thread::scope(|scope| {
            let syncing = scope.spawn(|| run_sync(&f.sync,&f.db));
            entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            let (done_tx,done_rx) = std::sync::mpsc::channel();
            let fixture = &f;
            let signing_out = scope.spawn(move || { let result = sign_out(&fixture.sync,&fixture.db,false); done_tx.send(()).unwrap(); result });
            let waited = done_rx.recv_timeout(Duration::from_millis(100)).is_err();
            release_tx.send(()).unwrap();
            syncing.join().unwrap().unwrap();
            signing_out.join().unwrap().unwrap();
            assert!(waited,"sign-out must wait for the running sync");
        });
        let conn = f.db.conn().unwrap();
        assert_eq!(get_state(&conn,"cursor").unwrap(),"0");
        assert_eq!(get_state(&conn,"last_sync_at").unwrap(),"0");
        assert_eq!(conn.query_row("SELECT count(*) FROM sync_versions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert!(Session::load(&f.sync.keys,&fake_session(&f).user_id).unwrap().is_none());
    }

    #[test]
    fn reenabling_sync_keeps_stale_local_copy_older_than_other_device_edit() {
        let f = fixture();
        sign_in(&f.sync,&f.db,"google").unwrap();
        create_key(&f.sync,&f.db,PASS,cheap_kdf()).unwrap();
        f.db.conn().unwrap().execute("INSERT INTO items(id,type,title,created_at,updated_at) VALUES('p','page','Base',1,10)",[]).unwrap();
        f.db.conn().unwrap().execute("UPDATE sync_outbox SET changed_at=10",[]).unwrap();
        run_sync(&f.sync,&f.db).unwrap();
        let other = SyncState::new(Some(f.server.clone()),KeyringStore::with_builder(keyring::mock::default_credential_builder()));
        let dir = tempfile::tempdir_in(".").unwrap();
        let db = Db::open_at(dir.path().join("app.db"));
        sign_in(&other,&db,"google").unwrap();
        unlock_key(&other,&db,PASS).unwrap();
        run_sync(&other,&db).unwrap();
        sign_out(&f.sync,&f.db,false).unwrap();
        db.conn().unwrap().execute("UPDATE items SET title='B edit', updated_at=20 WHERE id='p'",[]).unwrap();
        db.conn().unwrap().execute("UPDATE sync_outbox SET changed_at=20",[]).unwrap();
        run_sync(&other,&db).unwrap();
        sign_in(&f.sync,&f.db,"google").unwrap();
        unlock_key(&f.sync,&f.db,PASS).unwrap();
        run_sync(&f.sync,&f.db).unwrap();
        let title: String = f.db.conn().unwrap().query_row("SELECT title FROM items WHERE id='p'",[],|r|r.get(0)).unwrap();
        assert_eq!(title,"B edit");
    }

    #[test]
    fn warnings_and_usage_survive_sync_state_restart_and_usage_can_return_to_zero() {
        let f = fixture();
        sign_in(&f.sync,&f.db,"google").unwrap();
        create_key(&f.sync,&f.db,PASS,cheap_kdf()).unwrap();
        f.db.conn().unwrap().execute("INSERT INTO items(id,type,title,body,created_at,updated_at) VALUES('large','page','Catatan besar',?1,1,1)",["x".repeat(record::MAX_DECOMPRESSED_BYTES+1)]).unwrap();
        f.db.conn().unwrap().execute("INSERT INTO items(id,type,title,created_at,updated_at) VALUES('small','page','Kecil',1,1)",[]).unwrap();
        run_sync(&f.sync,&f.db).unwrap();
        assert!(status(&f.sync,&f.db).unwrap().last_error.unwrap().contains("Catatan besar"));
        let expected = f.server.usage(&fake_session(&f)).unwrap().bytes;
        assert!(expected>0);
        // A fresh SyncState has no in-memory error or usage cache.
        let restarted = SyncState::new(Some(f.server.clone()),KeyringStore::with_builder(keyring::mock::default_credential_builder()));
        fake_session(&f).store(&restarted.keys).unwrap();
        let status = status(&restarted,&f.db).unwrap();
        assert_eq!(status.bytes_used,expected);
        assert!(status.last_error.unwrap().contains("Catatan besar"));
        f.server.db_conn().execute("DELETE FROM fake_records",[]).unwrap();
        run_sync(&f.sync,&f.db).unwrap();
        assert_eq!(super::status(&f.sync,&f.db).unwrap().bytes_used,0);
    }

    #[test]
    fn replaced_vault_reports_needs_unlock_key_before_any_records_are_sent() {
        let f = fixture();
        sign_in(&f.sync,&f.db,"google").unwrap();
        create_key(&f.sync,&f.db,PASS,cheap_kdf()).unwrap();
        let session = fake_session(&f);
        let mut vault = f.server.get_vault(&session).unwrap().unwrap();
        f.server.delete_my_data(&session).unwrap();
        vault.dek_by_passphrase[0] ^= 1;
        f.server.put_vault(&session,&vault).unwrap();
        assert!(run_sync(&f.sync,&f.db).is_err());
        let status = status(&f.sync,&f.db).unwrap();
        assert!(status.needs_unlock_key);
        assert_eq!(status.last_error.as_deref(),Some("Kunci sync berubah atau dihapus di perangkat lain; buka kunci lagi"));
    }

    #[test]
    fn command_secret_storage_zeroizes_on_drop() {
        fn requires_zeroize<T: zeroize::Zeroize + zeroize::ZeroizeOnDrop>() {}
        requires_zeroize::<SecretInput>();
        requires_zeroize::<Zeroizing<[u8; 32]>>();
    }

    #[test]
    fn expired_sync_session_is_cleared_and_sign_in_can_retry() {
        let f = fixture();
        sign_in(&f.sync,&f.db,"google").unwrap();
        create_key(&f.sync,&f.db,PASS,cheap_kdf()).unwrap();
        f.server.set_auth_expired(true);
        let err = run_sync(&f.sync,&f.db).unwrap_err();
        assert_eq!(err.to_string(),"Sesi sync berakhir; masuk lagi");
        assert!(Session::load(&f.sync.keys,&fake_session(&f).user_id).unwrap().is_none());
        assert!(!status(&f.sync,&f.db).unwrap().signed_in);
        f.server.set_auth_expired(false);
        sign_in(&f.sync,&f.db,"google").unwrap();
        assert!(status(&f.sync,&f.db).unwrap().signed_in);
    }

    fn seed_account_state(f: &Fixture) {
        let conn = f.db.conn().unwrap();
        conn.execute("INSERT INTO sync_versions VALUES('p','100:old')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO sync_pending VALUES('pending','101:old',X'00')",
            [],
        )
        .unwrap();
        for (key, value) in [
            ("cursor", "99"),
            ("last_sync_at", "99"),
            ("vault_fingerprint", "old-vault"),
            ("bytes_used", "999"),
            ("warning:p", "old warning"),
            ("last_error", "old error"),
        ] {
            set_state(&conn, key, value).unwrap();
        }
        *lock(&f.sync.last_error) = Some("old error".into());
    }

    fn assert_account_state_reset(f: &Fixture) {
        let conn = f.db.conn().unwrap();
        for key in ["cursor", "last_sync_at", "bytes_used"] {
            assert_eq!(get_state(&conn, key).unwrap(), "0", "{key}");
        }
        assert_eq!(get_state(&conn, "last_error").unwrap(), "");
        assert_eq!(get_state(&conn, "warning:p").unwrap(), "");
        for table in ["sync_versions", "sync_pending"] {
            assert_eq!(
                conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        assert!(lock(&f.sync.last_error).is_none());
    }

    #[test]
    fn sign_in_to_different_account_resets_state_and_uploads_local_data() {
        let f = fixture();
        let old_user = "00000000-0000-0000-0000-000000000002";
        {
            let conn = f.db.conn().unwrap();
            set_state(&conn, "user_id", old_user).unwrap();
            conn.execute("INSERT INTO items(id,type,title,created_at,updated_at) VALUES('p','page','Local data',1,10)",[]).unwrap();
            conn.execute("DELETE FROM sync_outbox", []).unwrap();
        }
        engine::store_dek(&f.sync.keys, old_user, &Dek::from_bytes([7; 32])).unwrap();
        seed_account_state(&f);
        sign_in(&f.sync, &f.db, "google").unwrap();
        assert_account_state_reset(&f);
        assert_eq!(
            get_state(&f.db.conn().unwrap(), "vault_fingerprint").unwrap(),
            ""
        );
        assert!(engine::load_dek(&f.sync.keys, old_user).unwrap().is_none());
        let other = SyncState::new(
            Some(f.server.clone()),
            KeyringStore::with_builder(keyring::mock::default_credential_builder()),
        );
        let dir = tempfile::tempdir_in(".").unwrap();
        let db = Db::open_at(dir.path().join("app.db"));
        sign_in(&other, &db, "google").unwrap();
        create_key(&other, &db, PASS, cheap_kdf()).unwrap();
        unlock_key(&f.sync, &f.db, PASS).unwrap();
        assert_eq!(run_sync(&f.sync, &f.db).unwrap().unwrap().pushed, 1);
        run_sync(&other, &db).unwrap();
        assert_eq!(
            db.conn()
                .unwrap()
                .query_row("SELECT title FROM items WHERE id='p'", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "Local data"
        );
    }

    #[test]
    fn creating_replacement_vault_resets_state_and_uploads_all_local_data() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        f.db.conn().unwrap().execute("INSERT INTO items(id,type,title,created_at,updated_at) VALUES('p','page','Local data',1,10)",[]).unwrap();
        run_sync(&f.sync, &f.db).unwrap();
        f.db.conn()
            .unwrap()
            .execute("DELETE FROM sync_versions", [])
            .unwrap();
        seed_account_state(&f);
        f.server.delete_my_data(&fake_session(&f)).unwrap();
        create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        assert_account_state_reset(&f);
        assert_eq!(run_sync(&f.sync, &f.db).unwrap().unwrap().pushed, 1);
        let other = SyncState::new(
            Some(f.server.clone()),
            KeyringStore::with_builder(keyring::mock::default_credential_builder()),
        );
        let dir = tempfile::tempdir_in(".").unwrap();
        let db = Db::open_at(dir.path().join("app.db"));
        sign_in(&other, &db, "google").unwrap();
        unlock_key(&other, &db, PASS).unwrap();
        run_sync(&other, &db).unwrap();
        assert_eq!(
            db.conn()
                .unwrap()
                .query_row("SELECT title FROM items WHERE id='p'", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "Local data"
        );
    }

    #[test]
    fn unlocking_replacement_vault_resets_state_and_uploads_all_local_data() {
        for detect_key_change in [false, true] {
            let f = fixture();
            sign_in(&f.sync, &f.db, "google").unwrap();
            create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
            f.db.conn().unwrap().execute("INSERT INTO items(id,type,title,created_at,updated_at) VALUES('p','page','Local page',1,10),('q','page','Another page',1,10)", []).unwrap();
            assert_eq!(run_sync(&f.sync, &f.db).unwrap().unwrap().pushed, 2);
            run_sync(&f.sync, &f.db).unwrap(); // Pull our own records to advance the cursor.
            let old_fingerprint = {
                let conn = f.db.conn().unwrap();
                assert_ne!(get_state(&conn, "cursor").unwrap(), "0");
                assert_eq!(
                    conn.query_row("SELECT count(*) FROM sync_versions", [], |r| r
                        .get::<_, i64>(0))
                        .unwrap(),
                    2
                );
                assert_eq!(
                    conn.query_row("SELECT count(*) FROM sync_outbox", [], |r| r
                        .get::<_, i64>(0))
                        .unwrap(),
                    0
                );
                conn.execute(
                    "INSERT INTO sync_pending VALUES('pending','101:old',X'00')",
                    [],
                )
                .unwrap();
                set_state(&conn, "warning:p", "Old vault warning").unwrap();
                get_state(&conn, "vault_fingerprint").unwrap()
            };

            let other = SyncState::new(
                Some(f.server.clone()),
                KeyringStore::with_builder(keyring::mock::default_credential_builder()),
            );
            let dir = tempfile::tempdir_in(".").unwrap();
            let db = Db::open_at(dir.path().join("app.db"));
            sign_in(&other, &db, "google").unwrap();
            f.server.delete_my_data(&fake_session(&f)).unwrap();
            create_key(&other, &db, PASS, cheap_kdf()).unwrap();
            let new_fingerprint = get_state(&db.conn().unwrap(), "vault_fingerprint").unwrap();
            assert_ne!(old_fingerprint, new_fingerprint);
            if detect_key_change {
                assert!(run_sync(&f.sync, &f.db).is_err());
                assert!(!dek_present(&f));
            }

            unlock_key(&f.sync, &f.db, PASS).unwrap();
            assert_account_state_reset(&f);
            {
                let conn = f.db.conn().unwrap();
                assert_eq!(
                    get_state(&conn, "vault_fingerprint").unwrap(),
                    new_fingerprint
                );
                let mut stmt = conn
                    .prepare("SELECT record_id FROM sync_outbox ORDER BY record_id")
                    .unwrap();
                let queued = stmt
                    .query_map([], |r| r.get::<_, String>(0))
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap();
                assert_eq!(queued, ["p", "q"]);
            }
            assert_eq!(run_sync(&f.sync, &f.db).unwrap().unwrap().pushed, 2);
            assert_eq!(run_sync(&other, &db).unwrap().unwrap().pulled, 2);
        }
    }

    #[test]
    fn unlocking_same_vault_keeps_synced_versions_and_cursor() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        f.db.conn().unwrap().execute("INSERT INTO items(id,type,title,created_at,updated_at) VALUES('p','page','Synced page',1,10)", []).unwrap();
        run_sync(&f.sync, &f.db).unwrap();
        run_sync(&f.sync, &f.db).unwrap();
        let (cursor, version) = {
            let conn = f.db.conn().unwrap();
            (
                get_state(&conn, "cursor").unwrap(),
                conn.query_row(
                    "SELECT version FROM sync_versions WHERE record_id='p'",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .unwrap(),
            )
        };
        assert_ne!(cursor, "0");
        engine::delete_dek(&f.sync.keys, &require_user(&f.db).unwrap()).unwrap();

        unlock_key(&f.sync, &f.db, PASS).unwrap();
        let conn = f.db.conn().unwrap();
        assert_eq!(get_state(&conn, "cursor").unwrap(), cursor);
        assert_eq!(
            conn.query_row(
                "SELECT version FROM sync_versions WHERE record_id='p'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            version
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM sync_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn first_unlock_without_fingerprint_queues_preexisting_local_data() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        f.db.conn().unwrap().execute("INSERT INTO items(id,type,title,created_at,updated_at) VALUES('p','page','Preexisting page',1,10)", []).unwrap();
        f.db.conn()
            .unwrap()
            .execute("DELETE FROM sync_outbox", [])
            .unwrap();
        let other = SyncState::new(
            Some(f.server.clone()),
            KeyringStore::with_builder(keyring::mock::default_credential_builder()),
        );
        let dir = tempfile::tempdir_in(".").unwrap();
        let db = Db::open_at(dir.path().join("app.db"));
        sign_in(&other, &db, "google").unwrap();
        create_key(&other, &db, PASS, cheap_kdf()).unwrap();
        assert_eq!(
            get_state(&f.db.conn().unwrap(), "vault_fingerprint").unwrap(),
            ""
        );

        unlock_key(&f.sync, &f.db, PASS).unwrap();
        assert_eq!(
            get_state(&f.db.conn().unwrap(), "vault_fingerprint").unwrap(),
            get_state(&db.conn().unwrap(), "vault_fingerprint").unwrap()
        );
        assert_eq!(run_sync(&f.sync, &f.db).unwrap().unwrap().pushed, 1);
        assert_eq!(run_sync(&other, &db).unwrap().unwrap().pulled, 1);
    }

    #[test]
    fn sign_out_also_clears_account_warnings() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        seed_account_state(&f);
        sign_out(&f.sync, &f.db, false).unwrap();
        assert_account_state_reset(&f);
    }

    #[test]
    fn unlock_key_refreshes_and_retries_an_expired_access_token() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        create_key(&f.sync, &f.db, PASS, cheap_kdf()).unwrap();
        let user = require_user(&f.db).unwrap();
        let mut session = fake_session(&f);
        session.access_token = "expired-access".into();
        session.store(&f.sync.keys).unwrap();
        engine::delete_dek(&f.sync.keys, &user).unwrap();
        f.server.expire_access_token("expired-access");
        unlock_key(&f.sync, &f.db, PASS).unwrap();
        assert_eq!(f.server.refresh_count(), 1);
        assert!(dek_present(&f));
    }

    #[test]
    fn command_session_refreshes_sixty_seconds_before_expiry() {
        let f = fixture();
        sign_in(&f.sync, &f.db, "google").unwrap();
        let mut session = fake_session(&f);
        session.expires_at = time::now_ms() + 60_000;
        session.store(&f.sync.keys).unwrap();
        session_for(&f.sync, &session.user_id).unwrap();
        assert_eq!(f.server.refresh_count(), 1);
    }

}
