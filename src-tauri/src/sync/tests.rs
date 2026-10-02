use std::{
    io::{Read, Write},
    net::TcpStream,
    sync::Arc,
    time::Duration,
};

use rusqlite::params;

use super::{
    crypto::{self, Dek, Kdf},
    record,
    engine,
    fake::{self, MemoryServer},
    oauth,
    server::{Provider, Session, SyncServer, Vault, WireRecord},
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
        db.conn().unwrap().execute("INSERT INTO sync_state VALUES('vault_fingerprint',?1)", [fingerprint()]).unwrap();
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
    let server = test_server();
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
    let server = test_server();
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
fn quota_stops_push_but_allows_pull_and_idle_refreshes_vault_and_usage() {
    let server = test_server();
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
    // Idle cycles check the vault, refresh usage, and pull.
    let middle = server.call_count();
    a.sync(&server);
    assert_eq!(server.call_count() - middle, 3);
    assert_eq!(middle - before, 3);
}

#[test]
fn offline_preserves_outbox_and_server_calls_never_hold_database() {
    let server = test_server();
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
    let server = test_server();
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
    let server = test_server();
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
    let server = test_server();
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
    let (base, state) = redirect_uri.split_once("/callback?state=").unwrap();
    let addr = base.strip_prefix("http://").unwrap().to_string();
    let state = state.to_string();
    assert!(auth_url.contains(&super::server::percent_encode(&redirect_uri)));
    assert!(!auth_url.contains("&state="));

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
    fn update_vault(&self, session: &Session, vault: &super::server::Vault) -> Result<(), crate::error::AppError> { self.inner.update_vault(session,vault) }
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
    let server = EditDuringPush { inner: test_server(), edit: Box::new(|| a.write("p1", "Versi kedua", 200)) };
    a.sync(&server);
    let queued: i64 = a.db.conn().unwrap().query_row("SELECT count(*) FROM sync_outbox WHERE record_id='p1'", [], |r| r.get(0)).unwrap();
    assert_eq!(queued, 1, "the newer local edit must not be dropped with the pushed version");
    let plain = EditDuringPush { inner: server.inner, edit: Box::new(|| {}) };
    a.sync(&plain);
    b.sync(&plain);
    assert_eq!(b.title("p1"), "Versi kedua");
}

fn test_vault() -> Vault {
    Vault {
        kdf: Kdf { m_kib: 32, t: 1, p: 1, salt: *b"0123456789abcdef" },
        dek_by_passphrase: vec![7; 72],
        dek_by_recovery: vec![8; 72],
    }
}

fn fingerprint() -> String {
    use sha2::Digest;
    super::server::hex_encode(&sha2::Sha256::digest(test_vault().dek_by_passphrase))
}

fn test_server() -> MemoryServer {
    let server = MemoryServer::default();
    server.put_vault(&session(), &test_vault()).unwrap();
    server
}

fn state(client: &Client, key: &str) -> String {
    client.db.conn().unwrap().query_row("SELECT value FROM sync_state WHERE key=?1", [key], |r| r.get(0)).unwrap()
}

fn set_state(client: &Client, key: &str, value: &str) {
    client.db.conn().unwrap().execute("INSERT INTO sync_state VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value]).unwrap();
}

fn version(client: &Client, id: &str) -> String {
    client.db.conn().unwrap().query_row("SELECT version FROM sync_versions WHERE record_id=?1", [id], |r| r.get(0)).unwrap()
}

fn queue_pending(client: &Client, source: &Client, id: &str, ts: i64) {
    let payload = record::export(&source.db.conn().unwrap(), id).unwrap().unwrap().payload.unwrap();
    client.db.conn().unwrap().execute("INSERT INTO sync_pending VALUES(?1,?2,?3)", params![id,engine::format_version(ts,DEVICE_B),payload]).unwrap();
}

#[test]
fn rejected_push_repulls_and_applies_authenticated_winner() {
    let server = Arc::new(test_server());
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("p", "A loses", 8);
    b.write("p", "B wins", 10);
    let racing = server.clone();
    server.set_before_push(move || { b.sync(racing.as_ref()); });
    let report = a.sync(server.as_ref());
    assert_eq!(report.pushed, 0);
    assert_eq!(a.title("p"), "B wins");
    assert_eq!(version(&a, "p"), engine::format_version(10, DEVICE_B));
}

#[test]
fn oversized_exports_warn_per_record_and_continue_sync() {
    use sha2::Digest;
    let noise: String = (0_u64..12_000).map(|i| super::server::hex_encode(&sha2::Sha256::digest(i.to_le_bytes()))).collect();
    for body in [noise, "x".repeat(record::MAX_DECOMPRESSED_BYTES + 1)] {
        let server = test_server();
        let a = Client::new(DEVICE_A);
        let b = Client::new(DEVICE_B);
        a.write("large", "Halaman terlalu besar", 1);
        a.db.conn().unwrap().execute("UPDATE items SET body=?1 WHERE id='large'", [body]).unwrap();
        a.db.conn().unwrap().execute("UPDATE sync_outbox SET changed_at=1 WHERE record_id='large'", []).unwrap();
        a.write("small", "Still syncs", 2);
        assert_eq!(a.sync(&server).pushed, 1);
        b.sync(&server);
        assert_eq!(b.title("small"), "Still syncs");
        assert!(b.title_opt("large").is_none());
        let conn = a.db.conn().unwrap();
        let warning: String = conn.query_row("SELECT value FROM sync_state WHERE key='warning:large'", [], |r| r.get(0)).unwrap();
        assert!(warning.contains("Halaman terlalu besar"));
        assert_eq!(conn.query_row("SELECT count(*) FROM sync_outbox", [], |r| r.get::<_,i64>(0)).unwrap(), 1);
    }
}

#[test]
fn pending_older_than_known_version_is_dropped_on_empty_pull() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("p", "Current", 20);
    a.sync(&server);
    a.sync(&server); // consume echo, next pull is empty
    b.write("p", "Old pending", 10);
    queue_pending(&a, &b, "p", 10);
    let report = a.sync(&server);
    assert_eq!(a.title("p"), "Current");
    assert_eq!(report.pending, 0);
    assert_eq!(version(&a, "p"), engine::format_version(20, DEVICE_A));
}

#[test]
fn pending_cannot_overwrite_newer_outbox_or_downgrade_version() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("p", "Local newer", 20);
    b.write("p", "Pending older", 10);
    queue_pending(&a, &b, "p", 10);
    set_state(&a, "quota_bytes", "0");
    a.db.conn().unwrap().execute("INSERT INTO sync_versions VALUES('p',?1)", [engine::format_version(10,DEVICE_B)]).unwrap();
    b.write("other", "A pull triggers retry", 1);
    b.sync(&server);
    let report = a.sync(&server);
    assert_eq!(report.pending, 0);
    assert_eq!(a.title("p"), "Local newer");
    assert_eq!(version(&a,"p"), engine::format_version(10,DEVICE_B));
    assert_eq!(a.db.conn().unwrap().query_row("SELECT changed_at FROM sync_outbox WHERE record_id='p'", [], |r| r.get::<_,i64>(0)).unwrap(), 20);
}

