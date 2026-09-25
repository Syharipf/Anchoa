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
    /// Listing in flight and how we got there; results for any other path are stale.
    requested: Option<(PathBuf, Nav)>,
    back: Vec<PathBuf>,
    forward: Vec<PathBuf>,
    show_hidden: bool,
    entries: TypedColumnView<Entry, gtk::SingleSelection>,
    path_entry: gtk::Entry,
    toasts: adw::ToastOverlay,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Nav {
    New,
    Back,
    Forward,
}

#[derive(Debug, Clone)]
enum Msg {
    Open(PathBuf),
    OpenInput(String),
    Up,
    Back,
    Forward,
    Activate(u32),
    FocusPath,
    ToggleHidden,
}

#[derive(Debug)]
enum Cmd {
    Listed(PathBuf, Nav, io::Result<Vec<Entry>>),
}

const HIDDEN_FILTER: usize = 0;

#[relm4::component]
impl Component for App {
    type Init = PathBuf;
    type Input = Msg;
    type Output = ();
    type CommandOutput = Cmd;

    view! {
        adw::ApplicationWindow {
            set_title: Some("Loom"),
            set_default_size: (960, 640),

            gtk::Box {
                set_orientation: gtk::Orientation::Vertical,

                adw::HeaderBar {
                    pack_start = &gtk::Button {
                        set_icon_name: "go-previous-symbolic",
                        set_tooltip_text: Some("Back (Alt+Left)"),
                        #[watch]
                        set_sensitive: !model.back.is_empty(),
                        connect_clicked => Msg::Back,
                    },
                    pack_start = &gtk::Button {
                        set_icon_name: "go-next-symbolic",
                        set_tooltip_text: Some("Forward (Alt+Right)"),
                        #[watch]
                        set_sensitive: !model.forward.is_empty(),
                        connect_clicked => Msg::Forward,
                    },
                    pack_start = &gtk::Button {
                        set_icon_name: "go-up-symbolic",
                        set_tooltip_text: Some("Parent folder (Alt+Up)"),
                        connect_clicked => Msg::Up,
                    },

                    #[local_ref]
                    #[wrap(Some)]
                    set_title_widget = path_entry -> gtk::Entry {
                        set_hexpand: true,
                        set_tooltip_text: Some("Location (Ctrl+L)"),
                        connect_activate[sender] => move |entry| {
                            sender.input(Msg::OpenInput(entry.text().into()));
                        },
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
        entries.add_filter(|e| !e.name.starts_with('.'));

        let model = App {
            cwd: dir.clone(),
            requested: None,
            back: Vec::new(),
            forward: Vec::new(),
            show_hidden: false,
            entries,
            path_entry: gtk::Entry::new(),
            toasts: adw::ToastOverlay::new(),
        };
        let path_entry = &model.path_entry;
        let toasts = &model.toasts;
        let entries_view = &model.entries.view;
        let widgets = view_output!();

        let shortcuts = gtk::ShortcutController::new();
        shortcuts.set_scope(gtk::ShortcutScope::Global);
        for (accel, msg) in [
            ("<Alt>Up", Msg::Up),
            ("<Alt>Left", Msg::Back),
            ("<Alt>Right", Msg::Forward),
            ("<Ctrl>L", Msg::FocusPath),
            ("<Ctrl>H", Msg::ToggleHidden),
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
        shortcuts.add_shortcut(gtk::Shortcut::new(
            gtk::ShortcutTrigger::parse_string("<Ctrl>Q"),
            Some(gtk::NamedAction::new("window.close")),
        ));
        root.add_controller(shortcuts);

        sender.input(Msg::Open(dir));
        ComponentParts { model, widgets }
    }

    fn update(&mut self, msg: Msg, sender: ComponentSender<Self>, _: &Self::Root) {
        let target = match msg {
            Msg::Open(dir) => Some((dir, Nav::New)),
            Msg::OpenInput(text) => Some((
                fs::resolve_input(&text, &self.cwd, &gtk::glib::home_dir()),
                Nav::New,
            )),
            Msg::Up => self.cwd.parent().map(|p| (p.to_path_buf(), Nav::New)),
            Msg::Back => self.back.last().map(|p| (p.clone(), Nav::Back)),
            Msg::Forward => self.forward.last().map(|p| (p.clone(), Nav::Forward)),
            Msg::Activate(position) => self
                .entries
                .get_visible(position)
                .map(|item| item.borrow().clone())
                .filter(|entry| entry.is_dir)
                .map(|entry| (entry.path, Nav::New)),
            Msg::FocusPath => {
                self.path_entry.grab_focus();
                None
            }
            Msg::ToggleHidden => {
                self.show_hidden = !self.show_hidden;
                self.entries
                    .set_filter_status(HIDDEN_FILTER, !self.show_hidden);
                None
            }
        };
        if let Some((dir, nav)) = target {
            self.requested = Some((dir.clone(), nav));
            sender.spawn_oneshot_command(move || {
                let result = fs::list_dir(&dir);
                Cmd::Listed(dir, nav, result)
            });
        }
    }

    fn update_cmd(&mut self, cmd: Cmd, _: ComponentSender<Self>, _: &Self::Root) {
        let Cmd::Listed(dir, nav, result) = cmd;
        if self.requested.as_ref() != Some(&(dir.clone(), nav)) {
            return;
        }
        self.requested = None;
        let list = match result {
            Ok(list) => list,
            Err(err) => {
                self.toasts.add_toast(adw::Toast::new(&format!(
                    "Cannot open {}: {err}",
                    dir.display()
                )));
                return;
            }
        };
        if dir != self.cwd {
            let previous = std::mem::replace(&mut self.cwd, dir);
            match nav {
                Nav::New => {
                    self.back.push(previous);
                    self.forward.clear();
                }
                Nav::Back => {
                    self.back.pop();
                    self.forward.push(previous);
                }
                Nav::Forward => {
                    self.forward.pop();
                    self.back.push(previous);
                }
            }
        }
        self.entries.clear();
        self.entries.extend_from_iter(list);
        self.path_entry.set_text(&self.cwd.to_string_lossy());
        self.entries.view.grab_focus();
    }
}

fn main() {
    RelmApp::new(APP_ID).run::<App>(gtk::glib::home_dir());
}
