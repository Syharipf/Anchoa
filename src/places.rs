//! Sidebar locations: XDG user directories and mounted drives.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Place {
    pub label: String,
    pub path: PathBuf,
    /// Symbolic icon name.
    pub icon: &'static str,
}

/// Home plus the XDG user directories (Documents, Downloads, Music, Pictures, Videos) that
/// are configured, exist, and are not the home directory itself — in that order.
/// Uses `glib::home_dir()` and `glib::user_special_dir()`; cheap, safe on the UI thread.
pub fn standard_places() -> Vec<Place> {
    todo!()
}

/// Directories that hold mount points: `/run/media/$USER` (udisks2) and `/mnt`.
pub fn drive_roots() -> Vec<PathBuf> {
    todo!()
}

/// One `Place` per sub-directory of each root (icon `drive-harddisk-symbolic`, label = directory
/// name), sorted by label within each root, roots in the given order. Missing or unreadable roots
/// and non-directory entries are skipped. Blocks on I/O: call from a worker thread.
pub fn drives(roots: &[PathBuf]) -> Vec<Place> {
    let _ = roots;
    todo!()
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
    fn drives_lists_subdirectories_of_existing_roots() {
        let media = temp_dir("media");
        let mnt = temp_dir("mnt");
        std::fs::create_dir(media.join("USB B")).unwrap();
        std::fs::create_dir(media.join("Backup")).unwrap();
        std::fs::write(media.join("not-a-drive"), "").unwrap();
        std::fs::create_dir(mnt.join("data")).unwrap();

        let found = drives(&[
            media.clone(),
            Path::new("/nonexistent/loom").into(),
            mnt.clone(),
        ]);
        let labels: Vec<_> = found.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, ["Backup", "USB B", "data"]);
        assert_eq!(found[2].path, mnt.join("data"));
        assert!(found.iter().all(|p| p.icon == "drive-harddisk-symbolic"));

        std::fs::remove_dir_all(&media).unwrap();
        std::fs::remove_dir_all(&mnt).unwrap();
    }

    #[test]
    fn standard_places_starts_with_existing_home() {
        let places = standard_places();
        assert_eq!(places[0].path, relm4::gtk::glib::home_dir());
        assert!(places.iter().all(|p| p.path.is_dir()));
        assert!(places[1..].iter().all(|p| p.path != places[0].path));
    }

    #[test]
    fn drive_roots_are_media_and_mnt() {
        let roots = drive_roots();
        assert_eq!(roots.len(), 2);
        assert!(roots[0].starts_with("/run/media"));
        assert_eq!(roots[1], Path::new("/mnt"));
    }
}
