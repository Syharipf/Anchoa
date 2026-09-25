use std::io;
use std::path::PathBuf;

use loom::fs::{self, Entry};
use relm4::gtk::prelude::*;
use relm4::prelude::*;
use relm4::typed_view::OrdFn;
use relm4::typed_view::column::{LabelColumn, RelmColumn, TypedColumnView};
use relm4::{adw, gtk};

const APP_ID: &str = "io.github.syharipf.Loom";

struct NameColumn;

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

struct SizeColumn;

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

struct PermissionColumn;

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

struct ModifiedColumn;

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

struct App {
    cwd: PathBuf,
    /// Directory whose listing is in flight; results for any other path are stale.
    requested: PathBuf,
    entries: TypedColumnView<Entry, gtk::SingleSelection>,
    toasts: adw::ToastOverlay,
}

#[derive(Debug)]
enum Msg {
    Open(PathBuf),
    Up,
    Activate(u32),
}

#[derive(Debug)]
enum Cmd {
    Listed(PathBuf, io::Result<Vec<Entry>>),
}

#[relm4::component]
impl Component for App {
    type Init = PathBuf;
    type Input = Msg;
    type Output = ();
    type CommandOutput = Cmd;

    view! {
        adw::ApplicationWindow {
            set_default_size: (960, 640),

            gtk::Box {
                set_orientation: gtk::Orientation::Vertical,

                adw::HeaderBar {
                    pack_start = &gtk::Button {
                        set_icon_name: "go-up-symbolic",
                        set_tooltip_text: Some("Parent folder (Alt+Up)"),
                        connect_clicked => Msg::Up,
                    },

                    #[wrap(Some)]
                    set_title_widget = &adw::WindowTitle {
                        set_title: "Loom",
                        #[watch]
                        set_subtitle: &model.cwd.to_string_lossy(),
                    },
                },

                #[local_ref]
                toasts -> adw::ToastOverlay {
                    gtk::ScrolledWindow {
                        set_vexpand: true,

                        #[local_ref]
                        entries_view -> gtk::ColumnView {
                            connect_activate[sender] => move |_, position| {
                                sender.input(Msg::Activate(position));
                            },
                        },
                    },
                },
            },
        }
    }

    fn init(dir: PathBuf, root: Self::Root, sender: ComponentSender<Self>) -> ComponentParts<Self> {
        let mut entries = TypedColumnView::<Entry, gtk::SingleSelection>::new();
        entries.append_column::<NameColumn>();
        entries.append_column::<SizeColumn>();
        entries.append_column::<PermissionColumn>();
        entries.append_column::<ModifiedColumn>();
        // ponytail: hidden files always filtered; Ctrl+H toggle comes with the settings work.
        entries.add_filter(|e| !e.name.starts_with('.'));

        let model = App {
            cwd: dir.clone(),
            requested: PathBuf::new(),
            entries,
            toasts: adw::ToastOverlay::new(),
        };
        let toasts = &model.toasts;
        let entries_view = &model.entries.view;
        let widgets = view_output!();

        let shortcuts = gtk::ShortcutController::new();
        shortcuts.set_scope(gtk::ShortcutScope::Global);
        let up = sender.input_sender().clone();
        shortcuts.add_shortcut(gtk::Shortcut::new(
            gtk::ShortcutTrigger::parse_string("<Alt>Up"),
            Some(gtk::CallbackAction::new(move |_, _| {
                up.emit(Msg::Up);
                gtk::glib::Propagation::Stop
            })),
        ));
        root.add_controller(shortcuts);

        sender.input(Msg::Open(dir));
        ComponentParts { model, widgets }
    }

    fn update(&mut self, msg: Msg, sender: ComponentSender<Self>, _: &Self::Root) {
        match msg {
            Msg::Open(dir) => {
                self.requested = dir.clone();
                sender.spawn_oneshot_command(move || {
                    let result = fs::list_dir(&dir);
                    Cmd::Listed(dir, result)
                });
            }
            Msg::Up => {
                if let Some(parent) = self.cwd.parent() {
                    sender.input(Msg::Open(parent.to_path_buf()));
                }
            }
            Msg::Activate(position) => {
                let Some(item) = self.entries.get_visible(position) else {
                    return;
                };
                let entry = item.borrow();
                if entry.is_dir {
                    sender.input(Msg::Open(entry.path.clone()));
                }
            }
        }
    }

    fn update_cmd(&mut self, cmd: Cmd, _: ComponentSender<Self>, _: &Self::Root) {
        let Cmd::Listed(dir, result) = cmd;
        if dir != self.requested {
            return;
        }
        match result {
            Ok(list) => {
                self.entries.clear();
                self.entries.extend_from_iter(list);
                self.cwd = dir;
            }
            Err(err) => self.toasts.add_toast(adw::Toast::new(&format!(
                "Cannot open {}: {err}",
                dir.display()
            ))),
        }
    }
}

fn main() {
    RelmApp::new(APP_ID).run::<App>(gtk::glib::home_dir());
}