#[test]
fn pending_equal_known_version_retries_after_upgrade_with_empty_pull() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    b.write("p", "Now supported", 10);
    queue_pending(&a, &b, "p", 10);
    a.db.conn().unwrap().execute("INSERT INTO sync_versions VALUES('p',?1)", [engine::format_version(10,DEVICE_B)]).unwrap();
    let report = a.sync(&server);
    assert_eq!(report.pulled, 1);
    assert_eq!(report.pending, 0);
    assert_eq!(a.title("p"), "Now supported");
}

#[test]
fn accepted_push_clears_pending_for_that_record() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    a.write("p", "Accepted", 20);
    let db = a.db.clone();
    server.set_before_push(move || { db.conn().unwrap().execute("INSERT INTO sync_pending VALUES('p','10:old',X'00')", []).unwrap(); });
    let report = a.sync(&server);
    assert_eq!(report.pushed, 1);
    assert_eq!(report.pending, 0);
}

#[test]
fn newer_schema_deferral_keeps_local_outbox_and_warns() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("p", "Old schema", 8);
    b.write("p", "Future content", 10);
    let compressed = record::export(&b.db.conn().unwrap(), "p").unwrap().unwrap().payload.unwrap();
    let mut doc: serde_json::Value = serde_json::from_slice(&miniz_oxide::inflate::decompress_to_vec(&compressed).unwrap()).unwrap();
    doc["schema"] = serde_json::json!(999);
    let plain = miniz_oxide::deflate::compress_to_vec(&serde_json::to_vec(&doc).unwrap(),6);
    let payload = crypto::seal(&Dek::from_bytes([7;32]), &crypto::aad(USER,"p",10,DEVICE_B), &plain);
    server.push(&session(), &[WireRecord { id:"p".into(),changed_at:10,device_id:DEVICE_B.into(),deleted:false,payload:Some(payload),seq:0 }]).unwrap();
    let report = a.sync(&server);
    assert_eq!(report.pending, 1);
    assert_eq!(report.pushed, 0);
    assert_eq!(a.db.conn().unwrap().query_row("SELECT count(*) FROM sync_outbox", [], |r| r.get::<_,i64>(0)).unwrap(), 1);
    assert_eq!(server.pull(&session(),0,500).unwrap()[0].changed_at,10);
}

