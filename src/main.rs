mod clipboard;
mod columns;
mod file_ops;
mod sidebar;

use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anchoa::db::{self, Bookmark, DbError};
use anchoa::executor::ItemStatus;
use anchoa::fs::{self, Entry};
use anchoa::history::ResolvedBy;
use anchoa::places::{self, Place};
use anchoa::plan::{Action, ActionPlan};
use anchoa::validator::{Rejection, ValidatedPlan};
use anchoa::{command, config, history, parser, paste, planner, trash};
use columns::{ModifiedColumn, NameColumn, PermissionColumn, SizeColumn};
use file_ops::Job;
use relm4::gtk::gio::prelude::*;
use relm4::gtk::prelude::*;
use relm4::gtk::{gdk, gio};
use relm4::prelude::*;
use relm4::typed_view::column::{RelmColumn, TypedColumnView};
use relm4::{adw, gtk};
use sidebar::{Drive, DriveTarget, Msg as SidebarMsg, Output as SidebarOutput, Sidebar};

const APP_ID: &str = "io.github.syharipf.Anchoa";

struct App {
    cwd: PathBuf,
    /// Listing in flight and how we got there; results for any other path are stale.
    requested: Option<(PathBuf, Nav)>,
    back: Vec<PathBuf>,
    forward: Vec<PathBuf>,
    show_hidden: bool,
    entries: TypedColumnView<Entry, gtk::MultiSelection>,
    path_entry: gtk::Entry,
    command_entry: gtk::Entry,
    command_error: gtk::Label,
    recall: command::Recall,
    toasts: adw::ToastOverlay,
    sidebar: Controller<Sidebar>,
    /// `None` until opened, or forever if opening the database failed; bookmarks are
    /// then simply unavailable, core navigation keeps working regardless.
    db: Option<Arc<Mutex<rusqlite::Connection>>>,
    /// Held only to keep drive-mount notifications firing.
    _drive_monitors: Vec<gio::FileMonitor>,
    /// Plugged-in volumes, mounted or not (via udisks2); also fires on (un)plug and (un)mount.
    volumes: gio::VolumeMonitor,
    /// `cwd` is a trash folder: show the restore / empty bar.
    in_trash: bool,
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
    FocusCommand,
    FocusFileList,
    CommandTextChanged,
    RecallUp,
    RecallDown,
    RunCommand(String),
    CopySelected,
    CutSelected,
    PasteSelected,
    ClipboardRead(Option<(Vec<PathBuf>, bool)>),
    Paste {
        sources: Vec<PathBuf>,
        dest: Option<PathBuf>,
        cut: Option<bool>,
    },
    PasteConflictAccepted {
        cut: bool,
        from_clipboard: bool,
        plan: ActionPlan,
    },
    ToggleHidden,
    /// F6: cycle keyboard focus between the sidebar, file list and command panel.
    ToggleSidebarFocus,
    /// Ctrl+D: bookmark the current directory.
    BookmarkCwd,
    RemoveBookmark(i64),
    MoveBookmark {
        id: i64,
        up: bool,
    },
    MoveBookmarkTo {
        id: i64,
        position: i64,
    },
    RefreshDrives,
    /// Mount the volume with this unix device, then open it.
    MountVolume(String),
    Mounted(Result<PathBuf, String>),
    /// Delete: trash the selected entries (after confirming).
    TrashSelected,
    /// Delete in the trash, or its Delete button: delete the selected items for good.
    DeleteSelected,
    /// F2: rename the selected entry.
    RenameSelected,
    /// Ctrl+Shift+N: new folder in the current directory.
    NewFolder,
    /// Ctrl+Z: undo the latest operation (after a preview).
    Undo,
    /// Validate `plan` on a worker, then confirm or run it.
    Submit(Job, ActionPlan),
    /// Execute (and record) a validated, confirmed plan on a worker.
    Run(Job, ValidatedPlan),
    /// Restore the selected trash items (`false`) or everything in the trash (`true`).
    Restore(bool),
    /// Ask, then delete trash items for good: the selected ones, or all for `None`.
    DeleteForGood(Option<Vec<PathBuf>>),
    DeleteForGoodConfirmed(Option<Vec<PathBuf>>),
}

#[derive(Debug)]
enum Cmd {
    Listed(PathBuf, Nav, io::Result<Vec<Entry>>),
    DbOpened(Result<rusqlite::Connection, DbError>),
    Bookmarks(Result<Vec<Bookmark>, DbError>),
    BookmarkAdded(Result<(bool, Vec<Bookmark>), DbError>),
    Places(Vec<Place>),
    Drives(Vec<Place>),
    CommandPlanned {
        input: String,
        result: Result<(command::Preview, ActionPlan), String>,
    },
    RecentCommands(Result<Vec<String>, DbError>),
    PastePlanned {
        dest: PathBuf,
        cut: bool,
        from_clipboard: bool,
        plan: ActionPlan,
        conflicts: Vec<PathBuf>,
    },
    Validated(Job, Result<ValidatedPlan, Vec<Rejection>>),
    Ran(Job, Vec<ItemStatus>, Option<String>),
    UndoPlanned(file_ops::UndoPlanned),
    RestorePlanned(Result<(Result<ValidatedPlan, Vec<Rejection>>, usize), String>),
    DeletedForGood(io::Result<usize>),
    /// Old trash items deleted at startup.
    TrashExpired(io::Result<usize>),
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
            set_title: Some("Anchoa"),
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

