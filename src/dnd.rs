//! Drag and drop of files, shared by the file list and the sidebar.
//!
//! Files travel as a `gdk::FileList`, the standard format other apps use too.

use std::path::PathBuf;

use relm4::gtk;
use relm4::gtk::prelude::*;
use relm4::gtk::{gdk, gio};

/// Offers `paths` as a file list, for a drag source or the clipboard.
pub fn files_provider(paths: &[PathBuf]) -> gdk::ContentProvider {
    let files: Vec<_> = paths.iter().map(gio::File::for_path).collect();
    gdk::ContentProvider::for_value(&gdk::FileList::from_array(&files).to_value())
}

/// A drop target for files. `on_drop(paths, cut)` gets the local paths and whether the
/// user asked to move (Shift, `Some(true)`) or copy (Ctrl, `Some(false)`); `None` leaves
/// the choice to the caller. It returns whether it accepted the drop; a drop without
/// local files is refused before it is called.
pub fn file_drop_target(
    on_drop: impl Fn(Vec<PathBuf>, Option<bool>) -> bool + 'static,
) -> gtk::DropTarget {
    let target = gtk::DropTarget::new(
        gdk::FileList::static_type(),
        gdk::DragAction::COPY | gdk::DragAction::MOVE,
    );
    target.connect_drop(move |target, value, _, _| {
        let paths: Vec<_> = value
            .get::<gdk::FileList>()
            .map(|files| files.files().into_iter().filter_map(|f| f.path()).collect())
            .unwrap_or_default();
        !paths.is_empty() && on_drop(paths, cut(target))
    });
    target
}

fn cut(target: &gtk::DropTarget) -> Option<bool> {
    let state = target.current_drop()?.device().modifier_state();
    if state.contains(gdk::ModifierType::CONTROL_MASK) {
        Some(false)
    } else if state.contains(gdk::ModifierType::SHIFT_MASK) {
        Some(true)
    } else {
        None
    }
}
