//! Sidebar: standard places, mounted drives, and user bookmarks.
//!
//! Rows are rebuilt from scratch whenever a section changes; the lists involved
//! are small (a handful of places/drives/bookmarks), so this is simpler than
//! diffing and keeps [`RowKind`] (the row -> item mapping) trivially in sync.

use std::path::{Path, PathBuf};

use loom::db::Bookmark;
use loom::places::Place;
use relm4::RelmRemoveAllExt;
use relm4::gtk;
use relm4::gtk::prelude::*;
use relm4::prelude::*;

/// What a row at a given index represents. Indexed the same as the `ListBox`'s rows.
#[derive(Debug, Clone, PartialEq, Eq)]
enum RowKind {
    /// A non-selectable, non-activatable section title.
    Header,
    Place(PathBuf),
    Bookmark(i64, PathBuf),
}

pub struct Sidebar {
    list: gtk::ListBox,
    places: Vec<Place>,
    drives: Vec<Place>,
    bookmarks: Vec<Bookmark>,
    /// Row -> item mapping, rebuilt alongside `list`'s children.
    rows: Vec<RowKind>,
}

#[derive(Debug, Clone)]
pub enum Msg {
    SetPlaces(Vec<Place>),
    SetDrives(Vec<Place>),
    SetBookmarks(Vec<Bookmark>),
    /// Grab focus on the selected row, or the first activatable row.
    Focus,
    /// Internal: a row was activated by click or Enter.
    RowActivated(i32),
    /// Internal: Delete pressed while a row is selected.
    DeleteSelected,
    /// Internal: Alt+Shift+Up/Down pressed while a row is selected (`true` = up).
    MoveSelected(bool),
}

#[derive(Debug)]
pub enum Output {
    Open(PathBuf),
    RemoveBookmark(i64),
    MoveBookmark { id: i64, up: bool },
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
            Msg::RowActivated(index) => {
                if let Some(path) = self.rows.get(index as usize).and_then(RowKind::path) {
                    let _ = sender.output(Output::Open(path.clone()));
                }
            }
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
        }
    }
}

impl RowKind {
    fn path(&self) -> Option<&PathBuf> {
        match self {
            RowKind::Header => None,
            RowKind::Place(path) | RowKind::Bookmark(_, path) => Some(path),
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
                self.push_place(drive);
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
        self.list
            .append(&Self::item_row(place.icon, &place.label, &place.path));
        self.rows.push(RowKind::Place(place.path));
    }

    fn push_bookmark(&mut self, bookmark: Bookmark) {
        self.list.append(&Self::item_row(
            "folder-symbolic",
            &bookmark.label,
            &bookmark.path,
        ));
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

    fn item_row(icon: &str, label: &str, path: &Path) -> gtk::ListBoxRow {
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
        row.set_tooltip_text(Some(&path.to_string_lossy()));
        row
    }
}
