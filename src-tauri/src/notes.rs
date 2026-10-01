//! Page tree, pages management, trash, backlinks, and Markdown export (spec Fase 4B §4).
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::links;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageNode {
    pub id: String,
    pub title: String,
    pub parent_id: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub title: String,
    pub deleted_at: i64,
    pub descendants: usize,
}

fn sanitize_title(title: &str) -> Result<String, AppError> {
    let trimmed = title.trim();
    if trimmed.chars().count() > 200 {
        return Err(AppError::Invalid("Judul maksimal 200 karakter".into()));
    }
    if trimmed.is_empty() {
        Ok("Tanpa judul".to_string())
    } else {
        Ok(trimmed.to_string())
    }
}

fn validate_parent(conn: &Connection, parent_id: Option<&str>) -> Result<(), AppError> {
    if let Some(pid) = parent_id {
        let is_page: bool = conn
            .query_row(
                "SELECT 1 FROM items WHERE id = ?1 AND type = 'page' AND deleted_at IS NULL",
                [pid],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);

        if !is_page {
            return Err(AppError::Invalid("Induk harus halaman".into()));
        }
    }
    Ok(())
}

/// Semua halaman yang tidak terhapus, urut lower(title), lalu id.
pub fn tree(conn: &Connection) -> Result<Vec<PageNode>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, parent_id, updated_at
         FROM items
         WHERE type = 'page' AND deleted_at IS NULL
         ORDER BY LOWER(title) ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(PageNode {
            id: r.get(0)?,
            title: r.get(1)?,
            parent_id: r.get(2)?,
            updated_at: r.get(3)?,
        })
    })?;

    let mut pages = Vec::new();
    for r in rows {
        pages.push(r?);
    }
    Ok(pages)
}

pub fn create(
    conn: &Connection,
    parent_id: Option<&str>,
    title: &str,
    now: i64,
) -> Result<PageNode, AppError> {
    let clean_title = sanitize_title(title)?;
    validate_parent(conn, parent_id)?;

    let id = uuid::Uuid::now_v7().to_string();
    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO items (id, type, title, body, parent_id, created_at, updated_at)
         VALUES (?1, 'page', ?2, '', ?3, ?4, ?4)",
        params![id, clean_title, parent_id, now],
    )?;

    links::refresh_mentions(&tx, &clean_title)?;
    tx.commit()?;

    Ok(PageNode {
        id,
        title: clean_title,
        parent_id: parent_id.map(String::from),
        updated_at: now,
    })
}

pub fn rename(
    conn: &Connection,
    id: &str,
    title: &str,
    now: i64,
) -> Result<PageNode, AppError> {
    let (old_title, parent_id, updated_at): (String, Option<String>, i64) = conn
        .query_row(
            "SELECT title, parent_id, updated_at
             FROM items
             WHERE id = ?1 AND type = 'page' AND deleted_at IS NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;

    let clean_title = sanitize_title(title)?;
    if clean_title == old_title {
        return Ok(PageNode {
            id: id.to_string(),
            title: old_title,
            parent_id,
            updated_at,
        });
    }

    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "UPDATE items SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![clean_title, now, id],
    )?;

    let mut stmt = tx.prepare(
        "SELECT id, body
         FROM items
         WHERE id IN (SELECT from_id FROM links WHERE to_id = ?1) AND deleted_at IS NULL",
    )?;
    let linking_items: Vec<(String, String)> = stmt
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    drop(stmt);

    for (from_id, body) in linking_items {
        let rewritten = links::rewrite(&body, &old_title, &clean_title);
        if rewritten != body {
            tx.execute(
                "UPDATE items SET body = ?1, updated_at = ?2 WHERE id = ?3",
                params![rewritten, now, from_id],
            )?;
            links::refresh(&tx, &from_id, &rewritten)?;
        }
    }

    links::refresh_mentions(&tx, &clean_title)?;
    tx.commit()?;

    Ok(PageNode {
        id: id.to_string(),
        title: clean_title,
        parent_id,
        updated_at: now,
    })
}