                #[name = "panes"]
                gtk::Paned {
                    set_orientation: gtk::Orientation::Horizontal,
                    set_shrink_start_child: false,
                    set_resize_start_child: false,
                    set_position: 200,
                    set_start_child: Some(model.sidebar.widget()),

                    #[local_ref]
                    #[wrap(Some)]
                    set_end_child = toasts -> adw::ToastOverlay {
                        gtk::Box {
                            set_orientation: gtk::Orientation::Vertical,

                            gtk::ScrolledWindow {
                                set_vexpand: true,

                                #[local_ref]
                                entries_view -> gtk::ColumnView {
                                    connect_activate[sender] => move |_, position| {
                                        sender.input(Msg::Activate(position));
                                    },
                                },
                            },

                            gtk::ActionBar {
                                #[watch]
                                set_revealed: model.in_trash,
                                pack_start = &gtk::Button {
                                    set_label: "Restore",
                                    set_tooltip_text: Some("Put the selected items back where they were"),
                                    connect_clicked => Msg::Restore(false),
                                },
                                pack_start = &gtk::Button {
                                    set_label: "Restore All",
                                    connect_clicked => Msg::Restore(true),
                                },
                                pack_end = &gtk::Button {
                                    set_label: "Empty Trash",
                                    add_css_class: "destructive-action",
                                    connect_clicked => Msg::DeleteForGood(None),
                                },
                                pack_end = &gtk::Button {
                                    set_label: "Delete",
                                    set_tooltip_text: Some("Delete the selected items for good (Delete)"),
                                    connect_clicked => Msg::DeleteSelected,
                                },
                            },

                            #[local_ref]
                            command_entry -> gtk::Entry {
                                set_placeholder_text: Some("move *.jpg older than 30d to ~/Pictures/old"),
                                set_hexpand: true,
                                set_margin_start: 6,
                                set_margin_end: 6,
                                set_margin_top: 6,
                                connect_activate[sender] => move |entry| {
                                    sender.input(Msg::RunCommand(entry.text().into()));
                                },
                                connect_changed[sender] => move |_| {
                                    sender.input(Msg::CommandTextChanged);
                                },
                            },

                            #[local_ref]
                            command_error -> gtk::Label {
                                set_xalign: 0.0,
                                set_wrap: true,
                                set_visible: false,
                                set_margin_start: 6,
                                set_margin_end: 6,
                                set_margin_bottom: 4,
                            },
                        },
                    },
                },
            },
        }
    }

    fn init(dir: PathBuf, root: Self::Root, sender: ComponentSender<Self>) -> ComponentParts<Self> {
        let mut entries = TypedColumnView::<Entry, gtk::MultiSelection>::new();
        entries.append_column::<NameColumn>();
        entries.append_column::<SizeColumn>();
        entries.append_column::<PermissionColumn>();
        entries.append_column::<ModifiedColumn>();
        let row_input = sender.input_sender().clone();
        if let Some(factory) = entries
            .get_columns()
            .get(NameColumn::COLUMN_NAME)
            .and_then(|column| column.factory())
            .and_downcast::<gtk::SignalListItemFactory>()
        {
            factory.connect_setup(move |_, object| {
                if let Some(item) = object.downcast_ref::<gtk::ListItem>() {
                    setup_file_row(item, &row_input);
                }
            });
        }
        let list_input = sender.input_sender().clone();
        let list_drop = gtk::DropTarget::new(
            gdk::FileList::static_type(),
            gdk::DragAction::COPY | gdk::DragAction::MOVE,
        );
        list_drop.connect_drop(move |target, value, _, _| {
            emit_file_drop(&list_input, target, value, None)
        });
        entries.view.add_controller(list_drop);
        entries.add_filter(|e| !e.name.starts_with('.'));

        let sidebar =
            Sidebar::builder()
                .launch(())
                .forward(sender.input_sender(), |out| match out {
                    SidebarOutput::Open(path) => Msg::Open(path),
                    SidebarOutput::RemoveBookmark(id) => Msg::RemoveBookmark(id),
                    SidebarOutput::MoveBookmark { id, up } => Msg::MoveBookmark { id, up },
                    SidebarOutput::MoveBookmarkTo { id, position } => {
                        Msg::MoveBookmarkTo { id, position }
                    }
                    SidebarOutput::Paste { sources, dest, cut } => Msg::Paste {
                        sources,
                        dest: Some(dest),
                        cut,
                    },
                    SidebarOutput::TrashDrop { sources } => Msg::Submit(
                        Job::Trash,
                        plan(
                            sources
                                .into_iter()
                                .map(|path| Action::Trash { path })
                                .collect(),
                        ),
                    ),
                    SidebarOutput::Mount(device) => Msg::MountVolume(device),
                });

        // Drive contents are read on a worker thread; live updates just re-trigger that scan.
        let drive_roots = places::drive_roots();
        let drive_monitors = drive_roots
            .iter()
            .filter_map(|root| {
                let monitor = gio::File::for_path(root)
                    .monitor_directory(gio::FileMonitorFlags::NONE, gio::Cancellable::NONE)
                    .ok()?;
                let input = sender.input_sender().clone();
                monitor.connect_changed(move |_, _, _, _| input.emit(Msg::RefreshDrives));
                Some(monitor)
            })
            .collect();
        let volumes = gio::VolumeMonitor::get();
        let refresh = {
            let input = sender.input_sender().clone();
            move || input.emit(Msg::RefreshDrives)
        };
        {
            let refresh = refresh.clone();
            volumes.connect_volume_added(move |_, _| refresh());
        }
        {
            let refresh = refresh.clone();
            volumes.connect_volume_removed(move |_, _| refresh());
        }
        {
            let refresh = refresh.clone();
            volumes.connect_mount_added(move |_, _| refresh());
        }
        volumes.connect_mount_removed(move |_, _| refresh());
        sender.spawn_oneshot_command(|| Cmd::Places(places::standard_places()));
        sender.spawn_oneshot_command(move || Cmd::Drives(places::drives(&drive_roots)));

        let model = App {
            cwd: dir.clone(),
            requested: None,
            back: Vec::new(),
            forward: Vec::new(),
            show_hidden: false,
            entries,
            path_entry: gtk::Entry::new(),
            command_entry: gtk::Entry::new(),
            command_error: gtk::Label::new(None),
            recall: command::Recall::default(),
            toasts: adw::ToastOverlay::new(),
            sidebar,
            db: None,
            _drive_monitors: drive_monitors,
            volumes,
            in_trash: false,
        };
        let path_entry = &model.path_entry;
        let command_entry = &model.command_entry;
        let command_error = &model.command_error;
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
            ("<Ctrl>K", Msg::FocusCommand),
            ("<Ctrl>H", Msg::ToggleHidden),
            ("<Ctrl>D", Msg::BookmarkCwd),
            ("F6", Msg::ToggleSidebarFocus),
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

        let command_entry: &gtk::Widget = model.command_entry.upcast_ref();
        let shortcuts = gtk::ShortcutController::new();
        for (accel, msg) in [
            ("Escape", Msg::FocusFileList),
            ("Up", Msg::RecallUp),
            ("Down", Msg::RecallDown),
        ] {
            let input = sender.input_sender().clone();
            let msg = msg.clone();
            shortcuts.add_shortcut(gtk::Shortcut::new(
                gtk::ShortcutTrigger::parse_string(accel),
                Some(gtk::CallbackAction::new(move |_, _| {
                    input.emit(msg.clone());
                    gtk::glib::Propagation::Stop
                })),
            ));
        }
        command_entry.add_controller(shortcuts);

        // File shortcuts act on the file list only, so Delete in the path bar or the sidebar
        // keeps its own meaning; undo and new folder work anywhere in the two panes.
        let file_list: &gtk::Widget = model.entries.view.upcast_ref();
        let panes: &gtk::Widget = widgets.panes.upcast_ref();
        for (widget, accels) in [
            (
                file_list,
                &[
                    ("Delete", Msg::TrashSelected),
                    ("F2", Msg::RenameSelected),
                    ("<Ctrl>c", Msg::CopySelected),
                    ("<Ctrl>x", Msg::CutSelected),
                    ("<Ctrl>v", Msg::PasteSelected),
                ][..],
            ),
            (
                panes,
                &[("<Ctrl>z", Msg::Undo), ("<Ctrl><Shift>n", Msg::NewFolder)][..],
            ),
        ] {
            let shortcuts = gtk::ShortcutController::new();
            for (accel, msg) in accels {
                let input = sender.input_sender().clone();
                let msg = msg.clone();
                shortcuts.add_shortcut(gtk::Shortcut::new(
                    gtk::ShortcutTrigger::parse_string(accel),
                    Some(gtk::CallbackAction::new(move |_, _| {
                        input.emit(msg.clone());
                        gtk::glib::Propagation::Stop
                    })),
                ));
            }
            widget.add_controller(shortcuts);
        }

        // Never blocks the UI thread: opens (and migrates) the database on a worker thread.
        sender.spawn_oneshot_command(|| {
            let path = gtk::glib::user_data_dir().join("anchoa").join("history.db");
            Cmd::DbOpened(db::open(&path).inspect(|conn| {
                // Housekeeping only: a failed prune must not make history unavailable.
                let _ = db::prune(conn, file_ops::now());
            }))
        });

        // Trash items past the configured age are deleted for good (default 30 days).
        sender.spawn_oneshot_command(|| {
            let days = config::load(&config::path())
                .unwrap_or_default()
                .trash_auto_delete_days;
            Cmd::TrashExpired(trash::delete_expired(days, file_ops::now()))
        });

        sender.input(Msg::Open(dir));
        ComponentParts { model, widgets }
    }

    fn update(&mut self, msg: Msg, sender: ComponentSender<Self>, root: &Self::Root) {
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
            Msg::FocusCommand => {
                self.command_entry.grab_focus();
                None
            }
            Msg::FocusFileList => {
                self.entries.view.grab_focus();
                None
            }
            Msg::CommandTextChanged => {
                self.command_error.set_text("");
                self.command_error.set_visible(false);
                None
            }
            Msg::RecallUp => {
                if let Some(text) = self.recall.up(self.command_entry.text().as_str()) {
                    self.command_entry.set_text(&text);
                    self.command_entry.set_position(text.chars().count() as i32);
                }
                None
            }
            Msg::RecallDown => {
                if let Some(text) = self.recall.down() {
                    self.command_entry.set_text(&text);
                    self.command_entry.set_position(text.chars().count() as i32);
                }
                None
            }
            Msg::RunCommand(input) => {
                self.command_error.set_text("");
                self.command_error.set_visible(false);
                match parser::parse(&input) {
                    Ok(cmd) => {
                        let cwd = self.cwd.clone();
                        let home = gtk::glib::home_dir();
                        sender.spawn_oneshot_command(move || {
                            let result = planner::build(&cmd, &cwd, &home, file_ops::now())
                                .map(|plan| (command::preview(&plan), plan))
                                .map_err(|err| err.to_string());
                            Cmd::CommandPlanned { input, result }
                        });
                    }
                    Err(err) => {
                        let examples = command::examples(&input).join("\n");
                        self.command_error.set_text(&format!("{err}\n{examples}"));
                        self.command_error.set_visible(true);
                        if let Some(db) = self.db.clone() {
                            sender.spawn_oneshot_command(move || {
                                let conn =
                                    db.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                                let _ = history::record_command(
                                    &conn,
                                    &input,
                                    ResolvedBy::None,
                                    None,
                                    None,
                                    file_ops::now(),
                                );
                                Cmd::RecentCommands(history::recent_commands(&conn, 100))
                            });
                        }
                    }
                }
                None
            }
            Msg::CopySelected => {
                self.copy_selected(false, root);
                None
            }
            Msg::CutSelected => {
                self.copy_selected(true, root);
                None
            }
            Msg::PasteSelected => {
                if self.in_trash {
                    self.toasts
                        .add_toast(adw::Toast::new("Cannot paste into the trash"));
                } else {
                    let clipboard = root.clipboard();
                    let input = sender.input_sender().clone();
                    relm4::spawn_local(async move {
                        let contents = clipboard::read(&clipboard).await;
                        input.emit(Msg::ClipboardRead(contents));
                    });
                }
                None
            }
            Msg::ClipboardRead(Some((sources, cut))) => {
                if self.in_trash {
                    self.toasts
                        .add_toast(adw::Toast::new("Cannot paste into the trash"));
                } else {
                    self.spawn_paste(sources, self.cwd.clone(), Some(cut), true, &sender);
                }
                None
            }
            Msg::ClipboardRead(None) => None,
            Msg::Paste { sources, dest, cut } => {
                if !sources.is_empty() {
                    if dest.is_none() && self.in_trash {
                        self.toasts
                            .add_toast(adw::Toast::new("Cannot paste into the trash"));
                    } else {
                        self.spawn_paste(
                            sources,
                            dest.unwrap_or_else(|| self.cwd.clone()),
                            cut,
                            false,
                            &sender,
                        );
                    }
                }
                None
            }
            Msg::PasteConflictAccepted {
                cut,
                from_clipboard,
                plan,
            } => {
                sender.input(Msg::Submit(
                    Job::Paste {
                        cut,
                        from_clipboard,
                    },
                    plan,
                ));
                None
            }
            Msg::ToggleHidden => {
                self.show_hidden = !self.show_hidden;
                self.entries
                    .set_filter_status(HIDDEN_FILTER, !self.show_hidden);
                None
            }
            Msg::ToggleSidebarFocus => {
                if self.sidebar_has_focus(root) {
                    self.entries.view.grab_focus();
                } else if gtk::prelude::RootExt::focus(root)
                    .is_some_and(|widget| widget.is_ancestor(&self.command_entry))
                {
                    self.sidebar.emit(SidebarMsg::Focus);
                } else {
                    self.command_entry.grab_focus();
                }
                None
            }
            Msg::BookmarkCwd => {
                self.bookmark_cwd(&sender);
                None
            }
            Msg::RemoveBookmark(id) => {
                self.with_bookmarks(&sender, move |conn| db::remove_bookmark(conn, id));
                None
            }
            Msg::MoveBookmark { id, up } => {
                self.with_bookmarks(&sender, move |conn| db::move_bookmark(conn, id, up));
                None
            }
            Msg::MoveBookmarkTo { id, position } => {
                self.with_bookmarks(&sender, move |conn| {
                    db::move_bookmark_to(conn, id, position)
                });
                None
            }
            Msg::MountVolume(device) => {
                self.mount(&device, &sender, root);
                None
            }
            Msg::Mounted(Ok(path)) => Some((path, Nav::New)),
            Msg::Mounted(Err(err)) => {
                self.toasts
                    .add_toast(adw::Toast::new(&format!("Cannot mount: {err}")));
                None
            }
            // Items already in the trash cannot be trashed again: Delete deletes them for good.
            Msg::TrashSelected if self.in_trash => {
                sender.input(Msg::DeleteSelected);
                None
            }
            Msg::DeleteSelected => {
                let files: Vec<_> = self.selected().into_iter().map(|e| e.path).collect();
                if files.is_empty() {
                    self.toasts
                        .add_toast(adw::Toast::new("Select the items to delete first"));
                } else {
                    sender.input(Msg::DeleteForGood(Some(files)));
                }
                None
            }
            Msg::TrashSelected => {
                let actions: Vec<_> = self
                    .selected()
                    .into_iter()
                    .map(|entry| Action::Trash { path: entry.path })
                    .collect();
                if !actions.is_empty() {
                    sender.input(Msg::Submit(Job::Trash, plan(actions)));
                }
                None
            }
            Msg::RenameSelected => {
                if let [entry] = &self.selected()[..] {
                    let src = entry.path.clone();
                    file_ops::ask_name(
                        root,
                        "Rename",
                        "Rename",
                        &entry.name,
                        true,
                        sender.input_sender().clone(),
                        move |name| {
                            let dst = src.with_file_name(name);
                            Msg::Submit(Job::Rename, plan(vec![Action::Rename { src, dst }]))
                        },
                    );
                }
                None
            }
            Msg::NewFolder => {
                let cwd = self.cwd.clone();
                file_ops::ask_name(
                    root,
                    "New Folder",
                    "Create",
                    "New Folder",
                    false,
                    sender.input_sender().clone(),
                    move |name| {
                        let path = cwd.join(name);
                        Msg::Submit(Job::NewFolder, plan(vec![Action::Mkdir { path }]))
                    },
                );
                None
            }
            Msg::Undo => {
                match self.db.clone() {
                    Some(db) => sender
                        .spawn_oneshot_command(move || Cmd::UndoPlanned(file_ops::plan_undo(&db))),
                    None => self
                        .toasts
                        .add_toast(adw::Toast::new("Undo is unavailable: history did not open")),
                }
                None
            }
            Msg::Submit(job, plan) => {
                sender.spawn_oneshot_command(move || {
                    let result = file_ops::validate(plan);
                    Cmd::Validated(job, result)
                });
                None
            }
            Msg::Run(job, plan) => {
                let db = self.db.clone();
                sender.spawn_oneshot_command(move || {
                    let (statuses, warning) = file_ops::run(db.as_ref(), &job, &plan);
                    Cmd::Ran(job, statuses, warning)
                });
                None
            }
            Msg::Restore(all) => {
                let files = (!all).then(|| {
                    self.selected()
                        .into_iter()
                        .map(|entry| entry.path)
                        .collect::<Vec<_>>()
                });
                if files.as_ref().is_some_and(Vec::is_empty) {
                    self.toasts
                        .add_toast(adw::Toast::new("Select the items to restore first"));
                } else {
                    sender.spawn_oneshot_command(move || {
                        Cmd::RestorePlanned(file_ops::plan_restore(files))
                    });
                }
                None
            }
            Msg::DeleteForGood(files) => {
                let confirmed = Msg::DeleteForGoodConfirmed(files.clone());
                file_ops::confirm_delete(
                    root,
                    files.as_deref(),
                    sender.input_sender().clone(),
                    confirmed,
                );
                None
            }
            Msg::DeleteForGoodConfirmed(files) => {
                sender.spawn_oneshot_command(move || {
                    Cmd::DeletedForGood(match files {
                        Some(files) => trash::delete_files(&files),
                        None => trash::empty(),
                    })
                });
                None
            }
            Msg::RefreshDrives => {
                sender
                    .spawn_oneshot_command(|| Cmd::Drives(places::drives(&places::drive_roots())));
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

    fn update_cmd(&mut self, cmd: Cmd, sender: ComponentSender<Self>, root: &Self::Root) {
        match cmd {
            Cmd::PastePlanned {
                dest,
                cut,
                from_clipboard,
                mut plan,
                conflicts,
            } => {
                if !plan.actions.is_empty() {
                    if conflicts.is_empty() {
                        sender.input(Msg::Submit(
                            Job::Paste {
                                cut,
                                from_clipboard,
                            },
                            plan,
                        ));
                    } else {
                        file_ops::ask_conflict(
                            root,
                            &conflicts,
                            &dest,
                            sender.input_sender().clone(),
                            move |policy| {
                                plan.on_conflict = Some(policy);
                                Msg::PasteConflictAccepted {
                                    cut,
                                    from_clipboard,
                                    plan,
                                }
                            },
                        );
                    }
                }
            }
            Cmd::CommandPlanned { input, result } => match result {
                Ok((preview, plan)) => {
                    sender.input(Msg::Submit(Job::Command { input, preview }, plan));
                }
                Err(err) => self.toasts.add_toast(adw::Toast::new(&err)),
            },
            Cmd::RecentCommands(Ok(items)) => self.recall = command::Recall::new(items),
            Cmd::RecentCommands(Err(_)) => {}
            Cmd::Validated(job, Ok(plan)) | Cmd::UndoPlanned(Ok(Some((job, Ok(plan))))) => {
                let run = Msg::Run(job.clone(), plan.clone());
                file_ops::confirm(root, &job, plan.plan(), sender.input_sender().clone(), run);
            }
            Cmd::Validated(_, Err(rejections))
            | Cmd::UndoPlanned(Ok(Some((_, Err(rejections))))) => {
                file_ops::show_rejections(root, &rejections);
            }
            Cmd::RestorePlanned(Ok((Ok(plan), missing))) => {
                if missing > 0 {
                    self.toasts.add_toast(adw::Toast::new(&format!(
                        "{missing} selected item(s) are no longer in the trash"
                    )));
                }
                if plan.plan().actions.is_empty() {
                    self.toasts.add_toast(adw::Toast::new("Nothing to restore"));
                } else {
                    sender.input(Msg::Run(Job::Restore, plan));
                }
            }
            Cmd::RestorePlanned(Ok((Err(rejections), _))) => {
                file_ops::show_rejections(root, &rejections);
            }
            Cmd::RestorePlanned(Err(err)) => self
                .toasts
                .add_toast(adw::Toast::new(&format!("Cannot read the trash: {err}"))),
            Cmd::DeletedForGood(result) => {
                let text = match result {
                    Ok(n) => format!("Deleted {n} item(s) for good"),
                    Err(err) => format!("Deleting failed: {err}"),
                };
                self.toasts.add_toast(adw::Toast::new(&text));
                sender.input(Msg::Open(self.cwd.clone()));
            }
            // Without gvfs there is nothing to expire; stay quiet about it.
            Cmd::TrashExpired(Ok(0) | Err(_)) => {}
            Cmd::TrashExpired(Ok(n)) => self.toasts.add_toast(adw::Toast::new(&format!(
                "Deleted {n} item(s) that were in the trash for over the time limit"
            ))),
            Cmd::UndoPlanned(Ok(None)) => self.toasts.add_toast(adw::Toast::new("Nothing to undo")),
            Cmd::UndoPlanned(Err(err)) => self
                .toasts
                .add_toast(adw::Toast::new(&format!("Undo failed: {err}"))),
            Cmd::Ran(job, statuses, warning) => {
                if matches!(
                    &job,
                    Job::Paste {
                        cut: true,
                        from_clipboard: true,
                    }
                ) && !statuses
                    .iter()
                    .any(|status| matches!(status, ItemStatus::Failed(_)))
                {
                    clipboard::clear(&root.clipboard());
                }
                if let Job::Command { input, .. } = &job
                    && self.command_entry.text().as_str() == input
                    && !statuses
                        .iter()
                        .any(|status| matches!(status, ItemStatus::Failed(_)))
                {
                    self.command_entry.set_text("");
                }
                if matches!(job, Job::Trash | Job::Restore) {
                    // The first trashing creates the trash folder; show it in the sidebar.
                    sender.spawn_oneshot_command(|| Cmd::Places(places::standard_places()));
                }
                let toast = adw::Toast::new(&file_ops::summary(&job, &statuses));
                let undoable = !matches!(job, Job::Undo { .. })
                    && warning.is_none()
                    && statuses
                        .iter()
                        .any(|s| matches!(s, ItemStatus::Done { .. }));
                if undoable {
                    toast.set_button_label(Some("Undo"));
                    let input = sender.input_sender().clone();
                    toast.connect_button_clicked(move |_| input.emit(Msg::Undo));
                }
                self.toasts.add_toast(toast);
                if let Some(warning) = warning {
                    self.toasts.add_toast(adw::Toast::new(&warning));
                }
                if matches!(job, Job::Command { .. }) {
                    self.load_recent_commands(&sender);
                }
                sender.input(Msg::Open(self.cwd.clone()));
            }
            Cmd::Listed(dir, nav, result) => {
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
                self.in_trash = trash::is_trash_folder(&dir);
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
                // Opened from the sidebar: keep focus there, so Delete and reordering still
                // act on the row that was just clicked.
                if !self.sidebar_has_focus(root) {
                    self.entries.view.grab_focus();
                }
            }
            Cmd::DbOpened(Ok(conn)) => {
                self.db = Some(Arc::new(Mutex::new(conn)));
                self.with_bookmarks(&sender, |_| Ok(()));
                self.load_recent_commands(&sender);
            }
            Cmd::DbOpened(Err(err)) => self.bookmarks_unavailable(err),
            Cmd::Bookmarks(Ok(list)) => self.sidebar.emit(SidebarMsg::SetBookmarks(list)),
            Cmd::Bookmarks(Err(err)) => self.bookmarks_unavailable(err),
            Cmd::BookmarkAdded(Ok((added, list))) => {
                self.toasts.add_toast(adw::Toast::new(if added {
                    "Bookmark added"
                } else {
                    "Already bookmarked"
                }));
                self.sidebar.emit(SidebarMsg::SetBookmarks(list));
            }
            Cmd::BookmarkAdded(Err(err)) => self.bookmarks_unavailable(err),
            Cmd::Places(list) => self.sidebar.emit(SidebarMsg::SetPlaces(list)),
            Cmd::Drives(mnt) => {
                let mut drives = volume_drives(&self.volumes);
                drives.extend(mnt.into_iter().map(|place| Drive {
                    label: place.label,
                    icon: place.icon,
                    target: DriveTarget::Mounted(place.path),
                }));
                self.sidebar.emit(SidebarMsg::SetDrives(drives));
            }
        }
    }
}

impl App {
    fn copy_selected(&mut self, cut: bool, root: &adw::ApplicationWindow) {
        let sources: Vec<_> = self
            .selected()
            .into_iter()
            .map(|entry| entry.path)
            .collect();
        if sources.is_empty() {
            return;
        }
        clipboard::write(&root.clipboard(), &sources, cut);
        let count = sources.len();
        let noun = if count == 1 { "item" } else { "items" };
        self.toasts.add_toast(adw::Toast::new(&format!(
            "{} {count} {noun}",
            if cut { "Cut" } else { "Copied" }
        )));
    }

    fn spawn_paste(
        &self,
        sources: Vec<PathBuf>,
        dest: PathBuf,
        cut: Option<bool>,
        from_clipboard: bool,
        sender: &ComponentSender<Self>,
    ) {
        sender.spawn_oneshot_command(move || {
            let cut = cut.unwrap_or_else(|| {
                sources
                    .iter()
                    .all(|source| paste::same_device(source, &dest))
            });
            let plan = paste::plan(&sources, &dest, cut);
            let conflicts = paste::conflicts(&plan);
            Cmd::PastePlanned {
                dest,
                cut,
                from_clipboard,
                plan,
                conflicts,
            }
        });
    }

    fn load_recent_commands(&self, sender: &ComponentSender<Self>) {
        let Some(db) = self.db.clone() else { return };
        sender.spawn_oneshot_command(move || {
            let conn = db.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            Cmd::RecentCommands(history::recent_commands(&conn, 100))
        });
    }

    /// Runs `op` against the database on a worker thread, then reloads the bookmark list
    /// and forwards it to the sidebar. A no-op if the database never opened.
    fn with_bookmarks<F>(&self, sender: &ComponentSender<Self>, op: F)
    where
        F: FnOnce(&mut rusqlite::Connection) -> Result<(), DbError> + Send + 'static,
    {
        let Some(db) = self.db.clone() else { return };
        sender.spawn_oneshot_command(move || {
            let result = (|| {
                let mut conn = db.lock().unwrap();
                op(&mut conn)?;
                db::bookmarks(&conn)
            })();
            Cmd::Bookmarks(result)
        });
    }

    /// Bookmarks `self.cwd`, labelled by its file name (or "/" for the root).
    fn bookmark_cwd(&self, sender: &ComponentSender<Self>) {
        let Some(db) = self.db.clone() else {
            self.toasts
                .add_toast(adw::Toast::new("Bookmarks unavailable"));
            return;
        };
        let path = self.cwd.clone();
        let label = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "/".to_string());
        sender.spawn_oneshot_command(move || {
            let result = (|| {
                let conn = db.lock().unwrap();
                let added = db::add_bookmark(&conn, &path, &label)?;
                Ok((added, db::bookmarks(&conn)?))
            })();
            Cmd::BookmarkAdded(result)
        });
    }

    /// The selected entries of the file list, in list order.
    fn selected(&self) -> Vec<Entry> {
        let selection = self.entries.selection_model.selection();
        (0..selection.size())
            .filter_map(|i| self.entries.get_visible(selection.nth(i as u32)))
            .map(|item| item.borrow().clone())
            .collect()
    }

    fn sidebar_has_focus(&self, root: &adw::ApplicationWindow) -> bool {
        gtk::prelude::RootExt::focus(root)
            .is_some_and(|widget| widget.is_ancestor(self.sidebar.widget()))
    }

    /// Mounts the volume asynchronously (udisks2 may ask for a password through `root`),
    /// then opens it via [`Msg::Mounted`].
    fn mount(&self, device: &str, sender: &ComponentSender<Self>, root: &adw::ApplicationWindow) {
        let Some(volume) = self
            .volumes
            .volumes()
            .into_iter()
            .find(|v| v.identifier("unix-device").as_deref() == Some(device))
        else {
            return;
        };
        let input = sender.input_sender().clone();
        let mounted = volume.clone();
        volume.mount(
            gio::MountMountFlags::NONE,
            Some(&gtk::MountOperation::new(Some(root))),
            gio::Cancellable::NONE,
            move |result| {
                let path = result
                    .map_err(|err| err.message().to_owned())
                    .and_then(|()| {
                        mounted
                            .get_mount()
                            .and_then(|mount| mount.root().path())
                            .ok_or_else(|| "mounted, but it has no local folder".to_owned())
                    });
                input.emit(Msg::Mounted(path));
            },
        );
    }

    fn bookmarks_unavailable(&self, err: DbError) {
        self.toasts
            .add_toast(adw::Toast::new(&format!("Bookmarks unavailable: {err}")));
    }
}

