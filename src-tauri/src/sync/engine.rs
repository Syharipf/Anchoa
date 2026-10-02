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
    let bytes = Zeroizing::new(server::hex_decode(&secret)?);
    if bytes.len() != 32 {
        return Err(AppError::Invalid("Format kunci sync (DEK) tidak valid".into()));
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

fn call_server<T>(
    server: &dyn SyncServer,
    session: &mut Session,
    keys: &KeyringStore,
    refreshed_already: &mut bool,
    f: impl Fn(&Session) -> Result<T, AppError>,
) -> Result<T, AppError> {
    match f(session) {
        Ok(val) => Ok(val),
        Err(AppError::Other(ref msg)) if msg.contains("kedaluwarsa") && !*refreshed_already => {
            let new_session = server.refresh(session)?;
            new_session.store(keys)?;
            *session = new_session;
            *refreshed_already = true;
            f(session)
        }
        Err(e) => Err(e),
    }
}

pub fn sync_once(
    db: &Db,
    keys: &KeyringStore,
    server: &dyn SyncServer,
    now: i64,
) -> Result<SyncReport, AppError> {
    let (device_id, user_id, cursor, quota_bytes) = {
        let conn = db.conn()?;
        let get_state = |k: &str| -> Result<String, AppError> {
            Ok(conn
                .query_row("SELECT value FROM sync_state WHERE key = ?1", [k], |r| r.get(0))
                .optional()?
                .unwrap_or_default())
        };
        let device_id = get_state("device_id")?;
        let user_id = get_state("user_id")?;
        let cursor_str = get_state("cursor")?;
        let cursor = cursor_str.parse::<i64>().unwrap_or(0);
        let quota_str = get_state("quota_bytes")?;
        let quota_bytes = quota_str
            .parse::<u64>()
            .unwrap_or(server::DEFAULT_QUOTA_BYTES);
        (device_id, user_id, cursor, quota_bytes)
    };

    if user_id.is_empty() {
        return Err(AppError::Invalid("Sync belum dikonfigurasi: belum login".into()));
    }
    if device_id.is_empty() {
        return Err(AppError::Invalid("Sync belum dikonfigurasi: device_id kosong".into()));
    }

    let mut session = Session::load(keys, &user_id)?
        .ok_or_else(|| AppError::Other("Sesi sync tidak ditemukan; masuk kembali".into()))?;
    let dek = load_dek(keys, &user_id)?
        .ok_or_else(|| AppError::Other("Kunci sync (DEK) belum dibuka".into()))?;

    let mut refreshed_already = false;
    if now >= session.expires_at {
        let refreshed = server.refresh(&session)?;
        refreshed.store(keys)?;
        session = refreshed;
        refreshed_already = true;
    }

    let mut total_pulled: usize = 0;
    let mut current_cursor = cursor;

    // --- PULL PHASE ---
    loop {
        let wire_records = call_server(server, &mut session, keys, &mut refreshed_already, |s| {
            server.pull(s, current_cursor, PAGE_SIZE)
        })?;

        if wire_records.is_empty() {
            break;
        }

        {
            let mut conn = db.conn()?;
            let tx = conn.transaction()?;

            let mut to_apply: Vec<(Record, i64, String, Vec<u8>)> = Vec::new();

            for wire in &wire_records {
                if wire.seq > current_cursor {
                    current_cursor = wire.seq;
                }

                let Some(ciphertext) = &wire.payload else {
                    continue;
                };
                let aad = crypto::aad(&user_id, &wire.id, wire.changed_at, &wire.device_id);
                let decrypted = match crypto::open(&dek, &aad, ciphertext) {
                    Ok(plain) => plain,
                    Err(_) => {
                        log::warn!("Record {}: gagal didekripsi, dilewati", wire.id);
                        continue;
                    }
                };

                // LWW against sync_versions
                let stored_version: Option<String> = tx
                    .query_row(
                        "SELECT version FROM sync_versions WHERE record_id = ?1",
                        [&wire.id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if let Some(v_str) = stored_version
                    && let Some((stored_ts, stored_dev)) = parse_version(&v_str)
                    && (wire.changed_at, wire.device_id.as_str()) <= (stored_ts, stored_dev)
                {
                    continue;
                }

                // LWW against local outbox
                let outbox_changed_at: Option<i64> = tx
                    .query_row(
                        "SELECT changed_at FROM sync_outbox WHERE record_id = ?1",
                        [&wire.id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if let Some(local_ts) = outbox_changed_at
                    && (wire.changed_at, wire.device_id.as_str()) <= (local_ts, device_id.as_str())
                {
                    continue;
                }

                let rec = Record {
                    id: wire.id.clone(),
                    changed_at: wire.changed_at,
                    deleted: wire.deleted,
                    payload: Some(decrypted.clone()),
                };
                to_apply.push((rec, wire.changed_at, wire.device_id.clone(), decrypted));
            }

            if !to_apply.is_empty() {
                let records_slice: Vec<Record> = to_apply.iter().map(|(r, _, _, _)| r.clone()).collect();
                let results = record::apply_batch(&tx, &records_slice)?;

                for (idx, res) in results.into_iter().enumerate() {
                    let (rec, changed_at, wire_dev, plain) = &to_apply[idx];
                    let version_str = format_version(*changed_at, wire_dev);

                    match res {
                        Ok(Applied::Done) => {
                            total_pulled += 1;
                            tx.execute(
                                "INSERT INTO sync_versions (record_id, version) VALUES (?1, ?2) ON CONFLICT(record_id) DO UPDATE SET version = excluded.version",
                                params![rec.id, version_str],
                            )?;
                            tx.execute("DELETE FROM sync_pending WHERE record_id = ?1", [&rec.id])?;
                            tx.execute("DELETE FROM sync_outbox WHERE record_id = ?1", [&rec.id])?;
                        }
                        Ok(Applied::NeedsParent(_)) | Ok(Applied::NewerSchema) => {
                            tx.execute(
                                "INSERT INTO sync_pending (record_id, version, payload) VALUES (?1, ?2, ?3) ON CONFLICT(record_id) DO UPDATE SET version = excluded.version, payload = excluded.payload",
                                params![rec.id, version_str, plain],
                            )?;
                            tx.execute(
                                "INSERT INTO sync_versions (record_id, version) VALUES (?1, ?2) ON CONFLICT(record_id) DO UPDATE SET version = excluded.version",
                                params![rec.id, version_str],
                            )?;
                        }
                        Err(e) => {
                            log::warn!("Record {}: gagal diterapkan: {e}", rec.id);
                        }
                    }
                }
            }

            // Retry pending records
            retry_pending(&tx, &mut total_pulled)?;

            tx.execute(
                "UPDATE sync_state SET value = ?1 WHERE key = 'cursor'",
                [current_cursor.to_string()],
            )?;
            tx.commit()?;
        }

        if wire_records.len() < PAGE_SIZE as usize {
            break;
        }
    }

    // --- PUSH PHASE ---
    let mut total_pushed: usize = 0;
    let mut stopped_by_quota = false;
    let mut bytes_used = 0u64;

    let outbox_count: usize = {
        let conn = db.conn()?;
        conn.query_row("SELECT count(*) FROM sync_outbox", [], |r| r.get::<_, i64>(0))
            .map(|c| c as usize)?
    };

    if outbox_count > 0 {
        let usage = call_server(server, &mut session, keys, &mut refreshed_already, |s| {
            server.usage(s)
        })?;
        bytes_used = usage.bytes;

        if usage.bytes >= quota_bytes {
            stopped_by_quota = true;
        } else {
            loop {
                let outbox_rows: Vec<(String, i64)> = {
                    let conn = db.conn()?;
                    let mut stmt = conn.prepare(
                        "SELECT record_id, changed_at FROM sync_outbox ORDER BY changed_at LIMIT ?1",
                    )?;
                    let rows = stmt.query_map([PAGE_SIZE], |r| Ok((r.get(0)?, r.get(1)?)))?;
                    rows.collect::<Result<_, _>>()?
                };

                if outbox_rows.is_empty() {
                    break;
                }

                let mut wire_batch = Vec::new();
                let mut missing_rows = Vec::new();

                {
                    let conn = db.conn()?;
                    for (record_id, outbox_changed_at) in &outbox_rows {
                        let exported = record::export(&conn, record_id)?;
                        let Some(rec) = exported else {
                            missing_rows.push(record_id.clone());
                            continue;
                        };

                        let last_rx: Option<String> = conn
                            .query_row(
                                "SELECT version FROM sync_versions WHERE record_id = ?1",
                                [record_id],
                                |r| r.get(0),
                            )
                            .optional()?;
                        let last_rx_changed_at =
                            last_rx.and_then(|v| parse_version(&v).map(|(t, _)| t)).unwrap_or(0);
                        let effective_changed_at = (*outbox_changed_at).max(last_rx_changed_at + 1);

                        let payload_plain = rec.payload.as_deref().unwrap_or(&[]);
                        let aad = crypto::aad(&user_id, &rec.id, effective_changed_at, &device_id);
                        let ciphertext = crypto::seal(&dek, &aad, payload_plain);

                        wire_batch.push(WireRecord {
                            id: rec.id,
                            changed_at: effective_changed_at,
                            device_id: device_id.clone(),
                            deleted: rec.deleted,
                            payload: Some(ciphertext),
                            seq: 0,
                        });
                    }
                }

                if !missing_rows.is_empty() {
                    let conn = db.conn()?;
                    for id in missing_rows {
                        conn.execute("DELETE FROM sync_outbox WHERE record_id = ?1", [&id])?;
                    }
                }

                if wire_batch.is_empty() {
                    break;
                }

                let rejected = call_server(server, &mut session, keys, &mut refreshed_already, |s| {
                    server.push(s, &wire_batch)
                })?;

                let rejected_ids: HashSet<String> = rejected.iter().map(|r| r.id.clone()).collect();

                {
                    let mut conn = db.conn()?;
                    let tx = conn.transaction()?;
                    for wire in &wire_batch {
                        if !rejected_ids.contains(&wire.id) {
                            tx.execute("DELETE FROM sync_outbox WHERE record_id = ?1", [&wire.id])?;
                            let v_str = format_version(wire.changed_at, &wire.device_id);
                            tx.execute(
                                "INSERT INTO sync_versions (record_id, version) VALUES (?1, ?2) ON CONFLICT(record_id) DO UPDATE SET version = excluded.version",
                                params![wire.id, v_str],
                            )?;
                            total_pushed += 1;
                        }
                    }

                    // For rejected records where server has a newer version, resolve outbox and record server version
                    for rej in &rejected {
                        let outbox_ts: Option<i64> = tx
                            .query_row(
                                "SELECT changed_at FROM sync_outbox WHERE record_id = ?1",
                                [&rej.id],
                                |r| r.get(0),
                            )
                            .optional()?;
                        if let Some(local_ts) = outbox_ts
                            && (rej.changed_at, rej.device_id.as_str()) >= (local_ts, device_id.as_str())
                        {
                            tx.execute("DELETE FROM sync_outbox WHERE record_id = ?1", [&rej.id])?;
                            let v_str = format_version(rej.changed_at, &rej.device_id);
                            tx.execute(
                                "INSERT INTO sync_versions (record_id, version) VALUES (?1, ?2) ON CONFLICT(record_id) DO UPDATE SET version = excluded.version",
                                params![rej.id, v_str],
                            )?;
                        }
                    }

                    tx.commit()?;
                }

                // If some rows were rejected, re-pull them from server
                if !rejected.is_empty() {
                    let pull_again =
                        call_server(server, &mut session, keys, &mut refreshed_already, |s| {
                            server.pull(s, current_cursor, PAGE_SIZE)
                        })?;

                    if !pull_again.is_empty() {
                        let mut conn = db.conn()?;
                        let tx = conn.transaction()?;
                        let mut to_apply = Vec::new();

                        for wire in &pull_again {
                            if wire.seq > current_cursor {
                                current_cursor = wire.seq;
                            }
                            let Some(ciphertext) = &wire.payload else {
                                continue;
                            };
                            let aad = crypto::aad(&user_id, &wire.id, wire.changed_at, &wire.device_id);
                            let Ok(decrypted) = crypto::open(&dek, &aad, ciphertext) else {
                                continue;
                            };
                            let rec = Record {
                                id: wire.id.clone(),
                                changed_at: wire.changed_at,
                                deleted: wire.deleted,
                                payload: Some(decrypted.clone()),
                            };
                            to_apply.push((rec, wire.changed_at, wire.device_id.clone(), decrypted));
                        }

                        if !to_apply.is_empty() {
                            let records_slice: Vec<Record> =
                                to_apply.iter().map(|(r, _, _, _)| r.clone()).collect();
                            let results = record::apply_batch(&tx, &records_slice)?;
                            for (idx, res) in results.into_iter().enumerate() {
                                let (rec, changed_at, wire_dev, _) = &to_apply[idx];
                                if let Ok(Applied::Done) = res {
                                    total_pulled += 1;
                                    let v_str = format_version(*changed_at, wire_dev);
                                    tx.execute(
                                        "INSERT INTO sync_versions (record_id, version) VALUES (?1, ?2) ON CONFLICT(record_id) DO UPDATE SET version = excluded.version",
                                        params![rec.id, v_str],
                                    )?;
                                    tx.execute(
                                        "DELETE FROM sync_outbox WHERE record_id = ?1",
                                        [&rec.id],
                                    )?;
                                    tx.execute(
                                        "DELETE FROM sync_pending WHERE record_id = ?1",
                                        [&rec.id],
                                    )?;
                                }
                            }
                        }

                        retry_pending(&tx, &mut total_pulled)?;
                        tx.execute(
                            "UPDATE sync_state SET value = ?1 WHERE key = 'cursor'",
                            [current_cursor.to_string()],
                        )?;
                        tx.commit()?;
                    }
                }

                if rejected.len() == wire_batch.len() || wire_batch.len() < PAGE_SIZE as usize {
                    break;
                }
            }
        }
    }

    let pending_count: usize = {
        let conn = db.conn()?;
        conn.execute(
            "UPDATE sync_state SET value = ?1 WHERE key = 'last_sync_at'",
            [now.to_string()],
        )?;
        conn.query_row("SELECT count(*) FROM sync_pending", [], |r| r.get::<_, i64>(0))
            .map(|c| c as usize)?
    };

    Ok(SyncReport {
        pulled: total_pulled,
        pushed: total_pushed,
        pending: pending_count,
        bytes_used,
        quota_bytes,
        stopped_by_quota,
    })
}

fn retry_pending(conn: &Connection, total_pulled: &mut usize) -> Result<(), AppError> {
    let mut retry_progress = true;
    let mut iterations = 0;
    while retry_progress && iterations < 10 {
        iterations += 1;
        retry_progress = false;

        let pending_rows: Vec<(String, String, Vec<u8>)> = {
            let mut stmt = conn.prepare("SELECT record_id, version, payload FROM sync_pending")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            rows.collect::<Result<_, _>>()?
        };

        if pending_rows.is_empty() {
            break;
        }

        let mut pending_records = Vec::new();
        let mut pending_meta = Vec::new();

        for (id, ver_str, payload) in pending_rows {
            let (ts, _) = parse_version(&ver_str).unwrap_or((0, ""));
            let deleted = is_tombstone_payload(&payload);
            pending_records.push(Record {
                id: id.clone(),
                changed_at: ts,
                deleted,
                payload: Some(payload),
            });
            pending_meta.push((id, ver_str));
        }

        let results = record::apply_batch(conn, &pending_records)?;
        for (idx, res) in results.into_iter().enumerate() {
            if let Ok(Applied::Done) = res {
                let (id, ver_str) = &pending_meta[idx];
                *total_pulled += 1;
                conn.execute("DELETE FROM sync_pending WHERE record_id = ?1", [id])?;
                conn.execute(
                    "INSERT INTO sync_versions (record_id, version) VALUES (?1, ?2) ON CONFLICT(record_id) DO UPDATE SET version = excluded.version",
                    params![id, ver_str],
                )?;
                conn.execute("DELETE FROM sync_outbox WHERE record_id = ?1", [id])?;
                retry_progress = true;
            }
        }
    }
    Ok(())
}
