//! Helpers for planning and checking paste operations.

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use crate::plan::{Action, ActionPlan};
use relm4::gtk::glib;

/// Builds the move or copy actions for pasting `sources` into `dest`.
pub fn plan(sources: &[PathBuf], dest: &Path, cut: bool) -> ActionPlan {
    let actions = sources
        .iter()
        .filter_map(|src| {
            let name = src.file_name()?;
            if cut && src.parent() == Some(dest) {
                return None;
            }
            let dst = dest.join(name);
            if dest == src || dest.starts_with(src) {
                return None;
            }
            Some(if cut {
                Action::Move {
                    src: src.clone(),
                    dst,
                }
            } else {
                Action::Copy {
                    src: src.clone(),
                    dst,
                }
            })
        })
        .collect();
    ActionPlan {
        actions,
        on_conflict: None,
    }
}

/// Serializes paths in the GNOME copied-files clipboard format.
pub fn gnome_copied_files(paths: &[PathBuf], cut: bool) -> String {
    let mode = if cut { "cut" } else { "copy" };
    std::iter::once(mode.to_owned())
        .chain(
            paths
                .iter()
                .filter_map(|path| glib::filename_to_uri(path, None).ok())
                .map(String::from),
        )
        .collect::<Vec<_>>()
        .join("\n")
}

/// Parses the GNOME copied-files clipboard format, keeping only local file URIs.
pub fn parse_gnome_copied_files(text: &str) -> Option<(Vec<PathBuf>, bool)> {
    let mut lines = text
        .lines()
        .map(|line| line.trim_end_matches('\r'))
        .filter(|line| !line.trim().is_empty());
    let cut = match lines.next()? {
        "copy" => false,
        "cut" => true,
        _ => return None,
    };
    let paths = lines
        // Plain URI parsing, never a `gio::File`: a remote URI would make gvfs look up its
        // mount spec, which crashes when first done from several threads at once.
        .filter_map(|uri| glib::filename_from_uri(uri).ok().map(|(path, _)| path))
        .collect::<Vec<_>>();
    (!paths.is_empty()).then_some((paths, cut))
}

/// Returns destinations that already exist in `plan`.
pub fn conflicts(plan: &ActionPlan) -> Vec<PathBuf> {
    plan.actions
        .iter()
        .filter_map(|action| {
            let dst = match action {
                Action::Move { dst, .. }
                | Action::Copy { dst, .. }
                | Action::Rename { dst, .. } => dst,
                _ => return None,
            };
            dst.symlink_metadata().is_ok().then(|| dst.clone())
        })
        .collect()
}

/// Whether `src` and `dest` are on the same filesystem.
pub fn same_device(src: &Path, dest: &Path) -> bool {
    let Ok(src) = src.symlink_metadata() else {
        return false;
    };
    let Ok(dest) = dest.metadata() else {
        return false;
    };
    src.dev() == dest.dev()
}
