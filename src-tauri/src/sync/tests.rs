use std::{
    io::{Read, Write},
    net::TcpStream,
    sync::Arc,
    time::Duration,
};

use rusqlite::params;

use super::{
    crypto::Dek,
    engine,
    fake::{self, MemoryServer},
    oauth,
    server::{Provider, Session, SyncServer},
};
use crate::{db::Db, keystore::KeyringStore};

const USER: &str = "00000000-0000-0000-0000-000000000001";
const DEVICE_A: &str = "00000000-0000-0000-0000-00000000000a";
const DEVICE_B: &str = "00000000-0000-0000-0000-00000000000b";

struct Client {
    db: Arc<Db>,
    keys: KeyringStore,
    _dir: tempfile::TempDir,
}

impl Client {
    fn new(device: &str) -> Self {
        let dir = tempfile::Builder::new().prefix("sync-test-").tempdir_in(".").unwrap();
        let db = Arc::new(Db::open_at(dir.path().join("app.db")));
        let keys = KeyringStore::with_builder(keyring::mock::default_credential_builder());
        db.conn().unwrap().execute("UPDATE sync_state SET value=?1 WHERE key='device_id'", [device]).unwrap();
        db.conn().unwrap().execute("UPDATE sync_state SET value=?1 WHERE key='user_id'", [USER]).unwrap();
        session().store(&keys).unwrap();
        engine::store_dek(&keys, USER, &Dek::from_bytes([7; 32])).unwrap();
        Self { db, keys, _dir: dir }
    }

    fn write(&self, id: &str, title: &str, changed_at: i64) {
        let conn = self.db.conn().unwrap();
        conn.execute("INSERT INTO items(id,type,title,created_at,updated_at) VALUES(?1,'page',?2,1,1) ON CONFLICT(id) DO UPDATE SET title=excluded.title", params![id,title]).unwrap();
        conn.execute("UPDATE sync_outbox SET changed_at=?2 WHERE record_id=?1", params![id,changed_at]).unwrap();
    }

    fn write_with_parent(&self, id: &str, title: &str, parent: Option<&str>, changed_at: i64) {
        let conn = self.db.conn().unwrap();
        conn.execute(
            "INSERT INTO items(id,type,title,parent_id,created_at,updated_at) VALUES(?1,'page',?2,?3,1,1) ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id",
            params![id, title, parent],
        ).unwrap();
        conn.execute("UPDATE sync_outbox SET changed_at=?2 WHERE record_id=?1", params![id, changed_at]).unwrap();
    }

    fn title(&self, id: &str) -> String {
        self.db.conn().unwrap().query_row("SELECT title FROM items WHERE id=?1", [id], |r| r.get(0)).unwrap()
    }

    fn title_opt(&self, id: &str) -> Option<String> {
        self.db.conn().unwrap().query_row("SELECT title FROM items WHERE id=?1", [id], |r| r.get(0)).ok()
    }

    fn sync(&self, server: &dyn SyncServer) -> super::server::SyncReport {
        engine::sync_once(&self.db, &self.keys, server, 1_000).unwrap()
    }
}

fn session() -> Session {
    Session { user_id: USER.into(), email: "fake@example.test".into(), access_token: "secret-access".into(), refresh_token: "secret-refresh".into(), expires_at: i64::MAX }
}

#[test]
fn two_clients_converge_for_create_conflict_and_soft_delete() {
    let server = MemoryServer::default();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("page", "created", 100);
    assert_eq!(a.sync(&server).pushed, 1);
    assert_eq!(b.sync(&server).pulled, 1);
    assert_eq!(b.title("page"), "created");
    a.write("page", "A", 200);
    b.write("page", "B", 300);
    b.sync(&server);
    a.sync(&server);
    b.sync(&server);
    assert_eq!(a.title("page"), "B");
    assert_eq!(b.title("page"), "B");
    a.db.conn().unwrap().execute("UPDATE items SET deleted_at=123 WHERE id='page'", []).unwrap();
    a.db.conn().unwrap().execute("UPDATE sync_outbox SET changed_at=400", []).unwrap();
    a.sync(&server);
    b.sync(&server);
    let deleted: i64 = b.db.conn().unwrap().query_row("SELECT deleted_at FROM items WHERE id='page'", [], |r| r.get(0)).unwrap();
    assert_eq!(deleted, 123);
    assert!(!server.pull(&session(), 0, 500).unwrap()[0].deleted);
}