#[test]
fn pull_compares_effective_outgoing_version_with_slow_local_clock() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    b.write("p", "Base", 100);
    b.sync(&server);
    a.sync(&server);
    a.write("p", "Local clock behind", 1); // effective version is (101,A)
    b.write("p", "Concurrent B", 1); // effective version is (101,B)
    // Make A the tie winner by using B as A's device id and A as B's.
    set_state(&a,"device_id",DEVICE_B);
    set_state(&b,"device_id",DEVICE_A);
    b.sync(&server);
    a.sync(&server);
    b.sync(&server);
    assert_eq!(a.title("p"), "Local clock behind");
    assert_eq!(b.title("p"), "Local clock behind");
}

#[test]
fn vault_missing_or_replaced_stops_before_pull_and_deletes_local_dek() {
    for recreate in [false,true] {
        let server = test_server();
        let a = Client::new(DEVICE_A);
        let b = Client::new(DEVICE_B);
        a.write("p", "Must stay local", 20);
        b.sync(&server);
        server.delete_my_data(&session()).unwrap();
        if recreate {
            let mut replacement = test_vault();
            replacement.dek_by_passphrase[0] ^= 1;
            server.put_vault(&session(),&replacement).unwrap();
        }
        let before = server.call_count();
        let err = engine::sync_once(&a.db,&a.keys,&server,1000).unwrap_err();
        assert_eq!(err.to_string(), "Kunci sync berubah atau dihapus di perangkat lain; buka kunci lagi");
        assert_eq!(server.call_count()-before,1);
        assert!(engine::load_dek(&a.keys,USER).unwrap().is_none());
        assert_eq!(state(&a,"cursor"),"0");
        assert_eq!(server.usage(&session()).unwrap().rows,0);
    }
}

#[test]
fn ninety_day_gap_resets_cursor_for_full_pull_but_zero_does_not() {
    const DAY: i64 = 24*60*60*1000;
    for (last_sync, full) in [(1,true),(0,false),(2*DAY,false)] {
        let server = test_server();
        let a = Client::new(DEVICE_A);
        let b = Client::new(DEVICE_B);
        b.write("p","Remote",10);
        b.sync(&server);
        set_state(&a,"cursor","999");
        set_state(&a,"last_sync_at",&last_sync.to_string());
        let report = engine::sync_once(&a.db,&a.keys,&server,91*DAY).unwrap();
        assert_eq!(report.pulled,usize::from(full));
        assert_eq!(state(&a,"cursor"),if full {"1"} else {"999"});
    }
}

