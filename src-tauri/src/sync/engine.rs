//! Synchronization engine: orchestrates pull, LWW conflict resolution, and encrypted push.
use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, params};
use zeroize::Zeroizing;

use super::{
    crypto::{self, Dek},
    record::{self, Applied, Record},
    server::{self, PAGE_SIZE, Session, SyncReport, SyncServer, WireRecord},
};
use crate::{db::Db, error::AppError, keystore::KeyringStore};

pub fn store_dek(keys: &KeyringStore, user_id: &str, dek: &Dek) -> Result<(), AppError> {
    let hex = Zeroizing::new(server::hex_encode(dek.as_bytes()));
    keys.set(&format!("sync-dek:{user_id}"), &hex)
}

pub fn load_dek(keys: &KeyringStore, user_id: &str) -> Result<Option<Dek>, AppError> {
    let Some(secret) = keys.get(&format!("sync-dek:{user_id}"))? else {
        return Ok(None);
    };
    let secret = Zeroizing::new(secret);
    let bytes = Zeroizing::new(server::hex_decode(&secret)?);
    if bytes.len() != 32 {
        return Err(AppError::Invalid(
            "Format kunci sync (DEK) tidak valid".into(),
        ));
    }
    let mut array = [0u8; 32];
    array.copy_from_slice(&bytes);
    Ok(Some(Dek::from_bytes(array)))
}

pub fn delete_dek(keys: &KeyringStore, user_id: &str) -> Result<(), AppError> {
    keys.delete(&format!("sync-dek:{user_id}"))
}

pub(crate) fn format_version(changed_at: i64, device_id: &str) -> String {
    format!("{changed_at}:{device_id}")
}

pub(crate) fn parse_version(s: &str) -> Option<(i64, &str)> {
    let (ts, dev) = s.split_once(':')?;
    let changed_at = ts.parse::<i64>().ok()?;
    Some((changed_at, dev))
}

fn is_tombstone_payload(payload: &[u8]) -> bool {
    miniz_oxide::inflate::decompress_to_vec_with_limit(payload, record::MAX_DECOMPRESSED_BYTES)
        .ok()
        .and_then(|plain| serde_json::from_slice::<serde_json::Value>(&plain).ok())
        .and_then(|val| val.get("tombstone").and_then(|v| v.as_bool()))
        .unwrap_or(false)
}

fn check_vault(
    db: &Db,
    keys: &KeyringStore,
    server: &dyn SyncServer,
    session: &mut Session,
    fingerprint: &str,
) -> Result<(), AppError> {
    let vault = server::call_with_refresh(server, keys, session, |s| server.get_vault(s))?;
    if vault
        .as_ref()
        .is_none_or(|v| vault_fingerprint(v) != fingerprint)
    {
        delete_dek(keys, &session.user_id)?;
        let message = "Kunci sync berubah atau dihapus di perangkat lain; buka kunci lagi";
        set_state(&*db.conn()?, "last_error", message)?;
        return Err(AppError::Invalid(message.into()));
    }
    Ok(())
}

fn pending_document(payload: &[u8]) -> Option<serde_json::Value> {
    let plain =
        miniz_oxide::inflate::decompress_to_vec_with_limit(payload, record::MAX_DECOMPRESSED_BYTES)
            .ok()?;
    serde_json::from_slice(&plain).ok()
}

fn is_newer_schema(conn: &Connection, payload: &[u8]) -> Result<bool, AppError> {
    let schema: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    Ok(pending_document(payload)
        .and_then(|doc| doc["schema"].as_i64())
        .is_some_and(|incoming| incoming > schema))
}

fn warn_newer_schema(conn: &Connection, id: &str, payload: &[u8]) -> Result<(), AppError> {
    let title: Option<String> = conn
        .query_row("SELECT title FROM items WHERE id=?1", [id], |r| r.get(0))
        .optional()?;
    let title = title
        .or_else(|| {
            pending_document(payload)
                .and_then(|doc| doc["item"]["title"].as_str().map(str::to_owned))
        })
        .unwrap_or_else(|| id.into());
    set_state(
        conn,
        &format!("warning:{id}"),
        &format!("Perbarui Anchoa untuk menyinkronkan {title}"),
    )
}

pub(crate) fn set_state(conn: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    conn.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value])?;
    Ok(())
}

