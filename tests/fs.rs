//! Specification for describing a single entry, used to update the file list when the
//! open folder changes on disk (e.g. another app moved a file out of it).

use std::cmp::Ordering;
use std::path::{Path, PathBuf};

use anchoa::fs::{Entry, compare, list_dir, stat_entry};

struct Dir(PathBuf);

impl Dir {
    fn new(name: &str) -> Self {
        let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("fs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        Self(root)
    }

    fn p(&self, rel: &str) -> PathBuf {
        self.0.join(rel)
    }
}

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn entry(name: &str, is_dir: bool) -> Entry {
    Entry {
        path: PathBuf::from("/x").join(name),
        name: name.to_owned(),
        is_dir,
        size: 0,
        mode: 0,
        modified: 0,
    }
}

#[test]
fn stat_entry_matches_what_list_dir_reports() {
    let d = Dir::new("same");
    std::fs::write(d.p("b.txt"), "hello").unwrap();
    std::fs::create_dir(d.p("sub")).unwrap();
    for listed in list_dir(&d.0).unwrap() {
        assert_eq!(stat_entry(&listed.path), Some(listed));
    }
}

#[test]
fn stat_entry_of_a_missing_path_is_none() {
    let d = Dir::new("missing");
    assert_eq!(stat_entry(&d.p("gone.txt")), None);
}

#[test]
fn stat_entry_keeps_a_broken_symlink() {
    let d = Dir::new("broken");
    std::os::unix::fs::symlink(d.p("nowhere"), d.p("link")).unwrap();
    let e = stat_entry(&d.p("link")).expect("broken symlink is still listed");
    assert_eq!(e.name, "link");
    assert!(!e.is_dir);
}

#[test]
fn compare_puts_folders_first_then_names_ignoring_case() {
    assert_eq!(
        compare(&entry("zdir", true), &entry("A.txt", false)),
        Ordering::Less
    );
    assert_eq!(
        compare(&entry("a.txt", false), &entry("B.txt", false)),
        Ordering::Less
    );
    assert_eq!(
        compare(&entry("B.txt", false), &entry("a.txt", false)),
        Ordering::Greater
    );
}

#[test]
fn list_dir_uses_the_same_order_as_compare() {
    let d = Dir::new("order");
    for name in ["b.txt", "A.txt", "c.txt"] {
        std::fs::write(d.p(name), "").unwrap();
    }
    std::fs::create_dir(d.p("zdir")).unwrap();
    let listed = list_dir(&d.0).unwrap();
    assert!(
        listed
            .windows(2)
            .all(|w| compare(&w[0], &w[1]) != Ordering::Greater)
    );
}