#[test]
fn quota_is_checked_before_each_batch_including_bytes_pushed_this_cycle() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    for i in 0..501 { a.write(&format!("p{i:03}"),"Quota",i+1); }
    let first_batch_bytes: u64 = (0..500).map(|i| record::export(&a.db.conn().unwrap(), &format!("p{i:03}")).unwrap().unwrap().payload.unwrap().len() as u64+40).sum();
    set_state(&a,"quota_bytes", &(first_batch_bytes+1).to_string());
    let report = a.sync(&server);
    assert_eq!(report.pushed,500);
    assert!(report.stopped_by_quota);
    assert_eq!(report.bytes_used,first_batch_bytes);
    assert_eq!(state(&a,"bytes_used"),first_batch_bytes.to_string());
    assert_eq!(server.usage(&session()).unwrap().rows,500);
    let idle = a.sync(&server);
    assert_eq!(idle.bytes_used,first_batch_bytes);
    assert_eq!(idle.pushed,0);
}

#[test]
fn quota_rejects_a_first_batch_that_would_exceed_remaining_space() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    a.write("p","Too much for quota",1);
    set_state(&a,"quota_bytes","1");
    let report = a.sync(&server);
    assert_eq!(report.pushed,0);
    assert!(report.stopped_by_quota);
    assert_eq!(server.usage(&session()).unwrap().rows,0);
}

#[test]
fn concurrent_vault_creation_is_insert_only() {
    let server = MemoryServer::default();
    let barrier = std::sync::Barrier::new(2);
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..2).map(|i| {
            let barrier = &barrier;
            let server = &server;
            scope.spawn(move || {
                let mut vault = test_vault();
                vault.dek_by_passphrase[0] = i;
                barrier.wait();
                (i,server.put_vault(&session(),&vault))
            })
        }).collect();
        let results: Vec<_> = handles.into_iter().map(|t| t.join().unwrap()).collect();
        let winner = results.iter().find(|(_,r)| r.is_ok()).unwrap().0;
        assert_eq!(results.iter().filter(|(_,r)| r.is_ok()).count(),1);
        let err = results.into_iter().find(|(_,r)| r.is_err()).unwrap().1.unwrap_err();
        assert_eq!(err.to_string(),"Kunci sync sudah dibuat dari perangkat lain; buka dengan frasa sandi atau recovery key");
        assert_eq!(server.get_vault(&session()).unwrap().unwrap().dek_by_passphrase[0],winner);
    });
}

#[test]
fn oauth_error_callback_fails_immediately() {
    let server = Arc::new(MemoryServer::default());
    let flow = oauth::begin_with_opener(server,Provider::Google,|_| Ok(())).unwrap();
    let (base,state) = flow.redirect_uri().split_once("/callback?state=").unwrap();
    let addr = base.strip_prefix("http://").unwrap().to_owned();
    let request = format!("GET /callback?state={state}&error=access_denied&error_description=User+denied HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    let sender = std::thread::spawn(move || {
        let mut stream = TcpStream::connect(addr).unwrap();
        stream.write_all(request.as_bytes()).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
    });
    let start = std::time::Instant::now();
    let err = flow.wait(Duration::from_secs(2)).err().unwrap();
    sender.join().unwrap();
    assert!(matches!(err, crate::error::AppError::Invalid(ref m) if m.contains("Login sync gagal")));
    assert!(start.elapsed()<Duration::from_secs(1));
}

#[test]
fn oauth_opener_failure_returns_immediately() {
    let start = std::time::Instant::now();
    let result = oauth::begin_with_opener(Arc::new(MemoryServer::default()),Provider::Google,|_| Err(crate::error::AppError::Other("Browser tidak dapat dibuka".into())));
    assert!(matches!(result, Err(crate::error::AppError::Other(m)) if m.contains("Browser")));
    assert!(start.elapsed()<Duration::from_secs(1));
}

