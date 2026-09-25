//! User preferences, stored as TOML in `$XDG_CONFIG_HOME/anchoa/config.toml` (not in the database).
//!
//! Blocking file I/O: call from a worker thread only.

use std::io;
use std::path::{Path, PathBuf};

use relm4::gtk::glib;
use serde::{Deserialize, Serialize};

/// Missing keys take their default and unknown keys are ignored, so older and newer
/// config files both load.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    /// `.gguf` model for the LLM fallback; `None` disables the fallback.
    pub model_path: Option<PathBuf>,
    pub show_hidden: bool,
    /// Trash items older than this many days are deleted for good at startup; 0 never.
    pub trash_auto_delete_days: u32,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            model_path: None,
            show_hidden: false,
            trash_auto_delete_days: 30,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error("config file is invalid: {0}")]
    Parse(#[from] toml::de::Error),
    #[error("cannot write config: {0}")]
    Serialize(#[from] toml::ser::Error),
}

/// `$XDG_CONFIG_HOME/anchoa/config.toml`, which Flatpak maps into the app's own directory.
pub fn path() -> PathBuf {
    glib::user_config_dir().join("anchoa").join("config.toml")
}

/// Loads `path`, or the defaults if it does not exist yet.
pub fn load(path: &Path) -> Result<Config, ConfigError> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(toml::from_str(&text)?),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(Config::default()),
        Err(err) => Err(err.into()),
    }
}

/// Writes to a temp file next to `path` and renames it over, so a crash mid-write never
/// leaves a truncated config behind.
pub fn save(path: &Path, config: &Config) -> Result<(), ConfigError> {
    let text = toml::to_string(config)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Serializes [`update`]'s load-modify-save so two worker threads calling it around the same
/// time cannot race: `save` always uses one fixed temp file name, and without this lock a
/// second `load` could run before the first `save`, silently dropping one of the two changes.
static UPDATE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Loads `path` (or the defaults, if it does not exist yet), applies `change`, saves the
/// result, and returns it. A file that fails to parse is left untouched and returns
/// `Err(ConfigError::Parse)`. Concurrent calls are serialized, so two settings changed in
/// quick succession from different workers cannot race each other.
pub fn update(path: &Path, change: impl FnOnce(&mut Config)) -> Result<Config, ConfigError> {
    let _guard = UPDATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut config = load(path)?;
    change(&mut config);
    save(path, &config)?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("anchoa-config-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn trash_is_emptied_after_30_days_unless_configured() {
        assert_eq!(Config::default().trash_auto_delete_days, 30);
        let off: Config = toml::from_str("trash_auto_delete_days = 0").unwrap();
        assert_eq!(off.trash_auto_delete_days, 0);
        let partial: Config = toml::from_str("show_hidden = true").unwrap();
        assert_eq!(partial.trash_auto_delete_days, 30);
    }

    #[test]
    fn missing_file_gives_defaults() {
        let dir = temp_dir("missing");
        assert_eq!(load(&dir.join("config.toml")).unwrap(), Config::default());
    }

    #[test]
    fn save_then_load_round_trips_and_leaves_no_temp_file() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("nested/config.toml");
        let config = Config {
            model_path: Some("/models/qwen2.5-1.5b-instruct-q4_k_m.gguf".into()),
            show_hidden: true,
            trash_auto_delete_days: 7,
        };
        save(&path, &config).unwrap();
        assert_eq!(load(&path).unwrap(), config);
        let files: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(files, ["config.toml"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn partial_and_unknown_keys_load() {
        let config: Config = toml::from_str("show_hidden = true\nfrom_the_future = 1\n").unwrap();
        assert_eq!(
            config,
            Config {
                show_hidden: true,
                ..Config::default()
            }
        );
    }

    #[test]
    fn invalid_file_is_an_error() {
        let dir = temp_dir("invalid");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.toml");
        std::fs::write(&path, "show_hidden = \"yes\"").unwrap();
        assert!(matches!(load(&path), Err(ConfigError::Parse(_))));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
