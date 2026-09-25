//! Specification for the executor (PRD §4.8, §6.4), run against real files.
//!
//! Everything lives under `CARGO_TARGET_TMPDIR` (a real disk; gio refuses to trash on
//! tmpfs), and `XDG_DATA_HOME` points there too, so tests never touch the user's trash.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Once;

use loom::executor::{ItemStatus, execute};
use loom::plan::{Action, ActionPlan, ConflictPolicy};
use loom::validator::{ValidatedPlan, Validator};

fn data_home() -> PathBuf {
    Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("executor-xdg-{}", std::process::id()))
}

/// Points `XDG_DATA_HOME` at a private dir before glib first reads (and caches) it.
fn init() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        std::fs::create_dir_all(data_home()).unwrap();
        // SAFETY: runs once, before any test reads the environment through glib; the other
        // test threads are blocked in `call_once` until it returns.
        unsafe { std::env::set_var("XDG_DATA_HOME", data_home()) };
    });
}

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(name: &str) -> Self {
        init();
        let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("executor-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        Self { root }
    }

    fn p(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    fn write(&self, rel: &str, contents: &str) -> PathBuf {
        let path = self.p(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, contents).unwrap();
        path
    }

    fn plan(&self, actions: Vec<Action>, policy: Option<ConflictPolicy>) -> ValidatedPlan {
        Validator::new([self.root.clone()])
            .validate(ActionPlan {
                actions,
                on_conflict: policy,
            })
            .expect("fixture plans are valid")
    }

    /// Names in `rel`, sorted.
    fn names(&self, rel: &str) -> Vec<String> {
        let mut names: Vec<_> = std::fs::read_dir(self.p(rel))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::set_permissions(&self.root, std::fs::Permissions::from_mode(0o755));
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn run(plan: &ValidatedPlan) -> Vec<ItemStatus> {
    execute(plan, |_| true)
}

fn done(dst: &Path) -> ItemStatus {
    ItemStatus::Done {
        dst: Some(dst.to_path_buf()),
    }
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap()
}

fn in_trash(name: &str) -> bool {
    data_home().join("Trash/files").join(name).exists()
}

#[test]
fn move_rename_mkdir_chmod() {
    let f = Fixture::new("basic");
    let a = f.write("a.txt", "a");
    let b = f.write("b.txt", "b");
    let (new, moved, renamed) = (f.p("new/deep"), f.p("new/deep/a.txt"), f.p("c.txt"));
    let plan = f.plan(
        vec![
            Action::Mkdir { path: new.clone() },
            Action::Move {
                src: a.clone(),
                dst: moved.clone(),
            },
            Action::Rename {
                src: b.clone(),
                dst: renamed.clone(),
            },
            Action::Chmod {
                path: renamed.clone(),
                mode: 0o600,
            },
        ],
        None,
    );
    assert_eq!(
        run(&plan),
        [
            ItemStatus::Done { dst: None },
            done(&moved),
            done(&renamed),
            ItemStatus::Done { dst: None }
        ]
    );
    assert!(!a.exists() && !b.exists());
    assert_eq!((read(&moved), read(&renamed)), ("a".into(), "b".into()));
    let mode = std::fs::metadata(&renamed).unwrap().permissions().mode();
    assert_eq!(mode & 0o7777, 0o600);
}

#[test]
fn mkdir_fails_if_folder_appeared_after_validation() {
    let f = Fixture::new("mkdir");
    let dir = f.p("dir");
    let plan = f.plan(vec![Action::Mkdir { path: dir.clone() }], None);
    std::fs::create_dir(&dir).unwrap();
    assert!(matches!(run(&plan)[..], [ItemStatus::Failed(_)]));
}

#[test]
fn copy_is_recursive_keeps_symlinks_and_leaves_no_partial() {
    let f = Fixture::new("copy");
    f.write("src/top.txt", "top");
    f.write("src/sub/inner.txt", "inner");
    std::os::unix::fs::symlink("top.txt", f.p("src/link")).unwrap();
    let dst = f.p("out/copy");
    std::fs::create_dir(f.p("out")).unwrap();
    let plan = f.plan(
        vec![Action::Copy {
            src: f.p("src"),
            dst: dst.clone(),
        }],
        None,
    );

    assert_eq!(run(&plan), [done(&dst)]);
    assert_eq!(read(&dst.join("sub/inner.txt")), "inner");
    assert_eq!(
        std::fs::read_link(dst.join("link")).unwrap(),
        Path::new("top.txt")
    );
    assert_eq!(read(&f.p("src/top.txt")), "top", "source untouched");
    assert_eq!(f.names("out"), ["copy"]);
}

#[test]
fn failed_copy_removes_partial_and_stops_the_batch() {
    let f = Fixture::new("copy-fail");
    f.write("src/ok.txt", "ok");
    let secret = f.write("src/secret.txt", "no");
    std::fs::set_permissions(&secret, std::fs::Permissions::from_mode(0o000)).unwrap();
    if std::fs::read(&secret).is_ok() {
        return; // Running as root: permissions are not enforced.
    }
    std::fs::create_dir(f.p("out")).unwrap();
    let later = f.write("later.txt", "later");
    let plan = f.plan(
        vec![
            Action::Copy {
                src: f.p("src"),
                dst: f.p("out/copy"),
            },
            Action::Trash {
                path: later.clone(),
            },
        ],
        None,
    );

    let result = run(&plan);
    assert!(matches!(result[0], ItemStatus::Failed(_)), "{result:?}");
    assert_eq!(result[1], ItemStatus::Pending);
    assert_eq!(f.names("out"), Vec::<String>::new(), "no partial copy left");
    assert!(later.exists());
}

#[test]
fn stops_at_first_failure() {
    let f = Fixture::new("stop");
    let a = f.write("a.txt", "a");
    let gone = f.write("gone.txt", "g");
    let c = f.write("c.txt", "c");
    let plan = f.plan(
        vec![
            Action::Rename {
                src: a.clone(),
                dst: f.p("a2.txt"),
            },
            Action::Rename {
                src: gone.clone(),
                dst: f.p("gone2.txt"),
            },
            Action::Rename {
                src: c.clone(),
                dst: f.p("c2.txt"),
            },
        ],
        None,
    );
    std::fs::remove_file(&gone).unwrap();

    let result = run(&plan);
    assert_eq!(result[0], done(&f.p("a2.txt")));
    assert!(matches!(result[1], ItemStatus::Failed(_)));
    assert_eq!(result[2], ItemStatus::Pending);
    assert!(c.exists());
}

#[test]
fn cancelling_leaves_the_rest_pending() {
    let f = Fixture::new("cancel");
    let a = f.write("a.txt", "a");
    let b = f.write("b.txt", "b");
    let plan = f.plan(
        vec![
            Action::Chmod {
                path: a.clone(),
                mode: 0o600,
            },
            Action::Chmod {
                path: b.clone(),
                mode: 0o600,
            },
            Action::Mkdir { path: f.p("x") },
        ],
        None,
    );
    let mut asked = Vec::new();
    let result = execute(&plan, |i| {
        asked.push(i);
        i < 1
    });
    assert_eq!(
        result,
        [
            ItemStatus::Done { dst: None },
            ItemStatus::Pending,
            ItemStatus::Pending
        ]
    );
    assert_eq!(asked, [0, 1]);
    assert!(!f.p("x").exists());
}

#[test]
fn trash_goes_to_xdg_trash() {
    let f = Fixture::new("trash");
    let doomed = f.write("doomed-executor-test.txt", "bye");
    let plan = f.plan(
        vec![Action::Trash {
            path: doomed.clone(),
        }],
        None,
    );
    assert_eq!(run(&plan), [ItemStatus::Done { dst: None }]);
    assert!(!doomed.exists());
    assert!(in_trash("doomed-executor-test.txt"));
}

#[test]
fn destination_that_appeared_after_validation_is_not_overwritten() {
    let f = Fixture::new("toctou");
    let a = f.write("a.txt", "a");
    let dst = f.p("b.txt");
    let plan = f.plan(
        vec![Action::Move {
            src: a.clone(),
            dst: dst.clone(),
        }],
        None,
    );
    std::fs::write(&dst, "precious").unwrap();

    assert!(matches!(run(&plan)[..], [ItemStatus::Failed(_)]));
    assert_eq!(read(&dst), "precious");
    assert!(a.exists());
}

#[test]
fn conflict_skip() {
    let f = Fixture::new("skip");
    let a = f.write("a.txt", "new");
    let dst = f.write("out/a.txt", "old");
    let plan = f.plan(
        vec![Action::Copy {
            src: a.clone(),
            dst: dst.clone(),
        }],
        Some(ConflictPolicy::Skip),
    );
    assert_eq!(run(&plan), [ItemStatus::Skipped]);
    assert_eq!(read(&dst), "old");
}

#[test]
fn conflict_replace_trashes_the_old_item() {
    let f = Fixture::new("replace");
    let a = f.write("a.txt", "new");
    let dst = f.write("out/replaced-executor-test.txt", "old");
    let plan = f.plan(
        vec![Action::Move {
            src: a.clone(),
            dst: dst.clone(),
        }],
        Some(ConflictPolicy::Replace),
    );
    assert_eq!(run(&plan), [done(&dst)]);
    assert_eq!(read(&dst), "new");
    assert!(!a.exists());
    assert!(in_trash("replaced-executor-test.txt"));
}

#[test]
fn conflict_keep_both_picks_the_first_free_name() {
    let f = Fixture::new("keepboth");
    let a = f.write("a.txt", "a");
    let b = f.write("b.txt", "b");
    let dir = f.write("dir/x", "dir");
    f.write("out/photo.jpg", "0");
    f.write("out/photo (2).jpg", "2");
    f.write("out/folder/x", "old");
    let plan = f.plan(
        vec![
            Action::Copy {
                src: a.clone(),
                dst: f.p("out/photo.jpg"),
            },
            Action::Copy {
                src: b.clone(),
                dst: f.p("out/photo.jpg"),
            },
            Action::Copy {
                src: dir.parent().unwrap().into(),
                dst: f.p("out/folder"),
            },
        ],
        Some(ConflictPolicy::KeepBoth),
    );
    assert_eq!(
        run(&plan),
        [
            done(&f.p("out/photo (3).jpg")),
            done(&f.p("out/photo (4).jpg")),
            done(&f.p("out/folder (2)")),
        ]
    );
    assert_eq!(read(&f.p("out/photo (3).jpg")), "a");
    assert_eq!(read(&f.p("out/photo (4).jpg")), "b");
    assert_eq!(read(&f.p("out/photo.jpg")), "0");
    assert_eq!(read(&f.p("out/folder (2)/x")), "dir");
}

#[test]
fn move_across_filesystems_copies_then_removes_source() {
    // `/dev/shm` is tmpfs, the target dir is on disk: `rename(2)` fails with EXDEV there.
    let shm = Path::new("/dev/shm");
    if !shm.is_dir() {
        return;
    }
    let f = Fixture::new("xdev");
    let src_root = shm.join(format!("loom-executor-xdev-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&src_root);
    std::fs::create_dir_all(src_root.join("dir/sub")).unwrap();
    std::fs::write(src_root.join("dir/sub/f.txt"), "f").unwrap();
    let dst = f.p("moved");
    let plan = Validator::new([src_root.clone(), f.root.clone()])
        .validate(ActionPlan {
            actions: vec![Action::Move {
                src: src_root.join("dir"),
                dst: dst.clone(),
            }],
            on_conflict: None,
        })
        .unwrap();

    let result = run(&plan);
    let src_left = src_root.join("dir").exists();
    let _ = std::fs::remove_dir_all(&src_root);
    assert_eq!(result, [done(&dst)]);
    assert_eq!(read(&dst.join("sub/f.txt")), "f");
    assert!(!src_left);
    assert_eq!(f.names(""), ["moved"], "no partial copy left");
}
