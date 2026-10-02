use std::sync::{Arc, atomic::Ordering};

use super::*;
use account::{AppPassword, Credentials, KeyringStore};
use client::{Header, MailClient};
use fake::FakeMailClient;

const ADDRESS: &str = "anchoa@gmail.com";
const PASSWORD: &str = "abcdefghijklmnop";

#[test]
fn credential_transport_logs_are_disabled_at_every_level() {
    for target in [
        "async_imap",
        "async_imap::imap_stream",
        "lettre::transport::smtp",
        "keyring",
        "keyring::mock",
        "secret_service",
    ] {
        assert!(!allows_log_target(target));
    }
    assert!(allows_log_target("anchoa_lib::email"));
    assert!(allows_log_target("keyring_status"));
}

struct Fixture {
    _dir: tempfile::TempDir,
    db: Arc<Db>,
    keys: KeyringStore,
    client: FakeMailClient,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(Db::open_at(dir.path().join("test.db")));
        Self {
            _dir: dir,
            db,
            keys: KeyringStore::with_builder(keyring::mock::default_credential_builder()),
            client: FakeMailClient::empty(),
        }
    }

    fn connect(&self) {
        account::connect(&self.db, &self.keys, ADDRESS, PASSWORD, &self.client).unwrap();
    }

    fn seed(&self, uid: u32) {
        self.client
            .insert(
                INBOX,
                header(uid),
                b"Content-Type: text/plain; charset=utf-8\r\n\r\nHalo Indonesia".to_vec(),
            )
            .unwrap();
    }
}

fn header(uid: u32) -> Header {
    Header {
        uid,
        subject: format!("Pesan {uid}"),
        message_id: Some(format!("msg{uid}@example.com")),
        from_name: "Siti".into(),
        from_addr: "siti@example.com".into(),
        to_addrs: vec![ADDRESS.into()],
        sent_at: i64::from(uid) * 1000,
        unread: true,
        starred: false,
        has_html: false,
        refs: vec!["root@example.com".into()],
    }
}

#[test]
fn deleted_emails_leave_every_folder_filter_and_reject_actions_before_network_calls() {
    let f = Fixture::new();
    let mut h = header(1);
    h.starred = true;
    f.client.insert(INBOX, h.clone(), b"Content-Type: text/plain\r\n\r\nHalo".to_vec()).unwrap();
    f.client.insert(SENT, h, b"Content-Type: text/plain\r\n\r\nHalo".to_vec()).unwrap();
    sync::sync(&f.db, &f.client).unwrap();
    let id = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap()[0].id.clone();
    f.db.conn().unwrap().execute("UPDATE items SET deleted_at = 123 WHERE type = 'email'", []).unwrap();
    for folder in [Folder::Inbox, Folder::Sent, Folder::Starred] {
        for filter in [Filter::All, Filter::Unread] {
            assert!(list(&f.db, folder, filter, 200).unwrap().is_empty());
        }
    }
    f.client.set_hook(Arc::new(|| panic!("Deleted email must be rejected before calling the client"))).unwrap();
    assert!(matches!(get(&f.db.conn().unwrap(), &id), Err(AppError::NotFound)));
    assert!(matches!(actions::open(&f.db, &f.client, &id), Err(AppError::NotFound)));
    assert!(matches!(actions::set_flag(&f.db, &f.client, &id, Flag::Starred, false), Err(AppError::NotFound)));
    assert!(matches!(actions::archive(&f.db, &f.client, &id), Err(AppError::NotFound)));
}

#[test]
fn invalid_drafts_return_app_errors_without_sending_mail() {
    let f = Fixture::new();
    let draft = Draft { to: vec!["siti@example.com".into()], subject: "Halo".into(), body: "Terima kasih".into(), reply_to_id: None };
    for bad in [
        Draft { to: vec![], ..draft.clone() },
        Draft { to: vec!["invalid-address".into()], ..draft.clone() },
        Draft { to: vec!["siti@example.com\r\nBcc: evil@example.com".into()], ..draft.clone() },
        Draft { subject: "Halo\r\nBcc: evil@example.com".into(), ..draft.clone() },
        Draft { subject: "Halo\0".into(), ..draft.clone() },
    ] {
        assert!(matches!(send::send(&f.db, &f.client, ADDRESS, &bad), Err(AppError::Invalid(_))));
    }
    assert!(matches!(send::send(&f.db, &f.client, ADDRESS, &Draft { body: " \n ".into(), ..draft.clone() }), Err(AppError::Empty)));
    assert!(matches!(send::send(&f.db, &f.client, ADDRESS, &Draft { reply_to_id: Some("missing".into()), ..draft }), Err(AppError::NotFound)));
    assert!(f.client.sent().unwrap().is_empty());
}

