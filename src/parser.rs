//! Rule-based parser for the command panel (PRD §4.5). English only in v1.
//!
//! ```text
//! command   := "move" selection "to" PATH
//!            | "copy" selection "to" PATH
//!            | "rename" selection "to" NAME
//!            | "trash" selection
//!            | "chmod" MODE selection
//!            | "mkdir" PATH
//! selection := subject clause*
//! subject   := GLOB | kind | GLOB kind | kind GLOB
//! kind      := "files" | "dirs"
//! clause    := ("older" | "newer") "than" DURATION      -- e.g. 30d
//!            | ("larger" | "smaller") "than" SIZE       -- e.g. 5mb, 10kb, 2gb, 100b
//!            | "in" PATH
//!            | "and"                                    -- optional between clauses
//! MODE      := three octal digits, e.g. 644
//! ```
//!
//! Keywords are case-insensitive. A token in double quotes is never a keyword and may
//! contain spaces: `trash "to do.txt"`. Paths and globs are returned as written; `~` and
//! relative paths are resolved later, against the active folder.
//!
//! The parser has no partial confidence: a command either matches the grammar exactly
//! (confidence 1.0) or is an error, which is when the LLM fallback may take over.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Move {
        selection: Selection,
        to: String,
    },
    Copy {
        selection: Selection,
        to: String,
    },
    /// `to` may use the same `*` as the selection glob: `rename *.jpeg to *.jpg`.
    Rename {
        selection: Selection,
        to: String,
    },
    Trash {
        selection: Selection,
    },
    Chmod {
        mode: u32,
        selection: Selection,
    },
    Mkdir {
        path: String,
    },
}

/// Which entries of a folder a command applies to. All filters must hold.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Selection {
    pub glob: Option<String>,
    pub kind: Option<Kind>,
    pub filters: Vec<Filter>,
    /// The `in` folder; `None` means the active folder.
    pub dir: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Files,
    Dirs,
}

/// Ages are in seconds, sizes in bytes (SI units, matching the size column).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Filter {
    OlderThan(u64),
    NewerThan(u64),
    LargerThan(u64),
    SmallerThan(u64),
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ParseError {
    #[error("empty command")]
    Empty,
    #[error("unknown command `{0}`; try move, copy, rename, trash, chmod or mkdir")]
    UnknownVerb(String),
    /// `found` is `None` at the end of the input.
    #[error("expected {expected}, found {}", found.as_deref().map_or("end of command".into(), |f| format!("`{f}`")))]
    Expected {
        expected: &'static str,
        found: Option<String>,
    },
    #[error("missing closing quote")]
    UnclosedQuote,
    #[error("`{0}` is not a mode; use three octal digits like 644")]
    InvalidMode(String),
    #[error("`{0}` is not an age; use days like 30d")]
    InvalidDuration(String),
    #[error("`{0}` is not a size; use a number with b, kb, mb or gb, like 5mb")]
    InvalidSize(String),
    #[error("`{0}` is not supported yet")]
    Unsupported(String),
}

pub fn parse(input: &str) -> Result<Command, ParseError> {
    let _ = input;
    todo!()
}
