//! Per-folder customisation for the Files page: colour / emoji markers and
//! bookmarks, keyed by absolute folder path so a marker shows on every
//! surface (grid, list, Places), plus a read-only folder summary (count by
//! kind / size / duplicates). Nothing here moves or deletes user files.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::files::{self, FileKind};
use crate::time;

/// Walk guards: a summary must stay fast on huge trees.
const MAX_ENTRIES: usize = 20_000;
const MAX_DEPTH: usize = 8;
/// Files larger than this are grouped by size only, never hashed.
const HASH_LIMIT: u64 = 64 * 1024 * 1024;
const MAX_DUPLICATE_GROUPS: usize = 50;
const MAX_LARGEST: usize = 5;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMeta {
    pub path: String,
    pub emoji: String,
    pub color: String,
    pub pinned: bool,
    pub updated_at: i64,
}

/// Marker payload from the UI. Empty fields clear that part of the marker.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMarker {
    #[serde(default)]
    pub emoji: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindCount {
    pub kind: String,
    pub count: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BigFile {
    pub path: String,
    pub name: String,
    pub bytes: u64,
}

/// Files with identical content; `paths` is sorted, so `paths[0]` is stable.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub bytes: u64,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSummary {
    pub path: String,
    pub folders: u64,
    pub files: u64,
    pub total_bytes: u64,
    pub by_kind: Vec<KindCount>,
    pub largest: Vec<BigFile>,
    pub duplicates: Vec<DuplicateGroup>,
    /// True when a walk cap was hit, so the UI can say "at least".
    pub truncated: bool,
}

fn validate_path(path: &str) -> Result<&str, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("Path folder tidak boleh kosong".into()));
    }
    if trimmed.len() > 4096 {
        return Err(AppError::Invalid("Path folder terlalu panjang".into()));
    }
    Ok(trimmed)
}

fn valid_color(color: &str) -> bool {
    let hex = color.strip_prefix('#').unwrap_or(color);
    hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit())
}

fn validate_marker(marker: &FolderMarker) -> Result<(), AppError> {
    if !marker.color.is_empty() && !valid_color(&marker.color) {
        return Err(AppError::Invalid("Warna penanda harus format #rrggbb".into()));
    }
    if marker.emoji.chars().count() > 8 {
        return Err(AppError::Invalid("Penanda emoji terlalu panjang".into()));
    }
    Ok(())
}

fn row_to_meta(row: &rusqlite::Row<'_>) -> rusqlite::Result<FolderMeta> {
    Ok(FolderMeta {
        path: row.get(0)?,
        emoji: row.get(1)?,
        color: row.get(2)?,
        pinned: row.get::<_, i64>(3)? != 0,
        updated_at: row.get(4)?,
    })
}

const SELECT: &str = "SELECT path, emoji, color, pinned, updated_at FROM folder_markers";

/// Every stored marker, bookmarked folders first.
pub fn list(conn: &Connection) -> Result<Vec<FolderMeta>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} ORDER BY pinned DESC, updated_at DESC, path ASC"
    ))?;
    let rows = stmt.query_map([], row_to_meta)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get(conn: &Connection, path: &str) -> Result<Option<FolderMeta>, AppError> {
    let path = validate_path(path)?;
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE path = ?1"))?;
    let mut rows = stmt.query([path])?;
    match rows.next()? {
        Some(row) => Ok(Some(row_to_meta(row)?)),
        None => Ok(None),
    }
}

/// Upsert so the row keeps its bookmark while the marker changes.
pub fn set_marker(
    conn: &Connection,
    path: &str,
    marker: &FolderMarker,
    now: i64,
) -> Result<FolderMeta, AppError> {
    validate_marker(marker)?;
    let path = validate_path(path)?;
    conn.execute(
        "INSERT INTO folder_markers (path, emoji, color, pinned, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4)
         ON CONFLICT(path) DO UPDATE SET
             emoji = excluded.emoji,
             color = excluded.color,
             updated_at = excluded.updated_at",
        rusqlite::params![path, &marker.emoji, &marker.color, now],
    )?;
    // Re-read rather than trust the INSERT defaults: a bookmark set earlier must
    // survive a later marker change.
    get(conn, path)?.ok_or_else(|| AppError::Invalid("Folder tidak ditemukan".into()))
}

