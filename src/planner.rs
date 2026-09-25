//! Planner: turns a parsed [`Command`] into a concrete [`ActionPlan`] for the active folder.
//!
//! Blocking file I/O (lists the selected folder): call from a worker thread only. The plan
//! still has to pass the Validator; the planner only expands the command, it never decides
//! whether something is allowed.
//!
//! Resolution:
//! - Paths (`in`, `to`, `mkdir`, a folder part in the glob) go through
//!   [`crate::fs::resolve_input`]: `~` is home, relative paths start at the active folder.
//! - The selection lists one folder, not recursively: the `in` folder, the folder part of
//!   the glob (`~/Downloads/*.tmp`), or else the active folder. Using both `in` and a folder
//!   part is an error.
//! - Globs support `*` and `?` and are case-sensitive. Like a shell, they do not match
//!   hidden names unless the pattern itself starts with `.`. No glob (only `files`/`dirs`)
//!   selects every entry that is not hidden.
//! - `older`/`newer than` compare the modification time with `now`; `larger`/`smaller
//!   than` compare the size and only ever match files, since a folder's own size says
//!   nothing about its contents.
//! - Entries keep the order of [`crate::fs::list_dir`] (folders first, then by name).
//!
//! Per command:
//! - `move`/`copy ... to FOLDER`: `FOLDER` is always a folder; each entry keeps its name
//!   inside it. A `Mkdir` for it comes first if it does not exist yet.
//! - `rename ... to NAME`: with one `*` in both the glob and `NAME`, the part the `*`
//!   matched carries over (`*.jpeg` to `*.jpg`). Without `*` in `NAME`, exactly one entry
//!   may match. Entries whose name would not change are left out.
//! - `trash`, `chmod`: one action per entry. `mkdir PATH`: one `Mkdir`.
//!
//! The plan has no conflict policy; the caller adds one if the user picks it.

use std::io;
use std::path::{Path, PathBuf};

use crate::parser::Command;
use crate::plan::ActionPlan;

#[derive(Debug, thiserror::Error)]
pub enum PlanError {
    #[error("cannot read {}: {source}", dir.display())]
    ListFailed { dir: PathBuf, source: io::Error },
    #[error("nothing in {} matches", dir.display())]
    NoMatch { dir: PathBuf },
    #[error("use either a folder in the pattern or `in`, not both")]
    TwoFolders,
    #[error("{0}")]
    Rename(&'static str),
}

/// Expands `command` against the disk. `now` is seconds since the Unix epoch.
pub fn build(
    command: &Command,
    cwd: &Path,
    home: &Path,
    now: i64,
) -> Result<ActionPlan, PlanError> {
    let _ = (command, cwd, home, now);
    todo!()
}