fn setup_file_row(item: &gtk::ListItem, input: &relm4::Sender<Msg>) {
    let Some(root) = item.child() else {
        return;
    };
    let weak = item.downgrade();
    let drag = gtk::DragSource::new();
    drag.set_actions(gdk::DragAction::COPY | gdk::DragAction::MOVE);
    drag.connect_prepare(move |source, _, _| {
        let item = weak.upgrade()?;
        let widget = source.widget()?;
        let paths = drag_paths(&item, &widget)?;
        let files: Vec<_> = paths.into_iter().map(gio::File::for_path).collect();
        let value = gdk::FileList::from_array(&files).to_value();
        Some(gdk::ContentProvider::for_value(&value))
    });
    root.add_controller(drag);

    let weak = item.downgrade();
    let drop = gtk::DropTarget::new(
        gdk::FileList::static_type(),
        gdk::DragAction::COPY | gdk::DragAction::MOVE,
    );
    let input = input.clone();
    drop.connect_drop(move |target, value, _, _| {
        let Some(item) = weak.upgrade() else {
            return false;
        };
        let Some(entry) = list_item_entry(&item) else {
            return false;
        };
        entry.is_dir && emit_file_drop(&input, target, value, Some(entry.path))
    });
    root.add_controller(drop);
}

fn emit_file_drop(
    input: &relm4::Sender<Msg>,
    target: &gtk::DropTarget,
    value: &gtk::glib::Value,
    dest: Option<PathBuf>,
) -> bool {
    let sources = dropped_paths(value);
    if sources.is_empty() {
        return false;
    }
    input.emit(Msg::Paste {
        sources,
        dest,
        cut: drop_cut(target),
    });
    true
}