/// Upsert so bookmarking a folder with no marker still creates a row.
pub fn set_pinned(
    conn: &Connection,
    path: &str,
    pinned: bool,
    now: i64,
) -> Result<FolderMeta, AppError> {
    let path = validate_path(path)?;
    conn.execute(
        "INSERT INTO folder_markers (path, emoji, color, pinned, updated_at)
         VALUES (?1, '', '', ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET pinned = excluded.pinned, updated_at = excluded.updated_at",
        rusqlite::params![path, pinned, now],
    )?;
    get(conn, path)?.ok_or_else(|| AppError::Invalid("Folder tidak ditemukan".into()))
}

/// Drops the marker. The row is deleted when nothing custom is left, so Places
/// only lists folders the user actually touched.
pub fn clear(conn: &Connection, path: &str, now: i64) -> Result<Option<FolderMeta>, AppError> {
    let previous = get(conn, path)?;
    set_marker(conn, path, &FolderMarker::default(), now)?;
    if previous.is_none_or(|meta| !meta.pinned) {
        conn.execute(
            "DELETE FROM folder_markers WHERE path = ?1",
            [validate_path(path)?],
        )?;
    }
    get(conn, path)
}

fn kind_name(kind: FileKind) -> &'static str {
    match kind {
        FileKind::Folder => "folder",
        FileKind::Image => "image",
        FileKind::Video => "video",
        FileKind::Pdf => "pdf",
        FileKind::Text => "text",
        FileKind::Other => "other",
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

pub fn summary(path: &str, roots: &files::Roots) -> Result<FolderSummary, AppError> {
    let root = files::guard(path, roots)?;
    if !root.is_dir() {
        return Err(AppError::Invalid("Bukan sebuah folder".into()));
    }
    let mut result = FolderSummary {
        path: root.to_string_lossy().to_string(),
        folders: 0,
        files: 0,
        total_bytes: 0,
        by_kind: Vec::new(),
        largest: Vec::new(),
        duplicates: Vec::new(),
        truncated: false,
    };
    let mut kinds: Vec<(FileKind, u64, u64)> = Vec::new();
    let mut files_seen: Vec<(PathBuf, u64)> = Vec::new();

    walk(&root, 0, &mut result, &mut kinds, &mut files_seen);

    kinds.sort_by_key(|(kind, ..)| kind_name(*kind));
    result.by_kind = kinds
        .into_iter()
        .map(|(kind, count, bytes)| KindCount {
            kind: kind_name(kind).to_string(),
            count,
            bytes,
        })
        .collect();

    let mut largest = files_seen.clone();
    largest.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    result.largest = largest
        .into_iter()
        .take(MAX_LARGEST)
        .map(|(path, bytes)| BigFile {
            name: file_name(&path),
            path: path.to_string_lossy().to_string(),
            bytes,
        })
        .collect();

    result.duplicates = duplicate_groups(&files_seen);
    Ok(result)
}

fn walk(
    dir: &Path,
    depth: usize,
    summary: &mut FolderSummary,
    kinds: &mut Vec<(FileKind, u64, u64)>,
    files_seen: &mut Vec<(PathBuf, u64)>,
) {
    if depth > MAX_DEPTH || files_seen.len() >= MAX_ENTRIES {
        summary.truncated = true;
        return;
    }
    let Ok(read_dir) = fs::read_dir(dir) else {
        summary.truncated = true;
        return;
    };
    for item in read_dir.flatten() {
        if files_seen.len() >= MAX_ENTRIES {
            summary.truncated = true;
            return;
        }
        let path = item.path();
        // symlink_metadata: never follow a symlinked folder, it can loop forever.
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            summary.folders += 1;
            walk(&path, depth + 1, summary, kinds, files_seen);
            continue;
        }
        let bytes = meta.len();
        summary.files += 1;
        summary.total_bytes += bytes;
        files_seen.push((path.clone(), bytes));
        let kind = files::kind_of(&path);
        match kinds.iter_mut().find(|(k, ..)| *k == kind) {
            Some((_, count, size)) => {
                *count += 1;
                *size += bytes;
            }
            None => kinds.push((kind, 1, bytes)),
        }
    }
}

/// Groups equal content by size first, then by a content hash of the bytes.
fn duplicate_groups(files_seen: &[(PathBuf, u64)]) -> Vec<DuplicateGroup> {
    let mut by_size: HashMap<u64, Vec<&PathBuf>> = HashMap::new();
    for (path, bytes) in files_seen {
        by_size.entry(*bytes).or_default().push(path);
    }
    let mut groups = Vec::new();
    for (bytes, same_size) in by_size {
        if same_size.len() < 2 {
            continue;
        }
        let mut by_hash: HashMap<u64, Vec<String>> = HashMap::new();
        for path in same_size {
            if let Some(hash) = content_hash(path, bytes) {
                by_hash
                    .entry(hash)
                    .or_default()
                    .push(path.to_string_lossy().to_string());
            }
        }
        let mut hashes: Vec<(u64, Vec<String>)> = by_hash.into_iter().collect();
        hashes.sort_by_key(|(_, paths)| paths[0].clone());
        for (_, mut paths) in hashes {
            if paths.len() < 2 {
                continue;
            }
            paths.sort();
            groups.push(DuplicateGroup { bytes, paths });
        }
        if groups.len() >= MAX_DUPLICATE_GROUPS {
            groups.truncate(MAX_DUPLICATE_GROUPS);
            break;
        }
    }
    groups
}

/// FNV-1a over the file content; only called for files that share a size.
fn content_hash(path: &Path, bytes: u64) -> Option<u64> {
    if bytes == 0 || bytes > HASH_LIMIT {
        return None;
    }
    let data = fs::read(path).ok()?;
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in data {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    Some(hash)
}

#[tauri::command]
pub fn folder_meta_list(db: tauri::State<'_, crate::db::Db>) -> Result<Vec<FolderMeta>, AppError> {
    list(&*db.conn()?)
}

#[tauri::command]
pub fn folder_meta_set(
    db: tauri::State<'_, crate::db::Db>,
    path: String,
    marker: FolderMarker,
) -> Result<FolderMeta, AppError> {
    set_marker(&*db.conn()?, &path, &marker, time::now_ms())
}

#[tauri::command]
pub fn folder_meta_pin(
    db: tauri::State<'_, crate::db::Db>,
    path: String,
    pinned: bool,
) -> Result<FolderMeta, AppError> {
    set_pinned(&*db.conn()?, &path, pinned, time::now_ms())
}

#[tauri::command]
pub fn folder_meta_clear(
    db: tauri::State<'_, crate::db::Db>,
    path: String,
) -> Result<Option<FolderMeta>, AppError> {
    clear(&*db.conn()?, &path, time::now_ms())
}

#[tauri::command]
pub async fn folder_summary(
    app: tauri::AppHandle,
    path: String,
) -> Result<FolderSummary, AppError> {
    let (_user, roots, _devices) = crate::commands::current_user_and_roots(&app)?;
    tauri::async_runtime::spawn_blocking(move || summary(&path, &roots))
        .await
        .map_err(|e| AppError::Other(format!("Ringkasan folder gagal: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn fresh_db() -> Connection {
        crate::db::open_in_memory()
    }

    fn roots_for(home: &TempDir) -> files::Roots {
        files::Roots::new(home.path().to_path_buf(), Vec::new())
    }

    fn touch(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn marker_round_trips_and_updates_in_place() {
        let conn = fresh_db();
        let first = set_marker(
            &conn,
            "/home/user/Foto",
            &FolderMarker {
                emoji: "📷".into(),
                color: "#ff8800".into(),
            },
            100,
        )
        .unwrap();
        assert_eq!(first.emoji, "📷");
        assert_eq!(first.color, "#ff8800");
        assert!(!first.pinned);

        set_marker(
            &conn,
            "/home/user/Foto",
            &FolderMarker {
                emoji: "🎉".into(),
                color: String::new(),
            },
            200,
        )
        .unwrap();
        let all = list(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].emoji, "🎉");
        assert_eq!(all[0].color, "");
        assert_eq!(all[0].updated_at, 200);
    }

    #[test]
    fn pinning_keeps_the_marker_and_comes_first_in_places() {
        let conn = fresh_db();
        set_marker(
            &conn,
            "/a",
            &FolderMarker {
                emoji: "📁".into(),
                color: String::new(),
            },
            1,
        )
        .unwrap();
        set_marker(&conn, "/b", &FolderMarker::default(), 2).unwrap();

        let pinned = set_pinned(&conn, "/a", true, 3).unwrap();
        assert!(pinned.pinned);
        assert_eq!(pinned.emoji, "📁", "bookmark must not drop the marker");

        // Changing the marker later must not un-pin the folder.
        let after = set_marker(
            &conn,
            "/a",
            &FolderMarker {
                emoji: "⭐".into(),
                color: String::new(),
            },
            4,
        )
        .unwrap();
        assert!(after.pinned);

        let all = list(&conn).unwrap();
        assert_eq!(all[0].path, "/a");
        assert_eq!(all.len(), 2);

        set_pinned(&conn, "/a", false, 5).unwrap();
        assert!(list(&conn).unwrap().iter().all(|meta| !meta.pinned));
    }

    #[test]
    fn clearing_removes_the_row_but_keeps_a_bookmark() {
        let conn = fresh_db();
        set_pinned(&conn, "/kept", true, 1).unwrap();
        set_marker(
            &conn,
            "/kept",
            &FolderMarker {
                emoji: "📦".into(),
                color: String::new(),
            },
            2,
        )
        .unwrap();
        let cleared = clear(&conn, "/kept", 3).unwrap().unwrap();
        assert!(cleared.pinned);
        assert_eq!(cleared.emoji, "");
        assert_eq!(list(&conn).unwrap().len(), 1, "bookmarked folder stays");

        set_marker(
            &conn,
            "/plain",
            &FolderMarker {
                emoji: "x".into(),
                color: String::new(),
            },
            4,
        )
        .unwrap();
        assert!(clear(&conn, "/plain", 5).unwrap().is_none());
        assert_eq!(list(&conn).unwrap().len(), 1, "only the bookmarked folder remains");
    }

    #[test]
    fn bad_marker_input_is_rejected() {
        let conn = fresh_db();
        for marker in [
            FolderMarker {
                emoji: String::new(),
                color: "merah".into(),
            },
            FolderMarker {
                emoji: "x".repeat(9),
                color: String::new(),
            },
        ] {
            let err = set_marker(&conn, "/home/user", &marker, 1).unwrap_err();
            assert_eq!(err.code(), "invalid");
        }
        assert!(set_marker(&conn, "   ", &FolderMarker::default(), 1).is_err());
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn summary_counts_kinds_sizes_and_finds_duplicates() {
        let home = TempDir::new().unwrap();
        let root = home.path();
        touch(&root.join("a/one.txt"), b"hello");
        touch(&root.join("a/copy-of-one.txt"), b"hello");
        touch(&root.join("a/two.txt"), b"different");
        touch(&root.join("b/photo.png"), &[0u8; 1024]);

        let result = summary(&root.to_string_lossy(), &roots_for(&home)).unwrap();

        assert_eq!(result.path, root.to_string_lossy());
        assert_eq!(result.folders, 2);
        assert_eq!(result.files, 4);
        assert_eq!(result.total_bytes, 5 + 5 + 9 + 1024);
        assert!(!result.truncated);
        assert_eq!(result.largest[0].bytes, 1024);

        let text = result.by_kind.iter().find(|k| k.kind == "text").unwrap();
        assert_eq!(text.count, 3);
        assert_eq!(text.bytes, 19);
        let image = result.by_kind.iter().find(|k| k.kind == "image").unwrap();
        assert_eq!(image.count, 1);

        assert_eq!(result.duplicates.len(), 1);
        let group = &result.duplicates[0];
        assert_eq!(group.bytes, 5);
        assert_eq!(group.paths.len(), 2);
        assert!(group.paths[0].ends_with("copy-of-one.txt"));
    }

    #[test]
    fn summary_refuses_paths_outside_the_roots() {
        let home = TempDir::new().unwrap();
        assert!(summary("/", &roots_for(&home)).is_err());
    }
}
