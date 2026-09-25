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

/// A single token from the input. `quoted` tokens came from `"..."` and are never
/// treated as keywords, whatever text they contain.
#[derive(Debug, Clone)]
struct Token {
    text: String,
    quoted: bool,
}

/// Splits on whitespace; a `"..."` run is one token (quotes stripped) even if it
/// contains spaces. Returns `UnclosedQuote` if a `"` is never closed.
fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut tokens = Vec::new();
    let mut chars = input.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
        } else if c == '"' {
            chars.next();
            let mut text = String::new();
            let mut closed = false;
            for c in chars.by_ref() {
                if c == '"' {
                    closed = true;
                    break;
                }
                text.push(c);
            }
            if !closed {
                return Err(ParseError::UnclosedQuote);
            }
            tokens.push(Token { text, quoted: true });
        } else {
            let mut text = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_whitespace() {
                    break;
                }
                text.push(c);
                chars.next();
            }
            tokens.push(Token {
                text,
                quoted: false,
            });
        }
    }
    Ok(tokens)
}

const KEYWORDS: [&str; 11] = [
    "older", "newer", "larger", "smaller", "than", "in", "to", "and", "or", "files", "dirs",
];

fn is_keyword(text: &str) -> bool {
    KEYWORDS.iter().any(|k| text.eq_ignore_ascii_case(k))
}

/// A read-only walk over the token stream, one token at a time.
struct Cursor {
    tokens: Vec<Token>,
    pos: usize,
}

impl Cursor {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn bump(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.pos).cloned();
        if token.is_some() {
            self.pos += 1;
        }
        token
    }

    /// `true` and consumes the token if it is an unquoted case-insensitive match for `kw`.
    fn eat_keyword(&mut self, kw: &str) -> bool {
        match self.peek() {
            Some(t) if !t.quoted && t.text.eq_ignore_ascii_case(kw) => {
                self.pos += 1;
                true
            }
            _ => false,
        }
    }

    /// Consumes `kw`, or fails with `Expected { expected, .. }` naming what came instead.
    fn expect_keyword(&mut self, kw: &str, expected: &'static str) -> Result<(), ParseError> {
        if self.eat_keyword(kw) {
            Ok(())
        } else {
            Err(ParseError::Expected {
                expected,
                found: self.peek().map(|t| t.text.clone()),
            })
        }
    }
}

/// `kind := "files" | "dirs"`, consumed only if it matches exactly (case-insensitive,
/// unquoted).
fn take_kind(c: &mut Cursor) -> Option<Kind> {
    if c.eat_keyword("files") {
        Some(Kind::Files)
    } else if c.eat_keyword("dirs") {
        Some(Kind::Dirs)
    } else {
        None
    }
}

/// A glob is any token that isn't a bare keyword; a quoted token always qualifies.
fn take_glob(c: &mut Cursor) -> Option<String> {
    match c.peek() {
        Some(t) if t.quoted || !is_keyword(&t.text) => Some(c.bump().unwrap().text),
        _ => None,
    }
}

/// `subject := GLOB | kind | GLOB kind | kind GLOB`, at least one of the two required.
fn parse_subject(c: &mut Cursor) -> Result<Selection, ParseError> {
    let mut selection = Selection::default();
    if let Some(kind) = take_kind(c) {
        selection.kind = Some(kind);
        selection.glob = take_glob(c);
    } else if let Some(glob) = take_glob(c) {
        selection.glob = Some(glob);
        selection.kind = take_kind(c);
    }
    if selection.glob.is_none() && selection.kind.is_none() {
        return Err(ParseError::Expected {
            expected: "files to select",
            found: c.peek().map(|t| t.text.clone()),
        });
    }
    Ok(selection)
}

/// `N` followed by `d` (days) -> seconds, e.g. `30d` -> `30 * 86_400`.
fn parse_duration(text: &str) -> Result<u64, ParseError> {
    text.strip_suffix(['d', 'D'])
        .filter(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
        .and_then(|digits| digits.parse::<u64>().ok())
        .and_then(|days| days.checked_mul(86_400))
        .ok_or_else(|| ParseError::InvalidDuration(text.to_string()))
}

/// `N` followed by `b`/`kb`/`mb`/`gb` (SI units) -> bytes, e.g. `5mb` -> `5_000_000`.
fn parse_size(text: &str) -> Result<u64, ParseError> {
    let lower = text.to_ascii_lowercase();
    let (digits, unit) = if let Some(d) = lower.strip_suffix("kb") {
        (d, 1_000u64)
    } else if let Some(d) = lower.strip_suffix("mb") {
        (d, 1_000_000)
    } else if let Some(d) = lower.strip_suffix("gb") {
        (d, 1_000_000_000)
    } else if let Some(d) = lower.strip_suffix('b') {
        (d, 1)
    } else {
        return Err(ParseError::InvalidSize(text.to_string()));
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ParseError::InvalidSize(text.to_string()));
    }
    digits
        .parse::<u64>()
        .ok()
        .and_then(|n| n.checked_mul(unit))
        .ok_or_else(|| ParseError::InvalidSize(text.to_string()))
}

