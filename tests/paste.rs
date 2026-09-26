//! Specification for copy/cut/paste planning and conflict detection (PRD §4.2).

use std::path::{Path, PathBuf};

use anchoa::paste::{conflicts, gnome_copied_files, parse_gnome_copied_files, plan, same_device};
use anchoa::plan::{Action, ActionPlan};

struct Dir(PathBuf);

impl Dir {
    fn new(name: &str) -> Self {
        let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("paste-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("dst")).unwrap();
        Self(root)
    }

    fn p(&self, rel: &str) -> PathBuf {
        self.0.join(rel)
    }

    fn file(&self, rel: &str) -> PathBuf {
        let path = self.p(rel);
        std::fs::write(&path, "x").unwrap();
        path
    }
}

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn copy_keeps_each_name_in_the_destination() {
    let d = Dir::new("copy");
    let a = d.file("src/a.txt");
    let b = d.p("src/sub");
    std::fs::create_dir(&b).unwrap();

    let got = plan(&[a.clone(), b.clone()], &d.p("dst"), false);

    assert_eq!(
        got,
        ActionPlan {
            actions: vec![
                Action::Copy {
                    src: a,
                    dst: d.p("dst/a.txt"),
                },
                Action::Copy {
                    src: b,
                    dst: d.p("dst/sub"),
                },
            ],
            on_conflict: None,
        }
    );
}

#[test]
fn cut_moves() {
    let d = Dir::new("cut");
    let a = d.file("src/a.txt");

    let got = plan(std::slice::from_ref(&a), &d.p("dst"), true);

    assert_eq!(
        got.actions,
        vec![Action::Move {
            src: a,
            dst: d.p("dst/a.txt"),
        }]
    );
}

#[test]
fn cut_into_its_own_folder_does_nothing() {
    let d = Dir::new("cut-same");
    let a = d.file("src/a.txt");
    let b = d.file("dst/b.txt");

    let got = plan(&[a.clone(), b], &d.p("dst"), true);

    assert_eq!(
        got.actions,
        vec![Action::Move {
            src: a,
            dst: d.p("dst/a.txt"),
        }]
    );
    assert!(
        plan(&[d.p("dst/b.txt")], &d.p("dst"), true)
            .actions
            .is_empty()
    );
}

#[test]
fn copy_into_its_own_folder_is_a_conflict() {
    let d = Dir::new("copy-same");
    let a = d.file("dst/a.txt");

    let got = plan(std::slice::from_ref(&a), &d.p("dst"), false);

    assert_eq!(
        got.actions,
        vec![Action::Copy {
            src: a.clone(),
            dst: a.clone(),
        }]
    );
    assert_eq!(conflicts(&got), vec![a]);
}

#[test]
fn sources_without_a_name_are_left_out() {
    let d = Dir::new("root");
    assert!(
        plan(&[PathBuf::from("/")], &d.p("dst"), false)
            .actions
            .is_empty()
    );
}

#[test]
fn conflicts_lists_existing_destinations_in_plan_order() {
    let d = Dir::new("conflicts");
    let file = d.file("dst/file");
    let dir = d.p("dst/dir");
    std::fs::create_dir(&dir).unwrap();
    let link = d.p("dst/link");
    std::os::unix::fs::symlink(d.p("nowhere"), &link).unwrap();

    let p = ActionPlan {
        actions: vec![
            Action::Move {
                src: d.p("src/link"),
                dst: link.clone(),
            },
            Action::Copy {
                src: d.p("src/new"),
                dst: d.p("dst/new"),
            },
            Action::Copy {
                src: d.p("src/dir"),
                dst: dir.clone(),
            },
            Action::Rename {
                src: d.p("dst/other"),
                dst: file.clone(),
            },
        ],
        on_conflict: None,
    };

    assert_eq!(conflicts(&p), vec![link, dir, file]);
}

#[test]
fn conflicts_ignores_other_actions() {
    let d = Dir::new("conflicts-other");
    let file = d.file("dst/file");

    let p = ActionPlan {
        actions: vec![
            Action::Mkdir { path: file.clone() },
            Action::Trash { path: file.clone() },
            Action::Chmod {
                path: file,
                mode: 0o644,
            },
        ],
        on_conflict: None,
    };

    assert!(conflicts(&p).is_empty());
}

#[test]
fn a_folder_is_never_pasted_into_itself() {
    let d = Dir::new("into-itself");
    let folder = d.p("src/folder");
    std::fs::create_dir_all(folder.join("inner")).unwrap();

    for cut in [false, true] {
        assert!(
            plan(std::slice::from_ref(&folder), &folder, cut)
                .actions
                .is_empty()
        );
        assert!(
            plan(std::slice::from_ref(&folder), &folder.join("inner"), cut)
                .actions
                .is_empty()
        );
    }
    // A sibling whose name only starts the same is fine.
    let sibling = d.p("src/folder2");
    std::fs::create_dir(&sibling).unwrap();
    assert_eq!(plan(&[folder], &sibling, true).actions.len(), 1);
}

#[test]
fn same_device_within_one_filesystem() {
    let d = Dir::new("device");
    let a = d.file("src/a.txt");

    assert!(same_device(&a, &d.p("dst")));
    assert!(!same_device(&d.p("src/missing"), &d.p("dst")));
    assert!(!same_device(&a, &d.p("missing")));
}

#[test]
fn gnome_copied_files_lists_the_mode_then_file_uris() {
    let paths = [
        PathBuf::from("/home/u/a b.txt"),
        PathBuf::from("/home/u/café"),
    ];

    assert_eq!(
        gnome_copied_files(&paths, false),
        "copy\nfile:///home/u/a%20b.txt\nfile:///home/u/caf%C3%A9"
    );
    assert!(gnome_copied_files(&paths, true).starts_with("cut\n"));
}

#[test]
fn parse_gnome_copied_files_round_trips() {
    let paths = vec![
        PathBuf::from("/home/u/a b.txt"),
        PathBuf::from("/home/u/café"),
    ];

    for cut in [false, true] {
        assert_eq!(
            parse_gnome_copied_files(&gnome_copied_files(&paths, cut)),
            Some((paths.clone(), cut))
        );
    }
}

#[test]
fn parse_gnome_copied_files_tolerates_other_writers() {
    // Nautilus and Dolphin differ in trailing newlines and line endings.
    assert_eq!(
        parse_gnome_copied_files("cut\r\nfile:///tmp/x\r\n"),
        Some((vec![PathBuf::from("/tmp/x")], true))
    );
    // Remote items cannot be pasted locally; they are left out.
    assert_eq!(
        parse_gnome_copied_files("copy\nsftp://host/x\nfile:///tmp/y\n"),
        Some((vec![PathBuf::from("/tmp/y")], false))
    );
}

#[test]
fn parse_gnome_copied_files_rejects_anything_else() {
    assert_eq!(parse_gnome_copied_files(""), None);
    assert_eq!(parse_gnome_copied_files("hello world"), None);
    assert_eq!(parse_gnome_copied_files("copy\n"), None);
    assert_eq!(parse_gnome_copied_files("copy\nsftp://host/x"), None);
}
