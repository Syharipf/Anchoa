//! Validator: the mandatory gate between an [`ActionPlan`] and the executor.
//!
//! [`ValidatedPlan`] can only be built by [`Validator::validate`], so the executor, which
//! only accepts a `ValidatedPlan`, cannot be reached without passing through here.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use crate::plan::{Action, ActionPlan, ConflictPolicy};

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
    #[error("destination must end in a name, not `..`")]
    NoName,
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
        let roots = roots
            .into_iter()
            .filter_map(|root| root.canonicalize().ok())
            .collect();
        Self { roots }
    }

    /// Checks every action and returns all rejections, not just the first.
    pub fn validate(&self, plan: ActionPlan) -> Result<ValidatedPlan, Vec<Rejection>> {
        let mut destinations = HashSet::new();
        let rejections: Vec<_> = plan
            .actions
            .iter()
            .enumerate()
            .filter_map(|(index, action)| {
                let (path, reason) = self
                    .check(action, plan.on_conflict, &mut destinations)
                    .err()?;
                Some(Rejection {
                    index,
                    path: path.to_path_buf(),
                    reason,
                })
            })
            .collect();
        if rejections.is_empty() {
            Ok(ValidatedPlan(plan))
        } else {
            Err(rejections)
        }
    }

    /// Returns the first problem with `action`. A move or copy onto itself is allowed only with
    /// `KeepBoth`; destinations strictly inside the source are always rejected. Destinations of
    /// accepted actions are recorded in `destinations` to catch two actions writing to the same
    /// place.
    fn check<'a>(
        &self,
        action: &'a Action,
        policy: Option<ConflictPolicy>,
        destinations: &mut HashSet<PathBuf>,
    ) -> Check<'a, ()> {
        let (src, dst) = match action {
            Action::Trash { path } => return self.existing(path).map(drop),
            Action::Chmod { path, mode } => {
                self.existing(path)?;
                return match mode & !0o777 {
                    0 => Ok(()),
                    _ => Err((path, Reason::InvalidMode(*mode))),
                };
            }
            Action::Mkdir { path } => {
                let resolved = self.inside(path)?;
                if path.file_name().is_none() {
                    return Err((path, Reason::NoName));
                }
                if path.symlink_metadata().is_ok() {
                    return Err((path, Reason::AlreadyExists));
                }
                return claim(destinations, resolved, path, policy);
            }
            Action::Move { src, dst } | Action::Copy { src, dst } | Action::Rename { src, dst } => {
                (src, dst)
            }
        };
        let src_resolved = self.existing(src)?;
        let dst_resolved = self.inside(dst)?;
        // `dir/..` names no new entry; writing "there" would hit an existing folder.
        if dst.file_name().is_none() {
            return Err((dst, Reason::NoName));
        }
        if matches!(action, Action::Rename { .. }) && src.parent() != dst.parent() {
            return Err((dst, Reason::RenameChangesFolder));
        }
        if dst_resolved == src_resolved
            && (!matches!(action, Action::Move { .. } | Action::Copy { .. })
                || policy != Some(ConflictPolicy::KeepBoth))
        {
            return Err((dst, Reason::IntoItself));
        }
        if dst_resolved.starts_with(&src_resolved) && dst_resolved != src_resolved {
            return Err((dst, Reason::IntoItself));
        }
        if policy.is_none() && dst.symlink_metadata().is_ok() {
            return Err((dst, Reason::DestinationExists));
        }
        claim(destinations, dst_resolved, dst, policy)
    }

    /// Like [`Self::inside`], but `path` must also exist.
    fn existing<'a>(&self, path: &'a Path) -> Check<'a, PathBuf> {
        if path.is_absolute() && path.symlink_metadata().is_err() {
            return Err((path, Reason::NotFound));
        }
        self.inside(path)
    }

    /// Resolves `path` and checks that it lies strictly inside one of the roots.
    fn inside<'a>(&self, path: &'a Path) -> Check<'a, PathBuf> {
        if !path.is_absolute() {
            return Err((path, Reason::NotAbsolute));
        }
        let resolved = resolve(path).ok_or((path, Reason::Unresolvable))?;
        if self.roots.contains(&resolved) {
            Err((path, Reason::ProtectedRoot))
        } else if self.roots.iter().any(|root| resolved.starts_with(root)) {
            Ok(resolved)
        } else {
            Err((path, Reason::OutsideRoots))
        }
    }
}

type Check<'a, T> = Result<T, (&'a Path, Reason)>;

fn claim<'a>(
    destinations: &mut HashSet<PathBuf>,
    resolved: PathBuf,
    path: &'a Path,
    policy: Option<ConflictPolicy>,
) -> Check<'a, ()> {
    if destinations.insert(resolved) || policy == Some(ConflictPolicy::KeepBoth) {
        Ok(())
    } else {
        Err((path, Reason::DuplicateDestination))
    }
}

/// Canonicalizes the longest existing ancestor of `path` and appends the missing rest.
///
/// This follows every symlink, including the last component, so an item that is itself a
/// symlink pointing outside the roots cannot be operated on either.
// ponytail: stricter than needed for trash/move of such a symlink (they act on the link,
// not its target); resolve the parent only for those if users hit it.
fn resolve(path: &Path) -> Option<PathBuf> {
    let existing = path.ancestors().find(|a| a.symlink_metadata().is_ok())?;
    // Fails for a broken symlink, whose target could be anywhere.
    let mut resolved = existing.canonicalize().ok()?;
    for component in path.strip_prefix(existing).ok()?.components() {
        match component {
            Component::Normal(name) => resolved.push(name),
            Component::CurDir => {}
            // `..` under a missing folder cannot be resolved by the kernel.
            _ => return None,
        }
    }
    Some(resolved)
}