/// Consumes `than VALUE`, converting `VALUE` with `convert`. `missing` names what a
/// dangling `than` at the end of input is missing.
fn value_after_than(
    c: &mut Cursor,
    missing: &'static str,
    convert: impl FnOnce(&str) -> Result<u64, ParseError>,
) -> Result<u64, ParseError> {
    c.expect_keyword("than", "`than`")?;
    match c.bump() {
        Some(token) => convert(&token.text),
        None => Err(ParseError::Expected {
            expected: missing,
            found: None,
        }),
    }
}

/// `clause*`: applies filters and the `in` folder to `selection` until the input ends,
/// or (`stop_before_to`) until an unconsumed `to` is reached.
fn parse_clauses(
    c: &mut Cursor,
    selection: &mut Selection,
    stop_before_to: bool,
) -> Result<(), ParseError> {
    loop {
        let Some(token) = c.peek() else { return Ok(()) };
        if stop_before_to && !token.quoted && token.text.eq_ignore_ascii_case("to") {
            return Ok(());
        }
        if c.eat_keyword("and") {
            continue;
        }
        if c.eat_keyword("or") {
            return Err(ParseError::Unsupported("or".into()));
        }
        if c.eat_keyword("older") {
            let secs = value_after_than(c, "an age like 30d", parse_duration)?;
            selection.filters.push(Filter::OlderThan(secs));
        } else if c.eat_keyword("newer") {
            let secs = value_after_than(c, "an age like 30d", parse_duration)?;
            selection.filters.push(Filter::NewerThan(secs));
        } else if c.eat_keyword("larger") {
            let bytes = value_after_than(c, "a size like 5mb", parse_size)?;
            selection.filters.push(Filter::LargerThan(bytes));
        } else if c.eat_keyword("smaller") {
            let bytes = value_after_than(c, "a size like 5mb", parse_size)?;
            selection.filters.push(Filter::SmallerThan(bytes));
        } else if c.eat_keyword("in") {
            match c.bump() {
                Some(token) => selection.dir = Some(token.text),
                None => {
                    return Err(ParseError::Expected {
                        expected: "a folder",
                        found: None,
                    });
                }
            }
        } else {
            return Err(ParseError::Expected {
                expected: "a condition",
                found: Some(c.bump().unwrap().text),
            });
        }
    }
}

/// Consumes `to DESTINATION`.
fn parse_to_destination(c: &mut Cursor) -> Result<String, ParseError> {
    c.expect_keyword("to", "`to`")?;
    match c.bump() {
        Some(token) => Ok(token.text),
        None => Err(ParseError::Expected {
            expected: "a destination",
            found: None,
        }),
    }
}

/// `MODE := three octal digits`, e.g. `644`.
fn parse_mode(c: &mut Cursor) -> Result<u32, ParseError> {
    match c.bump() {
        Some(token) => {
            let digits = token.text.as_str();
            if digits.len() == 3 && digits.bytes().all(|b| (b'0'..=b'7').contains(&b)) {
                Ok(u32::from_str_radix(digits, 8).expect("checked octal digits"))
            } else {
                Err(ParseError::InvalidMode(token.text))
            }
        }
        None => Err(ParseError::Expected {
            expected: "a mode like 644",
            found: None,
        }),
    }
}

pub fn parse(input: &str) -> Result<Command, ParseError> {
    let tokens = tokenize(input)?;
    if tokens.is_empty() {
        return Err(ParseError::Empty);
    }
    let mut c = Cursor { tokens, pos: 0 };

    let verb = c.bump().unwrap();
    // A quoted verb never matches, like any quoted keyword.
    let verb_lower = if verb.quoted {
        String::new()
    } else {
        verb.text.to_ascii_lowercase()
    };

    let command = match verb_lower.as_str() {
        "move" | "copy" | "rename" => {
            let mut selection = parse_subject(&mut c)?;
            parse_clauses(&mut c, &mut selection, true)?;
            let to = parse_to_destination(&mut c)?;
            match verb_lower.as_str() {
                "move" => Command::Move { selection, to },
                "copy" => Command::Copy { selection, to },
                _ => Command::Rename { selection, to },
            }
        }
        "trash" => {
            let mut selection = parse_subject(&mut c)?;
            parse_clauses(&mut c, &mut selection, false)?;
            Command::Trash { selection }
        }
        "chmod" => {
            let mode = parse_mode(&mut c)?;
            let mut selection = parse_subject(&mut c)?;
            parse_clauses(&mut c, &mut selection, false)?;
            Command::Chmod { mode, selection }
        }
        "mkdir" => match c.bump() {
            Some(token) => Command::Mkdir { path: token.text },
            None => {
                return Err(ParseError::Expected {
                    expected: "a folder name",
                    found: None,
                });
            }
        },
        _ => return Err(ParseError::UnknownVerb(verb.text)),
    };

    if let Some(token) = c.peek() {
        return Err(ParseError::Expected {
            expected: "end of command",
            found: Some(token.text.clone()),
        });
    }
    Ok(command)
}
