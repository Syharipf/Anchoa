//! Full-text search over items with BM25 ranking and snippets (spec Fase 4B §4, C11-C13).
use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppError;
use crate::items::ItemSummary;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    #[serde(flatten)]
    pub item: ItemSummary,
    pub snippet: String,
}

/// Quotes each word and appends `*` (prefix match) to the last word.
/// Quotation marks in input are removed. Returns `None` if text is empty or only whitespace/quotes.
pub fn fts_query(text: &str) -> Option<String> {
    let clean: String = text
        .chars()
        .filter(|&c| c != '"' && c != '“' && c != '”')
        .collect();
    let words: Vec<&str> = clean.split_whitespace().collect();
    if words.is_empty() {
        return None;
    }
    let mut parts = Vec::with_capacity(words.len());
    for (i, word) in words.iter().enumerate() {
        if i == words.len() - 1 {
            parts.push(format!("\"{word}\"*"));
        } else {
            parts.push(format!("\"{word}\""));
        }
    }
    Some(parts.join(" "))
}

pub fn search(
    conn: &Connection,
    text: &str,
    pages_only: bool,
    limit: usize,
) -> Result<Vec<SearchHit>, AppError> {
    search_filtered(
        conn,
        text,
        if pages_only {
            "AND i.type = 'page'"
        } else {
            ""
        },
        limit,
    )
}

/// Chat must never read journals, including their copies made by entry_to_task.
pub(crate) fn search_for_chat(
    conn: &Connection,
    text: &str,
    limit: usize,
) -> Result<Vec<SearchHit>, AppError> {
    search_filtered(
        conn,
        text,
        "AND i.type NOT IN ('note', 'journal', 'email')
         AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.task_id = i.id OR j.item_id = i.id)
         AND NOT EXISTS (SELECT 1 FROM emails e WHERE e.item_id = i.id)",
        limit,
    )
}

fn search_filtered(
    conn: &Connection,
    text: &str,
    filter: &str,
    limit: usize,
) -> Result<Vec<SearchHit>, AppError> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let Some(query) = fts_query(text) else {
        return Ok(Vec::new());
    };

    let sql = format!(
        "SELECT
            i.id,
            i.type,
            i.title,
            i.due_at,
            MAX(i.created_at, i.updated_at, COALESCE(i.opened_at, 0)) AS last_activity_at,
            snippet(items_fts, 2, '\u{2}', '\u{3}', '…', 12) AS snip,
            i.body
         FROM items_fts
         JOIN items i ON i.id = items_fts.item_id
         WHERE items_fts MATCH ?1
           AND i.deleted_at IS NULL
           {filter}
         ORDER BY bm25(items_fts, 0.0, 5.0, 1.0)
         LIMIT ?2"
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params![query, limit as i64], |r| {
        let id: String = r.get(0)?;
        let kind: String = r.get(1)?;
        let title: String = r.get(2)?;
        let due_at: Option<i64> = r.get(3)?;
        let last_activity_at: i64 = r.get(4)?;
        let snip: String = r.get(5)?;
        let body: String = r.get(6)?;

        let snippet = if snip.contains('\u{2}') {
            snip
        } else {
            body.chars().take(80).collect()
        };

        Ok(SearchHit {
            item: ItemSummary {
                id,
                kind,
                title,
                due_at,
                last_activity_at,
            },
            snippet,
        })
    })?;

    let mut hits = Vec::new();
    for r in rows {
        hits.push(r?);
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fts_query_quotes_words_and_prefixes_the_last() {
        assert_eq!(
            fts_query("rencana besok"),
            Some("\"rencana\" \"besok\"*".to_string())
        );
        assert_eq!(
            fts_query("rencana"),
            Some("\"rencana\"*".to_string())
        );
        assert_eq!(
            fts_query("\"rencana\" \"besok\""),
            Some("\"rencana\" \"besok\"*".to_string())
        );
        assert_eq!(
            fts_query("“rencana” “besok”"),
            Some("\"rencana\" \"besok\"*".to_string())
        );
        assert_eq!(
            fts_query("  rencana   besok  lusa  "),
            Some("\"rencana\" \"besok\" \"lusa\"*".to_string())
        );
        assert_eq!(fts_query(""), None);
        assert_eq!(fts_query("   "), None);
        assert_eq!(fts_query("\"\""), None);
        assert_eq!(fts_query("“ ”"), None);
    }

    #[test]
    fn search_ranks_titles_and_skips_deleted() {
        let conn = crate::db::open_in_memory();
        let now = 1000;

        let id_title = crate::items::insert(&conn, "page", "Proyek Alpha", "catatan ringkas saja", now).unwrap();
        let id_body = crate::items::insert(&conn, "page", "Rangkuman", "di sini kita membahas proyek alpha secara mendalam", now + 10).unwrap();
        let id_del = crate::items::insert(&conn, "page", "Proyek Alpha Dihapus", "tidak boleh muncul", now + 20).unwrap();
        crate::items::soft_delete(&conn, &id_del, now + 30).unwrap();

        let hits = search(&conn, "proyek alpha", false, 10).unwrap();

        assert!(hits.iter().all(|h| h.item.id != id_del));
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].item.id, id_title);
        assert_eq!(hits[1].item.id, id_body);

        assert!(hits[1].snippet.contains('\u{2}'));
        assert!(hits[1].snippet.contains('\u{3}'));
        assert_eq!(hits[0].snippet, "catatan ringkas saja");

        let long_body = "x".repeat(100);
        let id_long = crate::items::insert(&conn, "page", "Proyek Beta", &long_body, now + 40).unwrap();
        let hits_beta = search(&conn, "proyek beta", false, 10).unwrap();
        assert_eq!(hits_beta.len(), 1);
        assert_eq!(hits_beta[0].item.id, id_long);
        assert_eq!(hits_beta[0].snippet, "x".repeat(80));
    }

    #[test]
    fn search_matches_without_diacritics() {
        let conn = crate::db::open_in_memory();
        let now = 1000;
        let id = crate::items::insert(&conn, "page", "Café résumé", "dokumen penting", now).unwrap();

        let hits = search(&conn, "cafe resume", false, 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].item.id, id);

        let hits2 = search(&conn, "café", false, 10).unwrap();
        assert_eq!(hits2.len(), 1);
        assert_eq!(hits2[0].item.id, id);
    }

    #[test]
    fn search_pages_only() {
        let conn = crate::db::open_in_memory();
        let now = 1000;
        let page_id = crate::items::insert(&conn, "page", "Halaman Arsitektur", "isi halaman", now).unwrap();
        let note_id = crate::items::insert(&conn, "note", "Catatan Arsitektur", "isi catatan", now).unwrap();

        let all_hits = search(&conn, "arsitektur", false, 10).unwrap();
        assert_eq!(all_hits.len(), 2);
        assert!(all_hits.iter().any(|h| h.item.id == note_id));

        let page_hits = search(&conn, "arsitektur", true, 10).unwrap();
        assert_eq!(page_hits.len(), 1);
        assert_eq!(page_hits[0].item.id, page_id);
        assert_ne!(page_hits[0].item.id, note_id);
    }
}
