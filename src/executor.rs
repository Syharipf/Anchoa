//! Executor: carries out a [`ValidatedPlan`] on disk, one action at a time.
//!
//! Blocking file I/O: call from a worker thread only.
//!
//! Guarantees (PRD §6.4):
//! - The batch stops at the first failure; later actions stay [`ItemStatus::Pending`].
//! - Copies are written to `.loom-partial-<name>` next to the destination and renamed into
//!   place only when complete; a failed copy removes its partial file or folder, so no
//!   half-written item ever carries the real name.
//! - A move across filesystems removes the source only after the copy has completed.
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

use std::path::PathBuf;

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

/// Runs `plan` in order. `keep_going(i)` is called before action `i`; returning `false`
/// cancels the rest, which stay `Pending`.
pub fn execute(plan: &ValidatedPlan, keep_going: impl FnMut(usize) -> bool) -> Vec<ItemStatus> {
    let _ = (plan, keep_going);
    todo!()
}
