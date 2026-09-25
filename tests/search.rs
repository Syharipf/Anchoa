//! Specification for name search (PRD §4.4).

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use anchoa::search::{matches, walk};

#[test]
fn plain_query_is_a_case_insensitive_substring() {
    assert!(matches("rep", "Report.PDF"));
    assert!(matches("REPORT", "report.pdf"));
    assert!(!matches("xyz", "report.pdf"));
}

#[test]
fn wildcards_make_a_whole_name_glob() {
    assert!(matches("*.jpg", "Photo.JPG"));
    assert!(matches("img_??.png", "IMG_01.png"));
    assert!(!matches("*.jpg", "photo.jpg.bak"));
    assert!(!matches("a?c", "abbc"));
}

#[test]
fn empty_query_matches_everything() {
    assert!(matches("", "anything"));
    assert!(matches("   ", "anything"));
}

struct Tree(PathBuf);

impl Tree {
    fn new(name: &str) -> Self {
        let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("search-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        Self(root)
    }

    fn file(&self, rel: &str) -> PathBuf {
        let path = self.0.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "x").unwrap();
        path
    }

    fn names(&self, query: &str, hidden: bool) -> Vec<String> {
        walk(&self.0, query, hidden, &AtomicBool::new(false))
            .into_iter()
            .map(|e| e.name)
            .collect()
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        // Make any locked folder removable again.
        if let Ok(read) = std::fs::read_dir(&self.0) {
            for entry in read.flatten() {
                let _ =
                    std::fs::set_permissions(entry.path(), std::fs::Permissions::from_mode(0o755));
            }
        }
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn walk_finds_nested_matches_with_relative_names_in_order() {
    let t = Tree::new("nested");
    t.file("b.jpg");
    t.file("A/deep/Two.JPG");
    t.file("A/one.jpg");
    t.file("A/notes.txt");

    assert_eq!(
        t.names("*.jpg", false),
        ["A/deep/Two.JPG", "A/one.jpg", "b.jpg"]
    );
}

#[test]
fn walk_returns_full_entries() {
    let t = Tree::new("entry");
    let path = t.file("sub/x.txt");

    let got = walk(&t.0, "x.txt", false, &AtomicBool::new(false));

    assert_eq!(got.len(), 1);
    assert_eq!(got[0].path, path);
    assert!(!got[0].is_dir);
    assert_eq!(got[0].size, 1);
}

#[test]
fn matching_folders_are_listed_and_still_searched() {
    let t = Tree::new("folders");
    t.file("photos/photos-2026.txt");

    assert_eq!(
        t.names("photos", false),
        ["photos", "photos/photos-2026.txt"]
    );
}

#[test]
fn hidden_names_follow_the_toggle() {
    let t = Tree::new("hidden");
    t.file(".cache/a.log");
    t.file(".b.log");
    t.file("c.log");

    assert_eq!(t.names("*.log", false), ["c.log"]);
    assert_eq!(t.names("*.log", true), [".b.log", ".cache/a.log", "c.log"]);
}

#[test]
fn symlinked_folders_are_not_followed() {
    let t = Tree::new("symlink");
    t.file("real/target.txt");
    std::os::unix::fs::symlink(t.0.join("real"), t.0.join("loop")).unwrap();

    assert_eq!(t.names("target", false), ["real/target.txt"]);
    assert_eq!(t.names("loop", false), ["loop"]);
}

#[test]
fn unreadable_folders_are_skipped() {
    let t = Tree::new("unreadable");
    t.file("locked/secret.txt");
    t.file("open/secret.txt");
    std::fs::set_permissions(t.0.join("locked"), std::fs::Permissions::from_mode(0o000)).unwrap();

    // Root can read anything; the skip only shows for a normal user.
    let expected: &[&str] = if std::fs::read_dir(t.0.join("locked")).is_ok() {
        &["locked/secret.txt", "open/secret.txt"]
    } else {
        &["open/secret.txt"]
    };
    assert_eq!(t.names("secret", false), expected);
}

#[test]
fn cancelled_walk_returns_nothing() {
    let t = Tree::new("cancel");
    t.file("a.txt");

    assert!(walk(&t.0, "a", false, &AtomicBool::new(true)).is_empty());
}
