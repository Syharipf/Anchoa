//! Looking into the XDG trash through gio's `trash:///` (served by gvfs), read-only.
//!
//! Loom never writes into a trash folder itself (CLAUDE.md rule 2): items go in with
//! `gio::File::trash` and come back out by moving the `trash:///` item, which lets gvfs
//! clean up the `.trashinfo` too. Without gvfs, `trash:///` is unavailable and restoring
//! simply is not offered.
//!
//! Blocking: call from a worker thread only.

use std::io;
use std::path::{Path, PathBuf};

use relm4::gtk::gio;
use relm4::gtk::glib;
use relm4::gtk::prelude::*;

/// One item in the trash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Trashed {
    /// Where it was trashed from.
    pub orig: PathBuf,
    /// When it was trashed, seconds since the Unix epoch.
    pub deleted: i64,
    /// Where it lies now, inside a trash `files` folder.
    pub file: PathBuf,
}

const ATTRIBUTES: &str =
    "standard::name,standard::target-uri,trash::orig-path,trash::deletion-date";

/// Everything in the trash, across the home trash and the trash folders of other mounts.
pub fn contents() -> io::Result<Vec<Trashed>> {
    let mut items = Vec::new();
    for info in children()? {
        let info = info.map_err(to_io)?;
        let orig = info.attribute_byte_string("trash::orig-path");
        let deleted = info
            .attribute_string("trash::deletion-date")
            .and_then(|date| {
                glib::DateTime::from_iso8601(&date, Some(&glib::TimeZone::local())).ok()
            });
        if let (Some(orig), Some(deleted), Some(file)) = (orig, deleted, target(&info)) {
            items.push(Trashed {
                orig: orig.into(),
                deleted: deleted.to_unix(),
                file,
            });
        }
    }
    Ok(items)
}

/// The `trash:///` item for `path`, if `path` is an item inside a trash `files` folder.
/// Moving that item (instead of `path` itself) restores it properly.
pub fn item(path: &Path) -> io::Result<Option<gio::File>> {
    if !is_trash_file(path) {
        return Ok(None);
    }
    for info in children()? {
        let info = info.map_err(to_io)?;
        if target(&info).as_deref() == Some(path) {
            return Ok(Some(gio::File::for_uri("trash:///").child(info.name())));
        }
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        format!("{} is no longer in the trash", path.display()),
    ))
}

/// `…/Trash/files/NAME` (home trash) or `…/.Trash-UID/files/NAME` (other mounts).
// ponytail: the spec's shared `$topdir/.Trash/$uid/files` layout is not recognised; add it
// if a mount with one turns up.
fn is_trash_file(path: &Path) -> bool {
    let trash = path
        .parent()
        .filter(|files| files.file_name() == Some("files".as_ref()))
        .and_then(Path::parent)
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned());
    trash.is_some_and(|name| name == "Trash" || name.starts_with(".Trash-"))
}

fn children() -> io::Result<gio::FileEnumerator> {
    // ponytail: lists the whole trash each time; index it if trashes with many thousands of
    // items make undo slow.
    gio::File::for_uri("trash:///")
        .enumerate_children(
            ATTRIBUTES,
            gio::FileQueryInfoFlags::NONE,
            gio::Cancellable::NONE,
        )
        .map_err(to_io)
}

fn target(info: &gio::FileInfo) -> Option<PathBuf> {
    gio::File::for_uri(&info.attribute_string("standard::target-uri")?).path()
}

fn to_io(err: glib::Error) -> io::Error {
    io::Error::other(err.message().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_trash_files() {
        for yes in [
            "/home/me/.local/share/Trash/files/a.txt",
            "/run/media/me/USB/.Trash-1000/files/dir",
        ] {
            assert!(is_trash_file(Path::new(yes)), "{yes}");
        }
        for no in [
            "/home/me/.local/share/Trash/files",
            "/home/me/.local/share/Trash/info/a.txt.trashinfo",
            "/home/me/files/a.txt",
            "/home/me/Trash/a.txt",
            "/home/me/.local/share/Trash/files/dir/inner.txt",
        ] {
            assert!(!is_trash_file(Path::new(no)), "{no}");
        }
    }
}
