//! File list: the folder's entries, the name filter and recursive search, and dragging
//! files in and out.
//!
//! The app owns navigation and every file operation. It hands this component each new
//! listing ([`Msg::Show`]) and reads the selection back through [`FileList::selected`];
//! the list reports what the user asked for through [`Output`].
//!
//! Search has two modes: typing in the list filters the loaded folder on the UI thread;
//! Ctrl+F then Enter walks the folder and everything below it on a worker, and the results
//! replace the list until Esc. Any navigation calls [`Msg::LeaveSearch`] first, so a stale
//! result or filter never lands on another folder.

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use anchoa::fs::Entry;
use anchoa::search;
use relm4::gtk;
use relm4::gtk::gdk;
use relm4::gtk::prelude::*;
use relm4::prelude::*;
use relm4::typed_view::column::{RelmColumn, TypedColumnView};

use crate::columns::{ModifiedColumn, NameColumn, PermissionColumn, SizeColumn};
use crate::dnd;

const HIDDEN_FILTER: usize = 0;
const FILTER_QUERY: usize = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchMode {
    Off,
    Filter,
    Recursive,
}

pub struct FileList {
    entries: TypedColumnView<Entry, gtk::MultiSelection>,
    search_bar: gtk::SearchBar,
    search_entry: gtk::SearchEntry,
    search_status: gtk::Label,
    /// Read by the list's filter; an empty query matches everything, so the filter stays
    /// harmlessly active outside filter mode.
    filter_query: Rc<RefCell<String>>,
    search_mode: SearchMode,
    /// The running walk, if any; results from any other walk are stale.
    search_cancel: Option<Arc<AtomicBool>>,
    /// Search results replace the listing, so Esc has to bring the folder back.
    showing_results: bool,
    cwd: PathBuf,
    show_hidden: bool,
}

#[derive(Debug)]
pub enum Msg {
    /// A new listing of `dir`.
    Show {
        dir: PathBuf,
        entries: Vec<Entry>,
    },
    Focus,
    ToggleHidden,
    /// Ctrl+F: open the search bar in recursive mode.
    OpenRecursiveSearch,
    /// Navigation is about to happen: cancel any search and clear the filter.
    LeaveSearch,
    /// Internal: a row was activated.
    Activate(u32),
    /// Internal: the search entry's text changed.
    SearchTextChanged(String),
    /// Internal: Enter in the search entry.
    RunSearch,
    /// Internal: the search bar opened (by typing or by Ctrl+F).
    SearchOpened,
    /// Internal: the search bar closed (Esc).
    SearchClosed,
}

#[derive(Debug)]
pub enum Output {
    /// A folder was activated.
    Open(PathBuf),
    /// Search results were closed: list the active folder again.
    Reload,
    /// Files were dropped on a folder row (`Some`) or elsewhere on the list (`None`);
    /// `cut` as in [`dnd::file_drop_target`].
    Paste {
        sources: Vec<PathBuf>,
        dest: Option<PathBuf>,
        cut: Option<bool>,
    },
    /// Delete, F2, Ctrl+C, Ctrl+X, Ctrl+V on the list.
    Trash,
    Rename,
    Copy,
    Cut,
    PasteClipboard,
}

#[derive(Debug)]
pub enum Cmd {
    /// Result of a [`search::walk`]; dropped unless `cancel` is still the running walk.
    SearchResults(Arc<AtomicBool>, Vec<Entry>),
}

#[relm4::component(pub)]
impl Component for FileList {
    type Init = PathBuf;
    type Input = Msg;
    type Output = Output;
    type CommandOutput = Cmd;

    view! {
        gtk::Box {
            set_orientation: gtk::Orientation::Vertical,
            set_vexpand: true,

            #[local_ref]
            search_bar -> gtk::SearchBar {
                #[wrap(Some)]
                set_child = &gtk::Box {
                    set_orientation: gtk::Orientation::Horizontal,
                    set_spacing: 6,

                    #[local_ref]
                    search_entry -> gtk::SearchEntry {
                        set_hexpand: true,
                        connect_search_changed[sender] => move |entry| {
                            sender.input(Msg::SearchTextChanged(entry.text().into()));
                        },
                        connect_activate => Msg::RunSearch,
                    },

                    #[local_ref]
                    search_status -> gtk::Label {
                        set_visible: false,
                        add_css_class: "dim-label",
                    },
                },
            },

            gtk::ScrolledWindow {
                set_vexpand: true,

                #[local_ref]
                entries_view -> gtk::ColumnView {
                    connect_activate[sender] => move |_, position| {
                        sender.input(Msg::Activate(position));
                    },
                },
            },
        }
    }

