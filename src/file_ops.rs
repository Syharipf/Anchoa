//! Manual file operations (trash, rename, new folder) and undo, from the UI side.
//!
//! Every operation is an [`ActionPlan`] that takes the same road as a typed command:
//! validated on a worker thread, confirmed in a dialog when destructive, executed on a worker
//! thread, and recorded in the history so it can be undone.
//!
//! ```text
//! Msg::Submit(job, plan) -> [worker] validate -> Cmd::Validated
//!   -> confirm dialog (trash, undo) -> Msg::Run(job, plan) -> [worker] execute + record -> Cmd::Ran
//! ```

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use loom::command::Preview;
use loom::executor::{self, ItemStatus};
use loom::history::{self, ResolvedBy, Skipped, Source};
use loom::plan::{Action, ActionPlan};
use loom::validator::{Rejection, ValidatedPlan, Validator};
use relm4::adw::prelude::*;
use relm4::{Sender, adw, gtk};

pub type Db = Arc<Mutex<rusqlite::Connection>>;

/// What a plan is for: decides the confirmation dialog and the result message.
#[derive(Debug, Clone)]
pub enum Job {
    Trash,
    Command {
        input: String,
        preview: Preview,
    },
    /// Move items from the trash back to where they were trashed from.
    Restore,
    Rename,
    NewFolder,
    Undo {
        operation_id: i64,
        skipped: Vec<Skipped>,
    },
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// The trees any plan may touch: home, udisks2 mounts and manual mounts.
fn validator() -> Validator {
    Validator::new([
        gtk::glib::home_dir(),
        PathBuf::from("/run/media"),
        PathBuf::from("/mnt"),
    ])
}

/// Worker thread.
pub fn validate(plan: ActionPlan) -> Result<ValidatedPlan, Vec<Rejection>> {
    validator().validate(plan)
}

/// Worker thread: executes `plan` and records it, or for an undo, marks the original
/// operation undone once every step succeeded. History problems never stop the operation
/// itself; they come back as the warning.
pub fn run(db: Option<&Db>, job: &Job, plan: &ValidatedPlan) -> (Vec<ItemStatus>, Option<String>) {
    let conn = db.map(|db| db.lock().unwrap_or_else(|poisoned| poisoned.into_inner()));
    if let Job::Undo { operation_id, .. } = job {
        let statuses = executor::execute(plan, |_| true);
        let all_done = statuses
            .iter()
            .all(|s| matches!(s, ItemStatus::Done { .. }));
        let warning = match &conn {
            Some(conn) if all_done => history::mark_undone(conn, *operation_id)
                .err()
                .map(|e| e.to_string()),
            _ => None,
        };
        return (statuses, warning);
    }
    let source = match job {
        Job::Command { .. } => Source::Rule,
        _ => Source::Manual,
    };
    let id = conn
        .as_ref()
        .map(|conn| history::begin(conn, plan, source, now()));
    let statuses = executor::execute(plan, |_| true);
    let mut warning = match (&conn, id.as_ref()) {
        (Some(conn), Some(Ok(id))) => history::finish(conn, *id, &statuses, now())
            .err()
            .map(|e| e.to_string()),
        (_, Some(Err(err))) => Some(err.to_string()),
        _ => Some("history is unavailable, so this cannot be undone".into()),
    };
    if let (Some(conn), Some(Ok(id)), Job::Command { input, .. }) = (&conn, id.as_ref(), job)
        && let Err(err) =
            history::record_command(conn, input, ResolvedBy::Rule, Some(1.0), Some(*id), now())
    {
        warning = Some(match warning {
            Some(warning) => format!("{warning}; {err}"),
            None => err.to_string(),
        });
    }
    (statuses, warning)
}

/// The latest operation's undo job and its validated plan, or `None` if nothing is left.
pub type UndoPlanned = Result<Option<(Job, Result<ValidatedPlan, Vec<Rejection>>)>, String>;

/// Worker thread: the undo plan for the latest operation, already validated.
pub fn plan_undo(db: &Db) -> UndoPlanned {
    let conn = db.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let undo = history::plan_undo(&conn).map_err(|e| e.to_string())?;
    Ok(undo.map(|undo| {
        let job = Job::Undo {
            operation_id: undo.operation_id,
            skipped: undo.skipped,
        };
        (job, validate(undo.plan))
    }))
}

/// One line for the toast after `job` ran.
pub fn summary(job: &Job, statuses: &[ItemStatus]) -> String {
    if let Some(ItemStatus::Failed(err)) =
        statuses.iter().find(|s| matches!(s, ItemStatus::Failed(_)))
    {
        return format!("Failed: {err}");
    }
    let done = statuses
        .iter()
        .filter(|s| matches!(s, ItemStatus::Done { .. }))
        .count();
    match job {
        Job::Trash => format!("Moved {} to trash", items(done)),
        Job::Command { .. } => format!("Done: {}", items(done)),
        Job::Restore => format!("Restored {}", items(done)),
        Job::Rename => "Renamed".into(),
        Job::NewFolder => "Folder created".into(),
        Job::Undo { .. } => "Undone".into(),
    }
}

fn items(n: usize) -> String {
    if n == 1 {
        "1 item".into()
    } else {
        format!("{n} items")
    }
}

/// A file or folder name the user typed: not empty, not `.`/`..`, no `/`.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains('/')
}

