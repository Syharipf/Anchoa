//! Wikilinks parsing, rewriting, resolving, and backlinks tracking (spec Fase 4B §3-4).
use rusqlite::{Connection, params};
use serde::Serialize;

use crate::error::AppError;
use crate::items::ItemSummary;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Backlink {
    #[serde(flatten)]
    pub item: ItemSummary,
    pub excerpt: String,
}

enum Segment<'a> {
    Code(&'a str),
    Text(&'a str),
}

fn segment_markdown(body: &str) -> Vec<Segment<'_>> {
    let mut segments = Vec::new();
    let mut cursor = 0;
    let bytes = body.as_bytes();
    let len = bytes.len();
    let mut text_start = 0;

    while cursor < len {
        let at_line_start = cursor == 0 || bytes[cursor - 1] == b'\n';
        if at_line_start {
            let mut s = cursor;
            let mut spaces = 0;
            while s < len && bytes[s] == b' ' && spaces < 3 {
                s += 1;
                spaces += 1;
            }
            let mut b_count = 0;
            while s + b_count < len && bytes[s + b_count] == b'`' {
                b_count += 1;
            }
            if b_count >= 3 {
                if cursor > text_start {
                    segments.push(Segment::Text(&body[text_start..cursor]));
                }
                let fence_start = cursor;
                cursor = s + b_count;

                let mut line_end = cursor;
                while line_end < len && bytes[line_end] != b'\n' {
                    line_end += 1;
                }

                let rest_of_line = &body[cursor..line_end];
                let close_pattern = "`".repeat(b_count);
                if let Some(pos) = rest_of_line.rfind(&close_pattern) {
                    let code_end = cursor + pos + b_count;
                    segments.push(Segment::Code(&body[fence_start..code_end]));
                    cursor = code_end;
                    text_start = cursor;
                    continue;
                }

                if line_end < len && bytes[line_end] == b'\n' {
                    cursor = line_end + 1;
                } else {
                    cursor = line_end;
                }

                let mut fence_closed = false;
                while cursor < len {
                    let line_start = cursor;
                    let mut s = line_start;
                    let mut sp = 0;
                    while s < len && bytes[s] == b' ' && sp < 3 {
                        s += 1;
                        sp += 1;
                    }
                    let mut close_b = 0;
                    while s + close_b < len && bytes[s + close_b] == b'`' {
                        close_b += 1;
                    }
                    let mut next_line = s + close_b;
                    while next_line < len && bytes[next_line] != b'\n' {
                        next_line += 1;
                    }
                    if close_b >= b_count {
                        if next_line < len && bytes[next_line] == b'\n' {
                            cursor = next_line + 1;
                        } else {
                            cursor = next_line;
                        }
                        segments.push(Segment::Code(&body[fence_start..cursor]));
                        text_start = cursor;
                        fence_closed = true;
                        break;
                    }
                    if next_line < len && bytes[next_line] == b'\n' {
                        cursor = next_line + 1;
                    } else {
                        cursor = next_line;
                    }
                }
                if !fence_closed {
                    segments.push(Segment::Code(&body[fence_start..len]));
                    text_start = len;
                    cursor = len;
                }
                continue;
            }
        }

        if bytes[cursor] == b'`' {
            let tick_start = cursor;
            let mut tick_count = 0;
            while cursor < len && bytes[cursor] == b'`' {
                tick_count += 1;
                cursor += 1;
            }
            // The span closes only on a run of exactly the same length (CommonMark).
            if let Some(found) = closing_run(&bytes[cursor..], tick_count) {
                let code_end = cursor + found + tick_count;
                if tick_start > text_start {
                    segments.push(Segment::Text(&body[text_start..tick_start]));
                }
                segments.push(Segment::Code(&body[tick_start..code_end]));
                cursor = code_end;
                text_start = cursor;
                continue;
            } else {
                continue;
            }
        }

        cursor += 1;
    }

    if text_start < len {
        segments.push(Segment::Text(&body[text_start..len]));
    }

    segments
}

/// Offset of the next run of exactly `count` backticks in `rest`.
fn closing_run(rest: &[u8], count: usize) -> Option<usize> {
    let mut i = 0;
    while i < rest.len() {
        if rest[i] != b'`' {
            i += 1;
            continue;
        }
        let start = i;
        while i < rest.len() && rest[i] == b'`' {
            i += 1;
        }
        if i - start == count {
            return Some(start);
        }
    }
    None
}

