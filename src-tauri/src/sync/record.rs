//! Item records contain deflated plaintext JSON. The sync engine encrypts them
//! later and owns version comparisons; applying a record never queues it again.
use miniz_oxide::{deflate::compress_to_vec, inflate::decompress_to_vec_with_limit};
use rusqlite::{Connection, OptionalExtension, params, params_from_iter, types::Value as SqlValue};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::AppError;

pub const SYNCED_TYPES: &[&str] = &["task", "project", "account", "transaction", "bill", "budget", "habit", "note", "page"];
pub const MAX_RECORD_BYTES: usize = 262_144;
pub const MAX_DECOMPRESSED_BYTES: usize = 8 * 1024 * 1024;
// crypto::seal adds a 24-byte nonce and a 16-byte Poly1305 tag.
const ENCRYPTION_OVERHEAD: usize = 40;

struct Extension {
    kind: &'static str,
    table: &'static str,
    columns: &'static [&'static str],
    references: &'static [&'static str],
}

const EXTENSIONS: &[Extension] = &[
    Extension {
        kind: "task",
        table: "tasks",
        columns: &["item_id", "status", "project_id", "start_at", "tag"],
        references: &["project_id"],
    },
    Extension { kind: "project", table: "projects", columns: &["item_id", "kind", "deadline_at", "repo_url"], references: &[] },
    Extension { kind: "account", table: "accounts", columns: &["item_id", "kind", "currency", "opening_balance"], references: &[] },
    Extension {
        kind: "transaction",
        table: "transactions",
        columns: &["item_id", "account_id", "amount", "category", "occurred_at", "transfer_id", "bill_id"],
        references: &["account_id", "bill_id"],
    },
    Extension {
        kind: "bill",
        table: "bills",
        columns: &["item_id", "account_id", "amount", "repeat", "due_day"],
        references: &["account_id"],
    },
    Extension { kind: "budget", table: "budgets", columns: &["item_id", "category", "amount"], references: &[] },
    Extension { kind: "habit", table: "habits", columns: &["item_id", "days", "remind_at", "remind_on", "auto_journal"], references: &[] },
    Extension {
        kind: "note",
        table: "journal_entries",
        columns: &["item_id", "kind", "mood", "tags", "task_id"],
        references: &["task_id"],
    },
];

#[derive(Serialize, Deserialize)]
struct ItemData {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    title: String,
    body: String,
    parent_id: Option<String>,
    due_at: Option<i64>,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
    completed_at: Option<i64>,
}

#[derive(Serialize, Deserialize)]
struct ItemDocument {
    schema: i64,
    item: ItemData,
    ext: Option<Map<String, Value>>,
}

#[derive(Serialize, Deserialize)]
struct CheckData {
    habit_id: String,
    date: String,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

#[derive(Serialize, Deserialize)]
struct CheckDocument {
    schema: i64,
    habit_check: CheckData,
}

#[derive(Serialize)]
struct TombstoneDocument<'a> {
    schema: i64,
    tombstone: bool,
    id: &'a str,
}

#[derive(Clone)]
pub struct Record {
    pub id: String,
    pub changed_at: i64,
    pub deleted: bool,
    /// Export always supplies a payload, including for tombstones; apply rejects `None`.
    pub payload: Option<Vec<u8>>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Applied {
    Done,
    NeedsParent(String),
    NewerSchema,
}

fn invalid_record() -> AppError {
    AppError::Invalid("Record sync tidak valid".into())
}

fn schema(conn: &Connection) -> Result<i64, AppError> {
    Ok(conn.pragma_query_value(None, "user_version", |r| r.get(0))?)
}

fn extension(kind: &str) -> Option<&'static Extension> {
    EXTENSIONS.iter().find(|ext| ext.kind == kind)
}

fn check_key(id: &str) -> Result<Option<(&str, &str)>, AppError> {
    let Some(key) = id.strip_prefix("hc:") else { return Ok(None) };
    let (habit, date) = key.rsplit_once(':').ok_or_else(invalid_record)?;
    if habit.is_empty() || date.parse::<jiff::civil::Date>().is_err() {
        return Err(invalid_record());
    }
    Ok(Some((habit, date)))
}

fn queued_at(conn: &Connection, id: &str) -> Result<Option<i64>, AppError> {
    Ok(conn.query_row("SELECT changed_at FROM sync_outbox WHERE record_id = ?1", [id], |r| r.get(0)).optional()?)
}

fn compressed<T: Serialize>(document: &T, title: &str) -> Result<Vec<u8>, AppError> {
    let json = serde_json::to_vec(document).map_err(|_| invalid_record())?;
    let payload = compress_to_vec(&json, 6);
    if payload.len() > MAX_RECORD_BYTES - ENCRYPTION_OVERHEAD {
        return Err(AppError::Invalid(format!("\"{title}\" terlalu besar untuk sync (batas 256 KB)")));
    }
    Ok(payload)
}

fn export_tombstone(conn: &Connection, id: &str, changed_at: i64) -> Result<Record, AppError> {
    let document = TombstoneDocument { schema: schema(conn)?, tombstone: true, id };
    Ok(Record { id: id.into(), changed_at, deleted: true, payload: Some(compressed(&document, id)?) })
}

fn export_extension(conn: &Connection, ext: &Extension, id: &str) -> Result<Option<Map<String, Value>>, AppError> {
    let sql = format!("SELECT {} FROM {} WHERE item_id = ?1", ext.columns.join(", "), ext.table);
    Ok(conn
        .query_row(&sql, [id], |row| {
            let mut values = Map::new();
            for (index, column) in ext.columns.iter().enumerate() {
                let value = match row.get::<_, SqlValue>(index)? {
                    SqlValue::Null => Value::Null,
                    SqlValue::Integer(value) => Value::from(value),
                    SqlValue::Text(value) => Value::from(value),
                    _ => return Err(rusqlite::Error::InvalidQuery),
                };
                values.insert((*column).into(), value);
            }
            Ok(values)
        })
        .optional()?)
}

/// Exports live rows, soft deletions, or hard deletions retained in the outbox.
/// Soft deletions retain the full row; only missing rows queued in the outbox
/// become tombstones. Missing unqueued rows and excluded types return `None`.
pub fn export(conn: &Connection, record_id: &str) -> Result<Option<Record>, AppError> {
    let queued = queued_at(conn, record_id)?;
    let (updated_at, payload) = if let Some((habit, date)) = check_key(record_id)? {
        let check = conn
            .query_row(
                "SELECT habit_id, date, created_at, updated_at, deleted_at FROM habit_checks WHERE habit_id = ?1 AND date = ?2",
                params![habit, date],
                |r| {
                    Ok(CheckData {
                        habit_id: r.get(0)?,
                        date: r.get(1)?,
                        created_at: r.get(2)?,
                        updated_at: r.get(3)?,
                        deleted_at: r.get(4)?,
                    })
                },
            )
            .optional()?;
        let Some(check) = check else {
            return queued.map(|changed_at| export_tombstone(conn, record_id, changed_at)).transpose();
        };
        let updated = check.updated_at.max(check.deleted_at.unwrap_or(0));
        let title: String = conn.query_row("SELECT title FROM items WHERE id = ?1", [habit], |r| r.get(0))?;
        let payload = compressed(&CheckDocument { schema: schema(conn)?, habit_check: check }, &title)?;
        (updated, payload)
    } else {
        let item = conn.query_row(
            "SELECT id, type, title, body, parent_id, due_at, created_at, updated_at, deleted_at, completed_at FROM items WHERE id = ?1",
            [record_id],
            |r| Ok(ItemData { id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, body: r.get(3)?, parent_id: r.get(4)?, due_at: r.get(5)?, created_at: r.get(6)?, updated_at: r.get(7)?, deleted_at: r.get(8)?, completed_at: r.get(9)? }),
        ).optional()?;
        let Some(item) = item else {
            return queued.map(|changed_at| export_tombstone(conn, record_id, changed_at)).transpose();
        };
        if !SYNCED_TYPES.contains(&item.kind.as_str()) {
            return Ok(None);
        }
        let updated = item.updated_at.max(item.deleted_at.unwrap_or(0));
        let ext = extension(&item.kind).map(|ext| export_extension(conn, ext, record_id)).transpose()?.flatten();
        let title = item.title.clone();
        let payload = compressed(&ItemDocument { schema: schema(conn)?, item, ext }, &title)?;
        (updated, payload)
    };
    Ok(Some(Record { id: record_id.into(), changed_at: queued.unwrap_or(updated_at), deleted: false, payload: Some(payload) }))
}