pub fn move_page(
    conn: &Connection,
    id: &str,
    parent_id: Option<&str>,
    now: i64,
) -> Result<PageNode, AppError> {
    let (title, cur_parent_id, cur_updated_at): (String, Option<String>, i64) = conn
        .query_row(
            "SELECT title, parent_id, updated_at
             FROM items
             WHERE id = ?1 AND type = 'page' AND deleted_at IS NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;

    if let Some(target_parent) = parent_id {
        if target_parent == id {
            return Err(AppError::Invalid(
                "Tidak bisa memindahkan ke diri sendiri atau turunan".into(),
            ));
        }

        let is_valid_parent: bool = conn
            .query_row(
                "SELECT 1 FROM items WHERE id = ?1 AND type = 'page' AND deleted_at IS NULL",
                [target_parent],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);

        if !is_valid_parent {
            return Err(AppError::Invalid("Induk harus halaman".into()));
        }

        let is_descendant: bool = conn
            .query_row(
                "WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM items WHERE parent_id = ?1 AND deleted_at IS NULL
                    UNION ALL
                    SELECT i.id FROM items i
                    JOIN descendants d ON i.parent_id = d.id
                    WHERE i.deleted_at IS NULL
                 )
                 SELECT 1 FROM descendants WHERE id = ?2 LIMIT 1",
                params![id, target_parent],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);

        if is_descendant {
            return Err(AppError::Invalid(
                "Tidak bisa memindahkan ke diri sendiri atau turunan".into(),
            ));
        }
    }

    if parent_id == cur_parent_id.as_deref() {
        return Ok(PageNode {
            id: id.to_string(),
            title,
            parent_id: cur_parent_id,
            updated_at: cur_updated_at,
        });
    }

    conn.execute(
        "UPDATE items SET parent_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![parent_id, now, id],
    )?;

    Ok(PageNode {
        id: id.to_string(),
        title,
        parent_id: parent_id.map(String::from),
        updated_at: now,
    })
}

pub fn save_body(
    conn: &Connection,
    id: &str,
    body: &str,
    now: i64,
) -> Result<(), AppError> {
    let page_exists: bool = conn
        .query_row(
            "SELECT 1 FROM items WHERE id = ?1 AND type = 'page' AND deleted_at IS NULL",
            [id],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);

    if !page_exists {
        return Err(AppError::NotFound);
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE items SET body = ?1, updated_at = ?2 WHERE id = ?3",
        params![body, now, id],
    )?;
    links::refresh(&tx, id, body)?;
    tx.commit()?;

    Ok(())
}

pub fn delete(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    let page_exists: bool = conn
        .query_row(
            "SELECT 1 FROM items WHERE id = ?1 AND type = 'page' AND deleted_at IS NULL",
            [id],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);

    if !page_exists {
        return Err(AppError::NotFound);
    }

    let tx = conn.unchecked_transaction()?;

    let mut stmt = tx.prepare(
        "WITH RECURSIVE subtree(id) AS (
            SELECT ?1 AS id
            UNION ALL
            SELECT i.id FROM items i
            JOIN subtree s ON i.parent_id = s.id
            WHERE i.deleted_at IS NULL
         )
         SELECT id FROM subtree",
    )?;
    let ids: Vec<String> = stmt
        .query_map([id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    drop(stmt);

    for item_id in ids {
        tx.execute(
            "UPDATE items SET deleted_at = ?1 WHERE id = ?2",
            params![now, item_id],
        )?;
    }

    tx.commit()?;
    Ok(())
}

pub fn trash(conn: &Connection) -> Result<Vec<TrashEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.title, p.deleted_at
         FROM items p
         WHERE p.type = 'page'
           AND p.deleted_at IS NOT NULL
           AND (
             p.parent_id IS NULL
             OR NOT EXISTS (
               SELECT 1 FROM items parent
               WHERE parent.id = p.parent_id
                 AND parent.deleted_at = p.deleted_at
             )
           )
         ORDER BY p.deleted_at DESC, LOWER(p.title) ASC, p.id ASC",
    )?;

    let roots: Vec<(String, String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    drop(stmt);

    let mut entries = Vec::with_capacity(roots.len());
    for (root_id, title, deleted_at) in roots {
        let count: i64 = conn.query_row(
            "WITH RECURSIVE subtree(id) AS (
                SELECT id FROM items WHERE parent_id = ?1 AND deleted_at = ?2
                UNION ALL
                SELECT i.id FROM items i
                JOIN subtree s ON i.parent_id = s.id
                WHERE i.deleted_at = ?2
             )
             SELECT COUNT(*) FROM subtree",
            params![root_id, deleted_at],
            |r| r.get(0),
        )?;

        entries.push(TrashEntry {
            id: root_id,
            title,
            deleted_at,
            descendants: count as usize,
        });
    }

    Ok(entries)
}

