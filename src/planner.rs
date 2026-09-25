//! Planner: turns a parsed [`Command`] into a concrete [`ActionPlan`] for the active folder.
//!
//! Blocking file I/O (lists the selected folder): call from a worker thread only. The plan
//! still has to pass the Validator; the planner only expands the command, it never decides
//! whether something is allowed.
//!
//! Resolution:
//! - Paths (`in`, `to`, `mkdir`, a folder part in the glob) go through
//!   [`crate::fs::resolve_input`]: `~` is home, relative paths start at the active folder.
//! - The selection lists one folder, not recursively: the `in` folder, the folder part of
//!   the glob (`~/Downloads/*.tmp`), or else the active folder. Using both `in` and a folder
//!   part is an error.
//! - Globs support `*` and `?` and are case-sensitive. Like a shell, they do not match
//!   hidden names unless the pattern itself starts with `.`. No glob (only `files`/`dirs`)
//!   selects every entry that is not hidden.
//! - `older`/`newer than` compare the modification time with `now`; `larger`/`smaller
//!   than` compare the size and only ever match files, since a folder's own size says
//!   nothing about its contents.
//! - Entries keep the order of [`crate::fs::list_dir`] (folders first, then by name).
//!
//! Per command:
//! - `move`/`copy ... to FOLDER`: `FOLDER` is always a folder; each entry keeps its name
//!   inside it. A `Mkdir` for it comes first if it does not exist yet.
//! - `rename ... to NAME`: with one `*` in both the glob and `NAME`, the part the `*`
//!   matched carries over (`*.jpeg` to `*.jpg`). Without `*` in `NAME`, exactly one entry
//!   may match. Entries whose name would not change are left out.
//! - `trash`, `chmod`: one action per entry. `mkdir PATH`: one `Mkdir`.
//!
//! The plan has no conflict policy; the caller adds one if the user picks it.

use std::io;
use std::path::{Path, PathBuf};

use crate::fs::{self, Entry};
use crate::parser::{Command, Filter, Kind, Selection};
use crate::plan::{Action, ActionPlan};

