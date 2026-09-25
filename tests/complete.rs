//! Specification for Tab completion in the path bar (PRD §6.1).

use std::path::{Path, PathBuf};

use anchoa::fs::complete;

struct Tree(PathBuf);

impl Tree {
    fn new(name: &str) -> Self {
        let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("complete-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for dir in [
            "Documents",
            "Downloads",
            "Desktop",
            "Music",
            ".config",
            "Documents/Work",
        ] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        std::fs::write(root.join("Dockerfile"), "x").unwrap();
        Self(root)
    }

    fn at(&self, rel: &str) -> String {
        format!("{}/{rel}", self.0.display())
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn a_single_folder_match_completes_with_a_slash() {
    let t = Tree::new("single");
    assert_eq!(complete(&t.at("Mu"), &t.0, &t.0), Some(t.at("Music/")));
}

#[test]
fn several_matches_complete_to_their_common_prefix() {
    let t = Tree::new("common");
    // Documents and Downloads share "Do"; the file Dockerfile never counts.
    assert_eq!(
        complete(&t.at("Docu"), &t.0, &t.0),
        Some(t.at("Documents/"))
    );
    assert_eq!(complete(&t.at("Dow"), &t.0, &t.0), Some(t.at("Downloads/")));
    assert_eq!(complete(&t.at("De"), &t.0, &t.0), Some(t.at("Desktop/")));
}

#[test]
fn nothing_to_add_is_none() {
    let t = Tree::new("none");
    // "D" is already the whole common prefix of Desktop/Documents/Downloads.
    assert_eq!(complete(&t.at("D"), &t.0, &t.0), None);
    assert_eq!(complete(&t.at("Nope"), &t.0, &t.0), None);
    assert_eq!(complete(&t.at("Missing/x"), &t.0, &t.0), None);
}

#[test]
fn what_was_typed_before_the_last_slash_is_kept() {
    let t = Tree::new("typed");
    // `~` and relative paths are completed without being expanded in the text.
    assert_eq!(complete("~/Mu", &t.0, &t.0), Some("~/Music/".into()));
    assert_eq!(
        complete("Documents/W", &t.0, &t.0),
        Some("Documents/Work/".into())
    );
    assert_eq!(complete("Mu", &t.0, &t.0), Some("Music/".into()));
}

#[test]
fn hidden_folders_need_a_leading_dot() {
    let t = Tree::new("hidden");
    assert_eq!(complete(&t.at(".co"), &t.0, &t.0), Some(t.at(".config/")));
    assert_eq!(complete(&t.at("co"), &t.0, &t.0), None);
}

#[test]
fn a_trailing_slash_lists_nothing_to_complete_unless_one_folder() {
    let t = Tree::new("slash");
    assert_eq!(
        complete(&t.at("Documents/"), &t.0, &t.0),
        Some(t.at("Documents/Work/"))
    );
    assert_eq!(complete(&t.at(""), &t.0, &t.0), None);
}