fn parse_text_wikilinks(text: &str, titles: &mut Vec<String>) {
    let mut cursor = 0;
    while let Some(start) = text[cursor..].find("[[") {
        let abs_start = cursor + start;
        let inner_start = abs_start + 2;
        if let Some(end) = text[inner_start..].find("]]") {
            let abs_end = inner_start + end;
            let candidate = &text[inner_start..abs_end];

            if candidate.contains('\n') || candidate.contains('\r') {
                cursor = inner_start;
                continue;
            }

            if let Some(last_open) = candidate.rfind("[[") {
                cursor = inner_start + last_open;
                continue;
            }

            let raw_title = match candidate.split_once('|') {
                Some((t, _)) => t,
                None => candidate,
            };
            let title = raw_title.trim();
            if !title.is_empty() && !titles.iter().any(|t| t == title) {
                titles.push(title.to_string());
            }

            cursor = abs_end + 2;
        } else {
            break;
        }
    }
}

/// Judul unik sesuai urutan muncul. "[[A|alias]]" menghasilkan "A". Judul dipangkas,
/// dan judul kosong dibuang. Isi ``` fence ``` dan `kode inline` diabaikan.
pub fn parse(body: &str) -> Vec<String> {
    let mut titles = Vec::new();
    let segments = segment_markdown(body);

    for seg in segments {
        if let Segment::Text(text) = seg {
            parse_text_wikilinks(text, &mut titles);
        }
    }

    titles
}

fn rewrite_text_wikilinks(text: &str, old_clean: &str, new: &str, out: &mut String) {
    let mut cursor = 0;
    while let Some(start) = text[cursor..].find("[[") {
        let abs_start = cursor + start;
        let inner_start = abs_start + 2;
        if let Some(end) = text[inner_start..].find("]]") {
            let abs_end = inner_start + end;
            let candidate = &text[inner_start..abs_end];

            if candidate.contains('\n') || candidate.contains('\r') {
                out.push_str(&text[cursor..inner_start]);
                cursor = inner_start;
                continue;
            }

            if let Some(last_open) = candidate.rfind("[[") {
                out.push_str(&text[cursor..inner_start + last_open]);
                cursor = inner_start + last_open;
                continue;
            }

            out.push_str(&text[cursor..abs_start]);

            let (raw_title, alias) = match candidate.split_once('|') {
                Some((t, a)) => (t, Some(a)),
                None => (candidate, None),
            };

            let title = raw_title.trim();
            if title.eq_ignore_ascii_case(old_clean) {
                if let Some(alias) = alias {
                    out.push_str(&format!("[[{new}|{alias}]]"));
                } else {
                    out.push_str(&format!("[[{new}]]"));
                }
            } else {
                out.push_str(&text[abs_start..abs_end + 2]);
            }

            cursor = abs_end + 2;
        } else {
            break;
        }
    }

    out.push_str(&text[cursor..]);
}

/// "[[Lama]]" menjadi "[[Baru]]" dan "[[Lama|x]]" menjadi "[[Baru|x]]". Pencocokan judul
/// tidak membedakan huruf besar dan kecil. "[[Lama lain]]" dan kode tidak disentuh.
pub fn rewrite(body: &str, old: &str, new: &str) -> String {
    let old_clean = old.trim();
    if old_clean.is_empty() {
        return body.to_string();
    }

    let mut out = String::with_capacity(body.len());
    let segments = segment_markdown(body);

    for seg in segments {
        match seg {
            Segment::Code(code) => out.push_str(code),
            Segment::Text(text) => rewrite_text_wikilinks(text, old_clean, new, &mut out),
        }
    }

    out
}

/// Halaman dulu, lalu item lain dengan judul sama yang updated_at terbaru (C6).
pub fn resolve(conn: &Connection, title: &str) -> Result<Option<ItemSummary>, AppError> {
    let clean = title.trim();
    if clean.is_empty() {
        return Ok(None);
    }

    let sql = "SELECT id, type, title, due_at, MAX(created_at, updated_at, COALESCE(opened_at, 0)) AS last_activity_at
               FROM items
               WHERE deleted_at IS NULL AND LOWER(TRIM(title)) = LOWER(?1)
               ORDER BY
                 CASE WHEN type = 'page' THEN 0 ELSE 1 END,
                 updated_at DESC,
                 id ASC
               LIMIT 1";

    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query([clean])?;

    if let Some(r) = rows.next()? {
        Ok(Some(ItemSummary {
            id: r.get(0)?,
            kind: r.get(1)?,
            title: r.get(2)?,
            due_at: r.get(3)?,
            last_activity_at: r.get(4)?,
        }))
    } else {
        Ok(None)
    }
}