#[test]
fn validates_address_and_app_password() {
    let f = Fixture::new();
    for address in [
        "",
        "invalid",
        "a@gmail.com\r\nBcc: evil@example.com",
        "Name <a@gmail.com>",
    ] {
        assert!(account::connect(&f.db, &f.keys, address, PASSWORD, &f.client).is_err());
    }
    for password in [
        "",
        "short",
        "abcdefghijklmnopq",
        "abcdefghijklmno1",
        "abcdefghijklmnø",
    ] {
        assert!(account::connect(&f.db, &f.keys, ADDRESS, password, &f.client).is_err());
    }
    account::connect(
        &f.db,
        &f.keys,
        " ANCHOA@gmail.com ",
        "abcd efgh ijkl mnop",
        &f.client,
    )
    .unwrap();
    assert_eq!(
        account::status(&f.db).unwrap().address.as_deref(),
        Some(ADDRESS)
    );
    assert_eq!(f.keys.get(ADDRESS).unwrap().as_str(), PASSWORD);
}

#[test]
fn wrong_credentials_are_not_saved() {
    let f = Fixture::new();
    f.client.reject_login(true).unwrap();
    assert!(account::connect(&f.db, &f.keys, ADDRESS, PASSWORD, &f.client).is_err());
    assert!(!account::status(&f.db).unwrap().connected);
    assert!(f.keys.get(ADDRESS).is_err());
}

