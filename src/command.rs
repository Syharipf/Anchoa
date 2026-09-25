//! Command panel helpers: examples for an unrecognized command and the preview summary
//! (PRD §4.5, §4.8, §6.6).

use std::path::PathBuf;

use crate::plan::{Action, ActionPlan};

/// The command history and the draft being edited in the command panel.
#[derive(Debug, Default)]
pub struct Recall {
    items: Vec<String>,
    position: Option<usize>,
    draft: String,
}

impl Recall {
    /// Creates recall state from `items`, ordered from newest to oldest.
    pub fn new(items: Vec<String>) -> Self {
        Self {
            items,
            ..Self::default()
        }
    }

    /// Moves one command backwards, or starts browsing from the current draft.
    pub fn up(&mut self, current: &str) -> Option<String> {
        if self.items.is_empty() {
            return None;
        }
        let position = match self.position {
            None => {
                self.draft = current.to_owned();
                0
            }
            Some(position) => position + 1,
        };
        let item = self.items.get(position)?.clone();
        self.position = Some(position);
        Some(item)
    }

    /// Moves one command forwards, or returns to the draft after the newest command.
    pub fn down(&mut self) -> Option<String> {
        let position = self.position?;
        if position == 0 {
            self.position = None;
            Some(self.draft.clone())
        } else {
            let item = self.items.get(position - 1)?.clone();
            self.position = Some(position - 1);
            Some(item)
        }
    }
}

/// The PRD §4.5 examples, one per verb.
pub const EXAMPLES: [&str; 6] = [
    "move *.jpg older than 30d to ~/Pictures/old",
    "trash *.tmp in ~/Downloads",
    "copy *.pdf larger than 5mb to ~/Documents/big",
    "rename *.jpeg to *.jpg",
    "mkdir 2026-09",
    "chmod 644 *.txt",
];

/// Three examples, the ones whose verb matches the input's first word (either one a prefix
/// of the other, so a typo like `mov` still counts) first, then the rest in list order.
pub fn examples(input: &str) -> Vec<&'static str> {
    let word = input
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut result = Vec::with_capacity(3);
    for example in EXAMPLES {
        let verb = example.split_whitespace().next().unwrap_or_default();
        if !word.is_empty()
            && (verb.starts_with(&word) || word.starts_with(verb))
            && !result.contains(&example)
        {
            result.push(example);
            if result.len() == 3 {
                return result;
            }
        }
    }
    for example in EXAMPLES {
        if !result.contains(&example) {
            result.push(example);
            if result.len() == 3 {
                break;
            }
        }
    }
    result
}

/// What a plan will do, for the confirm dialog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Preview {
    /// Actions other than `Mkdir`.
    pub items: usize,
    /// Size of the files moved, copied or trashed. Folders count as 0.
    // ponytail: no recursive folder size; add it on a worker if the total matters.
    pub bytes: u64,
    /// Folders the plan creates, in plan order.
    pub new_dirs: Vec<PathBuf>,
}

/// Blocking (stats each source): call from a worker thread. Sources that cannot be
/// stat'ed are left out of `bytes`.
pub fn preview(plan: &ActionPlan) -> Preview {
    let mut result = Preview {
        items: 0,
        bytes: 0,
        new_dirs: Vec::new(),
    };
    for action in &plan.actions {
        match action {
            Action::Mkdir { path } => result.new_dirs.push(path.clone()),
            Action::Move { src, .. } | Action::Copy { src, .. } | Action::Trash { path: src } => {
                result.items += 1;
                if let Ok(metadata) = std::fs::symlink_metadata(src)
                    && metadata.is_file()
                {
                    result.bytes = result.bytes.saturating_add(metadata.len());
                }
            }
            Action::Rename { .. } | Action::Chmod { .. } => result.items += 1,
        }
    }
    result
}
