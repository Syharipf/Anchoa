//! Executor: carries out a [`ValidatedPlan`] on disk, one action at a time.
//!
//! Blocking file I/O: call from a worker thread only.
//!
//! Guarantees (PRD §6.4):
//! - The batch stops at the first failure; later actions stay [`ItemStatus::Pending`].
//! - Copies are written to `.anchoa-partial-<name>` next to the destination and renamed into
//!   place only when complete; a failed copy removes its partial file or folder, so no
//!   half-written item ever carries the real name.
//! - A move across filesystems removes the source only after the copy has completed.
//! - Moving an item out of a trash folder restores it through gvfs (`trash:///`), which
//!   also removes its `.trashinfo`; see [`crate::trash`].
//! - Nothing is deleted permanently: trash and [`ConflictPolicy::Replace`] go through the
//!   XDG trash (`gio::File::trash`).
//! - An existing destination is never overwritten silently: if one appeared after
//!   validation and the plan has no conflict policy, the action fails.
//!
//! Per action:
//! - `Mkdir` creates missing parents too, but fails if the folder itself already exists.
//! - `Move`/`Copy`/`Rename` need the destination's parent folder to exist (the plan adds a
//!   `Mkdir` for it). Symlinks are copied as links, not followed.
//! - When the destination exists: `Skip` leaves both untouched, `Replace` trashes the
//!   existing item first, `KeepBoth` picks the first free `name (N).ext`, N ≥ 2.
//!
//! [`ConflictPolicy::Replace`]: crate::plan::ConflictPolicy::Replace

use std::ffi::OsString;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use relm4::gtk::gio;
use relm4::gtk::prelude::*;

use crate::plan::{Action, ConflictPolicy};
use crate::validator::ValidatedPlan;

/// Outcome of one action, in plan order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ItemStatus {
    /// `dst` is where a moved, copied or renamed item ended up (it differs from the plan
    /// under `KeepBoth`); `None` for the other actions.
    Done { dst: Option<PathBuf> },
    /// The destination existed and the policy was `Skip`.
    Skipped,
    /// Why it failed, for display.
    Failed(String),
    /// Not attempted: an earlier action failed or the batch was cancelled.
    Pending,
}

/// Counts of each [`ItemStatus`] outcome in a batch, for the progress dialog and toasts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tally {
    pub done: usize,
    pub skipped: usize,
    pub failed: usize,
    pub pending: usize,
}

impl Tally {
    /// Counts `statuses` by outcome.
    pub fn of(statuses: &[ItemStatus]) -> Self {
        let mut tally = Tally {
            done: 0,
            skipped: 0,
            failed: 0,
            pending: 0,
        };
        for status in statuses {
            match status {
                ItemStatus::Done { .. } => tally.done += 1,
                ItemStatus::Skipped => tally.skipped += 1,
                ItemStatus::Failed(_) => tally.failed += 1,
                ItemStatus::Pending => tally.pending += 1,
            }
        }
        tally
    }

    /// The batch stopped partway through: something finished and something didn't, whether
    /// from a failure or a cancel. Worth offering a rollback for; an all-or-nothing result
    /// (including one that never got anywhere) is not.
    pub fn is_partial(&self) -> bool {
        self.done > 0 && (self.failed > 0 || self.pending > 0)
    }
}

/// Runs `plan` in order. `keep_going(i)` is called before action `i`; returning `false`
/// cancels the rest, which stay `Pending`.
pub fn execute(plan: &ValidatedPlan, mut keep_going: impl FnMut(usize) -> bool) -> Vec<ItemStatus> {
    let plan = plan.plan();
    let mut statuses = vec![ItemStatus::Pending; plan.actions.len()];
    for (i, action) in plan.actions.iter().enumerate() {
        if !keep_going(i) {
            break;
        }
        statuses[i] =
            run(action, plan.on_conflict).unwrap_or_else(|err| ItemStatus::Failed(err.to_string()));
        if matches!(statuses[i], ItemStatus::Failed(_)) {
            break;
        }
    }
    statuses
}

fn run(action: &Action, policy: Option<ConflictPolicy>) -> io::Result<ItemStatus> {
    match action {
        Action::Mkdir { path } => {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::create_dir(path)?;
        }
        Action::Chmod { path, mode } => {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(*mode))?;
        }
        Action::Trash { path } => trash(path)?,
        Action::Move { src, dst } | Action::Rename { src, dst } => {
            return transfer(src, dst, policy, true);
        }
        Action::Copy { src, dst } => return transfer(src, dst, policy, false),
    }
    Ok(ItemStatus::Done { dst: None })
}

