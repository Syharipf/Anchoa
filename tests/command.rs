//! Specification for the command panel helpers (PRD §4.5, §4.8, §6.6).

use std::path::{Path, PathBuf};

use anchoa::command::{EXAMPLES, Preview, examples, preview};
use anchoa::plan::{Action, ActionPlan};

fn verb(example: &str) -> &str {
    example.split_whitespace().next().unwrap()
}

#[test]
fn examples_are_the_prd_commands() {
    assert_eq!(
        EXAMPLES.map(verb),
        ["move", "trash", "copy", "rename", "mkdir", "chmod"]
    );
}

#[test]
fn matching_verb_comes_first() {
    let got = examples("copy everything");
    assert_eq!(got.len(), 3);
    assert_eq!(verb(got[0]), "copy");
}

#[test]
fn verb_is_case_insensitive() {
    assert_eq!(verb(examples("CHMOD 7777 x")[0]), "chmod");
}

#[test]
fn typo_prefix_still_matches() {
    assert_eq!(verb(examples("mov *.jpg")[0]), "move");
    assert_eq!(verb(examples("renamed a to b")[0]), "rename");
}

#[test]
fn unknown_verb_falls_back_to_list_order() {
    assert_eq!(examples("tidy up please"), EXAMPLES[..3].to_vec());
    assert_eq!(examples(""), EXAMPLES[..3].to_vec());
}

#[test]
fn no_duplicates() {
    let got = examples("move");
    assert_eq!(got, vec![EXAMPLES[0], EXAMPLES[1], EXAMPLES[2]]);
}

struct Dir(PathBuf);

impl Dir {
    fn new(name: &str) -> Self {
        let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("command-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        Self(root)
    }

    fn file(&self, name: &str, len: usize) -> PathBuf {
        let path = self.0.join(name);
        std::fs::write(&path, vec![b'x'; len]).unwrap();
        path
    }
}

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn plan(actions: Vec<Action>) -> ActionPlan {
    ActionPlan {
        actions,
        on_conflict: None,
    }
}

#[test]
fn preview_counts_items_bytes_and_new_folders() {
    let d = Dir::new("preview");
    let a = d.file("a.jpg", 100);
    let b = d.file("b.jpg", 23);
    let dest = d.0.join("old");

    let got = preview(&plan(vec![
        Action::Mkdir { path: dest.clone() },
        Action::Move {
            src: a,
            dst: dest.join("a.jpg"),
        },
        Action::Copy {
            src: b,
            dst: dest.join("b.jpg"),
        },
    ]));

    assert_eq!(
        got,
        Preview {
            items: 2,
            bytes: 123,
            new_dirs: vec![dest],
        }
    );
}

#[test]
fn preview_counts_trash_sizes_and_folders_as_zero() {
    let d = Dir::new("preview-trash");
    let f = d.file("junk.tmp", 7);
    let sub = d.0.join("sub");
    std::fs::create_dir(&sub).unwrap();
    d.file("sub/inside", 1000);

    let got = preview(&plan(vec![
        Action::Trash { path: f },
        Action::Trash { path: sub },
    ]));

    assert_eq!(got.items, 2);
    assert_eq!(got.bytes, 7);
    assert!(got.new_dirs.is_empty());
}

#[test]
fn preview_skips_missing_sources_and_sizeless_actions() {
    let d = Dir::new("preview-missing");
    let f = d.file("x.txt", 5);

    let got = preview(&plan(vec![
        Action::Trash {
            path: d.0.join("gone"),
        },
        Action::Rename {
            src: f.clone(),
            dst: d.0.join("y.txt"),
        },
        Action::Chmod {
            path: f,
            mode: 0o644,
        },
    ]));

    assert_eq!(got.items, 3);
    assert_eq!(got.bytes, 0);
}