#[test]
fn local_newer_edit_survives_pull_and_clock_is_advanced() {
    let server = MemoryServer::default();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("p", "initial", 1_000);
    a.sync(&server);
    b.sync(&server);
    b.write("p", "slow clock", 1);
    b.sync(&server);
    a.sync(&server);
    assert_eq!(a.title("p"), "slow clock");
    assert_eq!(server.pull(&session(), 0, 500).unwrap()[0].changed_at, 1_001);
    a.write("p", "A", 2_000);
    b.write("p", "B", 3_000);
    a.sync(&server);
    b.sync(&server);
    a.sync(&server);
    assert_eq!(a.title("p"), "B");
}

#[test]
fn quota_stops_push_but_allows_pull_and_idle_uses_one_call() {
    let server = MemoryServer::default();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("remote", "remote", 1);
    a.sync(&server);
    b.write("local", "local", 2);
    b.db.conn().unwrap().execute("UPDATE sync_state SET value='1' WHERE key='quota_bytes'", []).unwrap();
    let report = b.sync(&server);
    assert!(report.stopped_by_quota);
    assert_eq!(report.pulled, 1);
    assert_eq!(report.pushed, 0);
    assert_eq!(b.title("remote"), "remote");
    assert_eq!(server.usage(&session()).unwrap().rows, 1);
    let before = server.call_count();
    a.sync(&server);
    // A first consumes its own server echo; a second idle cycle still only pulls.
    let middle = server.call_count();
    a.sync(&server);
    assert_eq!(server.call_count() - middle, 1);
    assert_eq!(middle - before, 1);
}

#[test]
fn offline_preserves_outbox_and_server_calls_never_hold_database() {
    let server = MemoryServer::default();
    let a = Client::new(DEVICE_A);
    a.write("p", "private content", 5);
    let db = Arc::clone(&a.db);
    server.set_hook(Arc::new(move || assert!(db.is_unlocked_for_test())));
    server.set_offline(true);
    let error = engine::sync_once(&a.db, &a.keys, &server, 1_000).unwrap_err();
    assert!(error.to_string().contains("server sync"));
    assert_eq!(a.db.conn().unwrap().query_row("SELECT count(*) FROM sync_outbox", [], |r| r.get::<_,i64>(0)).unwrap(), 1);
    server.set_offline(false);
    a.sync(&server);
    let payload = server.pull(&session(), 0, 500).unwrap().remove(0).payload.unwrap();
    assert!(!payload.windows(b"private content".len()).any(|w| w == b"private content"));
}

#[test]
fn expired_session_is_refreshed_once_and_persisted_only_in_keyring() {
    let server = MemoryServer::default();
    let a = Client::new(DEVICE_A);
    let mut expired = session();
    expired.expires_at = 0;
    expired.store(&a.keys).unwrap();
    a.write("p", "p", 1);
    a.sync(&server);
    assert_eq!(server.refresh_count(), 1);
    assert!(Session::load(&a.keys, USER).unwrap().unwrap().expires_at > 1_000);
    a.sync(&server);
    assert_eq!(server.refresh_count(), 1);
    let dump = std::fs::read(a.db.path.clone()).unwrap();
    assert!(!dump.windows(6).any(|w| w == b"secret"));
}

