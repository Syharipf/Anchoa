//! Operation history: records executed plans and builds their undo (PRD §4.9, §6.5).
//!
//! Recording is two-phase so a crash mid-batch leaves an honest trail: [`begin`] stores the
//! operation as `running` with every item `pending` (capturing what only exists before
//! execution, like a chmod's old mode), and [`finish`] stores each item's outcome and the
//! "after" state that undo later checks against the disk.
//!
//! Undo never touches the disk itself. [`plan_undo`] returns an ordinary [`ActionPlan`]
//! that goes through preview, the Validator and the executor like any other plan; once it
//! ran, [`mark_undone`] closes the operation. Inverses, applied in reverse item order:
//!
//! | done item      | undo                                                          |
//! |----------------|---------------------------------------------------------------|
//! | move / rename  | move / rename back                                            |
//! | copy           | trash the copy                                                |
//! | chmod          | chmod back to the old mode                                    |
//! | mkdir          | trash the folder, if it is empty once this undo has run       |
//! | trash          | not supported yet: restore it from the system trash           |
//!
//! An item is only undone if its "after" state still matches the disk: the item at the
//! destination has the recorded size and mtime (mode for chmod), and for move/rename the
//! original path is free. Otherwise it is skipped and reported.
// ponytail: trash undo needs trash:// lookup by original path + deletion date, which is an
// open question under Flatpak (PRD §10); add it once that is settled.

use std::path::PathBuf;

use rusqlite::Connection;

use crate::db::DbError;
use crate::executor::ItemStatus;
use crate::plan::ActionPlan;
use crate::validator::ValidatedPlan;

/// Who produced the plan; stored in `operation.source`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Manual,
    Rule,
    Llm,
}

/// Stores `plan` as a `running` operation with all items `pending`, before it executes.
/// `operation.kind` is the first action's kind that is not `mkdir` (or `mkdir` if all are).
/// Returns the operation id.
pub fn begin(
    conn: &Connection,
    plan: &ValidatedPlan,
    source: Source,
    now: i64,
) -> Result<i64, DbError> {
    let _ = (conn, plan, source, now);
    todo!()
}

/// Stores the outcome of each item (`statuses` in plan order, as returned by the
/// executor) and sets the operation to `done` (nothing failed or left pending), `partial`
/// (something done, something not) or `failed` (nothing done). `now` is the trash time.
pub fn finish(
    conn: &Connection,
    operation_id: i64,
    statuses: &[ItemStatus],
    now: i64,
) -> Result<(), DbError> {
    let _ = (conn, operation_id, statuses, now);
    todo!()
}

/// Undo for the latest operation that is `done` or `partial`, or `None` if there is none.
pub fn plan_undo(conn: &Connection) -> Result<Option<UndoPlan>, DbError> {
    let _ = conn;
    todo!()
}

/// Marks the operation `undone`, so the next [`plan_undo`] moves on to the one before.
pub fn mark_undone(conn: &Connection, operation_id: i64) -> Result<(), DbError> {
    let _ = (conn, operation_id);
    todo!()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UndoPlan {
    pub operation_id: i64,
    /// Possibly empty, when every item was skipped. `on_conflict` is always `None`.
    pub plan: ActionPlan,
    /// Items that cannot be undone, in reverse item order like the plan.
    pub skipped: Vec<Skipped>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skipped {
    /// The path as it would be touched by the undo (the destination for move/copy).
    pub path: PathBuf,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SkipReason {
    #[error("changed or gone since the operation")]
    Changed,
    #[error("something else is now at the original location")]
    OriginalTaken,
    #[error("folder is not empty")]
    NotEmpty,
    #[error("restore it from the trash instead")]
    TrashNotSupported,
}
