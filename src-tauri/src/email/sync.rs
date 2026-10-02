use std::collections::{HashMap, HashSet};

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
    // Phase 1: get UIDs + FLAGS cheaply for each folder.
    let uid_flag_batches = [INBOX, SENT, ALL_MAIL]
        .map(|folder| client.list_uids_flags(folder));
    let uid_flag_batches = uid_flag_batches
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;

    // Phase 2: determine which UIDs need full header fetches.
    let mut new_uid_sets: Vec<Vec<u32>> = Vec::new();
    {
        let conn = db.conn()?;
        for (folder, batch) in [INBOX, SENT, ALL_MAIL].into_iter().zip(&uid_flag_batches) {
            let validity_key = format!("email.uidvalidity.{folder}");
            let validity: Option<String> = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = ?1",
                    [&validity_key],
                    |r| r.get(0),
                )
                .optional()?;

            // If UIDVALIDITY changed, all UIDs are "new" (need full headers).
            if validity
                .as_deref()
                .is_some_and(|value| value != batch.uid_validity.to_string())
            {
                // All UIDs are new after a UIDVALIDITY change, capped at HEADER_LIMIT.
                let mut all: Vec<u32> = batch.entries.iter().map(|e| e.uid).collect();
                all.sort_unstable_by(|a, b| b.cmp(a));
                all.truncate(HEADER_LIMIT);
                new_uid_sets.push(all);
                continue;
            }

            // Find UIDs not already stored locally for this folder.
            let mut stored: HashSet<u32> = HashSet::new();
            {
                let mut stmt = conn.prepare(
                    "SELECT e.uid FROM emails e JOIN items i ON i.id = e.item_id WHERE e.folder = ?1 AND i.deleted_at IS NULL"
                )?;
                let rows = stmt.query_map([folder], |r| r.get::<_, u32>(0))?;
                for row in rows {
                    stored.insert(row?);
                }
            }

            // New UIDs: take newest HEADER_LIMIT first, then filter not stored locally.
            let mut server_uids: Vec<u32> = batch.entries.iter().map(|e| e.uid).collect();
            server_uids.sort_unstable_by(|a, b| b.cmp(a));
            let new_uids: Vec<u32> = server_uids
                .into_iter()
                .take(HEADER_LIMIT)
                .filter(|uid| !stored.contains(uid))
                .collect();
            new_uid_sets.push(new_uids);
        }
    }
    // DB lock released here.

    // Phase 3: fetch full headers only for new UIDs (not already stored).
    let mut header_batches = Vec::new();
    for (i, folder) in [INBOX, SENT, ALL_MAIL].into_iter().enumerate() {
        let new_uids = &new_uid_sets[i];
        if new_uids.is_empty() {
            header_batches.push(Vec::new());
        } else {
            let headers = client.fetch_headers(folder, new_uids)?;
            header_batches.push(headers);
        }
    }
    // DB lock released during all network calls above.

    // Phase 4: update the database.
    let now = time::now_ms();
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    let mut count = 0;
    for (i, folder) in [INBOX, SENT, ALL_MAIL].into_iter().enumerate() {
        let batch = &uid_flag_batches[i];
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

        let present: HashSet<_> = batch.entries.iter().map(|e| e.uid).collect();

        // Build a map of flags for quick lookup.
        let flags_map: HashMap<u32, (bool, bool)> = batch
            .entries
            .iter()
            .map(|e| (e.uid, (e.unread, e.starred)))
            .collect();

        // Insert new headers.
        for header in &header_batches[i] {
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

        // Update flags for existing UIDs (from the UID+FLAGS batch).
        {
            let mut stmt = tx.prepare("SELECT e.item_id, e.uid FROM emails e JOIN items i ON i.id = e.item_id WHERE e.folder = ?1 AND i.deleted_at IS NULL")?;
            let stored: Vec<(String, u32)> = stmt
                .query_map([folder], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (item_id, uid) in &stored {
                if let Some((unread, starred)) = flags_map.get(uid) {
                    tx.execute(
                        "UPDATE emails SET unread = ?2, starred = ?3 WHERE item_id = ?1 AND folder = ?4",
                        params![item_id, unread, starred, folder],
                    )?;
                }
            }
        }

        // Soft-delete messages missing from the server.
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

/// Prefetch bodies for the N newest INBOX messages that are not yet cached.
/// Uses BODY.PEEK[] to avoid marking them as read. Failures are logged.
#[allow(dead_code)]
pub fn prefetch(db: &Db, client: &dyn MailClient, limit: usize) {
    prefetch_with_cancel(db, client, limit, || false);
}

pub fn prefetch_with_cancel(
    db: &Db,
    client: &dyn MailClient,
    limit: usize,
    should_stop: impl Fn() -> bool,
) {
    if should_stop() {
        return;
    }
    // Phase 1: collect uncached message info under a short DB lock.
    let uncached = {
        let Ok(conn) = db.conn() else { return };
        let validity_key = format!("email.uidvalidity.{INBOX}");
        let validity: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [&validity_key],
                |r| r.get(0),
            )
            .ok()
            .flatten();
        let Some(uid_validity) = validity.and_then(|v| v.parse::<u32>().ok()) else {
            return;
        };
        let mut stmt = match conn.prepare(
            "SELECT e.item_id, e.uid FROM emails e JOIN items i ON i.id = e.item_id \
             WHERE e.folder = ?1 AND i.deleted_at IS NULL AND e.body_cached = 0 \
             ORDER BY e.sent_at DESC, e.uid DESC LIMIT ?2"
        ) {
            Ok(s) => s,
            Err(_) => return,
        };
        let rows: Vec<(String, u32)> = stmt
            .query_map(params![INBOX, limit as i64], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?))
            })
            .ok()
            .map(|iter| iter.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();
        (uid_validity, rows)
    };
    // DB lock released here.

    let (uid_validity, messages) = uncached;
    let client_address = client.address();

    for (item_id, uid) in messages {
        if should_stop() {
            return;
        }

        // Fetch body without holding the DB lock.
        let raw = match client.fetch_body(INBOX, uid, uid_validity) {
            Ok(raw) => raw,
            Err(e) => {
                log::warn!("Prefetch body UID {uid} gagal: {e}");
                continue;
            }
        };

        if should_stop() {
            return;
        }

        // Parse body.
        let body = match super::body::parse(&raw) {
            Ok(b) => b,
            Err(e) => {
                log::warn!("Prefetch parse UID {uid} gagal: {e}");
                continue;
            }
        };

        // Before each write, re-check in one DB statement that the row still exists,
        // is not deleted, belongs to the same folder+uid+uid_validity,
        // and that settings email.address still equals the client's address; otherwise skip.
        let now = time::now_ms();
        if let Ok(mut conn) = db.conn() {
            let Ok(tx) = conn.transaction() else { continue };
            let valid: bool = tx
                .query_row(
                    "SELECT 1 FROM emails e \
                     JOIN items i ON i.id = e.item_id \
                     JOIN settings s_addr ON s_addr.key = 'email.address' \
                     JOIN settings s_val ON s_val.key = ('email.uidvalidity.' || e.folder) \
                     WHERE e.item_id = ?1 \
                       AND i.deleted_at IS NULL \
                       AND e.folder = ?2 \
                       AND e.uid = ?3 \
                       AND s_val.value = ?4 \
                       AND s_addr.value = ?5",
                    params![item_id, INBOX, uid, uid_validity.to_string(), client_address],
                    |_| Ok(true),
                )
                .unwrap_or(false);

            if !valid {
                continue;
            }

            let _ = tx.execute(
                "UPDATE items SET body = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
                params![item_id, body.text, now],
            );
            let _ = tx.execute(
                "UPDATE emails SET body_cached = 1, has_html = ?2 WHERE item_id = ?1",
                params![item_id, body.has_html],
            );
            let _ = tx.commit();
        }
    }
}