/// Copies `src` to `dst`, or moves it when `remove_source`, resolving a conflict at `dst`.
fn transfer(
    src: &Path,
    dst: &Path,
    policy: Option<ConflictPolicy>,
    remove_source: bool,
) -> io::Result<ItemStatus> {
    let src_is_dir = src.symlink_metadata()?.is_dir();
    // ponytail: check-then-rename leaves a tiny race; renameat2(RENAME_NOREPLACE) closes it
    // if it ever matters.
    let dst = match policy {
        _ if !exists(dst) => dst.to_path_buf(),
        None => return Err(already_exists(dst)),
        Some(ConflictPolicy::Skip) => return Ok(ItemStatus::Skipped),
        Some(ConflictPolicy::Replace) => {
            trash(dst)?;
            dst.to_path_buf()
        }
        Some(ConflictPolicy::KeepBoth) => free_name(dst, src_is_dir),
    };
    if remove_source && let Some(item) = crate::trash::item(src)? {
        // Out of the trash through gvfs, so its `.trashinfo` goes too.
        item.move_(
            &gio::File::for_path(&dst),
            gio::FileCopyFlags::NOFOLLOW_SYMLINKS,
            gio::Cancellable::NONE,
            None,
        )
        .map_err(|err| io::Error::other(err.message().to_owned()))?;
        return Ok(ItemStatus::Done { dst: Some(dst) });
    }
    if remove_source {
        match std::fs::rename(src, &dst) {
            Err(err) if err.kind() == io::ErrorKind::CrossesDevices => {}
            result => return result.map(|()| ItemStatus::Done { dst: Some(dst) }),
        }
    }
    copy_via_partial(src, &dst)?;
    if remove_source {
        // The copy is complete, so this is the second half of a move, not a delete.
        let removed = if src_is_dir {
            std::fs::remove_dir_all(src)
        } else {
            std::fs::remove_file(src)
        };
        removed.map_err(|err| {
            io::Error::new(
                err.kind(),
                format!(
                    "copied to {} but could not remove the source: {err}",
                    dst.display()
                ),
            )
        })?;
    }
    Ok(ItemStatus::Done { dst: Some(dst) })
}

/// Copies `src` into `.anchoa-partial-<name>` next to `dst`, then renames it into place.
/// On failure the partial copy is removed.
fn copy_via_partial(src: &Path, dst: &Path) -> io::Result<()> {
    let mut name = OsString::from(".anchoa-partial-");
    name.push(
        dst.file_name()
            .ok_or_else(|| io::Error::other("destination has no name"))?,
    );
    let partial = dst.with_file_name(name);
    // A leftover from a crashed run; it only ever holds our own incomplete copy.
    let _ = remove_any(&partial);
    let result = copy_tree(src, &partial).and_then(|()| {
        if exists(dst) {
            Err(already_exists(dst))
        } else {
            std::fs::rename(&partial, dst)
        }
    });
    if result.is_err() {
        let _ = remove_any(&partial);
    }
    result
}

/// Recursive copy that recreates symlinks as links and refuses special files (a FIFO
/// would block forever).
fn copy_tree(src: &Path, dst: &Path) -> io::Result<()> {
    let meta = src.symlink_metadata()?;
    if meta.is_symlink() {
        std::os::unix::fs::symlink(std::fs::read_link(src)?, dst)
    } else if meta.is_dir() {
        std::fs::create_dir(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_tree(&entry.path(), &dst.join(entry.file_name()))?;
        }
        // Last, so a read-only folder can still be filled.
        std::fs::set_permissions(dst, meta.permissions())
    } else if meta.is_file() {
        std::fs::copy(src, dst).map(drop)
    } else {
        Err(io::Error::other(format!(
            "{} is not a regular file, folder or symlink",
            src.display()
        )))
    }
}

/// First free `stem (N).ext` next to `dst`, N ≥ 2. Folders keep dots in their name.
fn free_name(dst: &Path, is_dir: bool) -> PathBuf {
    let (stem, ext) = match (is_dir, dst.file_stem(), dst.extension()) {
        (false, Some(stem), ext) => (stem, ext),
        _ => (dst.file_name().unwrap_or_default(), None),
    };
    (2..)
        .map(|n| {
            let mut name = stem.to_os_string();
            name.push(format!(" ({n})"));
            if let Some(ext) = ext {
                name.push(".");
                name.push(ext);
            }
            dst.with_file_name(name)
        })
        .find(|candidate| !exists(candidate))
        .expect("some suffix is free")
}

fn trash(path: &Path) -> io::Result<()> {
    gio::File::for_path(path)
        .trash(gio::Cancellable::NONE)
        .map_err(|err| io::Error::other(err.message().to_owned()))
}

fn remove_any(path: &Path) -> io::Result<()> {
    if path.symlink_metadata()?.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

/// Like `Path::exists`, but true for a broken symlink too.
fn exists(path: &Path) -> bool {
    path.symlink_metadata().is_ok()
}

fn already_exists(path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::AlreadyExists,
        format!("{} already exists", path.display()),
    )
}
