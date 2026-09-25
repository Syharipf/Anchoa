//! Sidebar locations: XDG user directories and mounted drives.

use relm4::gtk::glib;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Place {
    pub label: String,
    pub path: PathBuf,
    /// Symbolic icon name.
    pub icon: &'static str,
}

/// Home plus the XDG user directories (Documents, Downloads, Music, Pictures, Videos) that
/// are configured, exist, and are not the home directory itself — in that order — and last
/// the home trash, once it exists (it is created by the first trashing).
/// Checks each directory exists, which may block on slow mounts: call from a worker thread.
pub fn standard_places() -> Vec<Place> {
    let mut places = Vec::new();
    let home = glib::home_dir();
    if home.is_dir() {
        places.push(Place {
            label: "Home".to_string(),
            path: home.clone(),
            icon: "user-home-symbolic",
        });
    }

    let xdg_dirs = [
        (glib::UserDirectory::Documents, "folder-documents-symbolic"),
        (glib::UserDirectory::Downloads, "folder-download-symbolic"),
        (glib::UserDirectory::Music, "folder-music-symbolic"),
        (glib::UserDirectory::Pictures, "folder-pictures-symbolic"),
        (glib::UserDirectory::Videos, "folder-videos-symbolic"),
    ];

    for (dir_type, icon) in xdg_dirs {
        if let Some(path) = glib::user_special_dir(dir_type)
            && path.is_dir()
            && path != home
            && let Some(name) = path.file_name()
        {
            places.push(Place {
                label: name.to_string_lossy().into_owned(),
                path,
                icon,
            });
        }
    }

    let trash = trash_files();
    if trash.is_dir() {
        places.push(Place {
            label: "Trash".to_string(),
            path: trash,
            icon: "user-trash-symbolic",
        });
    }

    places
}

/// The home trash's `files` folder: `$XDG_DATA_HOME/Trash/files`. Items trashed from other
/// drives go to that drive's own `.Trash-$UID` instead.
pub fn trash_files() -> PathBuf {
    glib::user_data_dir().join("Trash").join("files")
}

/// Directories that hold manual mount points (`/mnt`). Drives mounted through udisks2
/// (`/run/media/$USER`) come from `gio::VolumeMonitor` instead, which also sees them before
/// they are mounted.
pub fn drive_roots() -> Vec<PathBuf> {
    vec![PathBuf::from("/mnt")]
}

/// One `Place` per sub-directory of each root (icon `drive-harddisk-symbolic`, label = directory
/// name), sorted by label within each root, roots in the given order. Missing or unreadable roots
/// and non-directory entries are skipped. Blocks on I/O: call from a worker thread.
pub fn drives(roots: &[PathBuf]) -> Vec<Place> {
    let mut places = Vec::new();

    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };

        let mut root_places = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let label = entry.file_name().to_string_lossy().into_owned();
                root_places.push(Place {
                    label,
                    path,
                    icon: "drive-harddisk-symbolic",
                });
            }
        }

        root_places.sort_by(|a, b| a.label.cmp(&b.label));
        places.extend(root_places);
    }

    places
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

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
        let trash = places.iter().find(|p| p.label == "Trash");
        assert_eq!(
            trash.map(|p| p.path.clone()),
            trash_files().is_dir().then(trash_files)
        );
    }

    #[test]
    fn drive_roots_is_mnt() {
        assert_eq!(drive_roots(), [Path::new("/mnt")]);
    }
}