#[derive(Debug, thiserror::Error)]
pub enum PlanError {
    #[error("cannot read {}: {source}", dir.display())]
    ListFailed { dir: PathBuf, source: io::Error },
    #[error("nothing in {} matches", dir.display())]
    NoMatch { dir: PathBuf },
    #[error("use either a folder in the pattern or `in`, not both")]
    TwoFolders,
    #[error("{0}")]
    Rename(&'static str),
}

/// Expands `command` against the disk. `now` is seconds since the Unix epoch.
pub fn build(
    command: &Command,
    cwd: &Path,
    home: &Path,
    now: i64,
) -> Result<ActionPlan, PlanError> {
    match command {
        Command::Move { selection, to } => build_transfer(selection, to, cwd, home, now, false),
        Command::Copy { selection, to } => build_transfer(selection, to, cwd, home, now, true),
        Command::Trash { selection } => {
            let entries = select(selection, cwd, home, now)?;
            Ok(no_conflict(
                entries
                    .into_iter()
                    .map(|e| Action::Trash { path: e.path })
                    .collect(),
            ))
        }
        Command::Chmod { mode, selection } => {
            let entries = select(selection, cwd, home, now)?;
            Ok(no_conflict(
                entries
                    .into_iter()
                    .map(|e| Action::Chmod {
                        path: e.path,
                        mode: *mode,
                    })
                    .collect(),
            ))
        }
        Command::Mkdir { path } => Ok(no_conflict(vec![Action::Mkdir {
            path: fs::resolve_input(path, cwd, home),
        }])),
        Command::Rename { selection, to } => build_rename(selection, to, cwd, home, now),
    }
}

fn no_conflict(actions: Vec<Action>) -> ActionPlan {
    ActionPlan {
        actions,
        on_conflict: None,
    }
}

/// The folder a selection lists, and the pattern (if any) entries are matched against.
/// The folder is either the `in` folder, the folder part of a `dir/glob` pattern, or
/// `cwd`; having both `in` and a folder part in the glob is [`PlanError::TwoFolders`].
fn folder_and_pattern(
    selection: &Selection,
    cwd: &Path,
    home: &Path,
) -> Result<(PathBuf, Option<String>), PlanError> {
    match &selection.glob {
        Some(glob) if glob.contains('/') => {
            if selection.dir.is_some() {
                return Err(PlanError::TwoFolders);
            }
            let (folder, pattern) = glob.rsplit_once('/').expect("checked for '/'");
            Ok((fs::resolve_input(folder, cwd, home), Some(pattern.into())))
        }
        glob => {
            let folder = match &selection.dir {
                Some(dir) => fs::resolve_input(dir, cwd, home),
                None => cwd.to_path_buf(),
            };
            Ok((folder, glob.clone()))
        }
    }
}

/// Lists `selection`'s folder and keeps the entries it selects, in `list_dir` order.
/// Empty is [`PlanError::NoMatch`], not an empty `Vec`.
fn select(
    selection: &Selection,
    cwd: &Path,
    home: &Path,
    now: i64,
) -> Result<Vec<Entry>, PlanError> {
    let (folder, pattern) = folder_and_pattern(selection, cwd, home)?;
    let entries = fs::list_dir(&folder).map_err(|source| PlanError::ListFailed {
        dir: folder.clone(),
        source,
    })?;
    let selected: Vec<Entry> = entries
        .into_iter()
        .filter(|e| {
            entry_matches(
                e,
                pattern.as_deref(),
                selection.kind,
                &selection.filters,
                now,
            )
        })
        .collect();
    if selected.is_empty() {
        return Err(PlanError::NoMatch { dir: folder });
    }
    Ok(selected)
}

fn entry_matches(
    entry: &Entry,
    pattern: Option<&str>,
    kind: Option<Kind>,
    filters: &[Filter],
    now: i64,
) -> bool {
    if !name_matches(pattern, &entry.name) {
        return false;
    }
    match kind {
        Some(Kind::Files) if entry.is_dir => return false,
        Some(Kind::Dirs) if !entry.is_dir => return false,
        _ => {}
    }
    filters.iter().all(|f| filter_holds(f, entry, now))
}

/// A name starting with `.` only matches a pattern that itself starts with `.`; with no
/// pattern at all, hidden names are skipped.
fn name_matches(pattern: Option<&str>, name: &str) -> bool {
    let hidden = name.starts_with('.');
    match pattern {
        Some(p) => !(hidden && !p.starts_with('.')) && glob_match(p, name),
        None => !hidden,
    }
}

fn filter_holds(filter: &Filter, entry: &Entry, now: i64) -> bool {
    match *filter {
        Filter::OlderThan(secs) => entry.modified < now - secs as i64,
        Filter::NewerThan(secs) => entry.modified > now - secs as i64,
        Filter::LargerThan(bytes) => !entry.is_dir && entry.size > bytes,
        Filter::SmallerThan(bytes) => !entry.is_dir && entry.size < bytes,
    }
}

/// Matches `name` against `pattern`, where `*` is any run of characters (including none)
/// and `?` is exactly one; case-sensitive, no partial matches. Classic two-pointer
/// wildcard match: `star` remembers the last `*` to backtrack to when a literal fails.
fn glob_match(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let n: Vec<char> = name.chars().collect();
    let (mut pi, mut ni) = (0, 0);
    let mut star: Option<(usize, usize)> = None; // (pattern index after '*', name index it consumed up to)
    while ni < n.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == n[ni]) {
            pi += 1;
            ni += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some((pi + 1, ni));
            pi += 1;
        } else if let Some((back_pi, back_ni)) = star {
            pi = back_pi;
            ni = back_ni + 1;
            star = Some((back_pi, ni));
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|&c| c == '*')
}

