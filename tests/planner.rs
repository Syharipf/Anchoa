//! Specification for the planner: parsed command + folder contents -> ActionPlan.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use loom::parser::parse;
use loom::plan::{Action, ActionPlan};
use loom::planner::{PlanError, build};

const DAY: i64 = 86_400;

/// ```text
/// home/
///   Pictures/            (exists)
///   cam/                 <- active folder
///     a.jpg   40 days, 10 bytes
///     b.jpg    1 day,  10 bytes
///     c.png   40 days, 2_000_000 bytes
///     .hidden.jpg  40 days
///     old/    (folder)  40 days
///     sub/x.tmp  sub/y.log
///   Downloads/z.tmp
/// ```
struct Fixture {
    base: PathBuf,
    home: PathBuf,
    cam: PathBuf,
    now: i64,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let base = std::env::temp_dir().join(format!("loom-planner-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let home = base.join("home");
        let cam = home.join("cam");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let f = Self {
            base,
            home,
            cam,
            now,
        };
        std::fs::create_dir_all(f.home.join("Pictures")).unwrap();
        f.file("cam/a.jpg", 10, 40);
        f.file("cam/b.jpg", 10, 1);
        f.file("cam/c.png", 2_000_000, 40);
        f.file("cam/.hidden.jpg", 10, 40);
        f.file("cam/sub/x.tmp", 1, 1);
        f.file("cam/sub/y.log", 1, 1);
        f.file("Downloads/z.tmp", 1, 1);
        std::fs::create_dir(f.cam.join("old")).unwrap();
        f.age(&f.cam.join("old"), 40);
        f
    }

    fn file(&self, rel: &str, size: usize, days_old: i64) {
        let path = self.home.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, vec![b'x'; size]).unwrap();
        self.age(&path, days_old);
    }

    fn age(&self, path: &Path, days_old: i64) {
        let when = UNIX_EPOCH + Duration::from_secs((self.now - days_old * DAY) as u64);
        std::fs::File::open(path)
            .unwrap()
            .set_modified(when)
            .unwrap();
    }

    fn c(&self, rel: &str) -> PathBuf {
        self.cam.join(rel)
    }

    fn h(&self, rel: &str) -> PathBuf {
        self.home.join(rel)
    }

    fn plan(&self, command: &str) -> Result<ActionPlan, PlanError> {
        let command = parse(command).unwrap_or_else(|e| panic!("{command}: {e}"));
        build(&command, &self.cam, &self.home, self.now)
    }

    fn actions(&self, command: &str) -> Vec<Action> {
        let plan = self
            .plan(command)
            .unwrap_or_else(|e| panic!("{command}: {e}"));
        assert_eq!(plan.on_conflict, None);
        plan.actions
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.base);
    }
}

#[test]
fn move_with_age_filter_creates_the_missing_destination_first() {
    let f = Fixture::new("move");
    let dst = f.h("Pictures/old");
    assert_eq!(
        f.actions("move *.jpg older than 30d to ~/Pictures/old"),
        [
            Action::Mkdir { path: dst.clone() },
            Action::Move {
                src: f.c("a.jpg"),
                dst: dst.join("a.jpg")
            },
        ]
    );
}

#[test]
fn existing_destination_needs_no_mkdir_and_relative_paths_start_at_the_active_folder() {
    let f = Fixture::new("copy");
    assert_eq!(
        f.actions("copy *.jpg to ../Pictures"),
        [
            Action::Copy {
                src: f.c("a.jpg"),
                dst: f.h("Pictures/a.jpg")
            },
            Action::Copy {
                src: f.c("b.jpg"),
                dst: f.h("Pictures/b.jpg")
            },
        ]
    );
}

#[test]
fn newer_than() {
    let f = Fixture::new("newer");
    assert_eq!(
        f.actions("trash * newer than 7d"),
        // `sub` was just filled, so the folder itself is new too.
        [
            Action::Trash { path: f.c("sub") },
            Action::Trash { path: f.c("b.jpg") }
        ]
    );
}

#[test]
fn size_filters_only_match_files() {
    let f = Fixture::new("size");
    assert_eq!(
        f.actions("trash * larger than 1mb"),
        [Action::Trash { path: f.c("c.png") }]
    );
    assert_eq!(
        f.actions("trash * smaller than 1kb"),
        [
            Action::Trash { path: f.c("a.jpg") },
            Action::Trash { path: f.c("b.jpg") }
        ]
    );
}

#[test]
fn kind_selects_files_or_folders_and_skips_hidden() {
    let f = Fixture::new("kind");
    assert_eq!(
        f.actions("trash dirs"),
        [
            Action::Trash { path: f.c("old") },
            Action::Trash { path: f.c("sub") }
        ]
    );
    assert_eq!(
        f.actions("chmod 600 files"),
        [
            Action::Chmod {
                path: f.c("a.jpg"),
                mode: 0o600
            },
            Action::Chmod {
                path: f.c("b.jpg"),
                mode: 0o600
            },
            Action::Chmod {
                path: f.c("c.png"),
                mode: 0o600
            },
        ]
    );
    assert_eq!(
        f.actions("trash * older than 30d"),
        [
            Action::Trash { path: f.c("old") },
            Action::Trash { path: f.c("a.jpg") },
            Action::Trash { path: f.c("c.png") },
        ]
    );
}

