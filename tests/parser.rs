//! Specification for the rule-based command parser (PRD §4.5).

use anchoa::parser::{Command, Filter, Kind, ParseError, Selection, parse};

const DAY: u64 = 86_400;

fn glob(g: &str) -> Selection {
    Selection {
        glob: Some(g.into()),
        ..Selection::default()
    }
}

fn expected(expected: &'static str, found: Option<&str>) -> ParseError {
    ParseError::Expected {
        expected,
        found: found.map(Into::into),
    }
}

#[test]
fn prd_examples() {
    assert_eq!(
        parse("move *.jpg older than 30d to ~/Pictures/old"),
        Ok(Command::Move {
            selection: Selection {
                filters: vec![Filter::OlderThan(30 * DAY)],
                ..glob("*.jpg")
            },
            to: "~/Pictures/old".into(),
        })
    );
    assert_eq!(
        parse("trash *.tmp in ~/Downloads"),
        Ok(Command::Trash {
            selection: Selection {
                dir: Some("~/Downloads".into()),
                ..glob("*.tmp")
            },
        })
    );
    assert_eq!(
        parse("copy *.pdf larger than 5mb to ~/Documents/big"),
        Ok(Command::Copy {
            selection: Selection {
                filters: vec![Filter::LargerThan(5_000_000)],
                ..glob("*.pdf")
            },
            to: "~/Documents/big".into(),
        })
    );
    assert_eq!(
        parse("rename *.jpeg to *.jpg"),
        Ok(Command::Rename {
            selection: glob("*.jpeg"),
            to: "*.jpg".into(),
        })
    );
    assert_eq!(
        parse("mkdir 2026-09"),
        Ok(Command::Mkdir {
            path: "2026-09".into()
        })
    );
    assert_eq!(
        parse("chmod 644 *.txt"),
        Ok(Command::Chmod {
            mode: 0o644,
            selection: glob("*.txt"),
        })
    );
}

#[test]
fn kind_can_stand_alone_or_sit_on_either_side_of_the_glob() {
    let files = |g: Option<&str>| Selection {
        glob: g.map(Into::into),
        kind: Some(Kind::Files),
        ..Selection::default()
    };
    assert_eq!(
        parse("trash files"),
        Ok(Command::Trash {
            selection: files(None)
        })
    );
    assert_eq!(
        parse("trash *.log files"),
        Ok(Command::Trash {
            selection: files(Some("*.log"))
        })
    );
    assert_eq!(
        parse("trash files *.log"),
        Ok(Command::Trash {
            selection: files(Some("*.log"))
        })
    );
    assert_eq!(
        parse("move dirs to archive"),
        Ok(Command::Move {
            selection: Selection {
                kind: Some(Kind::Dirs),
                ..Selection::default()
            },
            to: "archive".into(),
        })
    );
}

#[test]
fn clauses_combine_in_any_order_with_optional_and() {
    let want = Selection {
        glob: Some("*".into()),
        kind: None,
        filters: vec![
            Filter::NewerThan(7 * DAY),
            Filter::SmallerThan(10_000),
            Filter::LargerThan(2_000_000_000),
        ],
        dir: Some("/data".into()),
    };
    assert_eq!(
        parse("trash * newer than 7d in /data smaller than 10kb and larger than 2gb"),
        Ok(Command::Trash {
            selection: want.clone()
        })
    );
    assert_eq!(
        parse("trash * newer than 7d and smaller than 10kb larger than 2gb in /data"),
        Ok(Command::Trash { selection: want })
    );
}

#[test]
fn keywords_are_case_insensitive_but_globs_keep_case() {
    assert_eq!(
        parse("  MOVE  *.JPG  Older Than 30D  TO  ~/Old  "),
        Ok(Command::Move {
            selection: Selection {
                filters: vec![Filter::OlderThan(30 * DAY)],
                ..glob("*.JPG")
            },
            to: "~/Old".into(),
        })
    );
}