/// `move`/`copy ... to FOLDER`: `FOLDER` gets a `Mkdir` first if it does not exist yet,
/// then one `Move`/`Copy` per selected entry, keeping its name.
fn build_transfer(
    selection: &Selection,
    to: &str,
    cwd: &Path,
    home: &Path,
    now: i64,
    copy: bool,
) -> Result<ActionPlan, PlanError> {
    let entries = select(selection, cwd, home, now)?;
    let dest = fs::resolve_input(to, cwd, home);
    let mut actions = Vec::with_capacity(entries.len() + 1);
    if !dest.exists() {
        actions.push(Action::Mkdir { path: dest.clone() });
    }
    for entry in entries {
        let dst = dest.join(&entry.name);
        actions.push(if copy {
            Action::Copy {
                src: entry.path,
                dst,
            }
        } else {
            Action::Move {
                src: entry.path,
                dst,
            }
        });
    }
    Ok(no_conflict(actions))
}

/// `rename ... to NAME`. See the module doc comment for the two shapes NAME can take.
fn build_rename(
    selection: &Selection,
    to: &str,
    cwd: &Path,
    home: &Path,
    now: i64,
) -> Result<ActionPlan, PlanError> {
    if to.contains('/') {
        return Err(PlanError::Rename(
            "a rename cannot move files to another folder",
        ));
    }
    if to == "." || to == ".." {
        return Err(PlanError::Rename("`.` and `..` are not names"));
    }
    if to.contains('*') {
        let pattern = selection.glob.as_deref().ok_or(PlanError::Rename(
            "`to` has a `*` but there is no pattern to carry it over from",
        ))?;
        if pattern.contains('?') {
            return Err(PlanError::Rename(
                "`?` in the pattern cannot be carried over to the new name",
            ));
        }
        if pattern.matches('*').count() != 1 {
            return Err(PlanError::Rename(
                "the pattern needs exactly one `*` to map into the new name",
            ));
        }
        if to.matches('*').count() != 1 {
            return Err(PlanError::Rename("the new name can only have one `*`"));
        }
        let star = pattern.find('*').expect("checked for exactly one '*'");
        let (prefix, suffix) = (&pattern[..star], &pattern[star + 1..]);
        let entries = select(selection, cwd, home, now)?;
        let actions = entries
            .into_iter()
            .filter_map(|entry| {
                let matched = entry.name.strip_prefix(prefix)?.strip_suffix(suffix)?;
                let new_name = to.replacen('*', matched, 1);
                (new_name != entry.name).then(|| Action::Rename {
                    dst: entry.path.with_file_name(new_name),
                    src: entry.path,
                })
            })
            .collect();
        Ok(no_conflict(actions))
    } else {
        let entries = select(selection, cwd, home, now)?;
        if entries.len() > 1 {
            return Err(PlanError::Rename(
                "several files cannot all get the same name",
            ));
        }
        let actions = entries
            .into_iter()
            .filter_map(|entry| {
                (entry.name != to).then(|| Action::Rename {
                    dst: entry.path.with_file_name(to),
                    src: entry.path,
                })
            })
            .collect();
        Ok(no_conflict(actions))
    }
}

#[cfg(test)]
mod tests {
    use super::glob_match;

    #[test]
    fn star_matches_empty_and_any_run() {
        assert!(glob_match("*", ""));
        assert!(glob_match("a*b", "ab"));
        assert!(glob_match("a*b", "axxxb"));
    }

    #[test]
    fn question_mark_matches_exactly_one_char() {
        assert!(glob_match("a?c", "abc"));
        assert!(!glob_match("a?c", "ac"));
        assert!(!glob_match("a?c", "abbc"));
    }

    #[test]
    fn no_partial_matches() {
        assert!(glob_match("abc", "abc"));
        assert!(!glob_match("abc", "xabcx"));
        assert!(!glob_match("abc", "ab"));
    }
}
