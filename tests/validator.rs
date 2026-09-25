//! Specification for the Validator (PRD §4.7), including adversarial plans.

use std::path::{Path, PathBuf};

use loom::plan::{Action, ActionPlan, ConflictPolicy};
use loom::validator::{Reason, Rejection, Validator};

/// Layout under a fresh temp dir:
///
/// ```text
/// home/                  <- the only allowed root
///   a.txt  exists.txt
///   dir/inner.txt
///   out_link -> ../outside        (symlink escaping the root)
///   dangling -> ../outside/new    (broken symlink pointing outside)
/// outside/secret.txt
/// ```
struct Fixture {
    base: PathBuf,
    home: PathBuf,
    outside: PathBuf,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let base =
            std::env::temp_dir().join(format!("loom-validator-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (home, outside) = (base.join("home"), base.join("outside"));
        std::fs::create_dir_all(home.join("dir")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        for file in [
            home.join("a.txt"),
            home.join("exists.txt"),
            home.join("dir/inner.txt"),
        ] {
            std::fs::write(file, "x").unwrap();
        }
        std::fs::write(outside.join("secret.txt"), "x").unwrap();
        std::os::unix::fs::symlink(&outside, home.join("out_link")).unwrap();
        std::os::unix::fs::symlink(outside.join("new"), home.join("dangling")).unwrap();
        Self {
            base,
            home,
            outside,
        }
    }

    fn validator(&self) -> Validator {
        Validator::new([self.home.clone()])
    }

    fn h(&self, rel: &str) -> PathBuf {
        self.home.join(rel)
    }

    /// Validates `actions` with `policy` and returns the rejections (empty if it passed).
    fn check(&self, actions: Vec<Action>, policy: Option<ConflictPolicy>) -> Vec<Rejection> {
        let plan = ActionPlan {
            actions,
            on_conflict: policy,
        };
        match self.validator().validate(plan.clone()) {
            Ok(validated) => {
                assert_eq!(validated.plan(), &plan);
                Vec::new()
            }
            Err(rejections) => rejections,
        }
    }

    /// Asserts that the single action is rejected for `reason`, reported on `path`.
    fn rejects(&self, action: Action, policy: Option<ConflictPolicy>, path: &Path, reason: Reason) {
        let got = self.check(vec![action.clone()], policy);
        assert_eq!(
            got,
            [Rejection {
                index: 0,
                path: path.to_path_buf(),
                reason
            }],
            "{action:?}"
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.base);
    }
}

#[test]
fn valid_plan_passes_unchanged() {
    let f = Fixture::new("valid");
    let actions = vec![
        Action::Mkdir { path: f.h("new") },
        Action::Move {
            src: f.h("a.txt"),
            dst: f.h("new/a.txt"),
        },
        Action::Copy {
            src: f.h("exists.txt"),
            dst: f.h("dir/copy.txt"),
        },
        Action::Rename {
            src: f.h("dir/inner.txt"),
            dst: f.h("dir/renamed.txt"),
        },
        Action::Chmod {
            path: f.h("dir"),
            mode: 0o755,
        },
        Action::Trash {
            path: f.h("exists.txt"),
        },
    ];
    assert_eq!(f.check(actions, None), []);
}

#[test]
fn empty_plan_passes() {
    let f = Fixture::new("empty");
    assert_eq!(f.check(Vec::new(), None), []);
}

#[test]
fn relative_path_is_rejected() {
    let f = Fixture::new("relative");
    let rel = PathBuf::from("a.txt");
    f.rejects(
        Action::Trash { path: rel.clone() },
        None,
        &rel,
        Reason::NotAbsolute,
    );
}

#[test]
fn path_outside_roots_is_rejected() {
    let f = Fixture::new("outside");
    let secret = f.outside.join("secret.txt");
    f.rejects(
        Action::Trash {
            path: secret.clone(),
        },
        None,
        &secret,
        Reason::OutsideRoots,
    );
    f.rejects(
        Action::Chmod {
            path: "/etc/passwd".into(),
            mode: 0o644,
        },
        None,
        Path::new("/etc/passwd"),
        Reason::OutsideRoots,
    );
    let dst = f.outside.join("stolen.txt");
    f.rejects(
        Action::Copy {
            src: f.h("a.txt"),
            dst: dst.clone(),
        },
        None,
        &dst,
        Reason::OutsideRoots,
    );
}

#[test]
fn dotdot_traversal_out_of_root_is_rejected() {
    let f = Fixture::new("dotdot");
    let sneaky = f.h("../outside/secret.txt");
    f.rejects(
        Action::Trash {
            path: sneaky.clone(),
        },
        None,
        &sneaky,
        Reason::OutsideRoots,
    );
    let dst = f.h("dir/../../outside/moved.txt");
    f.rejects(
        Action::Move {
            src: f.h("a.txt"),
            dst: dst.clone(),
        },
        None,
        &dst,
        Reason::OutsideRoots,
    );
}

#[test]
fn dotdot_inside_root_is_fine() {
    let f = Fixture::new("dotdot-inside");
    let actions = vec![Action::Move {
        src: f.h("dir/../a.txt"),
        dst: f.h("dir/./a.txt"),
    }];
    assert_eq!(f.check(actions, None), []);
}

#[test]
fn dotdot_in_missing_part_is_unresolvable() {
    let f = Fixture::new("dotdot-missing");
    let path = f.h("missing/../../outside/x");
    f.rejects(
        Action::Mkdir { path: path.clone() },
        None,
        &path,
        Reason::Unresolvable,
    );
}

#[test]
fn symlink_escaping_root_is_rejected() {
    let f = Fixture::new("symlink");
    let through = f.h("out_link/a.txt");
    f.rejects(
        Action::Move {
            src: f.h("a.txt"),
            dst: through.clone(),
        },
        None,
        &through,
        Reason::OutsideRoots,
    );
    let link = f.h("out_link");
    f.rejects(
        Action::Chmod {
            path: link.clone(),
            mode: 0o777,
        },
        None,
        &link,
        Reason::OutsideRoots,
    );
    let secret = f.h("out_link/secret.txt");
    f.rejects(
        Action::Trash {
            path: secret.clone(),
        },
        None,
        &secret,
        Reason::OutsideRoots,
    );
}

#[test]
fn broken_symlink_destination_is_unresolvable() {
    // Writing through `dangling` would create `outside/new`, even with an explicit policy.
    let f = Fixture::new("dangling");
    let dst = f.h("dangling");
    f.rejects(
        Action::Copy {
            src: f.h("a.txt"),
            dst: dst.clone(),
        },
        Some(ConflictPolicy::Replace),
        &dst,
        Reason::Unresolvable,
    );
}

#[test]
fn root_itself_is_protected() {
    let f = Fixture::new("root");
    f.rejects(
        Action::Trash {
            path: f.home.clone(),
        },
        None,
        &f.home,
        Reason::ProtectedRoot,
    );
    f.rejects(
        Action::Chmod {
            path: f.home.clone(),
            mode: 0o700,
        },
        None,
        &f.home,
        Reason::ProtectedRoot,
    );
    let dst = f.h("dir/home");
    let moved = f.check(
        vec![Action::Move {
            src: f.home.clone(),
            dst,
        }],
        None,
    );
    assert_eq!(moved[0].reason, Reason::ProtectedRoot);
}

#[test]
fn missing_source_is_rejected() {
    let f = Fixture::new("missing");
    let nope = f.h("nope.txt");
    f.rejects(
        Action::Trash { path: nope.clone() },
        None,
        &nope,
        Reason::NotFound,
    );
    f.rejects(
        Action::Move {
            src: nope.clone(),
            dst: f.h("dir/nope.txt"),
        },
        None,
        &nope,
        Reason::NotFound,
    );
    f.rejects(
        Action::Chmod {
            path: nope.clone(),
            mode: 0o644,
        },
        None,
        &nope,
        Reason::NotFound,
    );
}

#[test]
fn existing_destination_needs_a_policy() {
    let f = Fixture::new("exists");
    let dst = f.h("exists.txt");
    let action = Action::Move {
        src: f.h("a.txt"),
        dst: dst.clone(),
    };
    f.rejects(action.clone(), None, &dst, Reason::DestinationExists);
    for policy in [
        ConflictPolicy::Skip,
        ConflictPolicy::Replace,
        ConflictPolicy::KeepBoth,
    ] {
        assert_eq!(
            f.check(vec![action.clone()], Some(policy)),
            [],
            "{policy:?}"
        );
    }
    let rename = Action::Rename {
        src: f.h("a.txt"),
        dst: dst.clone(),
    };
    f.rejects(rename, None, &dst, Reason::DestinationExists);
}

#[test]
fn duplicate_destination_in_plan_is_rejected_unless_kept_both() {
    let f = Fixture::new("duplicate");
    let dst = f.h("dir/x.txt");
    let actions = vec![
        Action::Copy {
            src: f.h("a.txt"),
            dst: dst.clone(),
        },
        Action::Copy {
            src: f.h("exists.txt"),
            dst: dst.clone(),
        },
    ];
    let expected = [Rejection {
        index: 1,
        path: dst.clone(),
        reason: Reason::DuplicateDestination,
    }];
    assert_eq!(f.check(actions.clone(), None), expected);
    assert_eq!(
        f.check(actions.clone(), Some(ConflictPolicy::Replace)),
        expected
    );
    assert_eq!(f.check(actions, Some(ConflictPolicy::KeepBoth)), []);

    // Spelled differently, same place.
    let aliased = vec![
        Action::Mkdir { path: f.h("new") },
        Action::Mkdir {
            path: f.h("dir/../new"),
        },
    ];
    assert_eq!(
        f.check(aliased, None)[0].reason,
        Reason::DuplicateDestination
    );
}

#[test]
fn mkdir_on_existing_path_is_rejected_even_with_policy() {
    let f = Fixture::new("mkdir");
    let dir = f.h("dir");
    f.rejects(
        Action::Mkdir { path: dir.clone() },
        Some(ConflictPolicy::Replace),
        &dir,
        Reason::AlreadyExists,
    );
}

#[test]
fn moving_or_copying_into_itself_is_rejected() {
    let f = Fixture::new("into");
    let dst = f.h("dir/sub");
    f.rejects(
        Action::Move {
            src: f.h("dir"),
            dst: dst.clone(),
        },
        None,
        &dst,
        Reason::IntoItself,
    );
    f.rejects(
        Action::Copy {
            src: f.h("dir"),
            dst: dst.clone(),
        },
        None,
        &dst,
        Reason::IntoItself,
    );
}

#[test]
fn destination_must_end_in_a_name() {
    let f = Fixture::new("noname");
    std::fs::create_dir(f.h("dir/sub")).unwrap();
    let dotdot = f.h("dir/sub/..");
    f.rejects(
        Action::Move {
            src: f.h("a.txt"),
            dst: dotdot.clone(),
        },
        Some(ConflictPolicy::Replace),
        &dotdot,
        Reason::NoName,
    );
    f.rejects(
        Action::Mkdir {
            path: dotdot.clone(),
        },
        None,
        &dotdot,
        Reason::NoName,
    );
}

#[test]
fn rename_cannot_change_folder() {
    let f = Fixture::new("rename");
    let dst = f.h("dir/a.txt");
    f.rejects(
        Action::Rename {
            src: f.h("a.txt"),
            dst: dst.clone(),
        },
        None,
        &dst,
        Reason::RenameChangesFolder,
    );
}

#[test]
fn chmod_rejects_special_bits_and_out_of_range_modes() {
    let f = Fixture::new("chmod");
    let path = f.h("a.txt");
    for ok in [0o000, 0o644, 0o755, 0o777] {
        assert_eq!(
            f.check(
                vec![Action::Chmod {
                    path: path.clone(),
                    mode: ok
                }],
                None
            ),
            [],
            "{ok:o}"
        );
    }
    for bad in [0o4755, 0o2755, 0o1777, 0o7777, 0o10000, u32::MAX] {
        f.rejects(
            Action::Chmod {
                path: path.clone(),
                mode: bad,
            },
            None,
            &path,
            Reason::InvalidMode(bad),
        );
    }
}

#[test]
fn reports_every_rejected_action() {
    let f = Fixture::new("many");
    let secret = f.outside.join("secret.txt");
    let nope = f.h("nope");
    let actions = vec![
        Action::Trash { path: f.h("a.txt") },
        Action::Trash {
            path: secret.clone(),
        },
        Action::Mkdir { path: f.h("fresh") },
        Action::Trash { path: nope.clone() },
    ];
    assert_eq!(
        f.check(actions, None),
        [
            Rejection {
                index: 1,
                path: secret,
                reason: Reason::OutsideRoots
            },
            Rejection {
                index: 3,
                path: nope,
                reason: Reason::NotFound
            },
        ]
    );
}

#[test]
fn roots_are_canonicalized_and_missing_roots_dropped() {
    let f = Fixture::new("roots");
    let alias = f.base.join("home_alias");
    std::os::unix::fs::symlink(&f.home, &alias).unwrap();
    let validator = Validator::new([alias.clone(), f.base.join("does-not-exist")]);
    let plan = ActionPlan {
        actions: vec![
            Action::Trash { path: f.h("a.txt") },
            Action::Trash {
                path: alias.join("exists.txt"),
            },
        ],
        on_conflict: None,
    };
    assert!(validator.validate(plan).is_ok());
    // A dropped root grants nothing.
    let plan = ActionPlan {
        actions: vec![Action::Mkdir {
            path: f.base.join("does-not-exist/x"),
        }],
        on_conflict: None,
    };
    assert_eq!(
        validator.validate(plan).unwrap_err()[0].reason,
        Reason::OutsideRoots
    );
}
