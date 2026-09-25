//! Sidebar: standard places, drives, and user bookmarks.
//!
//! Rows are rebuilt from scratch whenever a section changes; the lists involved
//! are small (a handful of places/drives/bookmarks), so this is simpler than
//! diffing and keeps [`RowKind`] (the row -> item mapping) trivially in sync.

use std::path::PathBuf;

use anchoa::db::Bookmark;
use anchoa::places::Place;
use relm4::RelmRemoveAllExt;
use relm4::gtk;
use relm4::gtk::{gdk, prelude::*};
use relm4::prelude::*;

/// What a row at a given index represents. Indexed the same as the `ListBox`'s rows.
#[derive(Debug, Clone, PartialEq, Eq)]
enum RowKind {
    /// A non-selectable, non-activatable section title.
    Header,
    Place(PathBuf),
    /// A volume that is not mounted yet, by unix device (`/dev/sdc1`).
    Volume(String),
    Bookmark(i64, PathBuf),
}

/// A row in the Drives section.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Drive {
    pub label: String,
    /// Symbolic icon name.
    pub icon: &'static str,
    pub target: DriveTarget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DriveTarget {
    Mounted(PathBuf),
    /// Mounted on activation; the unix device (`/dev/sdc1`) identifies the volume.
    Unmounted(String),
}

pub struct Sidebar {
    list: gtk::ListBox,
    places: Vec<Place>,
    drives: Vec<Drive>,
    bookmarks: Vec<Bookmark>,
    /// Row -> item mapping, rebuilt alongside `list`'s children.
    rows: Vec<RowKind>,
}

#[derive(Debug, Clone)]
pub enum Msg {
    SetPlaces(Vec<Place>),
    SetDrives(Vec<Drive>),
    SetBookmarks(Vec<Bookmark>),
    /// Grab focus on the selected row, or the first activatable row.
    Focus,
    /// Internal: a row was activated by click or Enter.
    RowActivated(i32),
    /// Internal: Delete pressed while a row is selected.
    DeleteSelected,
    /// Internal: Alt+Shift+Up/Down pressed while a row is selected (`true` = up).
    MoveSelected(bool),
    /// Internal: bookmark `id` was dropped on the row at `index`, in its lower half if `after`.
    DropBookmark {
        id: i64,
        index: i32,
        after: bool,
    },
}

#[derive(Debug)]
pub enum Output {
    Open(PathBuf),
    RemoveBookmark(i64),
    MoveBookmark { id: i64, up: bool },
    MoveBookmarkTo { id: i64, position: i64 },
    Mount(String),
}

#[relm4::component(pub)]
impl SimpleComponent for Sidebar {
    type Init = ();
    type Input = Msg;
    type Output = Output;

    view! {
        gtk::ScrolledWindow {
            set_hscrollbar_policy: gtk::PolicyType::Never,

            #[local_ref]
            list -> gtk::ListBox {
                add_css_class: "navigation-sidebar",
                set_selection_mode: gtk::SelectionMode::Single,

                connect_row_activated[sender] => move |_, row| {
                    sender.input(Msg::RowActivated(row.index()));
                },
            }
        }
    }

    fn init(
        _: Self::Init,
        root: Self::Root,
        sender: ComponentSender<Self>,
    ) -> ComponentParts<Self> {
        let model = Sidebar {
            list: gtk::ListBox::new(),
            places: Vec::new(),
            drives: Vec::new(),
            bookmarks: Vec::new(),
            rows: Vec::new(),
        };
        let list = &model.list;
        let widgets = view_output!();

        let shortcuts = gtk::ShortcutController::new();
        for (accel, msg) in [
            ("Delete", Msg::DeleteSelected),
            ("<Alt><Shift>Up", Msg::MoveSelected(true)),
            ("<Alt><Shift>Down", Msg::MoveSelected(false)),
        ] {
            let input = sender.input_sender().clone();
            shortcuts.add_shortcut(gtk::Shortcut::new(
                gtk::ShortcutTrigger::parse_string(accel),
                Some(gtk::CallbackAction::new(move |_, _| {
                    input.emit(msg.clone());
                    gtk::glib::Propagation::Stop
                })),
            ));
        }
        model.list.add_controller(shortcuts);

        // Bookmarks are reordered by dragging one onto another (rows carry their id). While
        // dragging, a line above or below the bookmark under the pointer shows where it lands.
        let drop = gtk::DropTarget::new(i64::static_type(), gdk::DragAction::MOVE);
        drop.connect_motion(|target, _, y| {
            let list = target.widget().and_downcast::<gtk::ListBox>();
            let Some(list) = list else {
                return gdk::DragAction::empty();
            };
            clear_drop_marks(&list);
            match bookmark_row_at(&list, y) {
                Some((row, after)) => {
                    row.add_css_class(if after { "drop-after" } else { "drop-before" });
                    gdk::DragAction::MOVE
                }
                None => gdk::DragAction::empty(),
            }
        });
        drop.connect_leave(|target| {
            if let Some(list) = target.widget().and_downcast::<gtk::ListBox>() {
                clear_drop_marks(&list);
            }
        });
        let input = sender.input_sender().clone();
        drop.connect_drop(move |target, value, _, y| {
            let Some(list) = target.widget().and_downcast::<gtk::ListBox>() else {
                return false;
            };
            clear_drop_marks(&list);
            let (Ok(id), Some((row, after))) = (value.get::<i64>(), bookmark_row_at(&list, y))
            else {
                return false;
            };
            input.emit(Msg::DropBookmark {
                id,
                index: row.index(),
                after,
            });
            true
        });
        model.list.add_controller(drop);

        ComponentParts { model, widgets }
    }

