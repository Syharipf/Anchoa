//! Validator: the mandatory gate between an [`ActionPlan`] and the executor.
//!
//! [`ValidatedPlan`] can only be built by [`Validator::validate`], so the executor, which
//! only accepts a `ValidatedPlan`, cannot be reached without passing through here.

use std::path::PathBuf;

use crate::plan::ActionPlan;

/// Why one action was rejected.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Reason {
    #[error("path is not absolute")]
    NotAbsolute,
    #[error("path is outside the allowed locations")]
    OutsideRoots,
    #[error("path is an allowed location itself and cannot be changed")]
    ProtectedRoot,
    #[error("path does not exist")]
    NotFound,
    #[error("path cannot be resolved safely (broken symlink or `..` in a missing part)")]
    Unresolvable,
    #[error("destination already exists and no conflict policy was chosen")]
    DestinationExists,
    #[error("another action in this plan targets the same destination")]
    DuplicateDestination,
    #[error("folder already exists")]
    AlreadyExists,
    #[error("destination is inside the source")]
    IntoItself,
    #[error("rename cannot move the item to another folder")]
    RenameChangesFolder,
    #[error("mode {0:o} is not a plain 3-digit octal mode")]
    InvalidMode(u32),
}

/// A rejected action: its position in [`ActionPlan::actions`], the offending path as given
/// in the plan, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rejection {
    pub index: usize,
    pub path: PathBuf,
    pub reason: Reason,
}

/// A plan that passed [`Validator::validate`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedPlan(ActionPlan);

impl ValidatedPlan {
    pub fn plan(&self) -> &ActionPlan {
        &self.0
    }
}

pub struct Validator {
    roots: Vec<PathBuf>,
}

impl Validator {
    /// `roots` are the only trees the plan may touch (home, `/run/media`, `/mnt`).
    /// They are canonicalized here; roots that do not exist are dropped.
    pub fn new(roots: impl IntoIterator<Item = PathBuf>) -> Self {
        let _ = roots;
        todo!()
    }

    /// Checks every action and returns all rejections, not just the first.
    pub fn validate(&self, plan: ActionPlan) -> Result<ValidatedPlan, Vec<Rejection>> {
        let _ = (plan, &self.roots);
        todo!()
    }
}
