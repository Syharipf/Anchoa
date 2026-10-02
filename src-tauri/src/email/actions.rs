use rusqlite::{OptionalExtension, params};

use super::{
    ALL_MAIL, Email, Flag, body,
    client::{MailClient, MailError},
    get,
};
use crate::{db::Db, error::AppError, items, time};

pub fn get_with_uid_validity(db: &Db, id: &str) -> Result<(Email, u32), AppError> {
    let conn = db.conn()?;
    let email = get(&conn, id)?;
    let validity: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [format!("email.uidvalidity.{}", email.folder)],
            |r| r.get(0),
        )
        .optional()?;
    let uid_validity = validity
        .and_then(|value| value.parse().ok())
        .ok_or(MailError::Missing)?;
    Ok((email, uid_validity))
}

use std::collections::HashSet;
use std::sync::Mutex;

static PENDING_SEEN: Mutex<Option<HashSet<String>>> = Mutex::new(None);

pub fn mark_pending_seen(id: &str) {
    let mut guard = PENDING_SEEN.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    guard.get_or_insert_with(HashSet::new).insert(id.to_string());
}

pub fn cancel_pending_seen(id: &str) {
    let mut guard = PENDING_SEEN.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(set) = guard.as_mut() {
        set.remove(id);
    }
}

pub fn take_pending_seen(id: &str) -> bool {
    let mut guard = PENDING_SEEN.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    guard.as_mut().is_some_and(|set| set.remove(id))
}

pub fn run_background_seen(
    db: &Db,
    client: &dyn MailClient,
    id: &str,
    folder: &str,
    uid: u32,
    uid_validity: u32,
) -> Result<(), MailError> {
    if !take_pending_seen(id) {
        return Ok(());
    }
    // Before sending, verify that the local row is still read (unread = 0)
    let is_still_read = {
        let Ok(conn) = db.conn() else { return Ok(()) };
        let unread: Option<bool> = conn
            .query_row(
                "SELECT e.unread FROM emails e JOIN items i ON i.id = e.item_id WHERE e.item_id = ?1 AND i.deleted_at IS NULL",
                [id],
                |r| r.get(0),
            )
            .ok();
        unread == Some(false)
    };
    if !is_still_read {
        return Ok(());
    }
    client.set_flag(folder, uid, uid_validity, Flag::Seen, true)
}

#[derive(Debug, Clone)]
pub struct OpenResult {
    pub email: Email,
    pub used_body: bool,
    pub was_unread: bool,
    pub folder: String,
    pub uid: u32,
    pub uid_validity: u32,
}

impl std::ops::Deref for OpenResult {
    type Target = Email;
    fn deref(&self) -> &Self::Target {
        &self.email
    }
}

pub fn open(db: &Db, client: &dyn MailClient, id: &str) -> Result<OpenResult, AppError> {
    let (email, uid_validity) = get_with_uid_validity(db, id)?;
    let was_unread = email.unread;
    let (body, used_body) = if email.body_cached {
        (None, false)
    } else {
        (
            Some(body::parse(&client.fetch_body_and_mark_read(
                &email.folder,
                email.uid,
                uid_validity,
            )?)?),
            true,
        )
    };
    let now = time::now_ms();
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    if let Some(body) = body {
        tx.execute(
            "UPDATE items SET body = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
            params![id, body.text, now],
        )?;
        tx.execute(
            "UPDATE emails SET body_cached = 1, has_html = ?2 WHERE item_id = ?1",
            params![id, body.has_html],
        )?;
    }
    update_flag(&tx, &email, Flag::Seen, true, now)?;
    items::open(&tx, id, now)?;
    let result = get(&tx, id)?;
    tx.commit()?;
    Ok(OpenResult {
        email: result,
        used_body,
        was_unread,
        folder: email.folder,
        uid: email.uid,
        uid_validity,
    })
}

fn update_flag(
    conn: &rusqlite::Connection,
    email: &Email,
    flag: Flag,
    on: bool,
    now: i64,
) -> Result<(), AppError> {
    let (column, value) = match flag {
        Flag::Seen => ("unread", !on),
        Flag::Starred => ("starred", on),
    };
    // Gmail labels expose the same message under multiple folder/UID pairs.
    conn.execute(&format!("UPDATE emails SET {column} = ?2 WHERE (item_id = ?1 OR (?3 IS NOT NULL AND message_id = ?3 AND from_addr = ?4 AND sent_at = ?5)) AND item_id IN (SELECT id FROM items WHERE deleted_at IS NULL)"), params![email.id, value, email.message_id, email.from_addr, email.sent_at])?;
    conn.execute("UPDATE items SET updated_at = ?2 WHERE deleted_at IS NULL AND id IN (SELECT item_id FROM emails WHERE item_id = ?1 OR (?3 IS NOT NULL AND message_id = ?3 AND from_addr = ?4 AND sent_at = ?5))", params![email.id, now, email.message_id, email.from_addr, email.sent_at])?;
    Ok(())
}

pub fn set_flag(
    db: &Db,
    client: &dyn MailClient,
    id: &str,
    flag: Flag,
    on: bool,
) -> Result<(), AppError> {
    if matches!(flag, Flag::Seen) {
        cancel_pending_seen(id);
    }
    let (email, uid_validity) = get_with_uid_validity(db, id)?;
    client.set_flag(&email.folder, email.uid, uid_validity, flag, on)?;
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    update_flag(&tx, &email, flag, on, time::now_ms())?;
    tx.commit()?;
    Ok(())
}

pub fn archive(db: &Db, client: &dyn MailClient, id: &str) -> Result<(), AppError> {
    let (email, uid_validity) = get_with_uid_validity(db, id)?;
    client.move_to(&email.folder, email.uid, uid_validity, ALL_MAIL)?;
    // Destination UID is assigned by Gmail and will be discovered on the next sync.
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    let now = time::now_ms();
    if email.folder != ALL_MAIL {
        items::soft_delete(&tx, id, now)?;
    }
    tx.execute("UPDATE items SET deleted_at = ?2, updated_at = ?2 WHERE deleted_at IS NULL AND id IN (SELECT item_id FROM emails WHERE folder = ?1 AND ?3 IS NOT NULL AND message_id = ?3 AND from_addr = ?4 AND sent_at = ?5)", params![super::INBOX, now, email.message_id, email.from_addr, email.sent_at])?;
    tx.commit()?;
    Ok(())
}