    fn update(&mut self, msg: Msg, sender: ComponentSender<Self>) {
        match msg {
            Msg::SetPlaces(places) => {
                self.places = places;
                self.rebuild();
            }
            Msg::SetDrives(drives) => {
                self.drives = drives;
                self.rebuild();
            }
            Msg::SetBookmarks(bookmarks) => {
                self.bookmarks = bookmarks;
                self.rebuild();
            }
            Msg::Focus => self.focus(),
            Msg::RowActivated(index) => match self.rows.get(index as usize) {
                Some(RowKind::Place(path) | RowKind::Bookmark(_, path)) => {
                    let _ = sender.output(Output::Open(path.clone()));
                }
                Some(RowKind::Volume(device)) => {
                    let _ = sender.output(Output::Mount(device.clone()));
                }
                Some(RowKind::Header) | None => {}
            },
            Msg::DeleteSelected => {
                if let Some(RowKind::Bookmark(id, _)) = self.selected_kind() {
                    let _ = sender.output(Output::RemoveBookmark(id));
                }
            }
            Msg::MoveSelected(up) => {
                if let Some(RowKind::Bookmark(id, _)) = self.selected_kind() {
                    let _ = sender.output(Output::MoveBookmark { id, up });
                }
            }
            Msg::DropBookmark { id, index, after } => {
                let position_of = |id: i64| self.bookmarks.iter().position(|b| b.id == id);
                if let Some(RowKind::Bookmark(target, _)) = self.rows.get(index as usize)
                    && let (Some(from), Some(target)) = (position_of(id), position_of(*target))
                {
                    let position = drop_position(from, target, after) as i64;
                    let _ = sender.output(Output::MoveBookmarkTo { id, position });
                }
            }
        }
    }
}

impl Sidebar {
    /// The item behind the currently selected row, if any.
    fn selected_kind(&self) -> Option<RowKind> {
        let index = self.list.selected_row()?.index();
        self.rows.get(index as usize).cloned()
    }

    /// Grabs focus on the selected row, or the first activatable (non-header) row.
    fn focus(&self) {
        if let Some(row) = self.list.selected_row() {
            row.grab_focus();
            return;
        }
        let first = self
            .rows
            .iter()
            .position(|kind| *kind != RowKind::Header)
            .and_then(|index| self.list.row_at_index(index as i32));
        if let Some(row) = first {
            row.grab_focus();
        }
    }

    /// Clears and repopulates `list` from `places`, `drives`, and `bookmarks`, then
    /// restores the previous selection (matched by place path / bookmark id) if it
    /// still exists.
    fn rebuild(&mut self) {
        let previous = self.selected_kind();
        // Rebuilding destroys the focused row; remember to hand focus back afterwards.
        let had_focus = self.list.focus_child().is_some();

        self.list.remove_all();
        self.rows.clear();

        self.push_header("Places");
        for place in self.places.clone() {
            self.push_place(place);
        }

        if !self.drives.is_empty() {
            self.push_header("Drives");
            for drive in self.drives.clone() {
                let kind = match drive.target {
                    DriveTarget::Mounted(path) => RowKind::Place(path),
                    DriveTarget::Unmounted(device) => RowKind::Volume(device),
                };
                let tooltip = match &kind {
                    RowKind::Place(path) => path.to_string_lossy().into_owned(),
                    _ => "Not mounted: activate to mount".to_string(),
                };
                self.list
                    .append(&Self::item_row(drive.icon, &drive.label, &tooltip));
                self.rows.push(kind);
            }
        }

        if !self.bookmarks.is_empty() {
            self.push_header("Bookmarks");
            for bookmark in self.bookmarks.clone() {
                self.push_bookmark(bookmark);
            }
        }

        if let Some(key) = previous
            && let Some(index) = self.rows.iter().position(|kind| *kind == key)
        {
            self.list
                .select_row(self.list.row_at_index(index as i32).as_ref());
        }
        if had_focus {
            self.focus();
        }
    }

