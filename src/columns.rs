//! Columns of the file list: name (with a folder/file icon), size, permissions, modified.
//!
//! Name and size sort folders first; permissions do not sort.

use anchoa::fs::{self, Entry};
use relm4::gtk;
use relm4::gtk::prelude::*;
use relm4::typed_view::OrdFn;
use relm4::typed_view::column::{LabelColumn, RelmColumn};

pub struct NameColumn;

impl RelmColumn for NameColumn {
    type Root = gtk::Box;
    type Widgets = (gtk::Image, gtk::Label);
    type Item = Entry;

    const COLUMN_NAME: &'static str = "Name";
    const ENABLE_RESIZE: bool = true;
    const ENABLE_EXPAND: bool = true;

    fn setup(_: &gtk::ListItem) -> (Self::Root, Self::Widgets) {
        let icon = gtk::Image::new();
        let label = gtk::Label::builder()
            .xalign(0.0)
            .ellipsize(gtk::pango::EllipsizeMode::Middle)
            .build();
        let root = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        root.append(&icon);
        root.append(&label);
        (root, (icon, label))
    }

    fn bind(item: &mut Entry, (icon, label): &mut Self::Widgets, _: &mut Self::Root) {
        icon.set_icon_name(Some(if item.is_dir {
            "folder-symbolic"
        } else {
            "text-x-generic-symbolic"
        }));
        label.set_label(&item.name);
    }

    fn sort_fn() -> OrdFn<Entry> {
        Some(Box::new(|a, b| {
            (!a.is_dir, a.name.to_lowercase()).cmp(&(!b.is_dir, b.name.to_lowercase()))
        }))
    }
}

pub struct SizeColumn;

impl RelmColumn for SizeColumn {
    type Root = gtk::Label;
    type Widgets = ();
    type Item = Entry;

    const COLUMN_NAME: &'static str = "Size";

    fn setup(_: &gtk::ListItem) -> (Self::Root, Self::Widgets) {
        (gtk::Label::builder().xalign(1.0).build(), ())
    }

    fn bind(item: &mut Entry, _: &mut Self::Widgets, label: &mut Self::Root) {
        if item.is_dir {
            label.set_label("—");
        } else {
            label.set_label(&gtk::glib::format_size(item.size));
        }
    }

    fn sort_fn() -> OrdFn<Entry> {
        Some(Box::new(|a, b| {
            (!a.is_dir, a.size).cmp(&(!b.is_dir, b.size))
        }))
    }
}

pub struct PermissionColumn;

impl LabelColumn for PermissionColumn {
    type Item = Entry;
    type Value = u32;

    const COLUMN_NAME: &'static str = "Permissions";
    const ENABLE_SORT: bool = false;

    fn get_cell_value(item: &Entry) -> u32 {
        item.mode
    }

    fn format_cell_value(mode: &u32) -> String {
        fs::permission_string(*mode)
    }
}

pub struct ModifiedColumn;

impl LabelColumn for ModifiedColumn {
    type Item = Entry;
    type Value = i64;

    const COLUMN_NAME: &'static str = "Modified";
    const ENABLE_SORT: bool = true;

    fn get_cell_value(item: &Entry) -> i64 {
        item.modified
    }

    fn format_cell_value(secs: &i64) -> String {
        gtk::glib::DateTime::from_unix_local(*secs)
            .and_then(|t| t.format("%Y-%m-%d %H:%M"))
            .map_or_else(|_| "—".into(), Into::into)
    }
}