#[test]
fn child_arrives_before_parent_goes_to_pending_and_applies_after_parent() {
    let server = MemoryServer::default();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);

    // A writes parent and child (valid locally with foreign key)
    a.write("parent_page", "Parent", 100);
    a.write_with_parent("child_page", "Child", Some("parent_page"), 200);
    assert_eq!(a.sync(&server).pushed, 2);

    // Delete parent temporarily from server fake_records so child arrives first on B
    let parent_backup: (i64, String, bool, Vec<u8>, i64) = {
        let conn = server.db_conn();
        conn.query_row(
            "SELECT changed_at, device_id, deleted, payload, seq FROM fake_records WHERE id='parent_page'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        ).unwrap()
    };
    {
        let conn = server.db_conn();
        conn.execute("DELETE FROM fake_records WHERE id='parent_page'", []).unwrap();
    }

    // B syncs: child has missing parent, so goes to pending
    let report_b1 = b.sync(&server);
    assert_eq!(report_b1.pulled, 0);
    assert_eq!(report_b1.pending, 1);
    assert!(b.title_opt("child_page").is_none());

    // Restore parent on server with higher seq
    {
        let conn = server.db_conn();
        let max_seq: i64 = conn.query_row("SELECT COALESCE(MAX(seq), 0) + 1 FROM fake_records", [], |r| r.get(0)).unwrap();
        conn.execute(
            "INSERT INTO fake_records(user_id,id,changed_at,device_id,deleted,payload,seq) VALUES(?1,'parent_page',?2,?3,?4,?5,?6)",
            params![USER, parent_backup.0, parent_backup.1, parent_backup.2, parent_backup.3, max_seq],
        ).unwrap();
    }

    // B syncs: parent arrives, and child is retried and applied from pending!
    let report_b2 = b.sync(&server);
    assert_eq!(report_b2.pulled, 2);
    assert_eq!(report_b2.pending, 0);
    assert_eq!(b.title("parent_page"), "Parent");
    assert_eq!(b.title("child_page"), "Child");
}

#[test]
fn tampered_payload_is_skipped_and_cursor_advances() {
    let server = MemoryServer::default();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);

    a.write("page1", "First", 100);
    a.write("page2", "Second", 200);
    a.sync(&server);

    // Server tampers: swap payloads of page1 and page2
    server.tamper(|rows| {
        if rows.len() >= 2 {
            let p0 = rows[0].payload.clone();
            rows[0].payload = rows[1].payload.clone();
            rows[1].payload = p0;
        }
    });

    // B syncs: both fail to decrypt because AAD contains record_id, so both are skipped!
    let report_b = b.sync(&server);
    assert_eq!(report_b.pulled, 0);
    assert!(b.title_opt("page1").is_none());
    assert!(b.title_opt("page2").is_none());

    // A writes a third untampered record
    a.write("page3", "Third", 300);
    a.sync(&server);

    // B syncs: cursor had advanced past tampered rows, so only page3 arrives and succeeds!
    let report_b2 = b.sync(&server);
    assert_eq!(report_b2.pulled, 1);
    assert_eq!(b.title("page3"), "Third");
}

#[test]
fn oauth_rejects_invalid_state_and_wrong_path_and_completes_on_valid_callback() {
    let server: Arc<dyn SyncServer> = Arc::new(MemoryServer::default());
    let (tx_url, rx_url) = std::sync::mpsc::channel();

    let flow = oauth::begin_with_opener(Arc::clone(&server), Provider::Google, move |url| {
        tx_url.send(url.to_string()).unwrap();
        Ok(())
    }).unwrap();

    let auth_url = rx_url.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(auth_url.contains("provider=google"));
    assert!(auth_url.contains("code_challenge_method=s256"));
    assert!(auth_url.contains("redirect_to="));

    let redirect_uri = flow.redirect_uri().to_string();
    let addr = redirect_uri.strip_prefix("http://").unwrap().strip_suffix("/callback").unwrap().to_string();

    let state = auth_url.split("state=").nth(1).unwrap().split('&').next().unwrap().to_string();

    let handle = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));

        // 1. Wrong path -> 404
        let mut s1 = TcpStream::connect(&addr).unwrap();
        s1.write_all(b"GET /wrong HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut resp1 = String::new();
        s1.read_to_string(&mut resp1).unwrap();
        assert!(resp1.contains("404 Not Found"));

        // 2. Wrong state -> 404
        let mut s2 = TcpStream::connect(&addr).unwrap();
        s2.write_all(b"GET /callback?code=abc&state=wrong HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut resp2 = String::new();
        s2.read_to_string(&mut resp2).unwrap();
        assert!(resp2.contains("404 Not Found"));

        // 3. Missing code -> 404
        let mut s3 = TcpStream::connect(&addr).unwrap();
        let req3 = format!("GET /callback?state={state} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        s3.write_all(req3.as_bytes()).unwrap();
        let mut resp3 = String::new();
        s3.read_to_string(&mut resp3).unwrap();
        assert!(resp3.contains("404 Not Found"));

        // 4. Valid callback -> 200 OK
        let mut s4 = TcpStream::connect(&addr).unwrap();
        let req4 = format!("GET /callback?code=valid_code&state={state} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        s4.write_all(req4.as_bytes()).unwrap();
        let mut resp4 = String::new();
        s4.read_to_string(&mut resp4).unwrap();
        assert!(resp4.contains("200 OK"));
        assert!(resp4.contains("Login berhasil, kembali ke Anchoa"));
    });

    let session = flow.wait(Duration::from_secs(5)).unwrap();
    handle.join().unwrap();
    assert_eq!(session.user_id, fake::FAKE_USER_ID);
}

#[test]
fn oauth_times_out_when_no_callback_received() {
    let server = Arc::new(MemoryServer::default());
    let flow = oauth::begin_with_opener(server, Provider::GitHub, |_| Ok(())).unwrap();
    let err = match flow.wait(Duration::from_millis(100)) {
        Err(e) => e,
        Ok(_) => panic!("Expected timeout error"),
    };
    assert!(err.to_string().contains("timeout") || err.to_string().contains("waktu"));
}

#[test]
fn oauth_fake_server_bypasses_browser() {
    let server = Arc::new(MemoryServer::default());
    server.set_fake_session(true);
    let flow = oauth::begin_with_opener(server, Provider::Google, |_| {
        panic!("Should not invoke opener for fake server");
    }).unwrap();
    let sess = flow.wait(Duration::from_secs(1)).unwrap();
    assert_eq!(sess.user_id, fake::FAKE_USER_ID);
}


/// Delegates to a MemoryServer and runs a local edit while a push is in flight.
struct EditDuringPush<'a> {
    inner: MemoryServer,
    edit: Box<dyn Fn() + Send + Sync + 'a>,
}