#[test]
fn quotes_allow_spaces_and_escape_keywords() {
    assert_eq!(
        parse(r#"move "to do.txt" to "My Stuff""#),
        Ok(Command::Move {
            selection: glob("to do.txt"),
            to: "My Stuff".into(),
        })
    );
    assert_eq!(
        parse(r#"trash "files""#),
        Ok(Command::Trash {
            selection: glob("files")
        })
    );
    assert_eq!(parse(r#"trash "oops"#), Err(ParseError::UnclosedQuote));
}

#[test]
fn sizes_and_ages() {
    let larger = |s: &str| match parse(&format!("trash * larger than {s}")) {
        Ok(Command::Trash { selection }) => Ok(selection.filters[0]),
        other => Err(other),
    };
    assert_eq!(larger("100b"), Ok(Filter::LargerThan(100)));
    assert_eq!(larger("1KB"), Ok(Filter::LargerThan(1_000)));
    assert_eq!(larger("3mb"), Ok(Filter::LargerThan(3_000_000)));
    assert_eq!(larger("0gb"), Ok(Filter::LargerThan(0)));
    for bad in [
        "5",
        "mb",
        "5tb",
        "-5mb",
        "5.5mb",
        "5 mb",
        "99999999999999999999gb",
    ] {
        let err = parse(&format!("trash * larger than {bad}")).unwrap_err();
        assert!(
            matches!(
                err,
                ParseError::InvalidSize(_) | ParseError::Expected { .. }
            ),
            "{bad}: {err:?}"
        );
    }
    assert_eq!(
        parse("trash * larger than 5.5mb"),
        Err(ParseError::InvalidSize("5.5mb".into()))
    );
    assert_eq!(
        parse("trash * older than 30"),
        Err(ParseError::InvalidDuration("30".into()))
    );
    assert_eq!(
        parse("trash * older than 2w"),
        Err(ParseError::InvalidDuration("2w".into()))
    );
    assert_eq!(
        parse("trash * older than 99999999999999999999d"),
        Err(ParseError::InvalidDuration("99999999999999999999d".into()))
    );
}

#[test]
fn chmod_mode_must_be_three_octal_digits() {
    for bad in ["64", "0644", "4755", "888", "rwx", "+x", "u+x"] {
        assert_eq!(
            parse(&format!("chmod {bad} *.sh")),
            Err(ParseError::InvalidMode(bad.into())),
            "{bad}"
        );
    }
    assert_eq!(parse("chmod"), Err(expected("a mode like 644", None)));
}

#[test]
fn unknown_or_empty_commands() {
    assert_eq!(parse(""), Err(ParseError::Empty));
    assert_eq!(parse("   "), Err(ParseError::Empty));
    assert_eq!(
        parse("put my old screenshots somewhere tidy"),
        Err(ParseError::UnknownVerb("put".into()))
    );
    // Shell-looking input is just an unknown verb, never executed.
    assert_eq!(parse("rm -rf ~"), Err(ParseError::UnknownVerb("rm".into())));
}

#[test]
fn incomplete_commands_say_what_is_missing() {
    assert_eq!(parse("move"), Err(expected("files to select", None)));
    assert_eq!(parse("move *.jpg"), Err(expected("`to`", None)));
    assert_eq!(parse("move *.jpg to"), Err(expected("a destination", None)));
    assert_eq!(parse("rename a.txt"), Err(expected("`to`", None)));
    assert_eq!(parse("trash"), Err(expected("files to select", None)));
    assert_eq!(parse("mkdir"), Err(expected("a folder name", None)));
    assert_eq!(parse("trash * older"), Err(expected("`than`", None)));
    assert_eq!(
        parse("trash * older 30d"),
        Err(expected("`than`", Some("30d")))
    );
    assert_eq!(parse("trash * in"), Err(expected("a folder", None)));
}

#[test]
fn trailing_or_misplaced_words_are_rejected() {
    assert_eq!(
        parse("trash *.tmp please"),
        Err(expected("a condition", Some("please")))
    );
    assert_eq!(
        parse("move *.jpg to a b"),
        Err(expected("end of command", Some("b")))
    );
    assert_eq!(
        parse("mkdir a b"),
        Err(expected("end of command", Some("b")))
    );
    assert_eq!(
        parse("trash *.tmp to x"),
        Err(expected("a condition", Some("to")))
    );
    assert_eq!(
        parse("trash *.a or *.b"),
        Err(ParseError::Unsupported("or".into()))
    );
    assert_eq!(
        parse("trash files dirs"),
        Err(expected("a condition", Some("dirs")))
    );
}