/// Asks to confirm `plan` for `job` (trash and undo only), then sends `on_confirm`.
pub fn confirm<M: Send + 'static>(
    root: &adw::ApplicationWindow,
    job: &Job,
    plan: &ActionPlan,
    sender: Sender<M>,
    on_confirm: M,
) {
    let (heading, confirm_label, mut lines) = match job {
        Job::Trash => (
            format!("Move {} to trash?", items(plan.actions.len())),
            "Move to Trash",
            plan.actions.iter().map(describe).collect::<Vec<_>>(),
        ),
        Job::Command { input, preview } => {
            let mut lines = vec![format!(
                "{}, {}",
                items(preview.items),
                gtk::glib::format_size(preview.bytes)
            )];
            lines.extend(
                preview
                    .new_dirs
                    .iter()
                    .map(|dir| format!("Creates {}", dir.display())),
            );
            lines.extend(plan.actions.iter().map(describe));
            (format!("Run: {input}?"), "Run", lines)
        }
        Job::Undo { skipped, .. } => {
            let mut lines: Vec<_> = plan.actions.iter().map(describe).collect();
            lines.extend(
                skipped
                    .iter()
                    .map(|s| format!("Skipped {}: {}", s.path.display(), s.reason)),
            );
            let label = if plan.actions.is_empty() {
                "Forget It"
            } else {
                "Undo"
            };
            ("Undo the last operation?".to_string(), label, lines)
        }
        // Explicit already: a dialog asked for the name, or the user pressed Restore.
        Job::Restore | Job::Rename | Job::NewFolder => return sender.emit(on_confirm),
    };
    shorten(&mut lines);
    let dialog = adw::AlertDialog::new(Some(&heading), Some(&lines.join("\n")));
    dialog.add_response("cancel", "Cancel");
    dialog.add_response("confirm", confirm_label);
    let appearance = match job {
        Job::Trash => adw::ResponseAppearance::Destructive,
        Job::Command { .. }
            if plan
                .actions
                .iter()
                .any(|action| matches!(action, Action::Trash { .. })) =>
        {
            adw::ResponseAppearance::Destructive
        }
        _ => adw::ResponseAppearance::Suggested,
    };
    dialog.set_response_appearance("confirm", appearance);
    dialog.set_default_response(Some("confirm"));
    dialog.set_close_response("cancel");
    dialog.choose(Some(root), gtk::gio::Cancellable::NONE, move |response| {
        if response == "confirm" {
            sender.emit(on_confirm);
        }
    });
}

/// Asks for a name, prefilled with `initial` and its stem selected, then sends
/// `on_name(name)`. Confirming is disabled while the name is invalid, or unchanged when
/// `require_change` (a rename to the same name does nothing).
pub fn ask_name<M: Send + 'static>(
    root: &adw::ApplicationWindow,
    heading: &str,
    confirm_label: &str,
    initial: &str,
    require_change: bool,
    sender: Sender<M>,
    on_name: impl FnOnce(String) -> M + 'static,
) {
    let entry = gtk::Entry::builder()
        .text(initial)
        .activates_default(true)
        .build();
    // Select the name without its extension, like other file managers.
    let stem = match initial.rfind('.') {
        Some(dot) if dot > 0 => initial[..dot].chars().count(),
        _ => initial.chars().count(),
    } as i32;
    entry.connect_map(move |entry| {
        entry.grab_focus();
        entry.select_region(0, stem);
    });
    let dialog = adw::AlertDialog::new(Some(heading), None);
    dialog.set_extra_child(Some(&entry));
    dialog.add_response("cancel", "Cancel");
    dialog.add_response("confirm", confirm_label);
    dialog.set_response_appearance("confirm", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("confirm"));
    dialog.set_close_response("cancel");
    // Only a valid, changed name can be confirmed.
    let initial = initial.to_owned();
    let usable = {
        let initial = initial.clone();
        move |name: &str| valid_name(name) && !(require_change && name == initial)
    };
    dialog.set_response_enabled("confirm", usable(&initial));
    {
        let (dialog, usable) = (dialog.clone(), usable.clone());
        entry.connect_changed(move |entry| {
            dialog.set_response_enabled("confirm", usable(entry.text().trim()));
        });
    }
    dialog.choose(Some(root), gtk::gio::Cancellable::NONE, move |response| {
        let name = entry.text().trim().to_owned();
        if response == "confirm" && usable(&name) {
            sender.emit(on_name(name));
        }
    });
}