impl SyncServer for EditDuringPush<'_> {
    fn authorize_url(&self, provider: Provider, redirect: &str, challenge: &str, state: &str) -> String {
        self.inner.authorize_url(provider, redirect, challenge, state)
    }
    fn exchange_code(&self, code: &str, verifier: &str) -> Result<Session, crate::error::AppError> { self.inner.exchange_code(code, verifier) }
    fn refresh(&self, session: &Session) -> Result<Session, crate::error::AppError> { self.inner.refresh(session) }
    fn sign_out(&self, session: &Session) -> Result<(), crate::error::AppError> { self.inner.sign_out(session) }
    fn get_vault(&self, session: &Session) -> Result<Option<super::server::Vault>, crate::error::AppError> { self.inner.get_vault(session) }
    fn put_vault(&self, session: &Session, vault: &super::server::Vault) -> Result<(), crate::error::AppError> { self.inner.put_vault(session, vault) }
    fn push(&self, session: &Session, rows: &[super::server::WireRecord]) -> Result<Vec<super::server::Rejected>, crate::error::AppError> {
        let result = self.inner.push(session, rows);
        (self.edit)();
        result
    }
    fn pull(&self, session: &Session, after: i64, max: u32) -> Result<Vec<super::server::WireRecord>, crate::error::AppError> { self.inner.pull(session, after, max) }
    fn usage(&self, session: &Session) -> Result<super::server::Usage, crate::error::AppError> { self.inner.usage(session) }
    fn delete_my_data(&self, session: &Session) -> Result<(), crate::error::AppError> { self.inner.delete_my_data(session) }
}

#[test]
fn an_edit_made_while_its_push_is_in_flight_stays_queued_and_syncs_next_time() {
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("p1", "Versi pertama", 100);
    let server = EditDuringPush { inner: MemoryServer::default(), edit: Box::new(|| a.write("p1", "Versi kedua", 200)) };
    a.sync(&server);
    let queued: i64 = a.db.conn().unwrap().query_row("SELECT count(*) FROM sync_outbox WHERE record_id='p1'", [], |r| r.get(0)).unwrap();
    assert_eq!(queued, 1, "the newer local edit must not be dropped with the pushed version");
    let plain = EditDuringPush { inner: server.inner, edit: Box::new(|| {}) };
    a.sync(&plain);
    b.sync(&plain);
    assert_eq!(b.title("p1"), "Versi kedua");
}
