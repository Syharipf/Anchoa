//! Local fake transports. Both use the same transactional SQLite implementation,
//! so the file shared by two debug app instances has the same rules as tests.
use std::{path::Path, sync::{Mutex, MutexGuard}, time::Duration};

use rusqlite::{Connection, OptionalExtension, params};

use super::server::{self, Provider, Rejected, Session, SyncServer, Usage, Vault, WireRecord};
use crate::error::AppError;

pub const FAKE_USER_ID: &str = "00000000-0000-0000-0000-000000000001";

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS fake_records (
 user_id TEXT NOT NULL, id TEXT NOT NULL, changed_at INTEGER NOT NULL,
 device_id TEXT NOT NULL, deleted INTEGER NOT NULL, payload BLOB NOT NULL,
 seq INTEGER NOT NULL, PRIMARY KEY(user_id,id));
CREATE INDEX IF NOT EXISTS fake_records_cursor ON fake_records(user_id,seq);
CREATE TABLE IF NOT EXISTS fake_vault(user_id TEXT PRIMARY KEY, document TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fake_sequence(value INTEGER NOT NULL);
INSERT INTO fake_sequence SELECT 0 WHERE NOT EXISTS(SELECT 1 FROM fake_sequence);
";

struct Store {
    conn: Mutex<Connection>,
    #[cfg(test)]
    control: Mutex<Control>,
}

#[cfg(test)]
#[derive(Default)]
struct Control {
    calls: usize,
    refreshes: usize,
    offline: bool,
    fake_session: bool,
    hook: Option<std::sync::Arc<dyn Fn() + Send + Sync>>,
}

pub struct MemoryServer { store: Store }

#[cfg(debug_assertions)]
pub struct FileServer { store: Store }

impl Store {
    fn new(conn: Connection) -> Result<Self, AppError> {
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn), #[cfg(test)] control: Mutex::new(Control::default()) })
    }
    fn call(&self) -> Result<(), AppError> {
        #[cfg(test)]
        {
            let (hook, offline) = {
                let mut control = self.control.lock().map_err(|_| server::unreachable())?;
                control.calls += 1;
                (control.hook.clone(), control.offline)
            };
            if let Some(hook) = hook { hook() }
            if offline { return Err(server::unreachable()) }
        }
        Ok(())
    }
    fn conn(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        self.call()?;
        self.conn.lock().map_err(|_| server::unreachable())
    }
    fn push(&self, session: &Session, rows: &[WireRecord]) -> Result<Vec<Rejected>, AppError> {
        if rows.len() > server::PAGE_SIZE as usize { return Err(server::invalid_response()) }
        let user = server::canonical_uuid(&session.user_id)?;
        let mut normalized = rows.to_vec();
        for row in &mut normalized { server::validate_record(row)?; row.device_id = server::canonical_uuid(&row.device_id)? }
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut rejected = Vec::new();
        for row in normalized {
            let stored: Option<(i64, String)> = tx.query_row("SELECT changed_at,device_id FROM fake_records WHERE user_id=?1 AND id=?2", params![user,row.id], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
            if let Some((changed_at, device_id)) = stored
                && (row.changed_at, row.device_id.as_str()) <= (changed_at, device_id.as_str()) {
                rejected.push(Rejected { id: row.id, changed_at, device_id });
                continue;
            }
            tx.execute("UPDATE fake_sequence SET value=value+1", [])?;
            let seq: i64 = tx.query_row("SELECT value FROM fake_sequence", [], |r| r.get(0))?;
            tx.execute("INSERT INTO fake_records(user_id,id,changed_at,device_id,deleted,payload,seq) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(user_id,id) DO UPDATE SET changed_at=excluded.changed_at,device_id=excluded.device_id,deleted=excluded.deleted,payload=excluded.payload,seq=excluded.seq", params![user,row.id,row.changed_at,row.device_id,row.deleted,row.payload,seq])?;
        }
        tx.commit()?;
        Ok(rejected)
    }
    fn pull(&self, session: &Session, after: i64, max: u32) -> Result<Vec<WireRecord>, AppError> {
        let user = server::canonical_uuid(&session.user_id)?;
        let conn = self.conn()?;
        Ok(conn.prepare("SELECT id,changed_at,device_id,deleted,payload,seq FROM fake_records WHERE user_id=?1 AND seq>?2 ORDER BY seq LIMIT ?3")?.query_map(params![user,after,max.clamp(1,server::PAGE_SIZE)], |r| Ok(WireRecord { id:r.get(0)?, changed_at:r.get(1)?, device_id:r.get(2)?, deleted:r.get(3)?, payload:r.get(4)?, seq:r.get(5)? }))?.collect::<Result<_,_>>()?)
    }
    fn usage(&self, session: &Session) -> Result<Usage, AppError> {
        let user = server::canonical_uuid(&session.user_id)?;
        Ok(self.conn()?.query_row("SELECT count(*),coalesce(sum(length(payload)),0) FROM fake_records WHERE user_id=?1", [user], |r| Ok(Usage { rows:r.get::<_,i64>(0)? as u64,bytes:r.get::<_,i64>(1)? as u64 }))?)
    }
    fn get_vault(&self, session: &Session) -> Result<Option<Vault>, AppError> {
        let user = server::canonical_uuid(&session.user_id)?;
        server::stored_vault(&*self.conn()?, &user)
    }
    fn put_vault(&self, session: &Session, vault: &Vault) -> Result<(), AppError> {
        let user = server::canonical_uuid(&session.user_id)?;
        let value = server::vault_json(vault);
        // Validate all wrapped data and KDF parameters before persisting.
        server::vault_from_json(&value)?;
        self.conn()?.execute("INSERT INTO fake_vault VALUES(?1,?2) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document", params![user,value.to_string()])?;
        Ok(())
    }
    fn delete_my_data(&self, session: &Session) -> Result<(), AppError> {
        let user = server::canonical_uuid(&session.user_id)?;
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM fake_records WHERE user_id=?1", [&user])?;
        tx.execute("DELETE FROM fake_vault WHERE user_id=?1", [&user])?;
        tx.commit()?;
        Ok(())
    }
    fn refresh(&self, session: &Session) -> Result<Session, AppError> {
        self.call()?;
        #[cfg(test)]
        { self.control.lock().map_err(|_| server::unreachable())?.refreshes += 1; }
        Ok(Session { user_id: server::canonical_uuid(&session.user_id)?, email: session.email.clone(), access_token: "fake-access".into(), refresh_token: "fake-refresh".into(), expires_at: i64::MAX })
    }
}

impl Default for MemoryServer {
    fn default() -> Self {
        Self { store: Store::new(Connection::open_in_memory().expect("Fake sync database")).expect("Fake sync schema") }
    }
}

#[cfg(debug_assertions)]
impl FileServer {
    pub fn open(path: &Path) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.pragma_update(None,"journal_mode","WAL")?;
        Ok(Self { store: Store::new(conn)? })
    }
}

