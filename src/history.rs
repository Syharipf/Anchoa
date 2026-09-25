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

use std::collections::HashSet;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};

use crate::db::DbError;
use crate::executor::ItemStatus;
use crate::plan::{Action, ActionPlan};
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
    let actions = &plan.plan().actions;
    let op_kind = actions
        .iter()
        .find(|a| !matches!(a, Action::Mkdir { .. }))
        .map_or("mkdir", |a| kind_str(a));

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO operation (kind, source, status, created_at) VALUES (?1, ?2, 'running', ?3)",
        params![op_kind, source_str(source), now],
    )?;
    let operation_id = tx.last_insert_rowid();

    for (seq, action) in actions.iter().enumerate() {
        let (src, dst) = paths(action);
        // Only a chmod has a "before" state worth capturing; it is gone once it runs.
        let (mode_before, mode_after) = match action {
            Action::Chmod { path, mode } => {
                let current = std::fs::metadata(path)?.permissions().mode() & 0o777;
                (Some(current as i64), Some(*mode as i64))
            }
            _ => (None, None),
        };
        tx.execute(
            "INSERT INTO operation_item
                (operation_id, seq, kind, status, src_path, dst_path, mode_before, mode_after)
             VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7)",
            params![
                operation_id,
                seq as i64,
                kind_str(action),
                src.to_string_lossy(),
                dst.map(|d| d.to_string_lossy().into_owned()),
                mode_before,
                mode_after,
            ],
        )?;
    }
    tx.commit()?;
    Ok(operation_id)
}

/// The whitelisted `operation`/`operation_item` kind string for one action.
fn kind_str(action: &Action) -> &'static str {
    match action {
        Action::Move { .. } => "move",
        Action::Copy { .. } => "copy",
        Action::Trash { .. } => "trash",
        Action::Rename { .. } => "rename",
        Action::Mkdir { .. } => "mkdir",
        Action::Chmod { .. } => "chmod",
    }
}

fn source_str(source: Source) -> &'static str {
    match source {
        Source::Manual => "manual",
        Source::Rule => "rule",
        Source::Llm => "llm",
    }
}

/// `(src_path, dst_path)` as stored: the single path for actions with only one, `src`/`dst`
/// for the three that move data between two.
fn paths(action: &Action) -> (&Path, Option<&Path>) {
    match action {
        Action::Move { src, dst } | Action::Copy { src, dst } | Action::Rename { src, dst } => {
            (src.as_path(), Some(dst.as_path()))
        }
        Action::Trash { path } | Action::Mkdir { path } | Action::Chmod { path, .. } => {
            (path.as_path(), None)
        }
    }
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
    let tx = conn.unchecked_transaction()?;
    let mut any_failed = false;
    let mut any_pending = false;
    let mut any_done = false;

    for (seq, status) in statuses.iter().enumerate() {
        let seq = seq as i64;
        match status {
            ItemStatus::Done { dst } => {
                any_done = true;
                if let Some(dst) = dst {
                    tx.execute(
                        "UPDATE operation_item SET dst_path = ?1 WHERE operation_id = ?2 AND seq = ?3",
                        params![dst.to_string_lossy(), operation_id, seq],
                    )?;
                }
                let (kind, src_path, dst_path): (String, String, Option<String>) = tx.query_row(
                    "SELECT kind, src_path, dst_path FROM operation_item
                     WHERE operation_id = ?1 AND seq = ?2",
                    params![operation_id, seq],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )?;
                if kind == "trash" {
                    tx.execute(
                        "UPDATE operation_item SET status = 'done', trashed_at = ?1
                         WHERE operation_id = ?2 AND seq = ?3",
                        params![now, operation_id, seq],
                    )?;
                } else {
                    // move/copy/rename land at dst_path; mkdir/chmod act on src_path in place.
                    let after_path = dst_path.unwrap_or(src_path);
                    match std::fs::symlink_metadata(&after_path) {
                        Ok(meta) => tx.execute(
                            "UPDATE operation_item SET status = 'done', size = ?1, mtime_after = ?2
                             WHERE operation_id = ?3 AND seq = ?4",
                            params![meta.size() as i64, meta.mtime(), operation_id, seq],
                        )?,
                        Err(_) => tx.execute(
                            "UPDATE operation_item SET status = 'done'
                             WHERE operation_id = ?1 AND seq = ?2",
                            params![operation_id, seq],
                        )?,
                    };
                }
            }
            ItemStatus::Skipped => {
                tx.execute(
                    "UPDATE operation_item SET status = 'skipped' WHERE operation_id = ?1 AND seq = ?2",
                    params![operation_id, seq],
                )?;
            }
            ItemStatus::Failed(message) => {
                any_failed = true;
                tx.execute(
                    "UPDATE operation_item SET status = 'failed', error = ?1
                     WHERE operation_id = ?2 AND seq = ?3",
                    params![message, operation_id, seq],
                )?;
            }
            ItemStatus::Pending => any_pending = true,
        }
    }

    let op_status = if !any_failed && !any_pending {
        "done"
    } else if any_done {
        "partial"
    } else {
        "failed"
    };
    tx.execute(
        "UPDATE operation SET status = ?1 WHERE id = ?2",
        params![op_status, operation_id],
    )?;
    tx.commit()?;
    Ok(())
}