#[test]
fn disconnect_deletes_credentials_address_and_soft_deletes_email() {
    let f = Fixture::new();
    f.connect();
    f.seed(1);
    sync::sync(&f.db, &f.client).unwrap();
    let id = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap()[0]
        .id
        .clone();
    account::disconnect(&f.db, &f.keys).unwrap();
    assert!(!account::status(&f.db).unwrap().connected);
    assert!(f.keys.get(ADDRESS).is_err());
    assert!(
        list(&f.db, Folder::Inbox, Filter::All, 200)
            .unwrap()
            .is_empty()
    );
    assert!(get(&f.db.conn().unwrap(), &id).is_err());
    assert_eq!(
        f.db.conn()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM items WHERE type = 'email' AND deleted_at IS NOT NULL",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert_eq!(
        f.db.conn()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM emails", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    account::disconnect(&f.db, &f.keys).unwrap();
}

#[test]
fn account_changes_restore_keyring_on_database_failure() {
    let f = Fixture::new();
    f.db.conn().unwrap().execute_batch("CREATE TRIGGER reject_connect BEFORE INSERT ON settings BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(account::connect(&f.db, &f.keys, ADDRESS, PASSWORD, &f.client).is_err());
    assert!(f.keys.get(ADDRESS).is_err());
    assert!(!account::status(&f.db).unwrap().connected);
    f.db.conn()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_connect;")
        .unwrap();
    f.connect();
    f.db.conn().unwrap().execute_batch("CREATE TRIGGER reject_update BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(account::connect(&f.db, &f.keys, ADDRESS, "ponmlkjihgfedcba", &f.client).is_err());
    assert_eq!(f.keys.get(ADDRESS).unwrap().as_str(), PASSWORD);
    f.db.conn().unwrap().execute_batch("CREATE TRIGGER reject_disconnect BEFORE DELETE ON settings BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(account::disconnect(&f.db, &f.keys).is_err());
    assert_eq!(f.keys.get(ADDRESS).unwrap().as_str(), PASSWORD);
    assert!(account::status(&f.db).unwrap().connected);
}

#[test]
fn keyring_failures_are_redacted_and_do_not_save_the_account() {
    let f = Fixture::new();
    let entry = f.keys.entry_for_test(ADDRESS);
    entry
        .get_credential()
        .downcast_ref::<keyring::mock::MockCredential>()
        .unwrap()
        .set_error(keyring::Error::Invalid("secret".into(), PASSWORD.into()));
    let error = account::connect(&f.db, &f.keys, ADDRESS, PASSWORD, &f.client).unwrap_err();
    assert!(!format!("{error:?} {error}").contains(PASSWORD));
    assert!(!account::status(&f.db).unwrap().connected);
    assert!(f.keys.get(ADDRESS).is_err());
}

#[test]
fn password_never_appears_in_debug_errors_or_database() {
    let f = Fixture::new();
    let creds = Credentials::new(ADDRESS, PASSWORD).unwrap();
    assert!(!format!("{creds:?}").contains(PASSWORD));
    assert!(!format!("{:?}", AppPassword::parse(PASSWORD).unwrap()).contains(PASSWORD));
    f.client.reject_login(true).unwrap();
    let error = account::connect(&f.db, &f.keys, ADDRESS, PASSWORD, &f.client).unwrap_err();
    for output in [
        error.to_string(),
        format!("{error:?}"),
        serde_json::to_string(&error).unwrap(),
    ] {
        assert!(!output.contains(PASSWORD));
    }
    f.client.reject_login(false).unwrap();
    f.connect();
    let values: Vec<String> =
        f.db.conn()
            .unwrap()
            .prepare("SELECT value FROM settings")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
    assert!(!values.join(" ").contains(PASSWORD));
    let entry = f.keys.entry_for_test(ADDRESS);
    let mock = entry
        .get_credential()
        .downcast_ref::<keyring::mock::MockCredential>()
        .unwrap();
    mock.set_error(keyring::Error::Invalid("password".into(), PASSWORD.into()));
    let error = f.keys.get(ADDRESS).unwrap_err();
    assert!(!format!("{error:?} {error}").contains(PASSWORD));
}

#[test]
fn initial_sync_inserts_headers_as_searchable_email_items() {
    let f = Fixture::new();
    f.seed(1);
    f.seed(2);
    sync::sync(&f.db, &f.client).unwrap();
    let rows = list(&f.db, Folder::Inbox, Filter::Unread, 200).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].subject, "Pesan 2");
    assert!(
        rows.iter()
            .all(|e| uuid::Uuid::parse_str(&e.id).unwrap().get_version_num() == 7)
    );
    assert_eq!(
        f.db.conn()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'Pesan'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
}

#[test]
fn repeated_sync_updates_headers_and_soft_deletes_missing_messages() {
    let f = Fixture::new();
    f.seed(1);
    f.seed(2);
    sync::sync(&f.db, &f.client).unwrap();
    let original = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap();
    let mut changed = header(1);
    changed.subject = "Subjek diperbarui".into();
    changed.unread = false;
    changed.starred = true;
    f.client.insert(INBOX, changed, Vec::new()).unwrap();
    f.client.remove(INBOX, 2).unwrap();
    sync::sync(&f.db, &f.client).unwrap();
    let rows = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, original[1].id);
    assert_eq!(rows[0].subject, "Pesan 1");
    assert!(!rows[0].unread);
    assert!(rows[0].starred);
    assert!(get(&f.db.conn().unwrap(), &original[0].id).is_err());
}

#[test]
fn sync_preserves_messages_outside_the_latest_200_and_resets_reused_uids() {
    let f = Fixture::new();
    f.seed(1);
    sync::sync(&f.db, &f.client).unwrap();
    let first = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap()[0]
        .id
        .clone();
    for uid in 2..=202 {
        f.seed(uid);
    }
    sync::sync(&f.db, &f.client).unwrap();
    assert!(get(&f.db.conn().unwrap(), &first).is_ok());
    assert_eq!(
        f.db.conn()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM items WHERE type = 'email' AND deleted_at IS NULL",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        201
    );
    actions::open(&f.db, &f.client, &first).unwrap();
    f.client.reset_mailbox(INBOX, 2).unwrap();
    f.seed(1);
    sync::sync(&f.db, &f.client).unwrap();
    let rows = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap();
    assert_eq!(rows.len(), 1);
    assert_ne!(rows[0].id, first);
    assert!(!rows[0].body_cached);
}

#[test]
fn actions_reject_reused_uids_before_the_next_sync() {
    for (folder, view) in [
        (INBOX, Folder::Inbox),
        (SENT, Folder::Sent),
        (ALL_MAIL, Folder::Starred),
    ] {
        for cached in [false, true] {
            let f = Fixture::new();
            f.client.reset_mailbox(folder, 7).unwrap();
            let mut h = header(1);
            h.starred = true;
            f.client
                .insert(
                    folder,
                    h,
                    b"Content-Type: text/plain\r\n\r\nOriginal".to_vec(),
                )
                .unwrap();
            sync::sync(&f.db, &f.client).unwrap();
            let id = list(&f.db, view, Filter::All, 200).unwrap()[0].id.clone();
            if cached {
                actions::open(&f.db, &f.client, &id).unwrap();
            }
            let before = get(&f.db.conn().unwrap(), &id).unwrap();
            f.client.reset_mailbox(folder, 8).unwrap();
            let mut replacement = header(1);
            replacement.message_id = Some("replacement@example.com".into());
            replacement.starred = true;
            f.client
                .insert(
                    folder,
                    replacement,
                    b"Content-Type: text/plain\r\n\r\nReplacement".to_vec(),
                )
                .unwrap();
            if !cached {
                assert_eq!(
                    actions::open(&f.db, &f.client, &id).map(|_| ()).unwrap_err().to_string(),
                    client::MailError::Missing.to_string()
                );
            }
            for result in [
                actions::set_flag(&f.db, &f.client, &id, Flag::Seen, true),
                actions::set_flag(&f.db, &f.client, &id, Flag::Starred, false),
                actions::archive(&f.db, &f.client, &id),
            ] {
                assert_eq!(
                    result.unwrap_err().to_string(),
                    client::MailError::Missing.to_string()
                );
            }
            let after = get(&f.db.conn().unwrap(), &id).unwrap();
            assert_eq!(
                (after.body, after.body_cached, after.unread, after.starred),
                (
                    before.body,
                    before.body_cached,
                    before.unread,
                    before.starred
                )
            );
            assert_eq!(f.client.body_fetches().unwrap(), usize::from(cached));
            let batch = f.client.list_headers(folder, 200).unwrap();
            assert_eq!(batch.headers.len(), 1);
            assert!(batch.headers[0].unread && batch.headers[0].starred);
            sync::sync(&f.db, &f.client).unwrap();
            let replacement = list(&f.db, view, Filter::All, 200).unwrap()[0].id.clone();
            assert_eq!(
                actions::open(&f.db, &f.client, &replacement).unwrap().body,
                "Replacement"
            );
        }
    }
}

#[test]
fn mime_prefers_plain_text_and_converts_html_to_text() {
    let raw = b"MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nPlain wins\r\n--x\r\nContent-Type: text/html\r\n\r\n<b>HTML loses</b>\r\n--x--\r\n";
    let parsed = body::parse(raw).unwrap();
    assert_eq!(parsed.text.trim(), "Plain wins");
    assert!(parsed.has_html);
    let parsed = body::parse(b"Content-Type: text/html; charset=utf-8\r\n\r\n<style>hide</style><script>evil()</script><p>Halo &amp; selamat</p><p>&#233; &#x1F41F;</p><img src='https://tracker'><a href='https://example.com'>Tautan</a>").unwrap();
    assert!(parsed.text.contains("Halo & selamat"));
    assert!(parsed.text.contains("é 🐟"));
    assert!(parsed.text.contains("https://example.com"));
    for forbidden in ["<p>", "<img", "tracker", "evil()", "hide"] {
        assert!(!parsed.text.contains(forbidden));
    }
}

#[test]
fn decodes_indonesian_characters_and_encoded_word_headers() {
    let raw = b"From: =?UTF-8?Q?Siti_=C3=A9?= <siti@example.com>\r\nTo: anchoa@gmail.com\r\nSubject: =?UTF-8?Q?Selamat_pagi_=E2=80=94_Indonesia?=\r\nDate: Fri, 02 Oct 2026 09:00:00 +0700\r\nMessage-ID: <m@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nTerima kasih, biaya Rp50.000 =E2=80=94 sudah lunas.";
    assert_eq!(
        body::parse(raw).unwrap().text,
        "Terima kasih, biaya Rp50.000 — sudah lunas."
    );
    let h = client::parse_header(7, raw, true, false, false).unwrap();
    assert_eq!(h.from_name, "Siti é");
    assert_eq!(h.subject, "Selamat pagi — Indonesia");
    assert_eq!(h.message_id.as_deref(), Some("m@example.com"));
    assert_eq!(
        h.sent_at,
        "2026-10-02T02:00:00Z"
            .parse::<jiff::Timestamp>()
            .unwrap()
            .as_millisecond()
    );
}

#[test]
fn open_caches_even_empty_bodies_and_marks_read() {
    let f = Fixture::new();
    f.seed(1);
    f.client
        .insert(
            INBOX,
            header(2),
            b"Content-Type: text/plain\r\n\r\n".to_vec(),
        )
        .unwrap();
    sync::sync(&f.db, &f.client).unwrap();
    for row in list(&f.db, Folder::Inbox, Filter::All, 200).unwrap() {
        let opened = actions::open(&f.db, &f.client, &row.id).unwrap();
        assert!(!opened.unread);
        assert!(opened.body_cached);
        actions::open(&f.db, &f.client, &row.id).unwrap();
    }
    assert_eq!(f.client.body_fetches().unwrap(), 2);
    assert!(
        list(&f.db, Folder::Inbox, Filter::Unread, 200)
            .unwrap()
            .is_empty()
    );
    sync::sync(&f.db, &f.client).unwrap();
    assert!(
        list(&f.db, Folder::Inbox, Filter::All, 200)
            .unwrap()
            .iter()
            .all(|e| e.body_cached)
    );
}

#[test]
fn flags_and_archive_reach_the_fake_client() {
    let f = Fixture::new();
    f.seed(1);
    sync::sync(&f.db, &f.client).unwrap();
    let id = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap()[0]
        .id
        .clone();
    actions::set_flag(&f.db, &f.client, &id, Flag::Starred, true).unwrap();
    assert!(f.client.list_headers(INBOX, 200).unwrap().headers[0].starred);
    actions::set_flag(&f.db, &f.client, &id, Flag::Seen, true).unwrap();
    assert!(!f.client.list_headers(INBOX, 200).unwrap().headers[0].unread);
    actions::archive(&f.db, &f.client, &id).unwrap();
    assert!(
        f.client
            .list_headers(INBOX, 200)
            .unwrap()
            .headers
            .is_empty()
    );
    assert_eq!(
        f.client.list_headers(ALL_MAIL, 200).unwrap().headers.len(),
        1
    );
    assert!(
        list(&f.db, Folder::Inbox, Filter::All, 200)
            .unwrap()
            .is_empty()
    );
    sync::sync(&f.db, &f.client).unwrap();
    assert_eq!(
        list(&f.db, Folder::Starred, Filter::All, 200)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn flags_and_archive_do_not_affect_distinct_messages_with_the_same_message_id() {
    for (from_addr, sent_at) in [("other@example.com", 1000), ("siti@example.com", 2000)] {
        let f = Fixture::new();
        let mut original = header(1);
        original.starred = true;
        let mut distinct = original.clone();
        distinct.uid = 2;
        distinct.from_addr = from_addr.into();
        distinct.sent_at = sent_at;
        f.client.insert(INBOX, original, Vec::new()).unwrap();
        f.client.insert(INBOX, distinct, Vec::new()).unwrap();
        sync::sync(&f.db, &f.client).unwrap();
        let inbox = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap();
        let original = inbox.iter().find(|e| e.uid == 1).unwrap();
        let distinct = inbox.iter().find(|e| e.uid == 2).unwrap();
        let all_mail: String =
            f.db.conn()
                .unwrap()
                .query_row(
                    "SELECT item_id FROM emails WHERE folder = ?1 AND uid = 1",
                    [ALL_MAIL],
                    |r| r.get(0),
                )
                .unwrap();
        actions::set_flag(&f.db, &f.client, &all_mail, Flag::Starred, false).unwrap();
        actions::set_flag(&f.db, &f.client, &all_mail, Flag::Seen, true).unwrap();
        let changed = get(&f.db.conn().unwrap(), &original.id).unwrap();
        assert!(!changed.starred && !changed.unread);
        let unchanged = get(&f.db.conn().unwrap(), &distinct.id).unwrap();
        assert!(unchanged.starred && unchanged.unread);
        actions::set_flag(&f.db, &f.client, &all_mail, Flag::Starred, true).unwrap();
        sync::sync(&f.db, &f.client).unwrap();
        let unchanged = get(&f.db.conn().unwrap(), &distinct.id).unwrap();
        assert!(unchanged.starred && unchanged.unread);
        actions::archive(&f.db, &f.client, &all_mail).unwrap();
        assert!(get(&f.db.conn().unwrap(), &original.id).is_err());
        assert!(get(&f.db.conn().unwrap(), &distinct.id).is_ok());
        let remaining = f.client.list_headers(INBOX, 200).unwrap().headers;
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].uid, 2);
    }
}

#[test]
fn starred_includes_newly_starred_inbox_and_sent_messages_before_sync() {
    let f = Fixture::new();
    f.seed(1);
    f.client.insert(SENT, header(2), Vec::new()).unwrap();
    sync::sync(&f.db, &f.client).unwrap();
    let inbox = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap()[0]
        .id
        .clone();
    let sent = list(&f.db, Folder::Sent, Filter::All, 200).unwrap()[0]
        .id
        .clone();
    for id in [&inbox, &sent] {
        actions::set_flag(&f.db, &f.client, id, Flag::Starred, true).unwrap();
    }
    let starred = list(&f.db, Folder::Starred, Filter::All, 200).unwrap();
    assert_eq!(
        starred.iter().map(|e| &e.id).collect::<Vec<_>>(),
        vec![&sent, &inbox]
    );
    assert_eq!(
        list(&f.db, Folder::Starred, Filter::All, 1).unwrap()[0].id,
        sent
    );
    actions::set_flag(&f.db, &f.client, &sent, Flag::Seen, true).unwrap();
    let unread = list(&f.db, Folder::Starred, Filter::Unread, 200).unwrap();
    assert_eq!(unread.len(), 1);
    assert_eq!(unread[0].id, inbox);
    actions::set_flag(&f.db, &f.client, &sent, Flag::Starred, false).unwrap();
    assert_eq!(
        list(&f.db, Folder::Starred, Filter::All, 200)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn starred_deduplicates_message_identity_and_prefers_inbox_then_sent_then_all_mail() {
    let f = Fixture::new();
    let mut original = header(1);
    original.starred = true;
    f.client
        .insert(INBOX, original.clone(), Vec::new())
        .unwrap();
    let mut sent_copy = original.clone();
    sent_copy.uid = 10;
    f.client.insert(SENT, sent_copy, Vec::new()).unwrap();
    for folder in [SENT, ALL_MAIL] {
        let mut h = header(2);
        h.starred = true;
        f.client.insert(folder, h, Vec::new()).unwrap();
    }
    for uid in 3..=7 {
        let mut h = header(uid);
        h.starred = true;
        if uid == 4 || uid == 5 {
            h.message_id = original.message_id.clone();
        }
        if uid == 4 {
            h.from_addr = "other@example.com".into();
            h.sent_at = original.sent_at;
        }
        if uid >= 6 {
            h.message_id = None;
            h.sent_at = 6000;
        }
        f.client.insert(ALL_MAIL, h, Vec::new()).unwrap();
    }
    sync::sync(&f.db, &f.client).unwrap();
    let starred = list(&f.db, Folder::Starred, Filter::All, 200).unwrap();
    assert_eq!(
        starred
            .iter()
            .map(|e| (e.folder.as_str(), e.uid))
            .collect::<Vec<_>>(),
        vec![
            (ALL_MAIL, 7),
            (ALL_MAIL, 6),
            (ALL_MAIL, 5),
            (ALL_MAIL, 3),
            (SENT, 2),
            (ALL_MAIL, 4),
            (INBOX, 1),
        ]
    );
    for preferred in [INBOX, SENT, ALL_MAIL] {
        let rows = list(&f.db, Folder::Starred, Filter::All, 200).unwrap();
        let row = rows
            .iter()
            .find(|e| {
                e.message_id == original.message_id
                    && e.from_addr == original.from_addr
                    && e.sent_at == original.sent_at
            })
            .unwrap();
        assert_eq!(row.folder, preferred);
        crate::items::soft_delete(&f.db.conn().unwrap(), &row.id, 1).unwrap();
    }
    assert_eq!(
        list(&f.db, Folder::Starred, Filter::All, 200)
            .unwrap()
            .len(),
        6
    );
}

#[test]
fn archive_from_starred_removes_inbox_label_and_preserves_the_starred_message() {
    let f = Fixture::new();
    let mut h = header(1);
    h.starred = true;
    f.client
        .insert(INBOX, h, b"Content-Type: text/plain\r\n\r\nHalo".to_vec())
        .unwrap();
    sync::sync(&f.db, &f.client).unwrap();
    let starred = list(&f.db, Folder::Starred, Filter::All, 200).unwrap()[0]
        .id
        .clone();
    actions::archive(&f.db, &f.client, &starred).unwrap();
    assert!(
        f.client
            .list_headers(INBOX, 200)
            .unwrap()
            .headers
            .is_empty()
    );
    assert!(
        list(&f.db, Folder::Inbox, Filter::All, 200)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        list(&f.db, Folder::Starred, Filter::All, 200)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn send_sets_reply_headers_and_appears_in_sent_after_sync() {
    let f = Fixture::new();
    f.seed(1);
    sync::sync(&f.db, &f.client).unwrap();
    let id = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap()[0]
        .id
        .clone();
    let draft = Draft {
        to: vec!["siti@example.com".into()],
        subject: "Re: Pesan 1".into(),
        body: "Terima kasih — diterima.".into(),
        reply_to_id: Some(id),
    };
    send::send(&f.db, &f.client, ADDRESS, &draft).unwrap();
    let raw = f.client.sent().unwrap();
    let parsed = mail_parser::MessageParser::default()
        .parse(&raw[0])
        .unwrap();
    assert_eq!(parsed.in_reply_to().as_text(), Some("msg1@example.com"));
    assert_eq!(
        parsed.references().as_text_list().unwrap(),
        &["root@example.com", "msg1@example.com"]
    );
    assert_eq!(body::parse(&raw[0]).unwrap().text, draft.body);
    sync::sync(&f.db, &f.client).unwrap();
    assert_eq!(
        list(&f.db, Folder::Sent, Filter::All, 200).unwrap().len(),
        1
    );
    let new_draft = Draft {
        reply_to_id: None,
        ..draft
    };
    send::send(&f.db, &f.client, ADDRESS, &new_draft).unwrap();
    for bad in [
        Draft {
            to: vec![],
            ..new_draft.clone()
        },
        Draft {
            to: vec!["bad\r\nBcc: attacker@example.com".into()],
            ..new_draft.clone()
        },
        Draft {
            subject: "bad\nheader".into(),
            ..new_draft.clone()
        },
    ] {
        assert!(send::send(&f.db, &f.client, ADDRESS, &bad).is_err());
    }
    assert_eq!(f.client.sent().unwrap().len(), 2);
}

#[test]
fn database_is_not_held_during_any_client_call() {
    let f = Fixture::new();
    let db = Arc::clone(&f.db);
    f.client
        .set_hook(Arc::new(move || {
            assert!(db.is_unlocked_for_test(), "DB locked during mail IO")
        }))
        .unwrap();
    f.connect();
    f.seed(1);
    sync::sync(&f.db, &f.client).unwrap();
    let id = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap()[0]
        .id
        .clone();
    actions::open(&f.db, &f.client, &id).unwrap();
    actions::set_flag(&f.db, &f.client, &id, Flag::Starred, true).unwrap();
    send::send(
        &f.db,
        &f.client,
        ADDRESS,
        &Draft {
            to: vec!["siti@example.com".into()],
            subject: "Balasan".into(),
            body: "Halo".into(),
            reply_to_id: Some(id.clone()),
        },
    )
    .unwrap();
    actions::archive(&f.db, &f.client, &id).unwrap();
}

#[test]
fn second_sync_of_unchanged_mail_fetches_no_headers() {
    let f = Fixture::new();
    f.seed(1);
    f.seed(2);
    sync::sync(&f.db, &f.client).unwrap();
    let initial_fetches = f.client.fetched_headers_count.load(Ordering::SeqCst);
    assert!(initial_fetches >= 2);

    f.client.fetched_headers_count.store(0, Ordering::SeqCst);
    sync::sync(&f.db, &f.client).unwrap();

    assert_eq!(f.client.fetched_headers_count.load(Ordering::SeqCst), 0);
}

#[test]
fn changed_flags_update_locally() {
    let f = Fixture::new();
    let mut h = header(1);
    h.starred = true;
    f.client.insert(INBOX, h, Vec::new()).unwrap();
    sync::sync(&f.db, &f.client).unwrap();
    let rows = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].unread);
    assert!(rows[0].starred);

    // Update flag on server (fake client)
    let validity = f.client.list_uids_flags(INBOX).unwrap().uid_validity;
    f.client.set_flag(INBOX, 1, validity, Flag::Seen, true).unwrap();
    f.client.set_flag(INBOX, 1, validity, Flag::Starred, false).unwrap();

    f.client.fetched_headers_count.store(0, Ordering::SeqCst);
    sync::sync(&f.db, &f.client).unwrap();

    // No headers fetched because UIDs are unchanged
    assert_eq!(f.client.fetched_headers_count.load(Ordering::SeqCst), 0);

    // Flags updated locally
    let rows = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap();
    assert_eq!(rows.len(), 1);
    assert!(!rows[0].unread);
    assert!(!rows[0].starred);
}

#[test]
fn a_new_uid_fetches_exactly_one_header() {
    let f = Fixture::new();
    f.seed(1);
    f.seed(2);
    sync::sync(&f.db, &f.client).unwrap();

    f.seed(3);
    f.client.fetched_headers_count.store(0, Ordering::SeqCst);
    sync::sync(&f.db, &f.client).unwrap();

    assert_eq!(f.client.fetched_headers_count.load(Ordering::SeqCst), 1);
    let rows = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap();
    assert_eq!(rows.len(), 3);
}

#[test]
fn open_of_a_cached_email_makes_no_blocking_network_call() {
    let f = Fixture::new();
    f.seed(1);
    sync::sync(&f.db, &f.client).unwrap();
    let id = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap()[0].id.clone();

    // Cache the email by opening it first
    actions::open(&f.db, &f.client, &id).unwrap();
    let cached = get(&f.db.conn().unwrap(), &id).unwrap();
    assert!(cached.body_cached);

    // Reset all network call counters
    f.client.fetch_body_peek_count.store(0, Ordering::SeqCst);
    f.client.fetch_body_mark_read_count.store(0, Ordering::SeqCst);
    f.client.set_flag_count.store(0, Ordering::SeqCst);

    // Open again: must make NO blocking network calls
    let opened = actions::open(&f.db, &f.client, &id).unwrap();
    assert_eq!(opened.id, id);
    assert!(opened.body_cached);
    assert!(!opened.unread);

    assert_eq!(f.client.fetch_body_peek_count.load(Ordering::SeqCst), 0);
    assert_eq!(f.client.fetch_body_mark_read_count.load(Ordering::SeqCst), 0);
    assert_eq!(f.client.set_flag_count.load(Ordering::SeqCst), 0);
}

#[test]
fn open_of_an_uncached_email_uses_one_fetch() {
    let f = Fixture::new();
    f.seed(1);
    sync::sync(&f.db, &f.client).unwrap();
    let id = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap()[0].id.clone();

    let before = get(&f.db.conn().unwrap(), &id).unwrap();
    assert!(!before.body_cached);
    assert!(before.unread);

    // Reset all call counters
    f.client.fetch_body_peek_count.store(0, Ordering::SeqCst);
    f.client.fetch_body_mark_read_count.store(0, Ordering::SeqCst);
    f.client.set_flag_count.store(0, Ordering::SeqCst);

    let opened = actions::open(&f.db, &f.client, &id).unwrap();
    assert!(opened.body_cached);
    assert!(!opened.unread);

    // Exactly one non-PEEK fetch (which sets \Seen on server), no separate set_flag call
    assert_eq!(f.client.fetch_body_mark_read_count.load(Ordering::SeqCst), 1);
    assert_eq!(f.client.fetch_body_peek_count.load(Ordering::SeqCst), 0);
    assert_eq!(f.client.set_flag_count.load(Ordering::SeqCst), 0);
}

#[test]
fn a_dropped_session_is_retried_once_with_a_new_login() {
    let f = Fixture::new();
    f.connect();
    f.seed(1);
    sync::sync(&f.db, &f.client).unwrap();

    let initial_logins = f.client.login_count.load(Ordering::SeqCst);
    assert!(initial_logins >= 1);

    // Simulate dropped session
    f.client.drop_session();

    // Call should succeed because it retries once with a new login
    let batch = f.client.list_uids_flags(INBOX).unwrap();
    assert!(!batch.entries.is_empty());
    assert_eq!(
        f.client.login_count.load(Ordering::SeqCst),
        initial_logins + 1
    );
}

#[test]
fn prefetch_caches_bodies_without_marking_them_read() {
    let f = Fixture::new();
    f.seed(1);
    f.seed(2);
    sync::sync(&f.db, &f.client).unwrap();

    let before = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap();
    assert_eq!(before.len(), 2);
    assert!(before.iter().all(|e| !e.body_cached && e.unread));

    f.client.fetch_body_peek_count.store(0, Ordering::SeqCst);
    f.client.set_flag_count.store(0, Ordering::SeqCst);

    // Run prefetch for up to 20 newest uncached INBOX messages
    sync::prefetch(&f.db, &f.client, 20);

    // Bodies must now be cached, but unread must STILL be true!
    let after = list(&f.db, Folder::Inbox, Filter::All, 200).unwrap();
    assert_eq!(after.len(), 2);
    assert!(after.iter().all(|e| e.body_cached && e.unread));
    assert!(after.iter().all(|e| e.body.contains("Halo Indonesia")));

    // PEEK fetches were used, no set_flag
    assert_eq!(f.client.fetch_body_peek_count.load(Ordering::SeqCst), 2);
    assert_eq!(f.client.set_flag_count.load(Ordering::SeqCst), 0);
}