#[cfg(test)]
impl MemoryServer {
    pub fn set_hook(&self, hook: std::sync::Arc<dyn Fn() + Send + Sync>) { self.store.control.lock().unwrap().hook=Some(hook) }
    pub fn set_offline(&self, offline: bool) { self.store.control.lock().unwrap().offline=offline }
    pub fn set_fake_session(&self, enabled: bool) { self.store.control.lock().unwrap().fake_session = enabled; }
    pub fn call_count(&self) -> usize { self.store.control.lock().unwrap().calls }
    pub fn refresh_count(&self) -> usize { self.store.control.lock().unwrap().refreshes }
    pub fn tamper(&self, operation: impl FnOnce(&mut Vec<WireRecord>)) {
        let mut rows = self.pull(&fake_session(),0,500).unwrap();
        operation(&mut rows);
        let conn = self.store.conn.lock().unwrap();
        for row in rows { conn.execute("UPDATE fake_records SET payload=?1,deleted=?2 WHERE user_id=?3 AND id=?4",params![row.payload,row.deleted,FAKE_USER_ID,row.id]).unwrap(); }
    }
    pub fn tamper_seq(&self, id_a: &str, id_b: &str) {
        let conn = self.store.conn.lock().unwrap();
        let seq_a: i64 = conn.query_row("SELECT seq FROM fake_records WHERE id=?1", [id_a], |r| r.get(0)).unwrap();
        let seq_b: i64 = conn.query_row("SELECT seq FROM fake_records WHERE id=?1", [id_b], |r| r.get(0)).unwrap();
        conn.execute("UPDATE fake_records SET seq=?1 WHERE id=?2", params![seq_b, id_a]).unwrap();
        conn.execute("UPDATE fake_records SET seq=?1 WHERE id=?2", params![seq_a, id_b]).unwrap();
    }
    pub fn db_conn(&self) -> std::sync::MutexGuard<'_, rusqlite::Connection> {
        self.store.conn.lock().unwrap()
    }
}

impl MemoryServer {
    fn store_fake_session(&self) -> Option<Session> {
        #[cfg(test)]
        if self.store.control.lock().unwrap().fake_session {
            return Some(fake_session());
        }
        None
    }
}

#[cfg(debug_assertions)]
impl FileServer {
    fn store_fake_session(&self) -> Option<Session> {
        Some(fake_session())
    }
}

fn fake_session() -> Session {
    Session { user_id:FAKE_USER_ID.into(), email:"sync@example.test".into(), access_token:"fake-access".into(), refresh_token:"fake-refresh".into(), expires_at:i64::MAX }
}

macro_rules! implement_server {
    ($name:ty) => {
        impl SyncServer for $name {
            fn authorize_url(&self, provider: Provider, redirect: &str, challenge: &str, state: &str) -> String {
                format!("https://fake.invalid/auth/v1/authorize?provider={}&redirect_to={}&code_challenge={}&code_challenge_method=s256&state={}",provider.as_str(),server::percent_encode(redirect),server::percent_encode(challenge),server::percent_encode(state))
            }
            fn exchange_code(&self, _code: &str, _verifier: &str) -> Result<Session,AppError> { self.store.call()?; Ok(fake_session()) }
            fn refresh(&self, session: &Session) -> Result<Session,AppError> { self.store.refresh(session) }
            fn sign_out(&self, _session: &Session) -> Result<(),AppError> { self.store.call() }
            fn get_vault(&self, session: &Session) -> Result<Option<Vault>,AppError> { self.store.get_vault(session) }
            fn put_vault(&self, session: &Session, vault: &Vault) -> Result<(),AppError> { self.store.put_vault(session,vault) }
            fn push(&self, session: &Session, rows: &[WireRecord]) -> Result<Vec<Rejected>,AppError> { self.store.push(session,rows) }
            fn pull(&self, session: &Session, after: i64, max: u32) -> Result<Vec<WireRecord>,AppError> { self.store.pull(session,after,max) }
            fn usage(&self, session: &Session) -> Result<Usage,AppError> { self.store.usage(session) }
            fn delete_my_data(&self, session: &Session) -> Result<(),AppError> { self.store.delete_my_data(session) }
            fn fake_session(&self) -> Option<Session> { self.store_fake_session() }
        }
    }
}
implement_server!(MemoryServer);
#[cfg(debug_assertions)]
implement_server!(FileServer);

