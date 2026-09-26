//! Filesystem reads. Everything here blocks, so call it from a worker thread only.

use std::cmp::Ordering;
use std::io;
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub path: PathBuf,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mode: u32,
    /// Seconds since the Unix epoch.
    pub modified: i64,
}

/// Describes a single path the same way [`list_dir`] does.
///
/// Symlinks are described by their target; a broken symlink falls back to the link itself.
/// Returns `None` when neither stat works.
pub fn stat_entry(path: &Path) -> Option<Entry> {
    let meta = std::fs::metadata(path)
        .or_else(|_| std::fs::symlink_metadata(path))
        .ok()?;
    Some(Entry {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        is_dir: meta.is_dir(),
        size: meta.len(),
        mode: meta.mode(),
        modified: meta.mtime(),
        path: path.to_path_buf(),
    })
}

/// Orders entries the way [`list_dir`] returns them: folders first, then case-insensitive name.
pub fn compare(a: &Entry, b: &Entry) -> Ordering {
    (!a.is_dir, a.name.to_lowercase()).cmp(&(!b.is_dir, b.name.to_lowercase()))
}

/// Lists `dir`, directories first, then by case-insensitive name.
///
/// Symlinks are described by their target; a broken symlink falls back to the link itself.
/// Entries that vanish between `read_dir` and `stat` are skipped.
pub fn list_dir(dir: &Path) -> io::Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for dirent in std::fs::read_dir(dir)? {
        let path = dirent?.path();
        if let Some(entry) = stat_entry(&path) {
            entries.push(entry);
        }
    }
    entries.sort_by(compare);
    Ok(entries)
}

/// Resolves path-bar input: `~` expands to `home`, relative paths are taken from `cwd`,
/// and `.`/`..` are folded lexically (symlinks are not resolved).
pub fn resolve_input(input: &str, cwd: &Path, home: &Path) -> PathBuf {
    let input = input.trim();
    let joined = match input.strip_prefix('~') {
        Some("") => home.to_path_buf(),
        Some(rest) if rest.starts_with('/') => home.join(rest.trim_start_matches('/')),
        _ => cwd.join(input),
    };
    let mut resolved = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                resolved.pop();
            }
            other => resolved.push(other),
        }
    }
    resolved
}

/// Completes the last path component of `input` with a matching **folder** name (PRD §6.1,
/// Tab in the path bar). The text before the last `/` (if any) is kept as typed — `~` and
/// relative prefixes are not expanded — and only that folder (resolved via [`resolve_input`]
/// from the text up to and including that `/`, so a leading `/` correctly resolves to the
/// filesystem root) is read to find folder names starting with the part after the last `/`.
/// A bare `~` (no `/` at all) is home itself and completes straight to `~/`.
///
/// A single match always completes to the full name plus a trailing `/`, even if that name is
/// exactly what was typed (like a shell: pressing Tab on an already-complete folder name still
/// adds the `/`). Several matches complete to their longest common prefix, without a trailing
/// `/` (it may not be a complete name) — and `None` there when that prefix is no longer than
/// what was already typed, since several matches leave nothing unambiguous to add. Hidden
/// folders only match a prefix that itself starts with `.`, same as a shell — in particular, an
/// empty prefix never matches them. Entries whose name is not valid UTF-8 are skipped, since
/// they could not be written back into the (UTF-8) path bar.
pub fn complete(input: &str, cwd: &Path, home: &Path) -> Option<String> {
    if input == "~" {
        return Some("~/".to_string());
    }
    let (prefix_text, name_prefix) = match input.rfind('/') {
        Some(i) => (&input[..=i], &input[i + 1..]),
        None => ("", input),
    };
    let dir = resolve_input(prefix_text, cwd, home);
    let matches: Vec<String> = std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let file_name = entry.file_name();
            let name = file_name.to_str()?;
            if !name.starts_with(name_prefix)
                || (name.starts_with('.') && !name_prefix.starts_with('.'))
            {
                return None;
            }
            std::fs::metadata(entry.path())
                .ok()
                .filter(std::fs::Metadata::is_dir)
                .map(|_| name.to_owned())
        })
        .collect();
    match matches.as_slice() {
        [] => None,
        [only] => Some(format!("{prefix_text}{only}/")),
        multiple => {
            let completed = common_prefix(multiple);
            (completed.chars().count() > name_prefix.chars().count())
                .then(|| format!("{prefix_text}{completed}"))
        }
    }
}

/// The longest common prefix shared by every string in `names` (`names` is never empty).
fn common_prefix(names: &[String]) -> String {
    let first = &names[0];
    let shared = names[1..].iter().fold(first.chars().count(), |len, name| {
        first
            .chars()
            .zip(name.chars())
            .take_while(|(a, b)| a == b)
            .count()
            .min(len)
    });
    first.chars().take(shared).collect()
}

/// Formats the permission bits as `rwxr-xr-x`.
pub fn permission_string(mode: u32) -> String {
    (0..9)
        .map(|i| {
            if mode & (0o400 >> i) == 0 {
                '-'
            } else {
                ['r', 'w', 'x'][i % 3]
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("anchoa-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn list_dir_sorts_dirs_first_and_keeps_broken_symlinks() {
        let dir = temp_dir("list");
        std::fs::write(dir.join("b.txt"), "hello").unwrap();
        std::fs::write(dir.join("A.txt"), "").unwrap();
        std::fs::create_dir(dir.join("zdir")).unwrap();
        std::os::unix::fs::symlink(dir.join("missing"), dir.join("broken")).unwrap();

        let entries = list_dir(&dir).unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["zdir", "A.txt", "b.txt", "broken"]);
        assert!(entries[0].is_dir);
        assert_eq!(entries[2].size, 5);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn list_dir_missing_dir_is_error() {
        assert!(list_dir(Path::new("/nonexistent/anchoa-test")).is_err());
    }

    #[test]
    fn resolve_input_expands_home_and_relative_paths() {
        let (cwd, home) = (Path::new("/data/work"), Path::new("/home/me"));
        assert_eq!(resolve_input("~", cwd, home), home);
        assert_eq!(
            resolve_input(" ~/Pictures ", cwd, home),
            home.join("Pictures")
        );
        assert_eq!(resolve_input("/etc", cwd, home), Path::new("/etc"));
        assert_eq!(resolve_input("sub/dir", cwd, home), cwd.join("sub/dir"));
        assert_eq!(resolve_input("../x/./y", cwd, home), Path::new("/data/x/y"));
        assert_eq!(resolve_input("/../..", cwd, home), Path::new("/"));
        // `~user` is not supported; treated as a relative name.
        assert_eq!(resolve_input("~bob", cwd, home), cwd.join("~bob"));
    }

    #[test]
    fn permission_string_formats_bits() {
        assert_eq!(permission_string(0o755), "rwxr-xr-x");
        assert_eq!(permission_string(0o100640), "rw-r-----");
        assert_eq!(permission_string(0), "---------");
    }
}
