//! `ActionPlan`: the only thing the command layer may hand to the executor.
//!
//! The rule parser and the LLM fallback both end up here, with every path already expanded
//! to one concrete action per file. [`Action`] is the operation whitelist: anything not
//! representable as one of its variants cannot be executed.

use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// `dst` is the full destination path, not the folder it lands in.
    Move {
        src: PathBuf,
        dst: PathBuf,
    },
    /// `dst` is the full destination path, not the folder it lands in.
    Copy {
        src: PathBuf,
        dst: PathBuf,
    },
    Trash {
        path: PathBuf,
    },
    /// Changes the name only: `dst` must be in the same folder as `src`.
    Rename {
        src: PathBuf,
        dst: PathBuf,
    },
    Mkdir {
        path: PathBuf,
    },
    Chmod {
        path: PathBuf,
        mode: u32,
    },
}

/// What to do when a destination already exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictPolicy {
    Skip,
    Replace,
    /// Keep both by adding a ` (2)` suffix to the incoming name.
    KeepBoth,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActionPlan {
    pub actions: Vec<Action>,
    /// `None` means existing destinations were not expected, so they are rejected.
    pub on_conflict: Option<ConflictPolicy>,
}