pub(crate) fn vault_fingerprint(vault: &server::Vault) -> String {
    use sha2::Digest;
    server::hex_encode(&sha2::Sha256::digest(&vault.dek_by_passphrase))
}

fn known_version(conn: &Connection, id: &str) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row(
            "SELECT version FROM sync_versions WHERE record_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?)
}

fn effective_changed_at(queued: i64, known: Option<&str>) -> i64 {
    let received = known.and_then(parse_version).map_or(0, |(ts, _)| ts);
    queued.max(received.saturating_add(1))
}

/// Deferred records already have a known version, so equality is allowed only
/// when retrying that exact pending payload. Outgoing changes always use the
/// same clock adjustment here and at export.
fn wins_lww(
    conn: &Connection,
    id: &str,
    remote: (i64, &str),
    device: &str,
    retry: bool,
) -> Result<bool, AppError> {
    let known = known_version(conn, id)?;
    if let Some(version) = known.as_deref().and_then(parse_version)
        && (remote < version || (!retry && remote == version))
    {
        return Ok(false);
    }
    let queued: Option<i64> = conn
        .query_row(
            "SELECT changed_at FROM sync_outbox WHERE record_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(ts) = queued
        && remote
            <= (
                if retry && known.as_deref().and_then(parse_version) == Some(remote) {
                    // A deferred version has not been applied locally. It must not
                    // advance an older queued edit past itself just by being known.
                    ts
                } else {
                    effective_changed_at(ts, known.as_deref())
                },
                device,
            )
    {
        return Ok(false);
    }
    Ok(true)
}

pub fn sync_once(
    db: &Db,
    keys: &KeyringStore,
    server: &dyn SyncServer,
    now: i64,
) -> Result<SyncReport, AppError> {
    let (device_id, user_id, mut cursor, quota_bytes, last_sync, fingerprint) = {
        let conn = db.conn()?;
        let get = |key: &str| -> Result<String, AppError> {
            Ok(conn
                .query_row("SELECT value FROM sync_state WHERE key=?1", [key], |r| {
                    r.get(0)
                })
                .optional()?
                .unwrap_or_default())
        };
        (
            get("device_id")?,
            get("user_id")?,
            get("cursor")?.parse::<i64>().unwrap_or(0),
            get("quota_bytes")?
                .parse::<u64>()
                .unwrap_or(server::DEFAULT_QUOTA_BYTES),
            get("last_sync_at")?.parse::<i64>().unwrap_or(0),
            get("vault_fingerprint")?,
        )
    };
    if user_id.is_empty() {
        return Err(AppError::Invalid(
            "Sync belum dikonfigurasi: belum login".into(),
        ));
    }
    if device_id.is_empty() {
        return Err(AppError::Invalid(
            "Sync belum dikonfigurasi: device_id kosong".into(),
        ));
    }
    let mut session = Session::load(keys, &user_id)?.ok_or_else(server::session_ended)?;
    let dek = load_dek(keys, &user_id)?
        .ok_or_else(|| AppError::Other("Kunci sync (DEK) belum dibuka".into()))?;
    server::refresh_if_expiring(server, keys, &mut session, now)?;

    check_vault(db, keys, server, &mut session, &fingerprint)?;
    let usage = server::call_with_refresh(server, keys, &mut session, |s| server.usage(s))?;
    let mut bytes_used = usage.bytes;
    set_state(&*db.conn()?, "bytes_used", &bytes_used.to_string())?;
    const NINETY_DAYS: i64 = 90 * 24 * 60 * 60 * 1000;
    if last_sync != 0 && now.saturating_sub(last_sync) > NINETY_DAYS {
        cursor = 0;
        set_state(&*db.conn()?, "cursor", "0")?;
    }

    let mut pulled = 0;
    pull_all(
        db,
        keys,
        server,
        &mut session,
        &device_id,
        &dek,
        &mut cursor,
        &mut pulled,
    )?;

    let mut pushed = 0;
    let mut stopped_by_quota = false;
    let mut skipped = HashSet::new();
    loop {
        let outbox_rows: Vec<(String, i64)> = {
            let conn = db.conn()?;
            let mut stmt = conn.prepare(
                "SELECT record_id,changed_at FROM sync_outbox ORDER BY changed_at,record_id",
            )?;
            stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
                .filter(|row| match row {
                    Ok((id, _)) => !skipped.contains(id),
                    Err(_) => true,
                })
                .take(PAGE_SIZE as usize)
                .collect::<Result<_, _>>()?
        };
        if outbox_rows.is_empty() {
            break;
        }
        let mut batch = Vec::new();
        let mut exported_at = Vec::new();
        {
            let conn = db.conn()?;
            for (id, queued) in &outbox_rows {
                let pending: Option<Vec<u8>> = conn
                    .query_row(
                        "SELECT payload FROM sync_pending WHERE record_id=?1",
                        [id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if let Some(payload) = pending
                    && is_newer_schema(&conn, &payload)?
                {
                    warn_newer_schema(&conn, id, &payload)?;
                    skipped.insert(id.clone());
                    continue;
                }
                let rec = match record::export(&conn, id) {
                    Ok(Some(rec)) => rec,
                    Ok(None) => {
                        conn.execute(
                            "DELETE FROM sync_outbox WHERE record_id=?1 AND changed_at=?2",
                            params![id, queued],
                        )?;
                        continue;
                    }
                    Err(e) if record::is_too_large(&e) => {
                        set_state(&conn, &format!("warning:{id}"), &e.to_string())?;
                        skipped.insert(id.clone());
                        continue;
                    }
                    Err(e) => return Err(e),
                };
                let known = known_version(&conn, id)?;
                let changed_at = effective_changed_at(*queued, known.as_deref());
                let aad = crypto::aad(&user_id, id, changed_at, &device_id);
                let payload = crypto::seal(&dek, &aad, rec.payload.as_deref().unwrap_or(&[]));
                exported_at.push(*queued);
                batch.push(WireRecord {
                    id: id.clone(),
                    changed_at,
                    device_id: device_id.clone(),
                    deleted: rec.deleted,
                    payload: Some(payload),
                    seq: 0,
                });
            }
        }
        if batch.is_empty() {
            continue;
        }
        let batch_bytes: u64 = batch
            .iter()
            .map(|r| r.payload.as_ref().map_or(0, |p| p.len() as u64))
            .sum();
        // Conservatively count new ciphertext even when it replaces an existing
        // record, and carry accepted bytes across every batch in this cycle.
        if bytes_used.saturating_add(batch_bytes) > quota_bytes {
            stopped_by_quota = true;
            break;
        }
        check_vault(db, keys, server, &mut session, &fingerprint)?;
        let rejected =
            server::call_with_refresh(server, keys, &mut session, |s| server.push(s, &batch))?;
        let rejected_ids: HashSet<&str> = rejected.iter().map(|r| r.id.as_str()).collect();
        {
            let mut conn = db.conn()?;
            let tx = conn.transaction()?;
            for (wire, queued) in batch.iter().zip(&exported_at) {
                if rejected_ids.contains(wire.id.as_str()) {
                    continue;
                }
                tx.execute(
                    "DELETE FROM sync_outbox WHERE record_id=?1 AND changed_at=?2",
                    params![wire.id, queued],
                )?;
                tx.execute("DELETE FROM sync_pending WHERE record_id=?1", [&wire.id])?;
                tx.execute(
                    "DELETE FROM sync_state WHERE key=?1",
                    [format!("warning:{}", wire.id)],
                )?;
                tx.execute("INSERT INTO sync_versions VALUES(?1,?2) ON CONFLICT(record_id) DO UPDATE SET version=excluded.version",params![wire.id,format_version(wire.changed_at,&wire.device_id)])?;
                pushed += 1;
                bytes_used =
                    bytes_used.saturating_add(wire.payload.as_ref().map_or(0, |p| p.len() as u64));
            }
            set_state(&tx, "bytes_used", &bytes_used.to_string())?;
            tx.commit()?;
        }
        // Rejection versions are unauthenticated. Only decrypted pull content
        // can decide LWW or modify this record's local version and outbox.
        if !rejected.is_empty() {
            pull_all(
                db,
                keys,
                server,
                &mut session,
                &device_id,
                &dek,
                &mut cursor,
                &mut pulled,
            )?;
        }
        if rejected_ids.len() == batch.len() || outbox_rows.len() < PAGE_SIZE as usize {
            break;
        }
    }
    let pending = {
        let conn = db.conn()?;
        set_state(&conn, "last_sync_at", &now.to_string())?;
        conn.query_row("SELECT count(*) FROM sync_pending", [], |r| {
            r.get::<_, i64>(0)
        })? as usize
    };
    Ok(SyncReport {
        pulled,
        pushed,
        pending,
        bytes_used,
        quota_bytes,
        stopped_by_quota,
    })
}

#[allow(clippy::too_many_arguments)]
fn pull_all(
    db: &Db,
    keys: &KeyringStore,
    server: &dyn SyncServer,
    session: &mut Session,
    device: &str,
    dek: &Dek,
    cursor: &mut i64,
    pulled: &mut usize,
) -> Result<(), AppError> {
    loop {
        let page = server::call_with_refresh(server, keys, session, |s| {
            server.pull(s, *cursor, PAGE_SIZE)
        })?;
        {
            let mut conn = db.conn()?;
            let tx = conn.transaction()?;
            // Empty pages also retry pending records after an app upgrade.
            apply_page(&tx, &page, &session.user_id, device, dek, cursor, pulled)?;
            tx.commit()?;
        }
        if page.len() < PAGE_SIZE as usize {
            break;
        }
    }
    Ok(())
}

fn apply_page(
    tx: &Connection,
    page: &[WireRecord],
    user: &str,
    device: &str,
    dek: &Dek,
    cursor: &mut i64,
    pulled: &mut usize,
) -> Result<(), AppError> {
    let mut new_cursor = *cursor;
    let mut to_apply = Vec::new();
    for wire in page {
        new_cursor = new_cursor.max(wire.seq);
        let Some(ciphertext) = &wire.payload else {
            continue;
        };
        let aad = crypto::aad(user, &wire.id, wire.changed_at, &wire.device_id);
        let plain = crypto::open(dek, &aad, ciphertext)?;
        if is_newer_schema(tx, &plain)? {
            // Schema compatibility precedes LWW: even an older remote version
            // must hold back writes from a client that cannot preserve its fields.
            let version = format_version(wire.changed_at, &wire.device_id);
            tx.execute("INSERT INTO sync_pending VALUES(?1,?2,?3) ON CONFLICT(record_id) DO UPDATE SET version=excluded.version,payload=excluded.payload", params![wire.id,version,plain])?;
            let known = known_version(tx, &wire.id)?;
            if known
                .as_deref()
                .and_then(parse_version)
                .is_none_or(|known| (wire.changed_at, wire.device_id.as_str()) > known)
            {
                tx.execute("INSERT INTO sync_versions VALUES(?1,?2) ON CONFLICT(record_id) DO UPDATE SET version=excluded.version", params![wire.id,version])?;
            }
            warn_newer_schema(tx, &wire.id, &plain)?;
            continue;
        }
        let queued: Option<i64> = tx
            .query_row(
                "SELECT changed_at FROM sync_outbox WHERE record_id=?1",
                [&wire.id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(queued) = queued
            && wire.device_id == device
            && wire.changed_at
                == effective_changed_at(queued, known_version(tx, &wire.id)?.as_deref())
        {
            // Clock adjustment can give a later, unsent edit the same timestamp.
            // Only identical content acknowledges the push whose response was lost.
            let matches_local = match record::export(tx, &wire.id) {
                Ok(local) => {
                    local.is_some_and(|rec| rec.payload.as_deref() == Some(plain.as_slice()))
                }
                Err(e) if record::is_too_large(&e) => false,
                Err(e) => return Err(e),
            };
            if matches_local {
                tx.execute(
                    "DELETE FROM sync_outbox WHERE record_id=?1 AND changed_at=?2",
                    params![wire.id, queued],
                )?;
                tx.execute(
                    "DELETE FROM sync_state WHERE key=?1",
                    [format!("warning:{}", wire.id)],
                )?;
            }
            // A retained edit must advance past the authenticated echo on its next push.
            tx.execute("INSERT INTO sync_versions VALUES(?1,?2) ON CONFLICT(record_id) DO UPDATE SET version=excluded.version", params![wire.id,format_version(wire.changed_at,device)])?;
            continue;
        }
        if !wins_lww(
            tx,
            &wire.id,
            (wire.changed_at, &wire.device_id),
            device,
            false,
        )? {
            continue;
        }
        to_apply.push((
            Record {
                id: wire.id.clone(),
                changed_at: wire.changed_at,
                deleted: wire.deleted,
                payload: Some(plain),
            },
            format_version(wire.changed_at, &wire.device_id),
        ));
    }
    let records: Vec<Record> = to_apply.iter().map(|(r, _)| r.clone()).collect();
    let results = record::apply_batch(tx, &records)?;
    for ((rec, version), result) in to_apply.iter().zip(results) {
        // Even a failed apply advances the authenticated version, allowing a
        // retained local edit to move past the server's LWW rejection.
        tx.execute("INSERT INTO sync_versions VALUES(?1,?2) ON CONFLICT(record_id) DO UPDATE SET version=excluded.version",params![rec.id,version])?;
        match result {
            Ok(applied) => {
                // This authenticated version won against the effective outgoing
                // version. Deferral must also prevent pushing older content.
                if applied != Applied::NewerSchema {
                    tx.execute("DELETE FROM sync_outbox WHERE record_id=?1", [&rec.id])?;
                }
                tx.execute(
                    "DELETE FROM sync_state WHERE key=?1",
                    [format!("warning:{}", rec.id)],
                )?;
                if applied == Applied::Done {
                    *pulled += 1;
                    tx.execute("DELETE FROM sync_pending WHERE record_id=?1", [&rec.id])?;
                } else {
                    tx.execute("INSERT INTO sync_pending VALUES(?1,?2,?3) ON CONFLICT(record_id) DO UPDATE SET version=excluded.version,payload=excluded.payload",params![rec.id,version,rec.payload])?;
                    if applied == Applied::NewerSchema {
                        warn_newer_schema(tx, &rec.id, rec.payload.as_deref().unwrap_or_default())?;
                    }
                }
            }
            Err(e) => {
                log::warn!("Record {}: gagal diterapkan: {e}", rec.id);
                set_state(
                    tx,
                    &format!("warning:{}", rec.id),
                    &format!("Record {}: gagal diterapkan: {e}", rec.id),
                )?;
            }
        }
    }
    retry_pending(tx, device, pulled)?;
    *cursor = new_cursor;
    set_state(tx, "cursor", &cursor.to_string())
}

fn retry_pending(conn: &Connection, device: &str, pulled: &mut usize) -> Result<(), AppError> {
    for _ in 0..10 {
        let rows: Vec<(String, String, Vec<u8>)> = {
            let mut stmt = conn.prepare("SELECT record_id,version,payload FROM sync_pending")?;
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .collect::<Result<_, _>>()?
        };
        let mut records = Vec::new();
        let mut versions = Vec::new();
        for (id, version, payload) in rows {
            if is_newer_schema(conn, &payload)? {
                warn_newer_schema(conn, &id, &payload)?;
                continue;
            }
            let Some(remote) = parse_version(&version) else {
                conn.execute("DELETE FROM sync_pending WHERE record_id=?1", [&id])?;
                continue;
            };
            if !wins_lww(conn, &id, remote, device, true)? {
                conn.execute("DELETE FROM sync_pending WHERE record_id=?1", [&id])?;
                conn.execute(
                    "DELETE FROM sync_state WHERE key=?1",
                    [format!("warning:{id}")],
                )?;
                continue;
            }
            let ts = remote.0;
            records.push(Record {
                id,
                changed_at: ts,
                deleted: is_tombstone_payload(&payload),
                payload: Some(payload),
            });
            versions.push(version);
        }
        let results = record::apply_batch(conn, &records)?;
        let mut progress = false;
        for ((rec, version), result) in records.iter().zip(versions).zip(results) {
            if let Ok(Applied::Done) = result {
                *pulled += 1;
                conn.execute("DELETE FROM sync_pending WHERE record_id=?1", [&rec.id])?;
                conn.execute("INSERT INTO sync_versions VALUES(?1,?2) ON CONFLICT(record_id) DO UPDATE SET version=excluded.version",params![rec.id,version])?;
                conn.execute("DELETE FROM sync_outbox WHERE record_id=?1", [&rec.id])?;
                conn.execute(
                    "DELETE FROM sync_state WHERE key=?1",
                    [format!("warning:{}", rec.id)],
                )?;
                progress = true;
            }
        }
        if !progress {
            break;
        }
    }
    Ok(())
}