#[test]
fn rejection_metadata_cannot_clear_outbox_or_record_an_unauthenticated_version() {
    let server = Arc::new(test_server());
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("p","Local survives unauthenticated winner",8);
    b.write("p","Remote",10);
    let racing = server.clone();
    server.set_before_push(move || {
        b.sync(racing.as_ref());
        racing.tamper(|rows|rows[0].payload.as_mut().unwrap()[0] ^= 1);
    });
    a.sync(server.as_ref());
    assert_eq!(a.title("p"),"Local survives unauthenticated winner");
    let conn = a.db.conn().unwrap();
    assert_eq!(conn.query_row("SELECT changed_at FROM sync_outbox WHERE record_id='p'",[],|r|r.get::<_,i64>(0)).unwrap(),8);
    assert_eq!(conn.query_row("SELECT count(*) FROM sync_versions WHERE record_id='p'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
}

#[cfg(debug_assertions)]
#[test]
fn file_server_vault_create_and_update_match_memory_server() {
    let dir = tempfile::tempdir_in(".").unwrap();
    let server = fake::FileServer::open(&dir.path().join("cloud.db")).unwrap();
    let other = fake::FileServer::open(&dir.path().join("cloud.db")).unwrap();
    let vault = test_vault();
    server.put_vault(&session(),&vault).unwrap();
    let mut updated = test_vault();
    updated.dek_by_passphrase[0] = 9;
    assert!(matches!(other.put_vault(&session(),&updated),Err(crate::error::AppError::Invalid(_))));
    assert_eq!(other.get_vault(&session()).unwrap().unwrap().dek_by_passphrase[0],7);
    other.update_vault(&session(),&updated).unwrap();
    assert_eq!(server.get_vault(&session()).unwrap().unwrap().dek_by_passphrase[0],9);
    other.delete_my_data(&session()).unwrap();
    server.update_vault(&session(),&vault).unwrap();
    assert!(server.get_vault(&session()).unwrap().is_none());
}

fn outbox_count(client: &Client) -> i64 {
    client
        .db
        .conn()
        .unwrap()
        .query_row("SELECT count(*) FROM sync_outbox", [], |r| r.get(0))
        .unwrap()
}

fn push_document(
    server: &MemoryServer,
    source: &Client,
    id: &str,
    ts: i64,
    change: impl FnOnce(&mut serde_json::Value),
) {
    let compressed = record::export(&source.db.conn().unwrap(), id)
        .unwrap()
        .unwrap()
        .payload
        .unwrap();
    let mut doc =
        serde_json::from_slice(&miniz_oxide::inflate::decompress_to_vec(&compressed).unwrap())
            .unwrap();
    change(&mut doc);
    let plain = miniz_oxide::deflate::compress_to_vec(&serde_json::to_vec(&doc).unwrap(), 6);
    let payload = crypto::seal(
        &Dek::from_bytes([7; 32]),
        &crypto::aad(USER, id, ts, DEVICE_B),
        &plain,
    );
    server
        .push(
            &session(),
            &[WireRecord {
                id: id.into(),
                changed_at: ts,
                device_id: DEVICE_B.into(),
                deleted: false,
                payload: Some(payload),
                seq: 0,
            }],
        )
        .unwrap();
}

#[test]
fn lost_push_response_is_acknowledged_by_authenticated_echo_without_another_push() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    b.write("p", "Base", 100);
    b.sync(&server);
    a.sync(&server);
    a.write("p", "Lost response", 1); // effective outgoing version is 101
    server.lose_next_push_response();
    assert!(engine::sync_once(&a.db, &a.keys, &server, 1000).is_err());
    assert_eq!(outbox_count(&a), 1);
    let pushes = server.push_count();
    assert_eq!(a.sync(&server).pushed, 0);
    assert_eq!(server.push_count(), pushes);
    assert_eq!(outbox_count(&a), 0);
    assert_eq!(version(&a, "p"), engine::format_version(101, DEVICE_A));
    b.sync(&server);
    assert_eq!(b.title("p"), "Lost response");
}

#[test]
fn lost_push_echo_preserves_a_newer_local_edit() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("p", "First", 100);
    server.lose_next_push_response();
    assert!(engine::sync_once(&a.db, &a.keys, &server, 1000).is_err());
    a.write("p", "Second", 200);
    assert_eq!(a.sync(&server).pushed, 1);
    b.sync(&server);
    assert_eq!(b.title("p"), "Second");
}