#[test]
fn hidden_names_need_a_dot_pattern() {
    let f = Fixture::new("hidden");
    assert_eq!(
        f.actions("trash .*"),
        [Action::Trash {
            path: f.c(".hidden.jpg")
        }]
    );
    assert_eq!(
        f.actions("trash .hidden.jpg"),
        [Action::Trash {
            path: f.c(".hidden.jpg")
        }]
    );
}

#[test]
fn glob_wildcards_and_literals() {
    let f = Fixture::new("glob");
    assert_eq!(
        f.actions("trash ?.png"),
        [Action::Trash { path: f.c("c.png") }]
    );
    assert_eq!(
        f.actions("trash b.jpg"),
        [Action::Trash { path: f.c("b.jpg") }]
    );
    assert_eq!(
        f.actions("trash *.p*"),
        [Action::Trash { path: f.c("c.png") }]
    );
    // Case-sensitive, like the filesystem.
    assert!(matches!(
        f.plan("trash *.JPG"),
        Err(PlanError::NoMatch { .. })
    ));
}

#[test]
fn selection_folder_from_in_or_from_the_glob() {
    let f = Fixture::new("folder");
    assert_eq!(
        f.actions("trash *.tmp in sub"),
        [Action::Trash {
            path: f.c("sub/x.tmp")
        }]
    );
    assert_eq!(
        f.actions("trash ~/Downloads/*.tmp"),
        [Action::Trash {
            path: f.h("Downloads/z.tmp")
        }]
    );
    assert_eq!(
        f.actions("move sub/*.log to ~/Downloads"),
        [Action::Move {
            src: f.c("sub/y.log"),
            dst: f.h("Downloads/y.log")
        }]
    );
    assert!(matches!(
        f.plan("trash sub/*.tmp in ~"),
        Err(PlanError::TwoFolders)
    ));
}

#[test]
fn chmod_and_mkdir() {
    let f = Fixture::new("chmod");
    assert_eq!(
        f.actions("chmod 644 *.jpg"),
        [
            Action::Chmod {
                path: f.c("a.jpg"),
                mode: 0o644
            },
            Action::Chmod {
                path: f.c("b.jpg"),
                mode: 0o644
            },
        ]
    );
    assert_eq!(
        f.actions("mkdir 2026-09"),
        [Action::Mkdir {
            path: f.c("2026-09")
        }]
    );
    assert_eq!(
        f.actions("mkdir ~/new/deep"),
        [Action::Mkdir {
            path: f.h("new/deep")
        }]
    );
}

#[test]
fn rename_carries_the_star_over() {
    let f = Fixture::new("rename");
    assert_eq!(
        f.actions("rename *.jpg to *.jpeg"),
        [
            Action::Rename {
                src: f.c("a.jpg"),
                dst: f.c("a.jpeg")
            },
            Action::Rename {
                src: f.c("b.jpg"),
                dst: f.c("b.jpeg")
            },
        ]
    );
    assert_eq!(
        f.actions("rename a.* to photo.*"),
        [Action::Rename {
            src: f.c("a.jpg"),
            dst: f.c("photo.jpg")
        }]
    );
    // Names that would not change are left out.
    assert_eq!(
        f.actions("rename *.png older than 1d to *.png"),
        Vec::<Action>::new(),
    );
}

#[test]
fn rename_to_a_plain_name_needs_exactly_one_match() {
    let f = Fixture::new("rename-one");
    assert_eq!(
        f.actions("rename c.png to cover.png"),
        [Action::Rename {
            src: f.c("c.png"),
            dst: f.c("cover.png")
        }]
    );
    assert!(matches!(
        f.plan("rename *.jpg to same.jpg"),
        Err(PlanError::Rename(_))
    ));
}

#[test]
fn rename_patterns_that_cannot_be_mapped_are_errors() {
    let f = Fixture::new("rename-bad");
    for bad in [
        "rename c.png to *.gif",     // `*` in the new name but not in the glob
        "rename *.* to *.gif",       // more than one `*`
        "rename ?.png to *.gif",     // `?` cannot be carried over
        "rename *.png to sub/*.png", // a rename never changes folder
        "rename dirs to x",          // no glob to map from
    ] {
        assert!(matches!(f.plan(bad), Err(PlanError::Rename(_))), "{bad}");
    }
}

#[test]
fn no_match_and_unreadable_folder_are_errors() {
    let f = Fixture::new("errors");
    assert!(matches!(
        f.plan("trash *.gif"),
        Err(PlanError::NoMatch { .. })
    ));
    assert!(matches!(
        f.plan("trash * in nope"),
        Err(PlanError::ListFailed { .. })
    ));
}