/// Hapus links milik from_id, lalu isi lagi dari parse(body) + resolve. Tautan ke diri sendiri dibuang.
pub fn refresh(conn: &Connection, from_id: &str, body: &str) -> Result<(), AppError> {
    let titles = parse(body);
    let mut target_ids = Vec::new();

    for title in titles {
        if let Some(target) = resolve(conn, &title)?
            && target.id != from_id
            && !target_ids.contains(&target.id)
        {
            target_ids.push(target.id);
        }
    }

    conn.execute("DELETE FROM links WHERE from_id = ?1", [from_id])?;

    for to_id in target_ids {
        conn.execute(
            "INSERT OR IGNORE INTO links (from_id, to_id) VALUES (?1, ?2)",
            params![from_id, to_id],
        )?;
    }

    Ok(())
}

/// Item yang menautkan id, tidak terhapus, updated_at terbaru dulu, dengan cuplikan
/// baris pertama yang memuat [[judul (tanpa membedakan huruf besar/kecil), maksimal 120 karakter.
pub fn backlinks(conn: &Connection, id: &str) -> Result<Vec<Backlink>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.type, i.title, i.due_at,
                MAX(i.created_at, i.updated_at, COALESCE(i.opened_at, 0)), i.body, target.title
         FROM links l
         JOIN items i ON i.id = l.from_id
         JOIN items target ON target.id = l.to_id
         WHERE l.to_id = ?1 AND i.deleted_at IS NULL AND target.deleted_at IS NULL
         ORDER BY i.updated_at DESC, i.id ASC",
    )?;
    let rows = stmt.query_map([id], |row| {
        let body: String = row.get(5)?;
        let title: String = row.get(6)?;
        let needle = format!("[[{}", title.to_lowercase());
        let excerpt = body
            .lines()
            .find(|line| line.to_lowercase().contains(&needle))
            .map(|line| line.trim().chars().take(120).collect())
            .unwrap_or_default();
        Ok(Backlink {
            item: ItemSummary {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                due_at: row.get(3)?,
                last_activity_at: row.get(4)?,
            },
            excerpt,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Menjalankan `refresh` ulang untuk setiap item tidak terhapus yang isinya memuat `[[judul`
/// (`LIKE`, tanpa membedakan huruf besar dan kecil). Dengan begitu backlink muncul begitu
/// halaman tujuannya dibuat.
pub fn refresh_mentions(conn: &Connection, title: &str) -> Result<(), AppError> {
    let clean = title.trim();
    if clean.is_empty() {
        return Ok(());
    }

    // A loose filter: refresh() parses each body exactly, so "[[\tJudul]]" is found too.
    let pattern = format!("%{clean}%");
    let mut stmt = conn.prepare(
        "SELECT id, body FROM items WHERE deleted_at IS NULL AND body LIKE '%[[%' AND body LIKE ?1",
    )?;
    let rows = stmt.query_map([&pattern], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut items = Vec::new();
    for r in rows {
        items.push(r?);
    }

    for (from_id, body) in items {
        refresh(conn, &from_id, &body)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {

    #[test]
    fn inline_code_closes_only_on_an_equal_backtick_run() {
        let body = "``a ``` b ` [[Old]] `` and [[Real]]";
        assert_eq!(parse(body), vec!["Real".to_string()]);
        assert_eq!(rewrite(body, "Old", "New"), body);
    }

    use super::*;

    #[test]
    fn parse_skips_code_and_aliases() {
        let body = r#"
# Heading
Di sini ada [[Tautan Satu]] dan [[Tautan Dua|alias dua]].
Spasi: [[  Tautan Tiga  | alias tiga  ]] serta tautan kosong: [[]] dan [[   ]].

```rust
// Kode ini punya [[Tautan Palsu]] dan [[Tautan Dua|alias]]
fn main() {}
```

Kode satu baris: ``` fence [[Palsu Dua]] ``` dan `kode [[Palsu Tiga]]` inline.
Tautan ulang: [[Tautan Satu|alias lain]] dan [[Tautan Empat]].
"#;

        let parsed = parse(body);
        assert_eq!(
            parsed,
            vec![
                "Tautan Satu".to_string(),
                "Tautan Dua".to_string(),
                "Tautan Tiga".to_string(),
                "Tautan Empat".to_string(),
            ]
        );
    }

    #[test]
    fn rewrite_changes_only_exact_titles() {
        let body = r#"
Teks dengan [[Lama]], [[Lama|alias]], dan huruf kecil [[lama]].
Teks mirip: [[Lama Lain]] dan [[Lama Sekali|alias]].

```
Blok kode: [[Lama]] dan [[Lama|x]]
```

Inline: `[[Lama]]` tidak diubah.
"#;

        let rewritten = rewrite(body, "Lama", "Baru");
        let expected = r#"
Teks dengan [[Baru]], [[Baru|alias]], dan huruf kecil [[Baru]].
Teks mirip: [[Lama Lain]] dan [[Lama Sekali|alias]].

```
Blok kode: [[Lama]] dan [[Lama|x]]
```

Inline: `[[Lama]]` tidak diubah.
"#;
        assert_eq!(rewritten, expected);
    }

    #[test]
    fn resolve_prefers_pages() {
        let conn = crate::db::open_in_memory();

        // 1. Note with title "Catatan A" updated at 200
        conn.execute(
            "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES ('n1', 'note', 'Catatan A', '', 100, 200)",
            [],
        )
        .unwrap();

        // 2. Page with title "Catatan A" updated earlier at 100
        conn.execute(
            "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES ('p1', 'page', 'Catatan A', '', 100, 100)",
            [],
        )
        .unwrap();

        // 3. Resolve should prefer the page over the note, even though the note was updated later
        let resolved = resolve(&conn, "Catatan A").unwrap().unwrap();
        assert_eq!(resolved.id, "p1");
        assert_eq!(resolved.kind, "page");

        // Case-insensitive
        let resolved_lower = resolve(&conn, "catatan a").unwrap().unwrap();
        assert_eq!(resolved_lower.id, "p1");

        // 4. Two notes without page: prefers newer updated_at
        conn.execute(
            "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES ('n2', 'note', 'Proyek X', '', 100, 150)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES ('n3', 'note', 'Proyek X', '', 100, 300)",
            [],
        )
        .unwrap();

        let resolved_note = resolve(&conn, "Proyek X").unwrap().unwrap();
        assert_eq!(resolved_note.id, "n3");

        // 5. Deleted item is skipped
        conn.execute("UPDATE items SET deleted_at = 500 WHERE id = 'p1'", []).unwrap();
        let resolved_after_delete = resolve(&conn, "Catatan A").unwrap().unwrap();
        assert_eq!(resolved_after_delete.id, "n1");
    }

    #[test]
    fn refresh_and_backlinks_follow_saved_bodies() {
        let conn = crate::db::open_in_memory();
        let tz = jiff::tz::TimeZone::system();

        // Target page
        conn.execute(
            "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES ('target', 'page', 'Target Halaman', '', 100, 100)",
            [],
        )
        .unwrap();

        // 1. Source 1: Note updated via items::update
        let note_id = crate::items::insert(&conn, "note", "Catatan Penaut", "", 100).unwrap();
        crate::items::update(
            &conn,
            &note_id,
            &crate::items::ItemPatch {
                body: Some("Tautan ke [[Target Halaman]].".into()),
                ..Default::default()
            },
            150,
        )
        .unwrap();

        let links1 = backlinks(&conn, "target").unwrap();
        assert_eq!(links1.len(), 1);
        assert_eq!(links1[0].item.id, note_id);
        assert_eq!(links1[0].excerpt, "Tautan ke [[Target Halaman]].");

        // 2. Source 2: a Jurnal entry; the editor saves its body through items::update
        let journal_entry = crate::journal::create_entry(&conn, crate::journal::EntryKind::Note, Some("Jurnal Penaut"), 200, &tz).unwrap();
        crate::items::update(
            &conn,
            &journal_entry.id,
            &crate::items::ItemPatch {
                title: None,
                body: Some("Menyebut [[Target Halaman|alias]].".into()),
                due_at: None,
            },
            250,
        )
        .unwrap();

        let links2 = backlinks(&conn, "target").unwrap();
        assert_eq!(links2.len(), 2);
        assert_eq!(links2[0].item.id, journal_entry.id); // updated at 250
        assert_eq!(links2[0].item.kind, "note");
        assert_eq!(links2[0].excerpt, "Menyebut [[Target Halaman|alias]].");
        assert_eq!(links2[1].item.id, note_id);          // updated at 150

        // 3. Self-links are ignored
        refresh(&conn, "target", "Menautkan diri sendiri: [[Target Halaman]]").unwrap();
        let links3 = backlinks(&conn, "target").unwrap();
        assert_eq!(links3.len(), 2);
        assert!(!links3.iter().any(|backlink| backlink.item.id == "target"));

        // 4. Soft-deleted linking items do not appear
        crate::items::soft_delete(&conn, &journal_entry.id, 300).unwrap();
        let links4 = backlinks(&conn, "target").unwrap();
        assert_eq!(links4.len(), 1);
        assert_eq!(links4[0].item.id, note_id);
    }

    #[test]
    fn refresh_mentions_finds_and_updates_referencing_items() {
        let conn = crate::db::open_in_memory();

        // 1. Note mentioning [[Halaman Rencana]] before it exists
        let note_id = crate::items::insert(&conn, "note", "Catatan Lama", "Membahas [[Halaman Rencana]].", 100).unwrap();
        refresh(&conn, &note_id, "Membahas [[Halaman Rencana]].").unwrap();

        // Target page doesn't exist yet, so no links
        let target_id = "page_rencana";
        let links = backlinks(&conn, target_id).unwrap();
        assert!(links.is_empty());

        // 2. Now insert the page
        conn.execute(
            "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES (?1, 'page', 'Halaman Rencana', '', 200, 200)",
            params![target_id],
        ).unwrap();

        // 3. Call refresh_mentions
        refresh_mentions(&conn, "Halaman Rencana").unwrap();

        // Now the note appears in backlinks!
        let links_after = backlinks(&conn, target_id).unwrap();
        assert_eq!(links_after.len(), 1);
        assert_eq!(links_after[0].item.id, note_id);
        assert_eq!(links_after[0].excerpt, "Membahas [[Halaman Rencana]].");
    }

    #[test]
    fn backlinks_excerpt_uses_first_matching_line_and_flattens_item() {
        let conn = crate::db::open_in_memory();
        let target = crate::notes::create(&conn, None, "Target Halaman", 100).unwrap();
        let body = "Pendahuluan tanpa tautan.\n\tLihat [[tArGeT HaLaMaN|alias]] hari ini.  \r\nBaris berikutnya [[Target Halaman]].";
        let source = crate::items::insert(&conn, "note", "Jurnal Penaut", body, 200).unwrap();
        refresh(&conn, &source, body).unwrap();

        let backlinks = backlinks(&conn, &target.id).unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].excerpt, "Lihat [[tArGeT HaLaMaN|alias]] hari ini.");
        assert_eq!(
            serde_json::to_value(&backlinks[0]).unwrap(),
            serde_json::json!({
                "id": source,
                "type": "note",
                "title": "Jurnal Penaut",
                "dueAt": null,
                "lastActivityAt": 200,
                "excerpt": "Lihat [[tArGeT HaLaMaN|alias]] hari ini.",
            })
        );
    }

    #[test]
    fn backlinks_excerpt_limits_unicode_to_120_characters() {
        let conn = crate::db::open_in_memory();
        let target = crate::notes::create(&conn, None, "Target", 100).unwrap();
        let line = format!("Lihat [[Target]]: {}", "🦀".repeat(150));
        let body = format!("Pengantar.\n  {line}  \n[[Target]] di baris terakhir.");
        let source = crate::items::insert(&conn, "task", "Tugas Penaut", &body, 200).unwrap();
        refresh(&conn, &source, &body).unwrap();

        let backlinks = backlinks(&conn, &target.id).unwrap();
        assert_eq!(backlinks[0].excerpt, line.chars().take(120).collect::<String>());
        assert_eq!(backlinks[0].excerpt.chars().count(), 120);
    }

    #[test]
    fn backlinks_without_matching_line_have_empty_excerpt() {
        let conn = crate::db::open_in_memory();
        let target = crate::notes::create(&conn, None, "Target", 100).unwrap();
        let body = "Tautan dengan spasi [[ Target ]].";
        let source = crate::items::insert(&conn, "note", "Penaut", body, 200).unwrap();
        refresh(&conn, &source, body).unwrap();

        let backlinks = backlinks(&conn, &target.id).unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].excerpt, "");
    }

    #[test]
    fn backlinks_exclude_deleted_targets() {
        let conn = crate::db::open_in_memory();
        let target = crate::notes::create(&conn, None, "Target", 100).unwrap();
        let source = crate::items::insert(&conn, "note", "Penaut", "[[Target]]", 200).unwrap();
        refresh(&conn, &source, "[[Target]]").unwrap();
        crate::notes::delete(&conn, &target.id, 300).unwrap();

        assert!(backlinks(&conn, &target.id).unwrap().is_empty());
    }
}