fn drag_paths(item: &gtk::ListItem, widget: &gtk::Widget) -> Option<Vec<PathBuf>> {
    let entry = list_item_entry(item)?;
    let view = widget
        .ancestor(gtk::ColumnView::static_type())
        .and_downcast::<gtk::ColumnView>()?;
    let model = view.model()?;
    if model.is_selected(item.position()) {
        let selection = model.selection();
        let paths: Vec<_> = (0..selection.size())
            .filter_map(|index| model.item(selection.nth(index as u32)))
            .filter_map(|object| {
                object
                    .downcast_ref::<gtk::glib::BoxedAnyObject>()?
                    .try_borrow::<Entry>()
                    .ok()
                    .map(|entry| entry.path.clone())
            })
            .collect();
        if !paths.is_empty() {
            return Some(paths);
        }
    }
    Some(vec![entry.path])
}

fn list_item_entry(item: &gtk::ListItem) -> Option<Entry> {
    let object = item.item()?;
    let boxed = object.downcast_ref::<gtk::glib::BoxedAnyObject>()?;
    boxed.try_borrow::<Entry>().ok().map(|entry| entry.clone())
}

fn dropped_paths(value: &gtk::glib::Value) -> Vec<PathBuf> {
    value
        .get::<gdk::FileList>()
        .map(|files| {
            files
                .files()
                .into_iter()
                .filter_map(|file| file.path())
                .collect()
        })
        .unwrap_or_default()
}

