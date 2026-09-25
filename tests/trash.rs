//! Trash and undo against the real session trash through gvfs.
//!
//! Ignored by default: it needs a running gvfs and touches the user's own trash (one
//! uniquely named file, restored again). Run with `cargo test --test trash -- --ignored`.

use loom::executor::{ItemStatus, execute};
use loom::history::{self, Source};
use loom::plan::{Action, ActionPlan};
use loom::validator::Validator;

#[test]
#[ignore = "needs gvfs and uses the real home trash"]
fn trashed_file_comes_back_on_undo() {
    let home = relm4::gtk::glib::home_dir();
    let name = format!("loom-trash-e2e-{}.txt", std::process::id());
    let path = home.join(&name);
    std::fs::write(&path, "restore me").unwrap();
    let db_path = std::path::Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("trash-e2e-{}.db", std::process::id()));
    let _ = std::fs::remove_file(&db_path);
    let conn = loom::db::open(&db_path).unwrap();
    let validator = Validator::new([home.clone()]);
    let now = || {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
    };

    let plan = validator
        .validate(ActionPlan {
            actions: vec![Action::Trash { path: path.clone() }],
            on_conflict: None,
        })
        .unwrap();
    let id = history::begin(&conn, &plan, Source::Manual, now()).unwrap();
    let statuses = execute(&plan, |_| true);
    history::finish(&conn, id, &statuses, now()).unwrap();
    assert!(!path.exists());

    let undo = history::plan_undo(&conn).unwrap().unwrap();
    assert_eq!(undo.skipped, [], "{undo:?}");
    let statuses = execute(&validator.validate(undo.plan).unwrap(), |_| true);
    assert!(
        matches!(statuses[..], [ItemStatus::Done { .. }]),
        "{statuses:?}"
    );

    assert_eq!(std::fs::read_to_string(&path).unwrap(), "restore me");
    let leftover = home
        .join(".local/share/Trash/info")
        .join(format!("{name}.trashinfo"));
    assert!(!leftover.exists(), "gvfs should remove the .trashinfo");
    std::fs::remove_file(&path).unwrap();
    std::fs::remove_file(&db_path).unwrap();
}
