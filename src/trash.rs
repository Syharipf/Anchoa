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

use crate::plan::ActionPlan;
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

/// Items trashed more than `days` days before `now`; none when `days` is 0.
pub fn expired(items: &[Trashed], days: u32, now: i64) -> impl Iterator<Item = &Trashed> {
    let _ = (items, days, now);
    std::iter::empty()
}

/// A plan moving the trashed `files` (or everything, for `None`) back to where they were
/// trashed from, with a `Mkdir` for each original folder that no longer exists. Also returns
/// the requested files that are not in `items`. Checks the disk: worker thread only.
pub fn restore_plan(items: &[Trashed], files: Option<&[PathBuf]>) -> (ActionPlan, Vec<PathBuf>) {
    let _ = (items, files);
    todo!()
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
pub fn is_trash_file(path: &Path) -> bool {
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
    use crate::plan::Action;

    const DAY: i64 = 86_400;

    fn t(orig: &str, deleted: i64, file: &str) -> Trashed {
        Trashed {
            orig: orig.into(),
            deleted,
            file: file.into(),
        }
    }

    #[test]
    fn expired_items_are_older_than_the_limit() {
        let now = 100 * DAY;
        let items = [
            t("/h/old", now - 31 * DAY, "/T/files/old"),
            t("/h/edge", now - 30 * DAY, "/T/files/edge"),
            t("/h/new", now - DAY, "/T/files/new"),
        ];
        let names = |days| -> Vec<&str> {
            expired(&items, days, now)
                .map(|t| t.orig.to_str().unwrap())
                .collect()
        };
        assert_eq!(names(30), ["/h/old"]);
        assert_eq!(names(1), ["/h/old", "/h/edge"]);
        assert_eq!(names(0), Vec::<&str>::new(), "0 turns it off");
    }

    #[test]
    fn restore_plan_moves_items_home_and_recreates_missing_folders() {
        let base = std::env::temp_dir().join(format!("loom-trash-restore-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("kept")).unwrap();
        let p = |rel: &str| base.join(rel);
        let items = [
            t(p("kept/a").to_str().unwrap(), 1, "/T/files/a"),
            t(p("gone/deep/b").to_str().unwrap(), 2, "/T/files/b"),
            t(p("gone/deep/c").to_str().unwrap(), 3, "/T/files/c"),
            t(p("kept/d").to_str().unwrap(), 4, "/T/files/d"),
        ];

        // Selected ones only; `/T/files/zzz` is not in the trash any more.
        let selected = [PathBuf::from("/T/files/b"), PathBuf::from("/T/files/zzz")];
        let (plan, missing) = restore_plan(&items, Some(&selected));
        assert_eq!(
            plan.actions,
            [
                Action::Mkdir {
                    path: p("gone/deep")
                },
                Action::Move {
                    src: "/T/files/b".into(),
                    dst: p("gone/deep/b")
                },
            ]
        );
        assert_eq!(missing, [PathBuf::from("/T/files/zzz")]);
        assert_eq!(plan.on_conflict, None);

        // Everything: each missing folder is created once, before the first item needing it.
        let (plan, missing) = restore_plan(&items, None);
        assert_eq!(
            plan.actions,
            [
                Action::Move {
                    src: "/T/files/a".into(),
                    dst: p("kept/a")
                },
                Action::Mkdir {
                    path: p("gone/deep")
                },
                Action::Move {
                    src: "/T/files/b".into(),
                    dst: p("gone/deep/b")
                },
                Action::Move {
                    src: "/T/files/c".into(),
                    dst: p("gone/deep/c")
                },
                Action::Move {
                    src: "/T/files/d".into(),
                    dst: p("kept/d")
                },
            ]
        );
        assert_eq!(missing, Vec::<PathBuf>::new());
        std::fs::remove_dir_all(&base).unwrap();
    }

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