// A savepoint works both on its own and inside the engine's pull transaction.
// Any failure rolls back the flag together with partial rows/derived caches.
fn atomic<T>(conn: &Connection, operation: impl FnOnce() -> Result<T, AppError>) -> Result<T, AppError> {
    conn.execute_batch("SAVEPOINT sync_record;")?;
    match operation() {
        Ok(result) => {
            conn.execute_batch("RELEASE sync_record;")?;
            Ok(result)
        }
        Err(error) => {
            conn.execute_batch("ROLLBACK TO sync_record; RELEASE sync_record;")?;
            Err(error)
        }
    }
}

fn missing_parent(conn: &Connection, id: &str, parent: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(parent) = parent else { return Ok(None) };
    if parent == id {
        return Ok(None);
    }
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM items WHERE id = ?1)", [parent], |r| r.get(0))?;
    Ok((!exists).then(|| parent.to_string()))
}

fn extension_values(ext: &Extension, values: &Map<String, Value>, id: &str) -> Result<Vec<SqlValue>, AppError> {
    if values.len() != ext.columns.len() || values.get("item_id").and_then(Value::as_str) != Some(id) {
        return Err(invalid_record());
    }
    ext.columns
        .iter()
        .map(|column| match values.get(*column) {
            Some(Value::Null) => Ok(SqlValue::Null),
            Some(Value::String(value)) => Ok(SqlValue::Text(value.clone())),
            Some(Value::Number(value)) => value.as_i64().map(SqlValue::Integer).ok_or_else(invalid_record),
            _ => Err(invalid_record()),
        })
        .collect()
}

fn rebuild_links(conn: &Connection) -> Result<(), AppError> {
    // Rebuild all live sources: a newly arrived/renamed/deleted target can alter
    // the resolution of references in previously received records too.
    let sources: Vec<(String, String)> = conn
        .prepare("SELECT id, body FROM items WHERE deleted_at IS NULL AND body LIKE '%[[%'")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    conn.execute("DELETE FROM links", [])?;
    for (id, body) in sources {
        crate::links::refresh(conn, &id, &body)?;
    }
    Ok(())
}

fn apply_item(conn: &Connection, record: &Record, document: ItemDocument) -> Result<Applied, AppError> {
    let item = document.item;
    if item.id != record.id || !SYNCED_TYPES.contains(&item.kind.as_str()) {
        return Err(invalid_record());
    }
    let ext = extension(&item.kind);
    let ext_values = match (&document.ext, ext) {
        (Some(values), Some(ext)) => Some(extension_values(ext, values, &record.id)?),
        (None, _) => None,
        (Some(_), None) => return Err(invalid_record()),
    };
    if let Some(parent) = missing_parent(conn, &item.id, item.parent_id.as_deref())? {
        return Ok(Applied::NeedsParent(parent));
    }
    if let (Some(values), Some(ext)) = (&document.ext, ext) {
        for column in ext.references {
            let parent = match values.get(*column) {
                Some(Value::Null) => None,
                Some(Value::String(parent)) => Some(parent.as_str()),
                _ => return Err(invalid_record()),
            };
            if let Some(parent) = missing_parent(conn, &item.id, parent)? {
                return Ok(Applied::NeedsParent(parent));
            }
        }
    }
    conn.execute(
        "INSERT INTO items (id, type, title, body, parent_id, due_at, created_at, updated_at, deleted_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET type = excluded.type, title = excluded.title, body = excluded.body,
         parent_id = excluded.parent_id, due_at = excluded.due_at, created_at = excluded.created_at,
         updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, completed_at = excluded.completed_at",
        params![
            item.id,
            item.kind,
            item.title,
            item.body,
            item.parent_id,
            item.due_at,
            item.created_at,
            item.updated_at,
            item.deleted_at,
            item.completed_at
        ],
    )?;
    for other in EXTENSIONS {
        if other.kind != item.kind || document.ext.is_none() {
            conn.execute(&format!("DELETE FROM {} WHERE item_id = ?1", other.table), [&item.id])?;
        }
    }
    if let (Some(ext), Some(values)) = (ext, ext_values) {
        let placeholders = vec!["?"; ext.columns.len()].join(", ");
        let updates = ext.columns[1..].iter().map(|c| format!("{c} = excluded.{c}")).collect::<Vec<_>>().join(", ");
        let sql = format!(
            "INSERT INTO {} ({}) VALUES ({placeholders}) ON CONFLICT(item_id) DO UPDATE SET {updates}",
            ext.table,
            ext.columns.join(", ")
        );
        conn.execute(&sql, params_from_iter(values))?;
    }
    Ok(Applied::Done)
}

fn apply_inner(conn: &Connection, record: &Record) -> Result<Applied, AppError> {
    let key = check_key(&record.id)?;
    let payload = record.payload.as_ref().ok_or_else(invalid_record)?;
    if payload.len() > MAX_RECORD_BYTES - ENCRYPTION_OVERHEAD {
        return Err(invalid_record());
    }
    let plain = decompress_to_vec_with_limit(payload, MAX_DECOMPRESSED_BYTES).map_err(|_| invalid_record())?;
    let document: Value = serde_json::from_slice(&plain).map_err(|_| invalid_record())?;
    let incoming_schema = document.get("schema").and_then(Value::as_i64).ok_or_else(invalid_record)?;
    if incoming_schema < 1 {
        return Err(invalid_record());
    }
    if record.deleted
        && (document.get("tombstone").and_then(Value::as_bool) != Some(true)
            || document.get("id").and_then(Value::as_str) != Some(record.id.as_str()))
    {
        return Err(invalid_record());
    }
    if incoming_schema > schema(conn)? {
        return Ok(Applied::NewerSchema);
    }
    if record.deleted {
        if let Some((habit, date)) = key {
            conn.execute(
                "UPDATE habit_checks SET deleted_at = COALESCE(deleted_at, ?3), updated_at = ?3 WHERE habit_id = ?1 AND date = ?2",
                params![habit, date, record.changed_at],
            )?;
        } else {
            let sql = format!(
                "UPDATE items SET deleted_at = COALESCE(deleted_at, ?2) WHERE id = ?1 AND type IN ({})",
                vec!["?"; SYNCED_TYPES.len()].join(", "),
            );
            let mut values = vec![SqlValue::Text(record.id.clone()), SqlValue::Integer(record.changed_at)];
            values.extend(SYNCED_TYPES.iter().map(|s| SqlValue::Text((*s).into())));
            conn.execute(&sql, params_from_iter(values))?;
        }
        return Ok(Applied::Done);
    }
    if let Some((habit, date)) = key {
        let document: CheckDocument = serde_json::from_value(document).map_err(|_| invalid_record())?;
        let check = document.habit_check;
        if check.habit_id != habit || check.date != date {
            return Err(invalid_record());
        }
        if let Some(parent) = missing_parent(conn, &record.id, Some(habit))? {
            return Ok(Applied::NeedsParent(parent));
        }
        conn.execute(
            "INSERT INTO habit_checks (habit_id, date, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(habit_id, date) DO UPDATE SET created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
            params![check.habit_id, check.date, check.created_at, check.updated_at, check.deleted_at],
        )?;
        Ok(Applied::Done)
    } else {
        apply_item(conn, record, serde_json::from_value(document).map_err(|_| invalid_record())?)
    }
}