    fn init(cwd: PathBuf, root: Self::Root, sender: ComponentSender<Self>) -> ComponentParts<Self> {
        let mut entries = TypedColumnView::<Entry, gtk::MultiSelection>::new();
        entries.append_column::<NameColumn>();
        entries.append_column::<SizeColumn>();
        entries.append_column::<PermissionColumn>();
        entries.append_column::<ModifiedColumn>();
        if let Some(factory) = entries
            .get_columns()
            .get(NameColumn::COLUMN_NAME)
            .and_then(|column| column.factory())
            .and_downcast::<gtk::SignalListItemFactory>()
        {
            let output = sender.output_sender().clone();
            factory.connect_setup(move |_, object| {
                if let Some(item) = object.downcast_ref::<gtk::ListItem>() {
                    setup_row(item, &output);
                }
            });
        }
        let output = sender.output_sender().clone();
        entries
            .view
            .add_controller(dnd::file_drop_target(move |sources, cut| {
                output.emit(Output::Paste {
                    sources,
                    dest: None,
                    cut,
                });
                true
            }));
        entries.add_filter(|e| !e.name.starts_with('.'));
        let filter_query = Rc::new(RefCell::new(String::new()));
        {
            let filter_query = filter_query.clone();
            entries.add_filter(move |e| search::matches(&filter_query.borrow(), &e.name));
        }

        let model = FileList {
            entries,
            search_bar: gtk::SearchBar::new(),
            search_entry: gtk::SearchEntry::new(),
            search_status: gtk::Label::new(None),
            filter_query,
            search_mode: SearchMode::Off,
            search_cancel: None,
            showing_results: false,
            cwd,
            show_hidden: false,
        };
        model.search_bar.connect_entry(&model.search_entry);
        model
            .search_bar
            .set_key_capture_widget(Some(&model.entries.view));
        let search_bar = &model.search_bar;
        let search_entry = &model.search_entry;
        let search_status = &model.search_status;
        let entries_view = &model.entries.view;
        let widgets = view_output!();

        let input = sender.input_sender().clone();
        model
            .search_bar
            .connect_search_mode_enabled_notify(move |bar| {
                input.emit(if bar.is_search_mode() {
                    Msg::SearchOpened
                } else {
                    Msg::SearchClosed
                });
            });

        // File shortcuts act on the list only, so Delete in the path bar or the sidebar
        // keeps its own meaning.
        let shortcuts = gtk::ShortcutController::new();
        for (accel, out) in [
            ("Delete", (|| Output::Trash) as fn() -> Output),
            ("F2", || Output::Rename),
            ("<Ctrl>c", || Output::Copy),
            ("<Ctrl>x", || Output::Cut),
            ("<Ctrl>v", || Output::PasteClipboard),
        ] {
            let output = sender.output_sender().clone();
            shortcuts.add_shortcut(gtk::Shortcut::new(
                gtk::ShortcutTrigger::parse_string(accel),
                Some(gtk::CallbackAction::new(move |_, _| {
                    output.emit(out());
                    gtk::glib::Propagation::Stop
                })),
            ));
        }
        model.entries.view.add_controller(shortcuts);

        ComponentParts { model, widgets }
    }