#[test]
fn authenticated_apply_failure_records_version_so_local_outbox_can_advance() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("p", "Local", 100);
    b.write("p", "Invalid remote", 150);
    push_document(&server, &b, "p", 150, |doc| {
        doc["item"]["id"] = serde_json::json!("wrong-id")
    });
    set_state(&a, "quota_bytes", "0");
    a.sync(&server);
    assert_eq!(a.title("p"), "Local");
    assert_eq!(version(&a, "p"), engine::format_version(150, DEVICE_B));
    assert_eq!(outbox_count(&a), 1);
    assert!(!state(&a, "warning:p").is_empty());
    set_state(
        &a,
        "quota_bytes",
        &super::server::DEFAULT_QUOTA_BYTES.to_string(),
    );
    assert_eq!(a.sync(&server).pushed, 1);
    b.sync(&server);
    assert_eq!(b.title("p"), "Local");
    assert_eq!(version(&a, "p"), engine::format_version(151, DEVICE_A));
}

#[test]
fn oversized_local_edit_keeps_precedence_over_delayed_remote_edit() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("p", "Large local", 200);
    a.db.conn()
        .unwrap()
        .execute(
            "UPDATE items SET body=?1 WHERE id='p'",
            ["x".repeat(record::MAX_DECOMPRESSED_BYTES + 1)],
        )
        .unwrap();
    a.db.conn()
        .unwrap()
        .execute(
            "UPDATE sync_outbox SET changed_at=200 WHERE record_id='p'",
            [],
        )
        .unwrap();
    a.sync(&server);
    b.write("p", "Delayed remote", 150);
    b.sync(&server);
    a.sync(&server);
    assert_eq!(a.title("p"), "Large local");
    assert_eq!(outbox_count(&a), 1);
}

#[test]
fn a_full_batch_of_oversized_records_does_not_block_the_next_record() {
    use sha2::Digest;
    let server = test_server();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    let body: String = (0_u64..9_000)
        .map(|i| super::server::hex_encode(&sha2::Sha256::digest(i.to_le_bytes())))
        .collect();
    {
        let mut conn = a.db.conn().unwrap();
        let tx = conn.transaction().unwrap();
        for i in 0..500 {
            tx.execute("INSERT INTO items(id,type,title,body,created_at,updated_at) VALUES(?1,'page','Large',?2,1,1)",params![format!("large{i:03}"),body]).unwrap();
        }
        tx.execute("UPDATE sync_outbox SET changed_at=1", [])
            .unwrap();
        tx.commit().unwrap();
    }
    a.write("small", "Beyond skipped batch", 2);
    assert_eq!(a.sync(&server).pushed, 1);
    assert_eq!(outbox_count(&a), 500);
    b.sync(&server);
    assert_eq!(b.title("small"), "Beyond skipped batch");
}

#[test]
fn newer_schema_pending_survives_edits_and_resolves_by_lww_after_upgrade() {
    for (local_ts, local_device) in [
        (90, DEVICE_A),
        (100, DEVICE_A),
        (100, "00000000-0000-0000-0000-00000000000c"),
        (110, DEVICE_A),
    ] {
        let server = test_server();
        let a = Client::new(local_device);
        let b = Client::new(DEVICE_B);
        a.write("p", "Old local", 80);
        b.write("p", "Future content", 100);
        push_document(&server, &b, "p", 100, |doc| {
            doc["schema"] = serde_json::json!(13)
        });
        assert_eq!(a.sync(&server).pending, 1);
        a.write("p", "Local edit while deferred", local_ts);
        a.write("other", "Unblocked", 200);
        let report = a.sync(&server);
        assert_eq!(report.pending, 1);
        assert_eq!(report.pushed, 1);
        assert_eq!(outbox_count(&a), 1);
        assert_eq!(
            state(&a, "warning:p"),
            "Perbarui Anchoa untuk menyinkronkan Local edit while deferred"
        );
        assert_eq!(server.pull(&session(), 0, 500).unwrap()[0].changed_at, 100);
        a.db.conn()
            .unwrap()
            .pragma_update(None, "user_version", 13)
            .unwrap();
        let report = a.sync(&server);
        assert_eq!(report.pending, 0);
        let expected = if (local_ts, local_device) < (100, DEVICE_B) {
            "Future content"
        } else {
            "Local edit while deferred"
        };
        assert_eq!(a.title("p"), expected);
        b.db.conn()
            .unwrap()
            .pragma_update(None, "user_version", 13)
            .unwrap();
        b.sync(&server);
        assert_eq!(b.title("p"), expected);
    }
}