/// Applies one record and refreshes wikilinks. Use `apply_batch` for a pull page.
pub fn apply(conn: &Connection, record: &Record) -> Result<Applied, AppError> {
    let mut results = apply_batch(conn, std::slice::from_ref(record))?;
    results.remove(0)
}

/// Applies each record in its own savepoint, so one bad record does not undo the
/// others, then rebuilds wikilinks once: rebuilding per record is O(n²) on a full pull.
pub fn apply_batch(conn: &Connection, records: &[Record]) -> Result<Vec<Result<Applied, AppError>>, AppError> {
    let results: Vec<_> = records.iter().map(|record| apply_one(conn, record)).collect();
    if results.iter().any(|result| matches!(result, Ok(Applied::Done))) {
        rebuild_links(conn)?;
    }
    Ok(results)
}

/// Applies atomically with `applying = 1`, restoring the caller's previous flag.
/// Deferrals leave rows unchanged; the engine owns storage in sync_pending.
fn apply_one(conn: &Connection, record: &Record) -> Result<Applied, AppError> {
    atomic(conn, || {
        let previous: String = conn.query_row("SELECT value FROM sync_state WHERE key = 'applying'", [], |r| r.get(0))?;
        conn.execute("UPDATE sync_state SET value = '1' WHERE key = 'applying'", [])?;
        let result = apply_inner(conn, record)?;
        conn.execute("UPDATE sync_state SET value = ?1 WHERE key = 'applying'", [previous])?;
        Ok(result)
    })
}

