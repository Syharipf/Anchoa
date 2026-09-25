//! Filesystem reads. Everything here blocks, so call it from a worker thread only.

use std::io;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

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

/// Lists `dir`, directories first, then by case-insensitive name.
///
/// Symlinks are described by their target; a broken symlink falls back to the link itself.
/// Entries that vanish between `read_dir` and `stat` are skipped.
pub fn list_dir(dir: &Path) -> io::Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for dirent in std::fs::read_dir(dir)? {
        let path = dirent?.path();
        let Ok(meta) = std::fs::metadata(&path).or_else(|_| std::fs::symlink_metadata(&path))
        else {
            continue;
        };
        entries.push(Entry {
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            mode: meta.mode(),
            modified: meta.mtime(),
            path,
        });
    }
    entries.sort_by_cached_key(|e| (!e.is_dir, e.name.to_lowercase()));
    Ok(entries)
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
        let dir = std::env::temp_dir().join(format!("loom-{name}-{}", std::process::id()));
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
        assert!(list_dir(Path::new("/nonexistent/loom-test")).is_err());
    }

    #[test]
    fn permission_string_formats_bits() {
        assert_eq!(permission_string(0o755), "rwxr-xr-x");
        assert_eq!(permission_string(0o100640), "rw-r-----");
        assert_eq!(permission_string(0), "---------");
    }
}
