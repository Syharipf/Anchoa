//! Specification for operation recording and undo (PRD §4.9, §6.5).
//!
//! Real files under `CARGO_TARGET_TMPDIR` with a private `XDG_DATA_HOME`, as in
//! `tests/executor.rs`.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Once;

use anchoa::executor::{ItemStatus, execute};
use anchoa::history::{self, ResolvedBy, SkipReason, Skipped, Source, UndoPlan};
use anchoa::plan::{Action, ActionPlan, ConflictPolicy};
use anchoa::trash::Trashed;
use anchoa::validator::{ValidatedPlan, Validator};
use rusqlite::Connection;

const NOW: i64 = 1_800_000_000;

fn init() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let data = Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("history-xdg-{}", std::process::id()));
        std::fs::create_dir_all(&data).unwrap();
        // SAFETY: runs once, before any test reads the environment through glib; the other
        // test threads are blocked in `call_once` until it returns.
        unsafe { std::env::set_var("XDG_DATA_HOME", data) };
    });
}

struct Fixture {
    root: PathBuf,
    conn: Connection,
}

impl Fixture {
    fn new(name: &str) -> Self {
        init();
        let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("history-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("files")).unwrap();
        let conn = anchoa::db::open(&root.join("history.db")).unwrap();
        Self { root, conn }
    }

    /// Paths under `files/`, the only validator root.
    fn p(&self, rel: &str) -> PathBuf {
        self.root.join("files").join(rel)
    }

    fn write(&self, rel: &str, contents: &str) -> PathBuf {
        let path = self.p(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, contents).unwrap();
        path
    }

    fn validate(&self, plan: ActionPlan) -> ValidatedPlan {
        Validator::new([self.p("")])
            .validate(plan)
            .expect("valid plan")
    }

    /// Validates, records, executes and finishes `actions`; returns the operation id.
    fn run(&self, actions: Vec<Action>, policy: Option<ConflictPolicy>) -> i64 {
        let plan = self.validate(ActionPlan {
            actions,
            on_conflict: policy,
        });
        let id = history::begin(&self.conn, &plan, Source::Rule, NOW).unwrap();
        let statuses = execute(&plan, |_| true);
        history::finish(&self.conn, id, &statuses, NOW).unwrap();
        id
    }

    /// Plans the undo, runs it through the validator and executor, and marks it undone.
    fn undo(&self) -> UndoPlan {
        let undo = history::plan_undo(&self.conn)
            .unwrap()
            .expect("something to undo");
        let statuses = execute(&self.validate(undo.plan.clone()), |_| true);
        assert!(
            statuses
                .iter()
                .all(|s| matches!(s, ItemStatus::Done { .. })),
            "{statuses:?}"
        );
        history::mark_undone(&self.conn, undo.operation_id).unwrap();
        undo
    }

    fn status(&self, id: i64) -> String {
        self.conn
            .query_row("SELECT status FROM operation WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap()
    }

    /// `(kind, status, src_path, dst_path)` of each item, in `seq` order.
    fn items(&self, id: i64) -> Vec<(String, String, String, Option<String>)> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT kind, status, src_path, dst_path FROM operation_item
                 WHERE operation_id = ?1 ORDER BY seq",
            )
            .unwrap();
        stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn s(path: &Path) -> String {
    path.to_str().unwrap().to_owned()
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap()
}

fn mode(path: &Path) -> u32 {
    std::fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[test]
fn begin_records_a_running_operation_with_pending_items() {
    let f = Fixture::new("begin");
    let a = f.write("a.txt", "a");
    f.write("b.txt", "b");
    std::fs::set_permissions(&a, std::fs::Permissions::from_mode(0o640)).unwrap();
    let plan = f.validate(ActionPlan {
        actions: vec![
            Action::Mkdir { path: f.p("new") },
            Action::Move {
                src: a.clone(),
                dst: f.p("new/a.txt"),
            },
            // Validation sees the disk before the plan runs, so chmod something that exists.
            Action::Chmod {
                path: f.p("b.txt"),
                mode: 0o700,
            },
        ],
        on_conflict: None,
    });
    let id = history::begin(&f.conn, &plan, Source::Llm, NOW).unwrap();

    let (kind, source, status, created_at): (String, String, String, i64) = f
        .conn
        .query_row(
            "SELECT kind, source, status, created_at FROM operation WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(
        (kind.as_str(), source.as_str(), status.as_str(), created_at),
        ("move", "llm", "running", NOW)
    );
    assert_eq!(
        f.items(id),
        [
            ("mkdir".into(), "pending".into(), s(&f.p("new")), None),
            (
                "move".into(),
                "pending".into(),
                s(&a),
                Some(s(&f.p("new/a.txt")))
            ),
            ("chmod".into(), "pending".into(), s(&f.p("b.txt")), None),
        ]
    );
}

#[test]
fn chmod_records_the_old_mode_before_it_changes() {
    let f = Fixture::new("chmod-record");
    let a = f.write("a.txt", "a");
    std::fs::set_permissions(&a, std::fs::Permissions::from_mode(0o640)).unwrap();
    let id = f.run(
        vec![Action::Chmod {
            path: a.clone(),
            mode: 0o600,
        }],
        None,
    );
    let modes: (u32, u32) = f
        .conn
        .query_row(
            "SELECT mode_before, mode_after FROM operation_item WHERE operation_id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(modes, (0o640, 0o600));
}

#[test]
fn finish_sets_item_and_operation_status() {
    let f = Fixture::new("finish");
    let a = f.write("a.txt", "a");
    let b = f.write("b.txt", "b");
    let plan = f.validate(ActionPlan {
        actions: vec![
            Action::Rename {
                src: a.clone(),
                dst: f.p("a2.txt"),
            },
            Action::Rename {
                src: b.clone(),
                dst: f.p("b2.txt"),
            },
        ],
        on_conflict: None,
    });

    let done = history::begin(&f.conn, &plan, Source::Manual, NOW).unwrap();
    history::finish(
        &f.conn,
        done,
        &[
            ItemStatus::Done {
                dst: Some(f.p("a2.txt")),
            },
            ItemStatus::Skipped,
        ],
        NOW,
    )
    .unwrap();
    assert_eq!(f.status(done), "done");
    assert_eq!(f.items(done)[1].1, "skipped");

    let partial = history::begin(&f.conn, &plan, Source::Manual, NOW).unwrap();
    history::finish(
        &f.conn,
        partial,
        &[
            ItemStatus::Done {
                dst: Some(f.p("a2.txt")),
            },
            ItemStatus::Failed("disk full".into()),
        ],
        NOW,
    )
    .unwrap();
    assert_eq!(f.status(partial), "partial");
    let error: Option<String> = f
        .conn
        .query_row(
            "SELECT error FROM operation_item WHERE operation_id = ?1 AND seq = 1",
            [partial],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(error.as_deref(), Some("disk full"));

    let failed = history::begin(&f.conn, &plan, Source::Manual, NOW).unwrap();
    history::finish(
        &f.conn,
        failed,
        &[ItemStatus::Failed("nope".into()), ItemStatus::Pending],
        NOW,
    )
    .unwrap();
    assert_eq!(f.status(failed), "failed");
    assert_eq!(f.items(failed)[1].1, "pending");
}

#[test]
fn keep_both_records_where_the_item_actually_went() {
    let f = Fixture::new("keepboth");
    let a = f.write("a.txt", "new");
    f.write("out/a.txt", "old");
    let id = f.run(
        vec![Action::Copy {
            src: a.clone(),
            dst: f.p("out/a.txt"),
        }],
        Some(ConflictPolicy::KeepBoth),
    );
    assert_eq!(f.items(id)[0].3, Some(s(&f.p("out/a (2).txt"))));
}

#[test]
fn undo_moves_back_in_reverse_order_and_trashes_the_emptied_folder() {
    let f = Fixture::new("undo-move");
    let a = f.write("a.jpg", "a");
    let b = f.write("b.jpg", "b");
    let id = f.run(
        vec![
            Action::Mkdir { path: f.p("old") },
            Action::Move {
                src: a.clone(),
                dst: f.p("old/a.jpg"),
            },
            Action::Move {
                src: b.clone(),
                dst: f.p("old/b.jpg"),
            },
        ],
        None,
    );

    let undo = history::plan_undo(&f.conn).unwrap().unwrap();
    assert_eq!(undo.operation_id, id);
    assert_eq!(
        undo.plan,
        ActionPlan {
            actions: vec![
                Action::Move {
                    src: f.p("old/b.jpg"),
                    dst: b.clone()
                },
                Action::Move {
                    src: f.p("old/a.jpg"),
                    dst: a.clone()
                },
                Action::Trash { path: f.p("old") },
            ],
            on_conflict: None,
        }
    );
    assert_eq!(undo.skipped, []);

    f.undo();
    assert_eq!((read(&a), read(&b)), ("a".into(), "b".into()));
    assert!(!f.p("old").exists());
    assert_eq!(f.status(id), "undone");
    assert_eq!(history::plan_undo(&f.conn).unwrap(), None);
}

#[test]
fn undo_copy_rename_and_chmod() {
    let f = Fixture::new("undo-other");
    let a = f.write("a.txt", "a");
    let b = f.write("b.txt", "b");
    let d = f.write("d.txt", "d");
    std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o644)).unwrap();
    f.run(
        vec![
            Action::Copy {
                src: a.clone(),
                dst: f.p("copy.txt"),
            },
            Action::Chmod {
                path: d.clone(),
                mode: 0o600,
            },
            Action::Rename {
                src: b.clone(),
                dst: f.p("c.txt"),
            },
        ],
        None,
    );

    let undo = f.undo();
    assert_eq!(
        undo.plan.actions,
        [
            Action::Rename {
                src: f.p("c.txt"),
                dst: b.clone()
            },
            Action::Chmod {
                path: d.clone(),
                mode: 0o644
            },
            Action::Trash {
                path: f.p("copy.txt")
            },
        ]
    );
    assert!(!f.p("copy.txt").exists() && !f.p("c.txt").exists());
    assert_eq!(
        (read(&a), read(&b), mode(&d)),
        ("a".into(), "b".into(), 0o644)
    );
}

#[test]
fn changed_items_are_skipped_and_the_rest_still_undone() {
    let f = Fixture::new("changed");
    let a = f.write("a.txt", "a");
    let b = f.write("b.txt", "b");
    let c = f.write("c.txt", "c");
    std::fs::create_dir(f.p("dir")).unwrap();
    f.run(
        vec![
            Action::Move {
                src: a.clone(),
                dst: f.p("dir/a.txt"),
            },
            Action::Move {
                src: b.clone(),
                dst: f.p("dir/b.txt"),
            },
            Action::Chmod {
                path: c.clone(),
                mode: 0o600,
            },
        ],
        None,
    );
    std::fs::write(f.p("dir/a.txt"), "edited since").unwrap();
    std::fs::set_permissions(&c, std::fs::Permissions::from_mode(0o644)).unwrap();

    let undo = history::plan_undo(&f.conn).unwrap().unwrap();
    assert_eq!(
        undo.plan.actions,
        [Action::Move {
            src: f.p("dir/b.txt"),
            dst: b.clone()
        }]
    );
    assert_eq!(
        undo.skipped,
        [
            Skipped {
                path: c.clone(),
                reason: SkipReason::Changed
            },
            Skipped {
                path: f.p("dir/a.txt"),
                reason: SkipReason::Changed
            },
        ]
    );
}

#[test]
fn original_location_taken_is_skipped() {
    let f = Fixture::new("taken");
    let a = f.write("a.txt", "a");
    f.run(
        vec![Action::Rename {
            src: a.clone(),
            dst: f.p("b.txt"),
        }],
        None,
    );
    std::fs::write(&a, "someone else").unwrap();

    let undo = history::plan_undo(&f.conn).unwrap().unwrap();
    assert_eq!(undo.plan.actions, []);
    assert_eq!(
        undo.skipped,
        [Skipped {
            path: f.p("b.txt"),
            reason: SkipReason::OriginalTaken
        }]
    );
}

#[test]
fn folder_with_foreign_files_is_not_trashed() {
    let f = Fixture::new("notempty");
    let a = f.write("a.txt", "a");
    f.run(
        vec![
            Action::Mkdir { path: f.p("new") },
            Action::Move {
                src: a.clone(),
                dst: f.p("new/a.txt"),
            },
        ],
        None,
    );
    f.write("new/mine.txt", "added later");

    let undo = history::plan_undo(&f.conn).unwrap().unwrap();
    assert_eq!(
        undo.plan.actions,
        [Action::Move {
            src: f.p("new/a.txt"),
            dst: a.clone()
        }]
    );
    assert_eq!(
        undo.skipped,
        [Skipped {
            path: f.p("new"),
            reason: SkipReason::NotEmpty
        }]
    );
}

fn trashed(orig: &Path, deleted: i64, file: &Path) -> Trashed {
    Trashed {
        orig: orig.to_path_buf(),
        deleted,
        file: file.to_path_buf(),
    }
}

/// Trashes `name` through a recorded operation; returns its original path.
fn trash_one(f: &Fixture, name: &str) -> PathBuf {
    let doomed = f.write(name, "x");
    f.run(
        vec![Action::Trash {
            path: doomed.clone(),
        }],
        None,
    );
    let trashed_at: Option<i64> = f
        .conn
        .query_row("SELECT trashed_at FROM operation_item", [], |r| r.get(0))
        .unwrap();
    assert_eq!(trashed_at, Some(NOW));
    doomed
}

#[test]
fn trash_is_undone_by_moving_the_item_back_out_of_the_trash() {
    let f = Fixture::new("trash");
    let doomed = trash_one(&f, "doomed-history-test.txt");
    let in_trash = f.p("Trash/files/doomed-history-test.txt");
    let contents = vec![
        // The same path trashed an hour earlier belongs to another operation.
        trashed(&doomed, NOW - 3600, Path::new("/elsewhere/older")),
        trashed(&doomed, NOW, &in_trash),
        trashed(&f.p("other.txt"), NOW, Path::new("/elsewhere/other")),
    ];

    let undo = history::plan_undo_with(&f.conn, || Ok(contents))
        .unwrap()
        .unwrap();
    assert_eq!(
        undo.plan.actions,
        [Action::Move {
            src: in_trash,
            dst: doomed
        }]
    );
    assert_eq!(undo.skipped, []);
}

#[test]
fn trash_undo_skips_what_cannot_be_restored() {
    let f = Fixture::new("trash-skip");
    let doomed = trash_one(&f, "doomed-history-test.txt");
    let skipped = |reason| {
        vec![Skipped {
            path: doomed.clone(),
            reason,
        }]
    };
    let in_trash = vec![trashed(&doomed, NOW, &f.p("Trash/files/x"))];

    // Emptied from the trash (or restored by hand) since.
    let undo = history::plan_undo_with(&f.conn, || Ok(Vec::new()))
        .unwrap()
        .unwrap();
    assert_eq!(undo.plan.actions, []);
    assert_eq!(undo.skipped, skipped(SkipReason::NotInTrash));

    // No gvfs: the trash cannot be looked into.
    let undo = history::plan_undo_with(&f.conn, || Err(std::io::Error::other("no gvfs")))
        .unwrap()
        .unwrap();
    assert_eq!(undo.skipped, skipped(SkipReason::TrashNotSupported));

    // Something new took its place.
    std::fs::write(&doomed, "new").unwrap();
    let undo = history::plan_undo_with(&f.conn, || Ok(in_trash))
        .unwrap()
        .unwrap();
    assert_eq!(undo.plan.actions, []);
    assert_eq!(undo.skipped, skipped(SkipReason::OriginalTaken));
}

#[test]
fn undo_walks_back_through_history_skipping_failed_and_running() {
    let f = Fixture::new("multilevel");
    let a = f.write("a.txt", "a");
    let first = f.run(
        vec![Action::Rename {
            src: a.clone(),
            dst: f.p("b.txt"),
        }],
        None,
    );
    let second = f.run(
        vec![Action::Rename {
            src: f.p("b.txt"),
            dst: f.p("c.txt"),
        }],
        None,
    );
    // A failed operation (nothing done) and one that never finished (crash) are not undoable.
    let plan = f.validate(ActionPlan {
        actions: vec![Action::Mkdir { path: f.p("x") }],
        on_conflict: None,
    });
    let failed = history::begin(&f.conn, &plan, Source::Rule, NOW).unwrap();
    history::finish(&f.conn, failed, &[ItemStatus::Failed("no".into())], NOW).unwrap();
    history::begin(&f.conn, &plan, Source::Rule, NOW).unwrap();

    assert_eq!(f.undo().operation_id, second);
    assert_eq!(f.undo().operation_id, first);
    assert_eq!(read(&a), "a");
    assert_eq!(history::plan_undo(&f.conn).unwrap(), None);
}

#[test]
fn only_done_items_of_a_partial_operation_are_undone() {
    let f = Fixture::new("partial");
    let a = f.write("a.txt", "a");
    let b = f.write("b.txt", "b");
    let plan = f.validate(ActionPlan {
        actions: vec![
            Action::Rename {
                src: a.clone(),
                dst: f.p("a2.txt"),
            },
            Action::Rename {
                src: b.clone(),
                dst: f.p("b2.txt"),
            },
        ],
        on_conflict: None,
    });
    let id = history::begin(&f.conn, &plan, Source::Rule, NOW).unwrap();
    let statuses = execute(&plan, |i| i < 1);
    history::finish(&f.conn, id, &statuses, NOW).unwrap();
    assert_eq!(f.status(id), "partial");

    let undo = history::plan_undo(&f.conn).unwrap().unwrap();
    assert_eq!(
        undo.plan.actions,
        [Action::Rename {
            src: f.p("a2.txt"),
            dst: a
        }]
    );
    assert_eq!(undo.skipped, []);
}

#[test]
fn undoing_a_restore_trashes_the_item_again() {
    let f = Fixture::new("unrestore");
    // A restore is a move out of a trash `files` folder. Recorded by hand here: really
    // moving it needs gvfs to know this trash (see tests/trash.rs).
    let in_trash = f.write("Trash/files/a.txt", "a");
    let home = f.p("a.txt");
    let plan = f.validate(ActionPlan {
        actions: vec![Action::Move {
            src: in_trash.clone(),
            dst: home.clone(),
        }],
        on_conflict: None,
    });
    let id = history::begin(&f.conn, &plan, Source::Manual, NOW).unwrap();
    std::fs::rename(&in_trash, &home).unwrap();
    history::finish(
        &f.conn,
        id,
        &[ItemStatus::Done {
            dst: Some(home.clone()),
        }],
        NOW,
    )
    .unwrap();

    let undo = history::plan_undo(&f.conn).unwrap().unwrap();
    assert_eq!(undo.plan.actions, [Action::Trash { path: home }]);
    assert_eq!(undo.skipped, []);
}

/// `(input, resolved_by, confidence, operation_id, created_at)`.
type CommandRow = (String, String, Option<f64>, Option<i64>, i64);

/// Each command, by id.
fn commands(conn: &Connection) -> Vec<CommandRow> {
    let mut stmt = conn
        .prepare(
            "SELECT input, resolved_by, confidence, operation_id, created_at
             FROM command_history ORDER BY id",
        )
        .unwrap();
    stmt.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
    })
    .unwrap()
    .map(Result::unwrap)
    .collect()
}

#[test]
fn record_command_links_a_rule_command_to_its_operation() {
    let f = Fixture::new("record-rule");
    let id = f.run(
        vec![Action::Mkdir {
            path: f.p("2026-09"),
        }],
        None,
    );

    let row = history::record_command(
        &f.conn,
        "mkdir 2026-09",
        ResolvedBy::Rule,
        Some(1.0),
        Some(id),
        NOW,
    )
    .unwrap();

    assert!(row > 0);
    assert_eq!(
        commands(&f.conn),
        vec![(
            "mkdir 2026-09".into(),
            "rule".into(),
            Some(1.0),
            Some(id),
            NOW
        )]
    );
}

#[test]
fn record_command_stores_an_unrecognized_command_without_operation() {
    let f = Fixture::new("record-none");

    history::record_command(&f.conn, "tidy up please", ResolvedBy::None, None, None, NOW).unwrap();
    history::record_command(
        &f.conn,
        "from the model",
        ResolvedBy::Llm,
        Some(0.5),
        None,
        NOW + 1,
    )
    .unwrap();

    assert_eq!(
        commands(&f.conn),
        vec![
            ("tidy up please".into(), "none".into(), None, None, NOW),
            (
                "from the model".into(),
                "llm".into(),
                Some(0.5),
                None,
                NOW + 1
            ),
        ]
    );
}

#[test]
fn pruned_operation_leaves_the_command_without_operation() {
    let f = Fixture::new("record-pruned");
    let id = f.run(vec![Action::Mkdir { path: f.p("old") }], None);
    history::record_command(
        &f.conn,
        "mkdir old",
        ResolvedBy::Rule,
        Some(1.0),
        Some(id),
        NOW,
    )
    .unwrap();

    f.conn
        .execute("DELETE FROM operation WHERE id = ?1", [id])
        .unwrap();

    assert_eq!(commands(&f.conn)[0].3, None);
}