/// Undo for the latest operation that is `done` or `partial`, or `None` if there is none.
pub fn plan_undo(conn: &Connection) -> Result<Option<UndoPlan>, DbError> {
    let operation_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM operation WHERE status IN ('done', 'partial')
             ORDER BY created_at DESC, id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let Some(operation_id) = operation_id else {
        return Ok(None);
    };

    let mut stmt = conn.prepare(
        "SELECT kind, src_path, dst_path, mode_before, mode_after, size, mtime_after
         FROM operation_item WHERE operation_id = ?1 AND status = 'done' ORDER BY seq DESC",
    )?;
    let items = stmt
        .query_map([operation_id], |r| {
            Ok(DoneItem {
                kind: r.get(0)?,
                src_path: PathBuf::from(r.get::<_, String>(1)?),
                dst_path: r.get::<_, Option<String>>(2)?.map(PathBuf::from),
                mode_before: r.get(3)?,
                mode_after: r.get(4)?,
                size: r.get(5)?,
                mtime_after: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Paths that an already-added undo action removes from disk (moved away or trashed);
    // a `mkdir` is only "empty once this undo has run" if every entry it currently holds is
    // one of these. Items are walked in reverse `seq`, so the moves out of a folder are
    // always added before the `mkdir` that created it.
    let mut removed: HashSet<PathBuf> = HashSet::new();
    let mut actions = Vec::new();
    let mut skipped = Vec::new();

    for item in items {
        match item.kind.as_str() {
            "move" | "rename" => {
                let at = item
                    .dst_path
                    .clone()
                    .expect("move/rename item has dst_path");
                let orig = item.src_path.clone();
                if !matches_recorded(&at, item.size, item.mtime_after) {
                    skipped.push(Skipped {
                        path: at,
                        reason: SkipReason::Changed,
                    });
                } else if std::fs::symlink_metadata(&orig).is_ok() {
                    skipped.push(Skipped {
                        path: at,
                        reason: SkipReason::OriginalTaken,
                    });
                } else {
                    removed.insert(at.clone());
                    actions.push(if item.kind == "rename" {
                        Action::Rename { src: at, dst: orig }
                    } else {
                        Action::Move { src: at, dst: orig }
                    });
                }
            }
            "copy" => {
                let at = item.dst_path.clone().expect("copy item has dst_path");
                if !matches_recorded(&at, item.size, item.mtime_after) {
                    skipped.push(Skipped {
                        path: at,
                        reason: SkipReason::Changed,
                    });
                } else {
                    removed.insert(at.clone());
                    actions.push(Action::Trash { path: at });
                }
            }
            "chmod" => {
                let path = item.src_path.clone();
                let mode_after = item.mode_after.expect("chmod item has mode_after") as u32;
                let current = std::fs::metadata(&path)
                    .ok()
                    .map(|m| m.permissions().mode() & 0o777);
                if current != Some(mode_after) {
                    skipped.push(Skipped {
                        path,
                        reason: SkipReason::Changed,
                    });
                } else {
                    let mode_before = item.mode_before.expect("chmod item has mode_before") as u32;
                    actions.push(Action::Chmod {
                        path,
                        mode: mode_before,
                    });
                }
            }
            "trash" => skipped.push(Skipped {
                path: item.src_path.clone(),
                reason: SkipReason::TrashNotSupported,
            }),
            "mkdir" => {
                let path = item.src_path.clone();
                let empty_once_undone = std::fs::metadata(&path)
                    .ok()
                    .filter(|m| m.is_dir())
                    .and_then(|_| std::fs::read_dir(&path).ok())
                    .and_then(|entries| {
                        entries
                            .map(|e| e.map(|e| e.path()))
                            .collect::<Result<Vec<_>, _>>()
                            .ok()
                    })
                    .map(|entries| entries.iter().all(|p| removed.contains(p)));
                match empty_once_undone {
                    Some(true) => {
                        removed.insert(path.clone());
                        actions.push(Action::Trash { path });
                    }
                    Some(false) => skipped.push(Skipped {
                        path,
                        reason: SkipReason::NotEmpty,
                    }),
                    None => skipped.push(Skipped {
                        path,
                        reason: SkipReason::Changed,
                    }),
                }
            }
            other => unreachable!("operation_item.kind is whitelisted by the schema: {other}"),
        }
    }

    Ok(Some(UndoPlan {
        operation_id,
        plan: ActionPlan {
            actions,
            on_conflict: None,
        },
        skipped,
    }))
}

/// One `operation_item` row with status `done`, as needed to plan its undo.
struct DoneItem {
    kind: String,
    src_path: PathBuf,
    dst_path: Option<PathBuf>,
    mode_before: Option<i64>,
    mode_after: Option<i64>,
    size: Option<i64>,
    mtime_after: Option<i64>,
}

/// Whether `path` still has the size and mtime recorded when the item finished.
fn matches_recorded(path: &Path, size: Option<i64>, mtime_after: Option<i64>) -> bool {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return false;
    };
    Some(meta.size() as i64) == size && Some(meta.mtime()) == mtime_after
}

/// Marks the operation `undone`, so the next [`plan_undo`] moves on to the one before.
pub fn mark_undone(conn: &Connection, operation_id: i64) -> Result<(), DbError> {
    conn.execute(
        "UPDATE operation SET status = 'undone' WHERE id = ?1",
        [operation_id],
    )?;
    Ok(())
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
