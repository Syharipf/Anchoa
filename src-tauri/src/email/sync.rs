use std::collections::HashSet;

use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use super::{ALL_MAIL, HEADER_LIMIT, INBOX, SENT, client::MailClient};
use crate::{db::Db, error::AppError, items, time};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub headers: usize,
}

pub fn sync(db: &Db, client: &dyn MailClient) -> Result<SyncResult, AppError> {
    // Fetch everything first. A failed folder leaves the local snapshot intact.
    let batches = [INBOX, SENT, ALL_MAIL].map(|folder| client.list_headers(folder, HEADER_LIMIT));
    let batches = batches.into_iter().collect::<Result<Vec<_>, _>>()?;
    let now = time::now_ms();
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    let mut count = 0;
    for (folder, batch) in [INBOX, SENT, ALL_MAIL].into_iter().zip(batches) {
        let validity_key = format!("email.uidvalidity.{folder}");
        let validity: Option<String> = tx
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [&validity_key],
                |r| r.get(0),
            )
            .optional()?;
        if validity
            .as_deref()
            .is_some_and(|value| value != batch.uid_validity.to_string())
        {
            tx.execute("UPDATE items SET deleted_at = ?2, updated_at = ?2 WHERE id IN (SELECT item_id FROM emails WHERE folder = ?1) AND deleted_at IS NULL", params![folder, now])?;
            // A UIDVALIDITY change makes every old folder/UID identity invalid.
            tx.execute("DELETE FROM emails WHERE folder = ?1", [folder])?;
        }
        tx.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![validity_key, batch.uid_validity.to_string()])?;
        let present: HashSet<_> = batch.all_uids.into_iter().collect();
        for header in batch.headers {
            if !present.contains(&header.uid) {
                continue;
            }
            let existing: Option<(String, Option<i64>)> = tx.query_row("SELECT e.item_id, i.deleted_at FROM emails e JOIN items i ON i.id = e.item_id WHERE e.folder = ?1 AND e.uid = ?2", params![folder, header.uid], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
            let id = if let Some((id, None)) = existing {
                id
            } else {
                tx.execute(
                    "DELETE FROM emails WHERE folder = ?1 AND uid = ?2",
                    params![folder, header.uid],
                )?;
                items::insert(&tx, "email", &header.subject, "", now)?
            };
            tx.execute(
                "UPDATE items SET title = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
                params![id, header.subject, now],
            )?;
            let to = serde_json::to_string(&header.to_addrs)
                .map_err(|_| AppError::Other("Alamat email tidak dapat disimpan".into()))?;
            let refs = serde_json::to_string(&header.refs)
                .map_err(|_| AppError::Other("Header email tidak dapat disimpan".into()))?;
            tx.execute("INSERT INTO emails (item_id, folder, uid, message_id, from_name, from_addr, to_addrs, sent_at, unread, starred, has_html, refs) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) ON CONFLICT(folder, uid) DO UPDATE SET message_id = excluded.message_id, from_name = excluded.from_name, from_addr = excluded.from_addr, to_addrs = excluded.to_addrs, sent_at = excluded.sent_at, unread = excluded.unread, starred = excluded.starred, has_html = excluded.has_html, refs = excluded.refs", params![id, folder, header.uid, header.message_id, header.from_name, header.from_addr, to, header.sent_at, header.unread, header.starred, header.has_html, refs])?;
            count += 1;
        }
        let cached = {
            let mut stmt = tx.prepare("SELECT e.item_id, e.uid FROM emails e JOIN items i ON i.id = e.item_id WHERE e.folder = ?1 AND i.deleted_at IS NULL")?;
            stmt.query_map([folder], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?
        };
        for (id, uid) in cached {
            if !present.contains(&uid) {
                items::soft_delete(&tx, &id, now)?;
            }
        }
    }
    tx.commit()?;
    Ok(SyncResult { headers: count })
}