/// First mapping includes soft-deleted items and habit checks. Preserve
/// any newer queued version; the engine further advances versions before push.
pub fn enqueue_all(conn: &Connection) -> Result<(), AppError> {
    atomic(conn, || {
        let sql = format!(
            "INSERT INTO sync_outbox (record_id, changed_at)
             SELECT id, CAST(unixepoch('subsec') * 1000 AS INTEGER) FROM items WHERE type IN ({})
             ON CONFLICT(record_id) DO UPDATE SET changed_at = MAX(sync_outbox.changed_at, excluded.changed_at)",
            vec!["?"; SYNCED_TYPES.len()].join(", "),
        );
        conn.execute(&sql, params_from_iter(SYNCED_TYPES.iter()))?;
        conn.execute(
            "INSERT INTO sync_outbox (record_id, changed_at)
             SELECT 'hc:' || habit_id || ':' || date, CAST(unixepoch('subsec') * 1000 AS INTEGER) FROM habit_checks WHERE 1
             ON CONFLICT(record_id) DO UPDATE SET changed_at = MAX(sync_outbox.changed_at, excluded.changed_at)",
            [],
        )?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db::open_in_memory, habits, items};
    use miniz_oxide::{deflate::compress_to_vec, inflate::decompress_to_vec};
    use rusqlite::params;
    use serde_json::{Value, json};

    // Fixtures exercise the tables found by the SQL write-path search, including
    // journal_entries (the extension of note) and bare notes/pages.
    const EXTENSIONS: &[(&str, &str, &str, &str)] = &[
        (
            "project",
            "projects",
            "INSERT INTO projects VALUES ('project', 'app', 90, 'https://example.test/repo', 1, 'local command', '/local/repo')",
            "kind = 'research'",
        ),
        ("account", "accounts", "INSERT INTO accounts VALUES ('account', 'bank', 'IDR', 9007199254740993)", "opening_balance = 400"),
        ("bill", "bills", "INSERT INTO bills VALUES ('bill', 'account', 500, 'monthly', 2)", "amount = 600"),
        (
            "transaction",
            "transactions",
            "INSERT INTO transactions VALUES ('transaction', 'account', -500, 'Makan', 42, 'transfer', 'bill')",
            "amount = -600",
        ),
        ("budget", "budgets", "INSERT INTO budgets VALUES ('budget', NULL, 5000)", "amount = 6000"),
        ("habit", "habits", "INSERT INTO habits VALUES ('habit', 127, '08:00', 1, 1)", "days = 31"),
        ("task", "tasks", "INSERT INTO tasks VALUES ('task', 'doing', 'project', 90, 'tag')", "status = 'review'"),
        ("note", "journal_entries", "INSERT INTO journal_entries VALUES ('note', 'idea', 4, 'tag', 'task')", "mood = 5"),
    ];

    fn insert_item(conn: &Connection, id: &str, kind: &str) {
        conn.execute("INSERT INTO items (id, type, title, body, due_at, created_at, updated_at, opened_at, completed_at) VALUES (?1, ?2, ?1, 'isi', 80, 10, 20, 30, 40)", params![id, kind]).unwrap();
    }

    fn fixtures(conn: &Connection) {
        for kind in SYNCED_TYPES {
            insert_item(conn, kind, kind);
        }
        for (_, _, sql, _) in EXTENSIONS {
            conn.execute_batch(sql).unwrap();
        }
        conn.execute("UPDATE items SET parent_id = 'task' WHERE id = 'note'", []).unwrap();
        conn.execute("INSERT INTO habit_checks (habit_id, date, created_at, updated_at) VALUES ('habit', '2026-10-02', 50, 60)", [])
            .unwrap();
    }

    fn clear_outbox(conn: &Connection) {
        conn.execute("DELETE FROM sync_outbox", []).unwrap();
    }

    fn outbox(conn: &Connection) -> Vec<String> {
        conn.prepare("SELECT record_id FROM sync_outbox ORDER BY record_id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn only_outbox(conn: &Connection, id: &str) {
        assert_eq!(outbox(conn), vec![id.to_string()]);
        let timestamp: i64 = conn.query_row("SELECT changed_at FROM sync_outbox WHERE record_id = ?1", [id], |r| r.get(0)).unwrap();
        assert!(timestamp >= crate::time::now_ms() - 10_000);
    }

    fn document(record: &Record) -> Value {
        serde_json::from_slice(&decompress_to_vec(record.payload.as_ref().unwrap()).unwrap()).unwrap()
    }

    fn with_document(record: &Record, value: Value) -> Record {
        Record { payload: Some(compress_to_vec(&serde_json::to_vec(&value).unwrap(), 6)), ..record.clone() }
    }

    fn applying(conn: &Connection) -> String {
        conn.query_row("SELECT value FROM sync_state WHERE key = 'applying'", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn batch_isolates_a_bad_record_and_applies_the_rest() {
        let source = open_in_memory();
        fixtures(&source);
        let good = export(&source, "task").unwrap().unwrap();
        let bad = Record { payload: Some(vec![1, 2, 3]), ..good.clone() };
        let other = export(&source, "page").unwrap().unwrap();
        let target = open_in_memory();
        let results = apply_batch(&target, &[bad, other.clone()]).unwrap();
        assert!(results[0].is_err());
        assert!(matches!(results[1], Ok(Applied::Done)));
        assert_eq!(export(&target, "page").unwrap().unwrap().payload, other.payload);
        assert!(export(&target, "task").unwrap().is_none());
    }

    #[test]
    fn items_insert_update_soft_delete_restore_and_delete_are_captured_for_every_synced_type() {
        let conn = open_in_memory();
        assert_eq!(SYNCED_TYPES, &["task", "project", "account", "transaction", "bill", "budget", "habit", "note", "page"]);
        for kind in SYNCED_TYPES {
            clear_outbox(&conn);
            insert_item(&conn, kind, kind);
            only_outbox(&conn, kind);
            for change in ["body = 'baru'", "completed_at = 99", "deleted_at = 99", "deleted_at = NULL"] {
                clear_outbox(&conn);
                conn.execute(&format!("UPDATE items SET {change} WHERE id = ?1"), [kind]).unwrap();
                only_outbox(&conn, kind);
            }
            clear_outbox(&conn);
            conn.execute("DELETE FROM items WHERE id = ?1", [kind]).unwrap();
            only_outbox(&conn, kind);
            let record = export(&conn, kind).unwrap().unwrap();
            assert!(record.deleted);
            assert_eq!(document(&record), json!({"schema":12,"tombstone":true,"id":kind}));
        }
    }

    #[test]
    fn every_extension_insert_update_and_delete_enqueues_its_parent() {
        let conn = open_in_memory();
        for kind in SYNCED_TYPES {
            insert_item(&conn, kind, kind);
        }
        for (id, table, insert, update) in EXTENSIONS {
            clear_outbox(&conn);
            conn.execute_batch(insert).unwrap();
            only_outbox(&conn, id);
            clear_outbox(&conn);
            conn.execute(&format!("UPDATE {table} SET {update} WHERE item_id = ?1"), [id]).unwrap();
            only_outbox(&conn, id);
        }
        for (id, table, _, _) in EXTENSIONS.iter().rev() {
            clear_outbox(&conn);
            conn.execute(&format!("DELETE FROM {table} WHERE item_id = ?1"), [id]).unwrap();
            only_outbox(&conn, id);
        }
    }

    #[test]
    fn local_only_columns_do_not_create_new_versions() {
        let conn = open_in_memory();
        fixtures(&conn);
        clear_outbox(&conn);
        for kind in SYNCED_TYPES {
            conn.execute("UPDATE items SET opened_at = 999 WHERE id = ?1", [kind]).unwrap();
        }
        conn.execute("UPDATE projects SET agent = 1, agent_command = 'codex', agent_dir = '/tmp/x' WHERE item_id = 'project'", []).unwrap();
        assert!(outbox(&conn).is_empty());
        conn.execute("UPDATE projects SET repo_url = 'https://github.com/a/b' WHERE item_id = 'project'", []).unwrap();
        only_outbox(&conn, "project");
    }

    #[test]
    fn project_saves_with_only_local_changes_or_identical_values_do_not_enqueue() {
        use crate::projects::{ProjectInput, save_project};
        let conn = open_in_memory();
        let tz = jiff::tz::TimeZone::get("Asia/Jakarta").unwrap();
        let dir = tempfile::tempdir_in(".").unwrap();
        let mut input = ProjectInput { name: "Project".into(), ..Default::default() };
        let project = save_project(&conn, &input, 100, &tz).unwrap();
        input.id = Some(project.summary.id.clone());
        clear_outbox(&conn);
        for index in 0..4 {
            match index {
                1 => input.agent = true,
                2 => input.agent_command = Some("codex".into()),
                3 => input.agent_dir = Some(dir.path().to_str().unwrap().into()),
                _ => {}
            }
            save_project(&conn, &input, 200 + index, &tz).unwrap();
            assert!(outbox(&conn).is_empty(), "local change {index}");
        }
        input.description = "Changed content".into();
        save_project(&conn, &input, 300, &tz).unwrap();
        only_outbox(&conn, &project.summary.id);
        clear_outbox(&conn);
        save_project(&conn, &input, 400, &tz).unwrap();
        assert!(outbox(&conn).is_empty());
        input.repo_url = Some("https://github.com/example/repo".into());
        save_project(&conn, &input, 500, &tz).unwrap();
        only_outbox(&conn, &project.summary.id);
    }

    #[test]
    fn identical_updates_on_every_synced_table_and_item_timestamp_bumps_do_not_enqueue() {
        let conn = open_in_memory();
        fixtures(&conn);
        clear_outbox(&conn);
        conn.execute_batch(
            "UPDATE items SET type = type, title = title, body = body, parent_id = parent_id,
             due_at = due_at, completed_at = completed_at, created_at = created_at,
             updated_at = updated_at + 1, deleted_at = deleted_at;
             UPDATE habit_checks SET habit_id = habit_id, date = date, created_at = created_at,
             updated_at = updated_at, deleted_at = deleted_at;",
        ).unwrap();
        assert!(outbox(&conn).is_empty());
        for ext in super::EXTENSIONS {
            let assignments = ext.columns.iter().map(|column| format!("{column} = {column}")).collect::<Vec<_>>().join(", ");
            conn.execute(&format!("UPDATE {} SET {assignments}", ext.table), []).unwrap();
            assert!(outbox(&conn).is_empty(), "{}", ext.table);
        }
        conn.execute("UPDATE items SET parent_id = 'page' WHERE id = 'budget'", []).unwrap();
        only_outbox(&conn, "budget");
        clear_outbox(&conn);
        conn.execute("UPDATE items SET parent_id = NULL WHERE id = 'budget'", []).unwrap();
        only_outbox(&conn, "budget");
    }

    #[test]
    fn excluded_types_and_local_tables_never_enqueue_records() {
        let conn = open_in_memory();
        for kind in ["email", "activity", "download", "file"] {
            insert_item(&conn, kind, kind);
            assert!(export(&conn, kind).unwrap().is_none());
            conn.execute("UPDATE items SET body = 'cache', deleted_at = 99 WHERE id = ?1", [kind]).unwrap();
            conn.execute("DELETE FROM items WHERE id = ?1", [kind]).unwrap();
        }
        conn.execute("INSERT INTO settings VALUES ('local', 'preference')", []).unwrap();
        assert!(outbox(&conn).is_empty());
        assert!(export(&conn, "missing").unwrap().is_none());
    }

    #[test]
    fn applying_flag_suppresses_all_table_triggers() {
        let conn = open_in_memory();
        conn.execute("UPDATE sync_state SET value = '1' WHERE key = 'applying'", []).unwrap();
        fixtures(&conn);
        conn.execute_batch(
            "UPDATE items SET body = 'remote', deleted_at = 99;
            UPDATE habit_checks SET deleted_at = 99;
            DELETE FROM habit_checks;",
        )
        .unwrap();
        for (_, table, _, change) in EXTENSIONS {
            conn.execute_batch(&format!("UPDATE {table} SET {change}; DELETE FROM {table};")).unwrap();
        }
        conn.execute("DELETE FROM items", []).unwrap();
        assert!(outbox(&conn).is_empty());
    }

    #[test]
    fn habit_command_check_cancel_recheck_and_delete_enqueue_and_update_check_timestamp() {
        let conn = open_in_memory();
        let tz = jiff::tz::TimeZone::get("Asia/Jakarta").unwrap();
        let now = "2026-10-02T10:00:00+07:00".parse::<jiff::Timestamp>().unwrap().as_millisecond();
        let habit =
            habits::save_habit(&conn, &habits::HabitInput { name: "Baca".into(), days: 127, ..Default::default() }, now, &tz).unwrap();
        only_outbox(&conn, &habit.id);
        let check_id = format!("hc:{}:2026-10-02", habit.id);
        for (index, done) in [true, false, true].into_iter().enumerate() {
            clear_outbox(&conn);
            let timestamp = now + index as i64 + 1;
            habits::check_habit(&conn, &habit.id, done, timestamp, &tz).unwrap();
            only_outbox(&conn, &check_id);
            let (created, updated): (i64, i64) = conn
                .query_row("SELECT created_at, updated_at FROM habit_checks WHERE habit_id = ?1", [&habit.id], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .unwrap();
            assert_eq!(created, now + 1);
            assert_eq!(updated, timestamp);
            let record = export(&conn, &check_id).unwrap().unwrap();
            assert!(!record.deleted);
            assert_eq!(document(&record)["habit_check"]["deleted_at"], if done { Value::Null } else { json!(timestamp) });
        }
        clear_outbox(&conn);
        habits::delete_habit(&conn, &habit.id, now + 9).unwrap();
        only_outbox(&conn, &habit.id);
        assert_eq!(conn.query_row("SELECT updated_at FROM items WHERE id = ?1", [&habit.id], |r| r.get::<_, i64>(0)).unwrap(), now);
    }

    #[test]
    fn habit_check_physical_delete_is_captured() {
        let conn = open_in_memory();
        fixtures(&conn);
        clear_outbox(&conn);
        conn.execute("DELETE FROM habit_checks", []).unwrap();
        only_outbox(&conn, "hc:habit:2026-10-02");
        let record = export(&conn, "hc:habit:2026-10-02").unwrap().unwrap();
        assert!(record.deleted);
        assert_eq!(document(&record), json!({"schema":12,"tombstone":true,"id":record.id}));
    }

    #[test]
    fn compound_task_writes_capture_subtasks_project_detachment_and_note_conversion() {
        use crate::{projects, tasks};
        let conn = open_in_memory();
        let tz = jiff::tz::TimeZone::get("Asia/Jakarta").unwrap();
        insert_item(&conn, "project", "project");
        conn.execute("INSERT INTO projects (item_id, kind) VALUES ('project', 'app')", []).unwrap();
        clear_outbox(&conn);
        let task = tasks::create_task(
            &conn,
            &tasks::NewTask { title: "Parent".into(), project_id: Some("project".into()), ..Default::default() },
            100,
            &tz,
        )
        .unwrap();
        only_outbox(&conn, &task.id);
        clear_outbox(&conn);
        let child = tasks::create_task(
            &conn,
            &tasks::NewTask { title: "Child".into(), parent_id: Some(task.id.clone()), ..Default::default() },
            100,
            &tz,
        )
        .unwrap();
        only_outbox(&conn, &child.id);
        clear_outbox(&conn);
        tasks::update_task(
            &conn,
            &task.id,
            &tasks::TaskPatch {
                status: Some(tasks::TaskStatus::Doing),
                start_at: Some(Some(100)),
                tag: Some(Some("tag".into())),
                ..Default::default()
            },
            200,
            &tz,
        )
        .unwrap();
        only_outbox(&conn, &task.id); // activity written by status changes stays local
        clear_outbox(&conn);
        projects::delete_project(&conn, "project", 300).unwrap();
        let mut expected = vec![task.id.clone(), child.id.clone(), "project".into()];
        expected.sort();
        assert_eq!(outbox(&conn), expected);
        assert_eq!(conn.query_row("SELECT updated_at FROM items WHERE id = ?1", [&child.id], |r| r.get::<_, i64>(0)).unwrap(), 100);
        clear_outbox(&conn);
        tasks::delete_task(&conn, &task.id, 400).unwrap();
        let mut expected = vec![task.id, child.id];
        expected.sort();
        assert_eq!(outbox(&conn), expected);
        let note = items::capture_note(&conn, "Convert", 100).unwrap();
        clear_outbox(&conn);
        tasks::convert_to_task(&conn, &note.id, 200, &tz).unwrap();
        only_outbox(&conn, &note.id);
        assert_eq!(document(&export(&conn, &note.id).unwrap().unwrap())["item"]["type"], "task");
    }

    #[test]
    fn page_writes_capture_rewritten_mentions_moves_and_subtree_trash_restore() {
        use crate::notes;
        let conn = open_in_memory();
        let parent = notes::create(&conn, None, "Parent", 100).unwrap();
        let child = notes::create(&conn, Some(&parent.id), "Child", 100).unwrap();
        clear_outbox(&conn);
        notes::save_body(&conn, &child.id, "[[Parent]]", 200).unwrap();
        only_outbox(&conn, &child.id);
        clear_outbox(&conn);
        notes::rename(&conn, &parent.id, "Renamed", 300).unwrap();
        let mut expected = vec![parent.id.clone(), child.id.clone()];
        expected.sort();
        assert_eq!(outbox(&conn), expected);
        clear_outbox(&conn);
        notes::move_page(&conn, &child.id, None, 400).unwrap();
        only_outbox(&conn, &child.id);
        notes::move_page(&conn, &child.id, Some(&parent.id), 500).unwrap();
        clear_outbox(&conn);
        notes::delete(&conn, &parent.id, 600).unwrap();
        assert_eq!(outbox(&conn), expected);
        clear_outbox(&conn);
        notes::restore(&conn, &parent.id, 700).unwrap();
        assert_eq!(outbox(&conn), expected);
    }

    #[test]
    fn journal_extension_upsert_conversion_and_auto_habit_check_enqueue_records() {
        use crate::journal;
        let conn = open_in_memory();
        let tz = jiff::tz::TimeZone::get("Asia/Jakarta").unwrap();
        let now = "2026-10-02T10:00:00+07:00".parse::<jiff::Timestamp>().unwrap().as_millisecond();
        let habit = habits::save_habit(
            &conn,
            &habits::HabitInput { name: "Jurnal".into(), days: 127, auto_journal: true, ..Default::default() },
            now,
            &tz,
        )
        .unwrap();
        let note = items::capture_note(&conn, "Idea", now).unwrap();
        clear_outbox(&conn);
        journal::update_entry(
            &conn,
            &note.id,
            &journal::EntryPatch { kind: Some(journal::EntryKind::Idea), mood: Some(Some(5)), tags: Some("tag".into()) },
            now,
            &tz,
        )
        .unwrap();
        only_outbox(&conn, &note.id);
        clear_outbox(&conn);
        journal::entry_to_task(&conn, &note.id, now, &tz).unwrap();
        let task_id: String = conn.query_row("SELECT task_id FROM journal_entries WHERE item_id = ?1", [&note.id], |r| r.get(0)).unwrap();
        let mut expected = vec![note.id.clone(), task_id];
        expected.sort();
        assert_eq!(outbox(&conn), expected);
        items::update(&conn, &note.id, &items::ItemPatch { body: Some("Refleksi".into()), ..Default::default() }, now).unwrap();
        clear_outbox(&conn);
        journal::after_note_saved(&conn, &note.id, now, &tz).unwrap();
        only_outbox(&conn, &format!("hc:{}:2026-10-02", habit.id));
    }

    #[test]
    fn finance_writes_capture_both_transfer_legs_bill_payment_and_budget_changes() {
        use crate::{bills, finance, overview};
        let conn = open_in_memory();
        let tz = jiff::tz::TimeZone::get("Asia/Jakarta").unwrap();
        let now = "2026-10-02T10:00:00+07:00".parse::<jiff::Timestamp>().unwrap().as_millisecond();
        let from = finance::save_account(
            &conn,
            &finance::AccountInput { name: "Bank".into(), kind: "bank".into(), ..Default::default() },
            now,
            &tz,
        )
        .unwrap();
        let to = finance::save_account(
            &conn,
            &finance::AccountInput { name: "Cash".into(), kind: "cash".into(), ..Default::default() },
            now,
            &tz,
        )
        .unwrap();
        clear_outbox(&conn);
        let mut transfer_input = finance::TransferInput {
            from_account_id: from.id.clone(),
            to_account_id: to.id,
            amount: 500,
            occurred_at: now,
            ..Default::default()
        };
        let transfer = finance::save_transfer(&conn, &transfer_input, now, &tz).unwrap();
        let legs = outbox(&conn);
        assert_eq!(legs.len(), 2);
        clear_outbox(&conn);
        transfer_input.transfer_id = transfer.transfer_id;
        transfer_input.amount = 600;
        finance::save_transfer(&conn, &transfer_input, now, &tz).unwrap();
        assert_eq!(outbox(&conn), legs);
        clear_outbox(&conn);
        finance::delete_transaction(&conn, &transfer.id, now, &tz).unwrap();
        assert_eq!(outbox(&conn), legs);
        clear_outbox(&conn);
        let bill = bills::save_bill(
            &conn,
            &bills::BillInput {
                id: None,
                name: "Listrik".into(),
                amount: 500,
                account_id: from.id,
                repeat: bills::Repeat::Monthly,
                due_at: now,
            },
            now,
            &tz,
        )
        .unwrap();
        only_outbox(&conn, &bill.id);
        clear_outbox(&conn);
        let payment = bills::pay_bill(&conn, &bill.id, now, &tz).unwrap();
        let mut expected = vec![bill.id, payment.id];
        expected.sort();
        assert_eq!(outbox(&conn), expected);
        clear_outbox(&conn);
        overview::set_budget(&conn, Some(5000), now).unwrap();
        let budget = outbox(&conn);
        assert_eq!(budget.len(), 1);
        clear_outbox(&conn);
        overview::set_budget(&conn, Some(6000), now).unwrap();
        assert_eq!(outbox(&conn), budget);
        clear_outbox(&conn);
        overview::set_budget(&conn, None, now).unwrap();
        assert_eq!(outbox(&conn), budget);
    }

    #[test]
    fn export_apply_round_trip_all_types_checks_and_local_field_exclusion() {
        let source = open_in_memory();
        let destination = open_in_memory();
        fixtures(&source);
        for id in ["project", "account", "bill", "transaction", "budget", "habit", "task", "note", "page", "hc:habit:2026-10-02"] {
            let record = export(&source, id).unwrap().unwrap();
            let value = document(&record);
            assert_eq!(value["schema"], 12);
            assert!(value["item"].get("opened_at").is_none());
            for field in ["agent", "agent_command", "agent_dir"] {
                assert!(value["ext"].get(field).is_none());
            }
            assert_eq!(apply(&destination, &record).unwrap(), Applied::Done, "{id}");
            assert_eq!(document(&export(&destination, id).unwrap().unwrap()), value, "{id}");
        }
        // Compare stored rows independently of the serializer, so an omitted
        // synced column cannot disappear unnoticed from both exported copies.
        let rows = |conn: &Connection, sql: &str| {
            let mut statement = conn.prepare(sql).unwrap();
            let count = statement.column_count();
            statement
                .query_map([], |r| (0..count).map(|index| r.get::<_, SqlValue>(index)).collect::<rusqlite::Result<Vec<_>>>())
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        for sql in [
            "SELECT id, type, title, body, parent_id, due_at, created_at, updated_at, deleted_at, completed_at FROM items ORDER BY id",
            "SELECT item_id, kind, deadline_at, repo_url FROM projects ORDER BY item_id",
            "SELECT * FROM tasks ORDER BY item_id",
            "SELECT * FROM accounts ORDER BY item_id",
            "SELECT * FROM transactions ORDER BY item_id",
            "SELECT * FROM bills ORDER BY item_id",
            "SELECT * FROM budgets ORDER BY item_id",
            "SELECT * FROM habits ORDER BY item_id",
            "SELECT * FROM journal_entries ORDER BY item_id",
            "SELECT * FROM habit_checks ORDER BY habit_id, date",
        ] {
            assert_eq!(rows(&source, sql), rows(&destination, sql), "{sql}");
        }
        assert!(outbox(&destination).is_empty());
        assert_eq!(applying(&destination), "0");
        assert_eq!(destination.query_row("SELECT opening_balance FROM accounts", [], |r| r.get::<_, i64>(0)).unwrap(), 9007199254740993);
        assert_eq!(
            destination.query_row("SELECT opened_at FROM items WHERE id = 'project'", [], |r| r.get::<_, Option<i64>>(0)).unwrap(),
            None
        );
        assert!(!destination.query_row("SELECT agent FROM projects", [], |r| r.get::<_, bool>(0)).unwrap());
        // Importing again must preserve the device's local fields.
        destination.execute_batch("UPDATE items SET opened_at = 77 WHERE id = 'project'; UPDATE projects SET agent = 1, agent_command = 'mine', agent_dir = '/mine';").unwrap();
        clear_outbox(&destination);
        apply(&destination, &export(&source, "project").unwrap().unwrap()).unwrap();
        assert_eq!(destination.query_row("SELECT opened_at FROM items WHERE id = 'project'", [], |r| r.get::<_, i64>(0)).unwrap(), 77);
        assert_eq!(destination.query_row("SELECT agent_command FROM projects", [], |r| r.get::<_, String>(0)).unwrap(), "mine");
        assert!(outbox(&destination).is_empty());
    }

    #[test]
    fn extension_deletions_and_item_type_changes_replace_the_received_record() {
        let source = open_in_memory();
        let destination = open_in_memory();
        insert_item(&source, "note", "note");
        source.execute("INSERT INTO journal_entries (item_id, kind) VALUES ('note', 'idea')", []).unwrap();
        apply(&destination, &export(&source, "note").unwrap().unwrap()).unwrap();
        source.execute("DELETE FROM journal_entries WHERE item_id = 'note'", []).unwrap();
        apply(&destination, &export(&source, "note").unwrap().unwrap()).unwrap();
        assert_eq!(destination.query_row("SELECT COUNT(*) FROM journal_entries", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        source
            .execute_batch(
                "INSERT INTO journal_entries (item_id, kind) VALUES ('note', 'idea');
            UPDATE items SET type = 'task' WHERE id = 'note'; INSERT INTO tasks (item_id, status) VALUES ('note', 'plan');",
            )
            .unwrap();
        apply(&destination, &export(&source, "note").unwrap().unwrap()).unwrap();
        assert_eq!(
            destination.query_row("SELECT status FROM tasks WHERE item_id = 'note'", [], |r| r.get::<_, String>(0)).unwrap(),
            "plan"
        );
        assert_eq!(document(&export(&destination, "note").unwrap().unwrap()), document(&export(&source, "note").unwrap().unwrap()));
        assert!(outbox(&destination).is_empty());
    }

    #[test]
    fn missing_references_wait_without_partial_writes() {
        let source = open_in_memory();
        fixtures(&source);
        for (id, parent) in
            [("task", "project"), ("transaction", "account"), ("bill", "account"), ("note", "task"), ("hc:habit:2026-10-02", "habit")]
        {
            let destination = open_in_memory();
            let record = export(&source, id).unwrap().unwrap();
            assert_eq!(apply(&destination, &record).unwrap(), Applied::NeedsParent(parent.into()));
            assert_eq!(destination.query_row("SELECT COUNT(*) FROM items", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
            assert_eq!(applying(&destination), "0");
            assert!(outbox(&destination).is_empty());
        }
        // Optional FK references also need to wait (bill_id, journal task_id).
        let destination = open_in_memory();
        apply(&destination, &export(&source, "account").unwrap().unwrap()).unwrap();
        assert_eq!(apply(&destination, &export(&source, "transaction").unwrap().unwrap()).unwrap(), Applied::NeedsParent("bill".into()));
        let note = export(&source, "note").unwrap().unwrap();
        let mut value = document(&note);
        value["item"]["parent_id"] = Value::Null;
        assert_eq!(apply(&destination, &with_document(&note, value)).unwrap(), Applied::NeedsParent("task".into()));
    }

    #[test]
    fn newer_schema_is_deferred_before_reading_unknown_fields() {
        let conn = open_in_memory();
        let record = Record {
            id: "future".into(),
            changed_at: 99,
            deleted: false,
            payload: Some(compress_to_vec(br#"{"schema":13,"future":true}"#, 6)),
        };
        assert_eq!(apply(&conn, &record).unwrap(), Applied::NewerSchema);
        assert_eq!(applying(&conn), "0");
        assert!(outbox(&conn).is_empty());
    }

    #[test]
    fn apply_updates_search_and_rebuilds_links_in_either_arrival_order() {
        let source = open_in_memory();
        let target = items::insert(&source, "page", "Target", "", 10).unwrap();
        let origin = items::insert(&source, "note", "Origin", "[[Target]]", 20).unwrap();
        for order in [[&origin, &target], [&target, &origin]] {
            let conn = open_in_memory();
            for id in order {
                apply(&conn, &export(&source, id).unwrap().unwrap()).unwrap();
            }
            assert_eq!(
                conn.query_row("SELECT from_id, to_id FROM links", [], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).unwrap(),
                (origin.clone(), target.clone())
            );
            assert_eq!(
                conn.query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'Origin'", [], |r| r.get::<_, i64>(0)).unwrap(),
                1
            );
            source.execute("UPDATE items SET title = 'Renamed', body = 'changed' WHERE id = ?1", [&origin]).unwrap();
            apply(&conn, &export(&source, &origin).unwrap().unwrap()).unwrap();
            assert_eq!(
                conn.query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'Renamed'", [], |r| r.get::<_, i64>(0)).unwrap(),
                1
            );
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM links", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
            source.execute("UPDATE items SET title = 'Origin', body = '[[Target]]' WHERE id = ?1", [&origin]).unwrap();
        }
    }

    #[test]
    fn tombstones_apply_to_existing_and_missing_rows_and_can_be_restored() {
        let source = open_in_memory();
        let destination = open_in_memory();
        fixtures(&source);
        for id in ["habit", "hc:habit:2026-10-02"] {
            apply(&destination, &export(&source, id).unwrap().unwrap()).unwrap();
        }
        for id in ["habit", "hc:habit:2026-10-02"] {
            let live = export(&source, id).unwrap().unwrap();
            let record = with_document(
                &Record { changed_at: 100, deleted: true, ..live.clone() },
                json!({"schema":12,"tombstone":true,"id":id}),
            );
            let missing = open_in_memory();
            assert_eq!(apply(&missing, &record).unwrap(), Applied::Done);
            assert!(export(&missing, id).unwrap().is_none());
            for changed_at in [100, 200] {
                assert_eq!(apply(&destination, &Record { changed_at, ..record.clone() }).unwrap(), Applied::Done);
                let soft_deleted = export(&destination, id).unwrap().unwrap();
                assert!(!soft_deleted.deleted);
                let value = document(&soft_deleted);
                let row = if id.starts_with("hc:") { &value["habit_check"] } else { &value["item"] };
                assert_eq!(row["deleted_at"], 100);
            }
            assert!(outbox(&destination).is_empty());
            assert_eq!(applying(&destination), "0");
            apply(&destination, &live).unwrap();
            assert_eq!(document(&export(&destination, id).unwrap().unwrap()), document(&live));
        }
    }

    #[test]
    fn soft_deleted_items_and_checks_round_trip_exact_deletion_timestamps() {
        let source = open_in_memory();
        fixtures(&source);
        let existing = open_in_memory();
        let empty = open_in_memory();
        let ids = ["project", "account", "bill", "transaction", "budget", "habit", "task", "note", "page", "hc:habit:2026-10-02"];
        for id in ids {
            apply(&existing, &export(&source, id).unwrap().unwrap()).unwrap();
        }
        source.execute("UPDATE items SET deleted_at = 123, updated_at = 456", []).unwrap();
        source.execute("UPDATE habit_checks SET deleted_at = 321, updated_at = 654", []).unwrap();
        for (index, id) in ids.into_iter().enumerate() {
            let record = Record { changed_at: 1000 + index as i64, ..export(&source, id).unwrap().unwrap() };
            assert!(!record.deleted, "{id}");
            let value = document(&record);
            let row = if id.starts_with("hc:") { &value["habit_check"] } else { &value["item"] };
            assert_eq!(row["deleted_at"], if id.starts_with("hc:") { 321 } else { 123 });
            for target in [&existing, &empty] {
                assert_eq!(apply(target, &record).unwrap(), Applied::Done, "{id}");
                assert_eq!(document(&export(target, id).unwrap().unwrap()), value, "{id}");
                assert!(outbox(target).is_empty());
            }
        }
    }

    #[test]
    fn synced_page_subtree_keeps_trash_grouping_and_restores_together() {
        use crate::notes;
        let source = open_in_memory();
        let root = notes::create(&source, None, "Root", 100).unwrap();
        let child = notes::create(&source, Some(&root.id), "Child", 100).unwrap();
        let grandchild = notes::create(&source, Some(&child.id), "Grandchild", 100).unwrap();
        let earlier = notes::create(&source, Some(&root.id), "Earlier deletion", 100).unwrap();
        notes::delete(&source, &earlier.id, 500).unwrap();
        notes::delete(&source, &root.id, 600).unwrap();
        let records: Vec<_> = [&root.id, &child.id, &grandchild.id, &earlier.id].into_iter().enumerate()
            .map(|(index, id)| Record { changed_at: 1000 + index as i64, ..export(&source, id).unwrap().unwrap() })
            .collect();
        let target = open_in_memory();
        assert!(apply_batch(&target, &records).unwrap().into_iter().all(|result| matches!(result, Ok(Applied::Done))));
        let trash = notes::trash(&target).unwrap();
        assert_eq!(trash.len(), 2);
        assert_eq!((trash[0].id.as_str(), trash[0].deleted_at, trash[0].descendants), (root.id.as_str(), 600, 2));
        notes::restore(&target, &root.id, 2000).unwrap();
        for id in [&root.id, &child.id, &grandchild.id] {
            assert_eq!(target.query_row("SELECT deleted_at FROM items WHERE id = ?1", [id], |r| r.get::<_, Option<i64>>(0)).unwrap(), None);
            let restored = export(&target, id).unwrap().unwrap();
            assert_eq!(apply(&source, &restored).unwrap(), Applied::Done);
        }
        let trash = notes::trash(&target).unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!((trash[0].id.as_str(), trash[0].deleted_at), (earlier.id.as_str(), 500));
        assert_eq!(notes::trash(&source).unwrap(), trash);
        assert_eq!(target.query_row("SELECT parent_id FROM items WHERE id = ?1", [&grandchild.id], |r| r.get::<_, String>(0)).unwrap(), child.id);
    }

    #[test]
    fn live_transaction_referencing_a_soft_deleted_bill_applies_on_an_empty_database() {
        let source = open_in_memory();
        fixtures(&source);
        source.execute("UPDATE items SET deleted_at = 123 WHERE id = 'bill'", []).unwrap();
        let target = open_in_memory();
        for id in ["account", "bill", "transaction"] {
            let record = export(&source, id).unwrap().unwrap();
            assert!(!record.deleted);
            assert_eq!(apply(&target, &record).unwrap(), Applied::Done, "{id}");
        }
        let payment: (String, Option<i64>, Option<i64>) = target.query_row(
            "SELECT t.bill_id, bill.deleted_at, payment.deleted_at FROM transactions t
             JOIN items bill ON bill.id = t.bill_id JOIN items payment ON payment.id = t.item_id",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).unwrap();
        assert_eq!(payment, ("bill".into(), Some(123), None));
        assert!(outbox(&target).is_empty());
    }

    #[test]
    fn invalid_tombstones_are_rejected_without_changing_rows_or_caches() {
        let conn = open_in_memory();
        fixtures(&conn);
        conn.execute("UPDATE items SET body = '[[page]]' WHERE id = 'habit'", []).unwrap();
        crate::links::refresh(&conn, "habit", "[[page]]").unwrap();
        clear_outbox(&conn);
        let snapshot = || {
            ["SELECT * FROM items ORDER BY id", "SELECT * FROM habit_checks ORDER BY habit_id, date",
             "SELECT * FROM links ORDER BY from_id, to_id", "SELECT * FROM items_fts ORDER BY item_id",
             "SELECT * FROM sync_state ORDER BY key", "SELECT * FROM sync_outbox ORDER BY record_id"]
                .map(|sql| {
                    let mut statement = conn.prepare(sql).unwrap();
                    let count = statement.column_count();
                    statement.query_map([], |r| (0..count).map(|index| r.get::<_, SqlValue>(index)).collect::<rusqlite::Result<Vec<_>>>())
                        .unwrap().collect::<Result<Vec<_>, _>>().unwrap()
                })
        };
        for id in ["habit", "hc:habit:2026-10-02"] {
            let original = export(&conn, id).unwrap().unwrap();
            let deleted = Record { changed_at: 100, deleted: true, ..original.clone() };
            let invalid_records = [
                Record { payload: None, ..deleted.clone() },
                deleted.clone(), // A normal row document cannot authorize a tombstone.
                with_document(&deleted, json!({"schema":12,"tombstone":true,"id":"different"})),
                with_document(&deleted, json!({"schema":12,"tombstone":false,"id":id})),
                with_document(&deleted, json!({"schema":12,"id":id})),
                with_document(&deleted, json!({"schema":0,"tombstone":true,"id":id})),
                Record { payload: Some(vec![255, 255]), ..deleted.clone() },
            ];
            for invalid in invalid_records {
                let before = snapshot();
                assert!(matches!(apply(&conn, &invalid), Err(AppError::Invalid(_))));
                assert_eq!(snapshot(), before);
                assert_eq!(document(&export(&conn, id).unwrap().unwrap()), document(&original));
                assert_eq!(applying(&conn), "0");
                assert!(outbox(&conn).is_empty());
            }
        }
    }

    #[test]
    fn enqueue_all_includes_live_soft_deleted_and_checks_but_excludes_local_data() {
        let conn = open_in_memory();
        fixtures(&conn);
        insert_item(&conn, "email", "email");
        conn.execute("UPDATE items SET deleted_at = 99 WHERE id = 'habit'", []).unwrap();
        conn.execute("UPDATE habit_checks SET deleted_at = 99, updated_at = 99", []).unwrap();
        clear_outbox(&conn);
        enqueue_all(&conn).unwrap();
        let mut expected: Vec<String> = SYNCED_TYPES.iter().map(|s| s.to_string()).collect();
        expected.push("hc:habit:2026-10-02".into());
        expected.sort();
        assert_eq!(outbox(&conn), expected);
        conn.execute("UPDATE sync_outbox SET changed_at = 9007199254740993 WHERE record_id = 'task'", []).unwrap();
        enqueue_all(&conn).unwrap();
        assert_eq!(export(&conn, "task").unwrap().unwrap().changed_at, 9007199254740993);
    }

    #[test]
    fn deflate_size_limit_counts_encryption_overhead_and_names_the_title() {
        let conn = open_in_memory();
        let id = items::insert(&conn, "page", "Halaman besar", &"x".repeat(MAX_RECORD_BYTES * 2), 10).unwrap();
        let small = export(&conn, &id).unwrap().unwrap();
        assert!(small.payload.as_ref().unwrap().len() < MAX_RECORD_BYTES);
        // Deterministic, poorly compressible text; no random dependency needed.
        let mut noise = String::new();
        for index in 0_u64..30_000 {
            use sha2::Digest;
            for byte in sha2::Sha256::digest(index.to_le_bytes()) {
                use std::fmt::Write;
                write!(&mut noise, "{byte:02x}").unwrap();
            }
        }
        conn.execute("UPDATE items SET body = ?1 WHERE id = ?2", params![noise, id]).unwrap();
        let error = export(&conn, &id).err().unwrap();
        assert!(matches!(error, AppError::Invalid(_)));
        assert!(error.to_string().contains("Halaman besar"));
        // A payload that fits 256 KB only without the nonce and tag is rejected,
        // while a normal record still applies.
        let oversized = Record { payload: Some(vec![0; MAX_RECORD_BYTES - ENCRYPTION_OVERHEAD + 1]), ..small.clone() };
        assert!(matches!(apply(&open_in_memory(), &oversized), Err(AppError::Invalid(_))));
        assert!(matches!(apply(&open_in_memory(), &small), Ok(Applied::Done)));
    }

    #[test]
    fn small_compressed_payload_exceeding_eight_mib_is_rejected_atomically() {
        let source = open_in_memory();
        let id = items::insert(&source, "page", "Large expansion", "Original", 10).unwrap();
        let record = export(&source, &id).unwrap().unwrap();
        let mut value = document(&record);
        value["item"]["body"] = json!("x".repeat(8 * 1024 * 1024));
        let json = serde_json::to_vec(&value).unwrap();
        assert!(json.len() > 8 * 1024 * 1024);
        let bomb = with_document(&record, value);
        assert!(bomb.payload.as_ref().unwrap().len() < MAX_RECORD_BYTES - ENCRYPTION_OVERHEAD);
        let target = open_in_memory();
        apply(&target, &record).unwrap();
        assert!(matches!(apply(&target, &bomb), Err(AppError::Invalid(_))));
        assert_eq!(document(&export(&target, &id).unwrap().unwrap()), document(&record));
        assert_eq!(applying(&target), "0");
        assert!(outbox(&target).is_empty());
    }

    #[test]
    fn malformed_records_fail_atomically_and_restore_applying_even_inside_a_transaction() {
        let source = open_in_memory();
        let id = items::insert(&source, "page", "Valid", "body", 10).unwrap();
        let record = export(&source, &id).unwrap().unwrap();
        let conn = open_in_memory();
        conn.execute_batch("BEGIN; UPDATE sync_state SET value = '1' WHERE key = 'applying';").unwrap();
        assert_eq!(apply(&conn, &record).unwrap(), Applied::Done);
        assert_eq!(applying(&conn), "1");
        conn.execute_batch("ROLLBACK;").unwrap();
        assert!(export(&conn, &id).unwrap().is_none());

        for invalid in [
            Record { payload: Some(vec![255, 255]), ..record.clone() },
            Record { payload: None, ..record.clone() },
            Record { payload: Some(vec![0; MAX_RECORD_BYTES]), ..record.clone() },
            with_document(&record, json!({"schema":12,"item":{"id":"different"},"ext":null})),
        ] {
            assert!(matches!(apply(&conn, &invalid), Err(AppError::Invalid(_))));
            assert_eq!(applying(&conn), "0");
            assert!(outbox(&conn).is_empty());
        }
        let mut invalid = document(&record);
        invalid["item"]["type"] = json!("account");
        invalid["ext"] = json!({"item_id":id,"kind":null,"currency":"IDR","opening_balance":0});
        assert!(apply(&conn, &with_document(&record, invalid)).is_err());
        assert!(export(&conn, &id).unwrap().is_none());
        assert_eq!(applying(&conn), "0");
        assert!(outbox(&conn).is_empty());
    }
}