    fn update(&mut self, msg: Msg, sender: ComponentSender<Self>, _: &Self::Root) {
        match msg {
            Msg::Show { dir, entries } => {
                self.cwd = dir;
                self.entries.clear();
                self.entries.extend_from_iter(entries);
            }
            Msg::Focus => {
                self.entries.view.grab_focus();
            }
            Msg::ToggleHidden => {
                self.show_hidden = !self.show_hidden;
                self.entries
                    .set_filter_status(HIDDEN_FILTER, !self.show_hidden);
            }
            Msg::OpenRecursiveSearch => {
                // An earlier filter query must not hide recursive results once they land.
                self.set_filter("");
                self.search_mode = SearchMode::Recursive;
                let folder = self
                    .cwd
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| self.cwd.display().to_string());
                self.search_entry
                    .set_placeholder_text(Some(&format!("Search in {folder} and below")));
                self.search_bar.set_search_mode(true);
                self.search_entry.grab_focus();
            }
            Msg::LeaveSearch => {
                if self.search_mode != SearchMode::Off || self.search_cancel.is_some() {
                    self.reset_search();
                    self.search_bar.set_search_mode(false);
                }
            }
            Msg::Activate(position) => {
                if let Some(entry) = self
                    .entries
                    .get_visible(position)
                    .map(|item| item.borrow().clone())
                    .filter(|entry| entry.is_dir)
                {
                    sender.output(Output::Open(entry.path)).ok();
                }
            }
            Msg::SearchTextChanged(text) => {
                if self.search_mode == SearchMode::Filter {
                    self.set_filter(&text);
                }
            }
            Msg::RunSearch => {
                if self.search_mode == SearchMode::Recursive {
                    if let Some(previous) = self.search_cancel.take() {
                        previous.store(true, Ordering::Relaxed);
                    }
                    let cancel = Arc::new(AtomicBool::new(false));
                    self.search_cancel = Some(cancel.clone());
                    // `showing_results` stays as it is: with earlier results still on
                    // screen, Esc during this search must still bring the folder back.
                    self.search_status.set_text("Searching…");
                    self.search_status.set_visible(true);
                    let root = self.cwd.clone();
                    let query = self.search_entry.text().to_string();
                    let hidden = self.show_hidden;
                    sender.spawn_oneshot_command(move || {
                        let results = search::walk(&root, &query, hidden, &cancel);
                        Cmd::SearchResults(cancel, results)
                    });
                }
            }
            Msg::SearchOpened => {
                // Otherwise Ctrl+F already chose recursive mode.
                if self.search_mode == SearchMode::Off {
                    self.search_mode = SearchMode::Filter;
                    self.search_entry.set_placeholder_text(Some("Filter"));
                }
            }
            Msg::SearchClosed => {
                let restore = self.showing_results;
                self.reset_search();
                if restore {
                    sender.output(Output::Reload).ok();
                } else {
                    self.entries.view.grab_focus();
                }
            }
        }
    }

    fn update_cmd(&mut self, cmd: Cmd, _: ComponentSender<Self>, _: &Self::Root) {
        let Cmd::SearchResults(cancel, results) = cmd;
        if self
            .search_cancel
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &cancel))
        {
            self.search_cancel = None;
            self.search_status.set_visible(false);
            self.entries.clear();
            self.entries.extend_from_iter(results);
            self.showing_results = true;
        }
    }
}

impl FileList {
    /// The selected entries, in list order. Search results carry their real `path`; their
    /// `name` is relative to the searched folder.
    pub fn selected(&self) -> Vec<Entry> {
        let selection = self.entries.selection_model.selection();
        (0..selection.size())
            .filter_map(|i| self.entries.get_visible(selection.nth(i as u32)))
            .map(|item| item.borrow().clone())
            .collect()
    }

    fn set_filter(&self, query: &str) {
        *self.filter_query.borrow_mut() = query.to_owned();
        self.entries.notify_filter_changed(FILTER_QUERY);
    }

    /// Leaves search: cancels a running walk and clears the filter. The listing and the
    /// search bar's open state are the caller's to handle.
    fn reset_search(&mut self) {
        if let Some(cancel) = self.search_cancel.take() {
            cancel.store(true, Ordering::Relaxed);
        }
        self.set_filter("");
        self.search_mode = SearchMode::Off;
        self.search_status.set_visible(false);
        self.search_entry.set_text("");
        self.showing_results = false;
    }
}

/// Makes a row draggable (the selection, or just this row if it is not selected), and a
/// folder row a drop target.
fn setup_row(item: &gtk::ListItem, output: &relm4::Sender<Output>) {
    let Some(root) = item.child() else {
        return;
    };
    let weak = item.downgrade();
    let drag = gtk::DragSource::new();
    drag.set_actions(gdk::DragAction::COPY | gdk::DragAction::MOVE);
    drag.connect_prepare(move |source, _, _| {
        let item = weak.upgrade()?;
        let widget = source.widget()?;
        Some(dnd::files_provider(&drag_paths(&item, &widget)?))
    });
    root.add_controller(drag);

    let weak = item.downgrade();
    let output = output.clone();
    root.add_controller(dnd::file_drop_target(move |sources, cut| {
        // Only folder rows take drops; elsewhere the list's own target takes them.
        let Some(entry) = weak.upgrade().as_ref().and_then(list_item_entry) else {
            return false;
        };
        if entry.is_dir {
            output.emit(Output::Paste {
                sources,
                dest: Some(entry.path),
                cut,
            });
        }
        entry.is_dir
    }));
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