#[test]
fn vault_replaced_or_deleted_after_pull_stops_the_push_and_removes_dek() {
    for recreate in [false, true] {
        let server = Arc::new(test_server());
        let a = Client::new(DEVICE_A);
        let b = Client::new(DEVICE_B);
        a.write("p", "Must stay local", 100);
        let other = server.clone();
        server.set_after_pull(move || {
            b.sync(other.as_ref());
            other.delete_my_data(&session()).unwrap();
            if recreate {
                let mut vault = test_vault();
                vault.dek_by_passphrase[0] ^= 1;
                other.put_vault(&session(), &vault).unwrap();
            }
        });
        let err = engine::sync_once(&a.db, &a.keys, server.as_ref(), 1000).unwrap_err();
        assert_eq!(
            err.to_string(),
            "Kunci sync berubah atau dihapus di perangkat lain; buka kunci lagi"
        );
        assert_eq!(server.push_count(), 0);
        assert_eq!(outbox_count(&a), 1);
        assert!(engine::load_dek(&a.keys, USER).unwrap().is_none());
        assert_eq!(state(&a, "last_error"), err.to_string());
    }
}

#[test]
fn expired_access_token_is_refreshed_once_and_the_data_call_retried() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("p", "After refresh", 100);
    server.expire_access_token("secret-access");
    assert_eq!(a.sync(&server).pushed, 1);
    assert_eq!(server.refresh_count(), 1);
    assert_eq!(
        Session::load(&a.keys, USER).unwrap().unwrap().access_token,
        "fake-access"
    );
    b.sync(&server);
    assert_eq!(b.title("p"), "After refresh");
    assert_eq!(server.refresh_count(), 2);
}

#[test]
fn access_token_expiring_within_sixty_seconds_is_refreshed_proactively() {
    for expires_at in [60_999, 61_000, 61_001] {
        let server = test_server();
        let a = Client::new(DEVICE_A);
        let b = Client::new(DEVICE_B);
        let mut expiring = session();
        expiring.expires_at = expires_at;
        expiring.store(&a.keys).unwrap();
        a.write("p", "Refresh boundary", 100);
        a.sync(&server);
        assert_eq!(server.refresh_count(), usize::from(expires_at <= 61_000));
        b.sync(&server);
        assert_eq!(b.title("p"), "Refresh boundary");
    }
}

#[test]
fn tampered_lost_push_echo_cannot_acknowledge_the_outbox() {
    let server = test_server();
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    a.write("p", "Unauthenticated echo", 100);
    server.lose_next_push_response();
    assert!(engine::sync_once(&a.db, &a.keys, &server, 1000).is_err());
    server.tamper(|rows| rows[0].payload.as_mut().unwrap()[0] ^= 1);
    a.sync(&server);
    assert_eq!(outbox_count(&a), 1);
    b.sync(&server);
    assert!(b.title_opt("p").is_none());
    assert_eq!(
        a.db.conn()
            .unwrap()
            .query_row("SELECT count(*) FROM sync_versions", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn vault_is_rechecked_before_the_second_push_batch() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let server = Arc::new(test_server());
    let a = Client::new(DEVICE_A);
    let b = Client::new(DEVICE_B);
    for i in 0..501 {
        a.write(&format!("p{i:03}"), "Queued", i + 1);
    }
    let calls = AtomicUsize::new(0);
    let other = Arc::downgrade(&server);
    server.set_hook(Arc::new(move || {
        // Initial vault, usage, pull, first batch's vault, push, second vault.
        if calls.fetch_add(1, Ordering::SeqCst) == 5 {
            let other = other.upgrade().unwrap();
            b.sync(other.as_ref());
            other.delete_my_data(&session()).unwrap();
            let mut vault = test_vault();
            vault.dek_by_passphrase[0] ^= 1;
            other.put_vault(&session(), &vault).unwrap();
        }
    }));
    assert!(engine::sync_once(&a.db, &a.keys, server.as_ref(), 1000).is_err());
    assert_eq!(server.push_count(), 1);
    assert_eq!(outbox_count(&a), 1);
    assert!(engine::load_dek(&a.keys, USER).unwrap().is_none());
}