pub fn restore(conn: &Connection, id: &str, now: i64) -> Result<PageNode, AppError> {
    let (title, parent_id, updated_at, deleted_at): (String, Option<String>, i64, i64) = conn
        .query_row(
            "SELECT title, parent_id, updated_at, deleted_at
             FROM items
             WHERE id = ?1 AND type = 'page' AND deleted_at IS NOT NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;

    let parent_still_deleted = if let Some(ref pid) = parent_id {
        let parent_deleted: Option<Option<i64>> = conn
            .query_row(
                "SELECT deleted_at FROM items WHERE id = ?1",
                [pid],
                |r| r.get(0),
            )
            .optional()?;
        !matches!(parent_deleted, Some(None))
    } else {
        false
    };

    let new_parent_id = if parent_still_deleted {
        None
    } else {
        parent_id
    };

    let new_updated_at = if parent_still_deleted {
        now
    } else {
        updated_at
    };

    let tx = conn.unchecked_transaction()?;

    let mut stmt = tx.prepare(
        "WITH RECURSIVE subtree(id) AS (
            SELECT ?1 AS id
            UNION ALL
            SELECT i.id FROM items i
            JOIN subtree s ON i.parent_id = s.id
            WHERE i.deleted_at = ?2
         )
         SELECT id, title, body FROM items WHERE id IN (SELECT id FROM subtree)",
    )?;
    let subtree_items: Vec<(String, String, String)> = stmt
        .query_map(params![id, deleted_at], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?
        .collect::<Result<_, _>>()?;
    drop(stmt);

    for (item_id, item_title, item_body) in &subtree_items {
        tx.execute(
            "UPDATE items SET deleted_at = NULL WHERE id = ?1",
            [item_id],
        )?;
        links::refresh(&tx, item_id, item_body)?;
        links::refresh_mentions(&tx, item_title)?;
    }

    if parent_still_deleted {
        tx.execute(
            "UPDATE items SET parent_id = NULL, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
    }

    tx.commit()?;

    Ok(PageNode {
        id: id.to_string(),
        title,
        parent_id: new_parent_id,
        updated_at: new_updated_at,
    })
}

struct ExportRecord {
    id: String,
    title: String,
    body: String,
    parent_id: Option<String>,
}

fn export_level(
    parent_id: Option<&str>,
    current_dir: &Path,
    by_parent: &HashMap<Option<String>, Vec<ExportRecord>>,
) -> Result<(), AppError> {
    let empty = Vec::new();
    let pages = by_parent
        .get(&parent_id.map(String::from))
        .unwrap_or(&empty);

    // Names are unique within this export only, so exporting again overwrites
    // the earlier export instead of adding "A (2).md" copies next to it.
    let mut used = std::collections::HashSet::new();
    for page in pages {
        let safe = crate::downloads::safe_name(&page.title);
        let mut name = safe.clone();
        let mut n = 2;
        while !used.insert(name.to_lowercase()) {
            name = format!("{safe} ({n})");
            n += 1;
        }

        std::fs::write(current_dir.join(format!("{name}.md")), &page.body)?;

        let has_children = by_parent.contains_key(&Some(page.id.clone()));
        if has_children {
            let child_dir = current_dir.join(&name);
            std::fs::create_dir_all(&child_dir)?;
            export_level(Some(&page.id), &child_dir, by_parent)?;
        }
    }

    Ok(())
}

pub fn export(conn: &Connection, root: &Path) -> Result<PathBuf, AppError> {
    let export_dir = root.join("Anchoa Catatan");
    std::fs::create_dir_all(&export_dir)?;

    let mut stmt = conn.prepare(
        "SELECT id, title, body, parent_id
         FROM items
         WHERE type = 'page' AND deleted_at IS NULL
         ORDER BY LOWER(title) ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ExportRecord {
            id: r.get(0)?,
            title: r.get(1)?,
            body: r.get(2)?,
            parent_id: r.get(3)?,
        })
    })?;

    let mut all_pages = Vec::new();
    let mut page_ids = std::collections::HashSet::new();
    for r in rows {
        let rec = r?;
        page_ids.insert(rec.id.clone());
        all_pages.push(rec);
    }
    drop(stmt);

    let mut by_parent: HashMap<Option<String>, Vec<ExportRecord>> = HashMap::new();

    for page in all_pages {
        let effective_parent = match &page.parent_id {
            Some(pid) if page_ids.contains(pid) => Some(pid.clone()),
            _ => None,
        };
        by_parent.entry(effective_parent).or_default().push(page);
    }

    export_level(None, &export_dir, &by_parent)?;

    Ok(export_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::links;

    #[test]
    fn tree_lists_pages_sorted_without_deleted() {
        let conn = open_in_memory();
        create(&conn, None, "Zebra", 100).unwrap();
        create(&conn, None, "Apple", 200).unwrap();
        let mango = create(&conn, None, "mango", 300).unwrap();
        let banana = create(&conn, None, "Banana", 400).unwrap();

        // A non-page item should not appear in the tree
        crate::items::insert(&conn, "note", "Catatan Lepas", "", 500).unwrap();

        // Delete banana
        delete(&conn, &banana.id, 600).unwrap();

        let list = tree(&conn).unwrap();
        let titles: Vec<&str> = list.iter().map(|p| p.title.as_str()).collect();
        assert_eq!(titles, vec!["Apple", "mango", "Zebra"]);
        assert_eq!(list[1].id, mango.id);
    }

    #[test]
    fn create_rejects_non_page_parent() {
        let conn = open_in_memory();
        let note_id = crate::items::insert(&conn, "note", "Bukan Halaman", "", 100).unwrap();

        let err = create(&conn, Some(&note_id), "Sub", 200).unwrap_err();
        assert!(matches!(err, AppError::Invalid(ref msg) if msg == "Induk harus halaman"));

        let nonexistent = uuid::Uuid::now_v7().to_string();
        let err2 = create(&conn, Some(&nonexistent), "Sub", 200).unwrap_err();
        assert!(matches!(err2, AppError::Invalid(ref msg) if msg == "Induk harus halaman"));

        let page = create(&conn, None, "Parent Page", 200).unwrap();
        delete(&conn, &page.id, 300).unwrap();
        let err3 = create(&conn, Some(&page.id), "Sub", 400).unwrap_err();
        assert!(matches!(err3, AppError::Invalid(ref msg) if msg == "Induk harus halaman"));

        // Blank title becomes "Tanpa judul"
        let blank = create(&conn, None, "   ", 500).unwrap();
        assert_eq!(blank.title, "Tanpa judul");

        // Over 200 characters is rejected
        let too_long = "a".repeat(201);
        let err_long = create(&conn, None, &too_long, 600).unwrap_err();
        assert!(matches!(err_long, AppError::Invalid(_)));
    }

    #[test]
    fn rename_rewrites_links_in_linking_items() {
        let conn = open_in_memory();
        let target = create(&conn, None, "Catatan Lama", 100).unwrap();

        // Linking page and note
        let source_page = create(&conn, None, "Penaut", 110).unwrap();
        save_body(
            &conn,
            &source_page.id,
            "Lihat [[Catatan Lama]] dan juga [[Catatan Lama|alias nama]].",
            120,
        )
        .unwrap();

        let source_note_id = crate::items::insert(
            &conn,
            "note",
            "Catatan Eksternal",
            "Kutipan [[catatan lama]].",
            130,
        )
        .unwrap();
        links::refresh(&conn, &source_note_id, "Kutipan [[catatan lama]].").unwrap();

        let back1 = links::backlinks(&conn, &target.id).unwrap();
        assert_eq!(back1.len(), 2);

        // Rename
        let renamed = rename(&conn, &target.id, "Catatan Baru", 200).unwrap();
        assert_eq!(renamed.title, "Catatan Baru");
        assert_eq!(renamed.updated_at, 200);

        // Check rewritten bodies
        let page_body: String = conn
            .query_row(
                "SELECT body FROM items WHERE id = ?1",
                [&source_page.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            page_body,
            "Lihat [[Catatan Baru]] dan juga [[Catatan Baru|alias nama]]."
        );

        let note_body: String = conn
            .query_row(
                "SELECT body FROM items WHERE id = ?1",
                [&source_note_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(note_body, "Kutipan [[Catatan Baru]].");

        // Backlinks still exist under new title
        let back2 = links::backlinks(&conn, &target.id).unwrap();
        assert_eq!(back2.len(), 2);

        // Renaming with exact same title does nothing
        let same = rename(&conn, &target.id, "Catatan Baru", 300).unwrap();
        assert_eq!(same.updated_at, 200);
    }

    #[test]
    fn move_rejects_cycles() {
        let conn = open_in_memory();
        let a = create(&conn, None, "A", 100).unwrap();
        let b = create(&conn, Some(&a.id), "B", 110).unwrap();
        let c = create(&conn, Some(&b.id), "C", 120).unwrap();

        // Move to self
        assert!(matches!(
            move_page(&conn, &a.id, Some(&a.id), 200),
            Err(AppError::Invalid(_))
        ));

        // Move to child
        assert!(matches!(
            move_page(&conn, &a.id, Some(&b.id), 200),
            Err(AppError::Invalid(_))
        ));

        // Move to grandchild
        assert!(matches!(
            move_page(&conn, &a.id, Some(&c.id), 200),
            Err(AppError::Invalid(_))
        ));

        // Move C to root is allowed
        let c_moved = move_page(&conn, &c.id, None, 250).unwrap();
        assert_eq!(c_moved.parent_id, None);
        assert_eq!(c_moved.updated_at, 250);

        // Move A under C is now allowed because C is at root and A is not an ancestor of C anymore
        let a_moved = move_page(&conn, &a.id, Some(&c.id), 300).unwrap();
        assert_eq!(a_moved.parent_id, Some(c.id));
    }

    #[test]
    fn delete_and_restore_whole_subtree() {
        let conn = open_in_memory();
        let a = create(&conn, None, "A", 100).unwrap();
        let b = create(&conn, Some(&a.id), "B", 110).unwrap();
        let c = create(&conn, Some(&b.id), "C", 120).unwrap();
        let other = create(&conn, None, "Other", 130).unwrap();

        delete(&conn, &a.id, 500).unwrap();

        // All A, B, C are soft-deleted with deleted_at = 500
        let a_del: Option<i64> = conn
            .query_row("SELECT deleted_at FROM items WHERE id = ?1", [&a.id], |r| {
                r.get(0)
            })
            .unwrap();
        let b_del: Option<i64> = conn
            .query_row("SELECT deleted_at FROM items WHERE id = ?1", [&b.id], |r| {
                r.get(0)
            })
            .unwrap();
        let c_del: Option<i64> = conn
            .query_row("SELECT deleted_at FROM items WHERE id = ?1", [&c.id], |r| {
                r.get(0)
            })
            .unwrap();
        let other_del: Option<i64> = conn
            .query_row(
                "SELECT deleted_at FROM items WHERE id = ?1",
                [&other.id],
                |r| r.get(0),
            )
            .unwrap();

        assert_eq!(a_del, Some(500));
        assert_eq!(b_del, Some(500));
        assert_eq!(c_del, Some(500));
        assert_eq!(other_del, None);

        // Restore A
        let a_restored = restore(&conn, &a.id, 600).unwrap();
        assert_eq!(a_restored.id, a.id);

        let a_del_after: Option<i64> = conn
            .query_row("SELECT deleted_at FROM items WHERE id = ?1", [&a.id], |r| {
                r.get(0)
            })
            .unwrap();
        let b_del_after: Option<i64> = conn
            .query_row("SELECT deleted_at FROM items WHERE id = ?1", [&b.id], |r| {
                r.get(0)
            })
            .unwrap();
        let c_del_after: Option<i64> = conn
            .query_row("SELECT deleted_at FROM items WHERE id = ?1", [&c.id], |r| {
                r.get(0)
            })
            .unwrap();

        assert_eq!(a_del_after, None);
        assert_eq!(b_del_after, None);
        assert_eq!(c_del_after, None);
    }

    #[test]
    fn restore_to_root_when_parent_still_deleted() {
        let conn = open_in_memory();
        let a = create(&conn, None, "Parent", 100).unwrap();
        let b = create(&conn, Some(&a.id), "Child", 110).unwrap();

        // Delete child individually at 200
        delete(&conn, &b.id, 200).unwrap();
        // Delete parent at 300
        delete(&conn, &a.id, 300).unwrap();

        // Restoring child B while parent A is still deleted moves B to root
        let b_restored = restore(&conn, &b.id, 400).unwrap();
        assert_eq!(b_restored.parent_id, None);
        assert_eq!(b_restored.updated_at, 400);

        let b_parent_db: Option<String> = conn
            .query_row("SELECT parent_id FROM items WHERE id = ?1", [&b.id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(b_parent_db, None);
    }

    #[test]
    fn trash_lists_only_deletion_roots() {
        let conn = open_in_memory();
        let a = create(&conn, None, "A", 100).unwrap();
        let _b = create(&conn, Some(&a.id), "B", 110).unwrap();
        let _c = create(&conn, Some(&a.id), "C", 120).unwrap();

        let x = create(&conn, None, "X", 130).unwrap();

        delete(&conn, &x.id, 200).unwrap();
        delete(&conn, &a.id, 300).unwrap();

        let t = trash(&conn).unwrap();
        assert_eq!(t.len(), 2);

        // Ordered by deleted_at DESC
        assert_eq!(t[0].id, a.id);
        assert_eq!(t[0].title, "A");
        assert_eq!(t[0].deleted_at, 300);
        assert_eq!(t[0].descendants, 2);

        assert_eq!(t[1].id, x.id);
        assert_eq!(t[1].title, "X");
        assert_eq!(t[1].deleted_at, 200);
        assert_eq!(t[1].descendants, 0);
    }

    #[test]
    fn save_body_refreshes_links() {
        let conn = open_in_memory();
        let target = create(&conn, None, "Target", 100).unwrap();
        let source = create(&conn, None, "Source", 110).unwrap();

        save_body(&conn, &source.id, "Menghubungkan ke [[Target]].", 200).unwrap();

        let bl1 = links::backlinks(&conn, &target.id).unwrap();
        assert_eq!(bl1.len(), 1);
        assert_eq!(bl1[0].id, source.id);

        save_body(&conn, &source.id, "Sudah dihapus tautannya.", 300).unwrap();

        let bl2 = links::backlinks(&conn, &target.id).unwrap();
        assert!(bl2.is_empty());
    }

    #[test]
    fn creating_a_page_links_earlier_mentions() {
        let conn = open_in_memory();

        // An earlier item mentions [[Ide baru]]
        let note_id = crate::items::insert(
            &conn,
            "note",
            "Catatan Awal",
            "Ada rencana hebat tentang [[Ide baru]].",
            100,
        )
        .unwrap();
        links::refresh(&conn, &note_id, "Ada rencana hebat tentang [[Ide baru]].").unwrap();

        // Now the page "Ide baru" is created
        let page = create(&conn, None, "Ide baru", 200).unwrap();

        let bl = links::backlinks(&conn, &page.id).unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].id, note_id);
    }

    #[test]
    fn export_writes_folder_notes_and_unique_names() {
        let conn = open_in_memory();
        let dir = tempfile::tempdir().unwrap();

        let _x = create(&conn, None, "../x", 100).unwrap();
        save_body(&conn, &_x.id, "Isi ../x", 105).unwrap();

        let a1 = create(&conn, None, "A", 110).unwrap();
        save_body(&conn, &a1.id, "Isi A1", 115).unwrap();

        let sub_a = create(&conn, Some(&a1.id), "Sub A", 120).unwrap();
        save_body(&conn, &sub_a.id, "Isi Sub A", 125).unwrap();

        let a2 = create(&conn, None, "A", 130).unwrap();
        save_body(&conn, &a2.id, "Isi A2", 135).unwrap();

        let export_path = export(&conn, dir.path()).unwrap();
        assert_eq!(export_path, dir.path().join("Anchoa Catatan"));

        let x_file = export_path.join("x.md");
        assert!(x_file.is_file(), "x.md must exist");
        assert_eq!(std::fs::read_to_string(&x_file).unwrap(), "Isi ../x");

        let a_file = export_path.join("A.md");
        assert!(a_file.is_file(), "A.md must exist");
        assert_eq!(std::fs::read_to_string(&a_file).unwrap(), "Isi A1");

        let a_sub_dir = export_path.join("A");
        assert!(a_sub_dir.is_dir(), "Folder note A/ must exist");
        let sub_file = a_sub_dir.join("Sub A.md");
        assert!(sub_file.is_file(), "Sub A.md must exist inside A/");
        assert_eq!(std::fs::read_to_string(&sub_file).unwrap(), "Isi Sub A");

        let a2_file = export_path.join("A (2).md");
        assert!(a2_file.is_file(), "A (2).md must exist for duplicate title");
        assert_eq!(std::fs::read_to_string(&a2_file).unwrap(), "Isi A2");

        // Exporting again overwrites the earlier files instead of adding copies.
        export(&conn, dir.path()).unwrap();
        assert!(!export_path.join("A (3).md").exists());
        assert_eq!(std::fs::read_dir(&export_path).unwrap().count(), 4); // x.md, A.md, A/, A (2).md
    }
}
