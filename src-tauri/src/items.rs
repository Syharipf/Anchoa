use rusqlite::{Connection, OptionalExtension, Params, Row, params};
use serde::{Deserialize, Deserializer, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    pub body: String,
    pub parent_id: Option<String>,
    pub due_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub opened_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSummary {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    pub due_at: Option<i64>,
    pub last_activity_at: i64,
}

/// Fields sent by the item page. A missing field is left unchanged;
/// `dueAt: null` clears the due date.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPatch {
    pub title: Option<String>,
    pub body: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub due_at: Option<Option<i64>>,
}

fn present<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<i64>>, D::Error> {
    Option::<i64>::deserialize(d).map(Some)
}

const ITEM_COLUMNS: &str = "id, type, title, body, parent_id, due_at, created_at, updated_at, opened_at";

fn item_from_row(r: &Row) -> rusqlite::Result<Item> {
    Ok(Item {
        id: r.get(0)?,
        kind: r.get(1)?,
        title: r.get(2)?,
        body: r.get(3)?,
        parent_id: r.get(4)?,
        due_at: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
        opened_at: r.get(8)?,
    })
}

/// Live (not deleted) items matching `clause`, which is SQL placed after
/// `WHERE deleted_at IS NULL AND`; it may end with ORDER BY / LIMIT.
pub fn summaries(conn: &Connection, clause: &str, params: impl Params) -> Result<Vec<ItemSummary>, AppError> {
    let sql = format!(
        "SELECT id, type, title, due_at, MAX(created_at, updated_at, COALESCE(opened_at, 0)) AS last_activity_at
         FROM items WHERE deleted_at IS NULL AND {clause}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params, |r| {
        Ok(ItemSummary { id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, due_at: r.get(3)?, last_activity_at: r.get(4)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Item, AppError> {
    conn.query_row(
        &format!("SELECT {ITEM_COLUMNS} FROM items WHERE id = ?1 AND deleted_at IS NULL"),
        [id],
        item_from_row,
    )
    .optional()?
    .ok_or(AppError::NotFound)
}

pub fn capture_note(conn: &Connection, text: &str, now: i64) -> Result<Item, AppError> {
    let title = text.trim();
    if title.is_empty() {
        return Err(AppError::Empty);
    }
    let id = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO items (id, type, title, created_at, updated_at) VALUES (?1, 'note', ?2, ?3, ?3)",
        params![id, title, now],
    )?;
    get(conn, &id)
}

/// Marks the item as opened. Does not touch `updated_at`.
pub fn open(conn: &Connection, id: &str, now: i64) -> Result<Item, AppError> {
    let changed = conn.execute(
        "UPDATE items SET opened_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

pub fn update(conn: &Connection, id: &str, patch: &ItemPatch, now: i64) -> Result<Item, AppError> {
    if patch.title.is_none() && patch.body.is_none() && patch.due_at.is_none() {
        return get(conn, id);
    }
    let changed = conn.execute(
        "UPDATE items SET
           title = COALESCE(?2, title),
           body = COALESCE(?3, body),
           due_at = CASE WHEN ?4 THEN ?5 ELSE due_at END,
           updated_at = ?6
         WHERE id = ?1 AND deleted_at IS NULL",
        params![id, patch.title, patch.body, patch.due_at.is_some(), patch.due_at.flatten(), now],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    let changed = conn.execute(
        "UPDATE items SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn list_inbox(conn: &Connection) -> Result<Vec<ItemSummary>, AppError> {
    summaries(conn, "parent_id IS NULL ORDER BY created_at DESC, id DESC", [])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn capture_trims_text_into_an_inbox_note() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "  beli kopi  ", 1000).unwrap();
        assert_eq!(item.kind, "note");
        assert_eq!(item.title, "beli kopi");
        assert_eq!(item.parent_id, None);
        assert_eq!((item.created_at, item.updated_at), (1000, 1000));
        assert_eq!(uuid::Uuid::parse_str(&item.id).unwrap().get_version_num(), 7);
    }

    #[test]
    fn capture_rejects_blank_text() {
        let conn = open_in_memory();
        assert!(matches!(capture_note(&conn, "   ", 1000), Err(AppError::Empty)));
        assert!(list_inbox(&conn).unwrap().is_empty());
    }

    #[test]
    fn open_sets_opened_at_only() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        let opened = open(&conn, &item.id, 5000).unwrap();
        assert_eq!(opened.opened_at, Some(5000));
        assert_eq!(opened.updated_at, 1000);
    }

    #[test]
    fn update_changes_only_sent_fields() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        let patch = ItemPatch { body: Some("isi".into()), due_at: Some(Some(9000)), ..Default::default() };
        let updated = update(&conn, &item.id, &patch, 2000).unwrap();
        assert_eq!(updated.title, "a");
        assert_eq!(updated.body, "isi");
        assert_eq!(updated.due_at, Some(9000));
        assert_eq!(updated.updated_at, 2000);
    }

    #[test]
    fn update_with_null_due_clears_it() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        update(&conn, &item.id, &ItemPatch { due_at: Some(Some(9000)), ..Default::default() }, 2000).unwrap();
        let cleared = update(&conn, &item.id, &ItemPatch { due_at: Some(None), ..Default::default() }, 3000).unwrap();
        assert_eq!(cleared.due_at, None);
    }

    #[test]
    fn empty_patch_does_not_touch_updated_at() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        let same = update(&conn, &item.id, &ItemPatch::default(), 2000).unwrap();
        assert_eq!(same.updated_at, 1000);
    }

    #[test]
    fn patch_json_distinguishes_missing_from_null() {
        let missing: ItemPatch = serde_json_from(r#"{"title":"x"}"#);
        assert_eq!(missing.due_at, None);
        let null: ItemPatch = serde_json_from(r#"{"dueAt":null}"#);
        assert_eq!(null.due_at, Some(None));
        let set: ItemPatch = serde_json_from(r#"{"dueAt":5}"#);
        assert_eq!(set.due_at, Some(Some(5)));
    }

    fn serde_json_from(json: &str) -> ItemPatch {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn deleted_items_disappear() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        delete(&conn, &item.id, 2000).unwrap();
        assert!(matches!(get(&conn, &item.id), Err(AppError::NotFound)));
        assert!(matches!(open(&conn, &item.id, 3000), Err(AppError::NotFound)));
        assert!(matches!(delete(&conn, &item.id, 3000), Err(AppError::NotFound)));
        assert!(list_inbox(&conn).unwrap().is_empty());
    }

    #[test]
    fn inbox_lists_newest_first() {
        let conn = open_in_memory();
        capture_note(&conn, "lama", 1000).unwrap();
        capture_note(&conn, "baru", 2000).unwrap();
        let titles: Vec<String> = list_inbox(&conn).unwrap().into_iter().map(|s| s.title).collect();
        assert_eq!(titles, ["baru", "lama"]);
    }

    #[test]
    fn unknown_id_is_not_found() {
        let conn = open_in_memory();
        assert!(matches!(update(&conn, "nope", &ItemPatch { title: Some("x".into()), ..Default::default() }, 1), Err(AppError::NotFound)));
    }
}
