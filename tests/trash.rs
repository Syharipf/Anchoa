//! Trash and undo against the real session trash through gvfs.
//!
//! Ignored by default: it needs a running gvfs and touches the user's own trash (one
//! uniquely named file, restored again). Run with `cargo test --test trash -- --ignored`.

use loom::executor::{ItemStatus, execute};
use loom::history::{self, Source};
use loom::plan::{Action, ActionPlan};
use loom::validator::Validator;
use relm4::gtk::prelude::*;

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

    // gvfs notices new trash items asynchronously; a person never undoes this fast.
    std::thread::sleep(std::time::Duration::from_secs(1));
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

#[test]
#[ignore = "needs gvfs and uses the real home trash"]
fn trashed_file_and_folder_can_be_deleted_for_good() {
    let home = relm4::gtk::glib::home_dir();
    let tag = format!("loom-delete-e2e-{}", std::process::id());
    let file = home.join(format!("{tag}.txt"));
    let dir = home.join(&tag);
    std::fs::write(&file, "bye").unwrap();
    std::fs::create_dir_all(dir.join("inner")).unwrap();
    std::fs::write(dir.join("inner/x"), "bye").unwrap();
    for path in [&file, &dir] {
        relm4::gtk::gio::File::for_path(path)
            .trash(relm4::gtk::gio::Cancellable::NONE)
            .unwrap();
    }
    std::thread::sleep(std::time::Duration::from_secs(1));
    let in_trash: Vec<_> = loom::trash::contents()
        .unwrap()
        .into_iter()
        .filter(|t| t.orig == file || t.orig == dir)
        .map(|t| t.file)
        .collect();
    assert_eq!(in_trash.len(), 2);

    assert_eq!(loom::trash::delete_files(&in_trash).unwrap(), 2);
    let left = loom::trash::contents().unwrap();
    assert!(left.iter().all(|t| t.orig != file && t.orig != dir));
    assert!(in_trash.iter().all(|p| !p.exists()));
}