/// Worker thread: a validated plan restoring `files` from the trash (all of it for `None`),
/// and how many of `files` were not in the trash any more.
pub fn plan_restore(
    files: Option<Vec<PathBuf>>,
) -> Result<(Result<ValidatedPlan, Vec<Rejection>>, usize), String> {
    let items = loom::trash::contents().map_err(|e| e.to_string())?;
    let (plan, missing) = loom::trash::restore_plan(&items, files.as_deref());
    Ok((validate(plan), missing.len()))
}

/// Asks before deleting trash items for good (`files`, or the whole trash for `None`), then
/// sends `on_confirm`.
pub fn confirm_delete<M: Send + 'static>(
    root: &adw::ApplicationWindow,
    files: Option<&[PathBuf]>,
    sender: Sender<M>,
    on_confirm: M,
) {
    let (heading, body, label) = match files {
        None => (
            "Empty the trash?".to_string(),
            "Everything in the trash, on every drive, is deleted for good.".to_string(),
            "Empty Trash",
        ),
        Some(files) => {
            let mut lines: Vec<_> = files
                .iter()
                .map(|f| {
                    f.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned()
                })
                .collect();
            shorten(&mut lines);
            let heading = format!("Delete {} for good?", items(files.len()));
            (heading, lines.join("\n"), "Delete")
        }
    };
    let body = format!("{body}\n\nThis cannot be undone.");
    let dialog = adw::AlertDialog::new(Some(&heading), Some(&body));
    dialog.add_response("cancel", "Cancel");
    dialog.add_response("empty", label);
    dialog.set_response_appearance("empty", adw::ResponseAppearance::Destructive);
    // Deleting for good is never the default answer.
    dialog.set_default_response(Some("cancel"));
    dialog.set_close_response("cancel");
    dialog.choose(Some(root), gtk::gio::Cancellable::NONE, move |response| {
        if response == "empty" {
            sender.emit(on_confirm);
        }
    });
}

/// Shows why the Validator refused a plan.
pub fn show_rejections(root: &adw::ApplicationWindow, rejections: &[Rejection]) {
    let mut lines: Vec<_> = rejections
        .iter()
        .map(|r| format!("{}: {}", r.path.display(), r.reason))
        .collect();
    shorten(&mut lines);
    let dialog = adw::AlertDialog::new(Some("This cannot be done"), Some(&lines.join("\n")));
    dialog.add_response("close", "Close");
    dialog.present(Some(root));
}

fn describe(action: &Action) -> String {
    match action {
        Action::Move { src, dst } | Action::Rename { src, dst } => {
            format!("{} → {}", src.display(), dst.display())
        }
        Action::Copy { src, dst } => format!("copy {} → {}", src.display(), dst.display()),
        Action::Trash { path } => path.display().to_string(),
        Action::Mkdir { path } => format!("new folder {}", path.display()),
        Action::Chmod { path, mode } => format!("{} → {mode:o}", path.display()),
    }
}

/// Keeps a dialog readable: at most 10 lines plus a count of the rest.
fn shorten(lines: &mut Vec<String>) {
    const MAX: usize = 10;
    if lines.len() > MAX {
        let rest = lines.len() - MAX;
        lines.truncate(MAX);
        lines.push(format!("…and {rest} more"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_names() {
        for ok in ["a", "New Folder", ".hidden", "a.b.c", "…"] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in ["", ".", "..", "a/b", "/"] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn summary_reports_first_failure_or_count() {
        let done = ItemStatus::Done { dst: None };
        assert_eq!(
            summary(&Job::Trash, &[done.clone(), done.clone()]),
            "Moved 2 items to trash"
        );
        assert_eq!(
            summary(&Job::Trash, std::slice::from_ref(&done)),
            "Moved 1 item to trash"
        );
        assert_eq!(
            summary(
                &Job::Trash,
                &[
                    done,
                    ItemStatus::Failed("disk full".into()),
                    ItemStatus::Pending
                ]
            ),
            "Failed: disk full"
        );
    }

    #[test]
    fn shorten_caps_at_ten_lines() {
        let mut lines: Vec<_> = (0..13).map(|i| i.to_string()).collect();
        shorten(&mut lines);
        assert_eq!(lines.len(), 11);
        assert_eq!(lines[10], "…and 3 more");
    }
}
