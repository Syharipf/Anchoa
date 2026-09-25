//! Command panel: the entry under the file list, its error line and command recall.
//!
//! It only parses (cheap, on the UI thread) and shows problems. Planning against the
//! active folder, recording to the database and running are the app's job: the panel
//! reports a parsed command or an unrecognized one through [`Output`].

use anchoa::command::{self, Recall};
use anchoa::parser::{self, Command};
use relm4::gtk;
use relm4::gtk::prelude::*;
use relm4::prelude::*;

pub struct CommandPanel {
    entry: gtk::Entry,
    error: gtk::Label,
    recall: Recall,
}

#[derive(Debug)]
pub enum Msg {
    /// Ctrl+K: move keyboard focus here.
    Focus,
    /// The recorded commands, newest first, for Up/Down.
    SetRecent(Vec<String>),
    /// `input` ran without a failed item: clear the entry if it still shows it.
    Ran(String),
    /// Internal: Enter pressed.
    Activate,
    /// Internal: the text changed.
    Changed,
    /// Internal: Up / Down pressed.
    Up,
    Down,
}

#[derive(Debug)]
pub enum Output {
    Parsed {
        input: String,
        command: Command,
    },
    /// Not a command; the panel already shows why, with examples.
    Unrecognized(String),
    /// Esc: give focus back to the file list.
    Leave,
}

#[relm4::component(pub)]
impl SimpleComponent for CommandPanel {
    type Init = ();
    type Input = Msg;
    type Output = Output;

    view! {
        gtk::Box {
            set_orientation: gtk::Orientation::Vertical,

            #[local_ref]
            entry -> gtk::Entry {
                set_placeholder_text: Some("move *.jpg older than 30d to ~/Pictures/old"),
                set_hexpand: true,
                set_margin_start: 6,
                set_margin_end: 6,
                set_margin_top: 6,
                connect_activate => Msg::Activate,
                connect_changed => Msg::Changed,
            },

            #[local_ref]
            error -> gtk::Label {
                set_xalign: 0.0,
                set_wrap: true,
                set_visible: false,
                set_margin_start: 6,
                set_margin_end: 6,
                set_margin_bottom: 4,
            },
        }
    }

    fn init(_: (), root: Self::Root, sender: ComponentSender<Self>) -> ComponentParts<Self> {
        let model = CommandPanel {
            entry: gtk::Entry::new(),
            error: gtk::Label::new(None),
            recall: Recall::default(),
        };
        let entry = &model.entry;
        let error = &model.error;
        let widgets = view_output!();

        let shortcuts = gtk::ShortcutController::new();
        let input = sender.input_sender().clone();
        shortcuts.add_shortcut(shortcut("Up", move || input.emit(Msg::Up)));
        let input = sender.input_sender().clone();
        shortcuts.add_shortcut(shortcut("Down", move || input.emit(Msg::Down)));
        let output = sender.output_sender().clone();
        shortcuts.add_shortcut(shortcut("Escape", move || output.emit(Output::Leave)));
        model.entry.add_controller(shortcuts);

        ComponentParts { model, widgets }
    }

    fn update(&mut self, msg: Msg, sender: ComponentSender<Self>) {
        match msg {
            Msg::Focus => {
                self.entry.grab_focus();
            }
            Msg::SetRecent(items) => self.recall = Recall::new(items),
            Msg::Ran(input) => {
                if self.entry.text().as_str() == input {
                    self.entry.set_text("");
                }
            }
            Msg::Changed => self.show_error(None),
            Msg::Up => {
                let text = self.recall.up(self.entry.text().as_str());
                self.recall_to(text);
            }
            Msg::Down => {
                let text = self.recall.down();
                self.recall_to(text);
            }
            Msg::Activate => {
                let input = self.entry.text().to_string();
                match parser::parse(&input) {
                    Ok(command) => {
                        self.show_error(None);
                        sender.output(Output::Parsed { input, command }).ok();
                    }
                    Err(err) => {
                        let examples = command::examples(&input).join("\n");
                        self.show_error(Some(&format!("{err}\n{examples}")));
                        sender.output(Output::Unrecognized(input)).ok();
                    }
                }
            }
        }
    }
}

fn shortcut(accel: &str, action: impl Fn() + 'static) -> gtk::Shortcut {
    gtk::Shortcut::new(
        gtk::ShortcutTrigger::parse_string(accel),
        Some(gtk::CallbackAction::new(move |_, _| {
            action();
            gtk::glib::Propagation::Stop
        })),
    )
}

impl CommandPanel {
    fn show_error(&self, text: Option<&str>) {
        self.error.set_text(text.unwrap_or_default());
        self.error.set_visible(text.is_some());
    }

    fn recall_to(&self, text: Option<String>) {
        if let Some(text) = text {
            self.entry.set_text(&text);
            self.entry.set_position(text.chars().count() as i32);
        }
    }
}