    fn push_header(&mut self, text: &str) {
        self.list.append(&Self::header_row(text));
        self.rows.push(RowKind::Header);
    }

    fn push_place(&mut self, place: Place) {
        self.list.append(&Self::item_row(
            place.icon,
            &place.label,
            &place.path.to_string_lossy(),
        ));
        self.rows.push(RowKind::Place(place.path));
    }

    fn push_bookmark(&mut self, bookmark: Bookmark) {
        let row = Self::item_row(
            "folder-symbolic",
            &bookmark.label,
            &bookmark.path.to_string_lossy(),
        );
        let drag = gtk::DragSource::new();
        drag.set_actions(gdk::DragAction::MOVE);
        drag.set_content(Some(&gdk::ContentProvider::for_value(
            &bookmark.id.to_value(),
        )));
        drag.connect_drag_begin(|source, _| {
            if let Some(row) = source.widget() {
                source.set_icon(Some(&gtk::WidgetPaintable::new(Some(&row))), 0, 0);
            }
        });
        row.add_controller(drag);
        row.add_css_class("bookmark");
        self.list.append(&row);
        self.rows
            .push(RowKind::Bookmark(bookmark.id, bookmark.path));
    }

    fn header_row(text: &str) -> gtk::ListBoxRow {
        let label = gtk::Label::builder()
            .label(text)
            .xalign(0.0)
            .margin_start(6)
            .margin_top(6)
            .margin_bottom(2)
            .css_classes(["dim-label"])
            .build();
        let row = gtk::ListBoxRow::new();
        row.set_child(Some(&label));
        row.set_selectable(false);
        row.set_activatable(false);
        row
    }

    fn item_row(icon: &str, label: &str, tooltip: &str) -> gtk::ListBoxRow {
        let content = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        content.append(&gtk::Image::from_icon_name(icon));
        content.append(
            &gtk::Label::builder()
                .label(label)
                .xalign(0.0)
                .ellipsize(gtk::pango::EllipsizeMode::End)
                .build(),
        );
        let row = gtk::ListBoxRow::new();
        row.set_child(Some(&content));
        row.set_tooltip_text(Some(tooltip));
        row
    }
}

/// Styles for the drop indicator: a line in the accent colour on the row's top or bottom edge.
pub const CSS: &str = "
.navigation-sidebar row.drop-before { box-shadow: inset 0 2px @accent_color; }
.navigation-sidebar row.drop-after { box-shadow: inset 0 -2px @accent_color; }
";

/// The bookmark row under `y` (list coordinates), and whether `y` is in its lower half.
fn bookmark_row_at(list: &gtk::ListBox, y: f64) -> Option<(gtk::ListBoxRow, bool)> {
    let row = list
        .row_at_y(y as i32)
        .filter(|row| row.has_css_class("bookmark"))?;
    let bounds = row.compute_bounds(list)?;
    let after = y as f32 > bounds.y() + bounds.height() / 2.0;
    Some((row, after))
}

fn clear_drop_marks(list: &gtk::ListBox) {
    let mut child = list.first_child();
    while let Some(widget) = child {
        widget.remove_css_class("drop-before");
        widget.remove_css_class("drop-after");
        child = widget.next_sibling();
    }
}

/// New position for the bookmark at `from` when dropped before (or `after`) the one at
/// `target`, positions counted before the move.
fn drop_position(from: usize, target: usize, after: bool) -> usize {
    let slot = target + usize::from(after);
    if from < slot { slot - 1 } else { slot }
}

#[cfg(test)]
mod tests {
    use super::drop_position;

    #[test]
    fn drop_position_lands_at_the_indicated_line() {
        // [a, b, c, d]: dragging a (0) to the line above / below c (2).
        assert_eq!(drop_position(0, 2, false), 1); // [b, a, c, d]
        assert_eq!(drop_position(0, 2, true), 2); // [b, c, a, d]
        // Dragging d (3) to the line above / below b (1).
        assert_eq!(drop_position(3, 1, false), 1); // [a, d, b, c]
        assert_eq!(drop_position(3, 1, true), 2); // [a, b, d, c]
        // Dropping next to itself changes nothing.
        assert_eq!(drop_position(2, 2, false), 2);
        assert_eq!(drop_position(2, 2, true), 2);
        assert_eq!(drop_position(2, 1, true), 2);
        assert_eq!(drop_position(2, 3, false), 2);
    }
}