fn drop_cut(target: &gtk::DropTarget) -> Option<bool> {
    let state = target.current_drop()?.device().modifier_state();
    if state.contains(gdk::ModifierType::CONTROL_MASK) {
        Some(false)
    } else if state.contains(gdk::ModifierType::SHIFT_MASK) {
        Some(true)
    } else {
        None
    }
}

/// Local volumes from udisks2, mounted or not. Network mounts are left out: they have no
/// unix device, and remote locations are out of scope for v1.
fn volume_drives(monitor: &gio::VolumeMonitor) -> Vec<Drive> {
    monitor
        .volumes()
        .into_iter()
        .filter_map(|volume| {
            let device = volume.identifier("unix-device")?;
            let removable = volume.drive().is_some_and(|drive| drive.is_removable());
            let target = match volume.get_mount().and_then(|mount| mount.root().path()) {
                Some(path) => DriveTarget::Mounted(path),
                None => DriveTarget::Unmounted(device.into()),
            };
            Some(Drive {
                label: volume.name().into(),
                icon: if removable {
                    "drive-removable-media-symbolic"
                } else {
                    "drive-harddisk-symbolic"
                },
                target,
            })
        })
        .collect()
}

fn plan(actions: Vec<Action>) -> ActionPlan {
    ActionPlan {
        actions,
        on_conflict: None,
    }
}

fn main() {
    let app = RelmApp::new(APP_ID);
    relm4::set_global_css(sidebar::CSS);
    app.run::<App>(gtk::glib::home_dir());
}
