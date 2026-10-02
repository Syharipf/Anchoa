use rusqlite::params;

use super::{ALL_MAIL, Email, Flag, body, client::MailClient, get};
use crate::{db::Db, error::AppError, items, time};

pub fn open(db: &Db, client: &dyn MailClient, id: &str) -> Result<Email, AppError> {
    let email = get(&*db.conn()?, id)?;
    let body = if email.body_cached {
        None
    } else {
        Some(body::parse(&client.fetch_body(&email.folder, email.uid)?)?)
    };
    client.set_flag(&email.folder, email.uid, Flag::Seen, true)?;
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
    Ok(result)
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
    conn.execute(&format!("UPDATE emails SET {column} = ?2 WHERE (item_id = ?1 OR (?3 IS NOT NULL AND message_id = ?3)) AND item_id IN (SELECT id FROM items WHERE deleted_at IS NULL)"), params![email.id, value, email.message_id])?;
    conn.execute("UPDATE items SET updated_at = ?2 WHERE deleted_at IS NULL AND id IN (SELECT item_id FROM emails WHERE item_id = ?1 OR (?3 IS NOT NULL AND message_id = ?3))", params![email.id, now, email.message_id])?;
    Ok(())
}

pub fn set_flag(
    db: &Db,
    client: &dyn MailClient,
    id: &str,
    flag: Flag,
    on: bool,
) -> Result<(), AppError> {
    let email = get(&*db.conn()?, id)?;
    client.set_flag(&email.folder, email.uid, flag, on)?;
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    update_flag(&tx, &email, flag, on, time::now_ms())?;
    tx.commit()?;
    Ok(())
}

pub fn archive(db: &Db, client: &dyn MailClient, id: &str) -> Result<(), AppError> {
    let email = get(&*db.conn()?, id)?;
    client.move_to(&email.folder, email.uid, ALL_MAIL)?;
    // Destination UID is assigned by Gmail and will be discovered on the next sync.
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    let now = time::now_ms();
    if email.folder != ALL_MAIL {
        items::soft_delete(&tx, id, now)?;
    }
    tx.execute("UPDATE items SET deleted_at = ?2, updated_at = ?2 WHERE deleted_at IS NULL AND id IN (SELECT item_id FROM emails WHERE folder = ?1 AND ?3 IS NOT NULL AND message_id = ?3)", params![super::INBOX, now, email.message_id])?;
    tx.commit()?;
    Ok(())
}
