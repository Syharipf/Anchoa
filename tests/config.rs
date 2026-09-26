//! Specification for changing one preference at a time (PRD §4.11).

use std::path::{Path, PathBuf};

use anchoa::config::{self, Config, ConfigError};

fn dir(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("config-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

#[test]
fn update_creates_the_file_from_defaults() {
    let path = dir("create").join("anchoa/config.toml");

    let got = config::update(&path, |c| c.show_hidden = true).unwrap();

    let expected = Config {
        show_hidden: true,
        ..Config::default()
    };
    assert_eq!(got, expected);
    assert_eq!(config::load(&path).unwrap(), expected);
}

#[test]
fn update_keeps_the_other_settings() {
    let path = dir("keep").join("config.toml");
    let before = Config {
        model_path: Some("/models/m.gguf".into()),
        show_hidden: true,
        trash_auto_delete_days: 7,
    };
    config::save(&path, &before).unwrap();

    config::update(&path, |c| c.trash_auto_delete_days = 0).unwrap();

    assert_eq!(
        config::load(&path).unwrap(),
        Config {
            trash_auto_delete_days: 0,
            ..before
        }
    );
}

#[test]
fn update_never_overwrites_a_file_it_cannot_read() {
    let path = dir("invalid").join("config.toml");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "show_hidden = \"yes\"").unwrap();

    let got = config::update(&path, |c| c.show_hidden = true);

    assert!(matches!(got, Err(ConfigError::Parse(_))));
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "show_hidden = \"yes\""
    );
}
