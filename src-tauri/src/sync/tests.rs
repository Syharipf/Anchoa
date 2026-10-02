use std::sync::Arc;

use rusqlite::params;

use super::{crypto::Dek, engine, fake::MemoryServer, server::{Session, SyncServer}};
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

    fn title(&self, id: &str) -> String {
        self.db.conn().unwrap().query_row("SELECT title FROM items WHERE id=?1", [id], |r| r.get(0)).unwrap()
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
