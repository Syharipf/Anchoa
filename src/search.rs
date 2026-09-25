//! Name search for the active folder. Filesystem traversal blocks, so call it from a worker.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::fs::{self, Entry};
use crate::planner::glob_match;

/// Matches `name` case-insensitively, using a whole-name glob when `query` has `*` or `?`.
pub fn matches(query: &str, name: &str) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }
    let name = name.to_lowercase();
    if query.contains(['*', '?']) {
        glob_match(&query, &name)
    } else {
        name.contains(&query)
    }
}

/// Recursively searches below `root`, stopping and returning no results when `cancel` is set.
pub fn walk(root: &Path, query: &str, hidden: bool, cancel: &AtomicBool) -> Vec<Entry> {
    let mut results = Vec::new();
    if visit(root, root, query, hidden, cancel, &mut results) {
        results.sort_by_cached_key(|entry| entry.name.to_lowercase());
        results
    } else {
        Vec::new()
    }
}

fn visit(
    root: &Path,
    dir: &Path,
    query: &str,
    hidden: bool,
    cancel: &AtomicBool,
    results: &mut Vec<Entry>,
) -> bool {
    if cancel.load(Ordering::Relaxed) {
        return false;
    }
    let Ok(entries) = fs::list_dir(dir) else {
        return true;
    };
    for mut entry in entries {
        let name = entry.path.file_name().unwrap_or_default().to_string_lossy();
        let visible = hidden || !name.starts_with('.');
        if visible
            && entry.is_dir
            && !std::fs::symlink_metadata(&entry.path)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
            && !visit(root, &entry.path, query, hidden, cancel, results)
        {
            return false;
        }
        if visible && matches(query, &name) {
            entry.name = entry
                .path
                .strip_prefix(root)
                .unwrap_or(&entry.path)
                .to_string_lossy()
                .into_owned();
            results.push(entry);
        }
    }
    true
}
