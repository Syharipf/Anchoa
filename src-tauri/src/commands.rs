//! Thin Tauri glue: every function here only resolves state and delegates.
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::dashboard::{self, Dashboard};
use crate::db::Db;
use crate::error::AppError;
use crate::github::{self, Contributions};
use crate::items::{self, Item, ItemPatch, ItemSummary};
use crate::{backup, time};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatus {
    pub path: String,
    pub error: Option<String>,
    pub backup_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataPaths {
    pub data_dir: String,
    pub backup_dir: String,
    pub log_dir: String,
}

pub fn backup_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app.path().app_data_dir()?.join("backups"))
}

#[tauri::command]
pub fn db_status(db: State<'_, Db>) -> DbStatus {
    DbStatus { path: db.path.display().to_string(), error: db.open_error.clone(), backup_error: db.backup_error.clone() }
}

#[tauri::command]
pub fn capture_note(db: State<'_, Db>, text: String) -> Result<Item, AppError> {
    items::capture_note(&*db.conn()?, &text, time::now_ms())
}

#[tauri::command]
pub fn open_item(db: State<'_, Db>, id: String) -> Result<Item, AppError> {
    items::open(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn update_item(db: State<'_, Db>, id: String, patch: ItemPatch) -> Result<Item, AppError> {
    items::update(&*db.conn()?, &id, &patch, time::now_ms())
}

#[tauri::command]
pub fn complete_item(db: State<'_, Db>, id: String, done: bool) -> Result<Item, AppError> {
    items::complete(&*db.conn()?, &id, done, time::now_ms())
}

#[tauri::command]
pub fn delete_item(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    items::delete(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn list_inbox(db: State<'_, Db>) -> Result<Vec<ItemSummary>, AppError> {
    items::list_inbox(&*db.conn()?)
}

#[tauri::command]
pub fn get_dashboard(db: State<'_, Db>) -> Result<Dashboard, AppError> {
    dashboard::get(&*db.conn()?, time::now_ms(), &jiff::tz::TimeZone::system())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    pub connected: bool,
    pub login: Option<String>,
}

fn blocking_error(e: tauri::Error) -> AppError {
    AppError::Other(format!("Tugas latar gagal: {e}"))
}

#[tauri::command]
pub fn github_status(app: AppHandle, db: State<'_, Db>) -> Result<GithubStatus, AppError> {
    let connected = github::load_token(&app.path().app_config_dir()?).is_some();
    let login = if connected { github::login(&*db.conn()?)? } else { None };
    Ok(GithubStatus { connected, login })
}

/// Checks the token against GitHub first; it is only saved when GitHub accepts it.
#[tauri::command]
pub async fn connect_github(app: AppHandle, token: String) -> Result<GithubStatus, AppError> {
    let dir = app.path().app_config_dir()?;
    let window = github::window(&jiff::Zoned::now())?;
    let (candidate, from, to) = (token.trim().to_string(), window.from.clone(), window.to.clone());
    let (login, days) = tauri::async_runtime::spawn_blocking(move || github::parse(&github::fetch(&candidate, &from, &to)?))
        .await
        .map_err(blocking_error)??;
    github::save_token(&dir, &token)?;
    let db = app.state::<Db>();
    github::store(&*db.conn()?, &login, &days, &window.from_date, &window.today)?;
    Ok(GithubStatus { connected: true, login: Some(login) })
}

#[tauri::command]
pub fn disconnect_github(app: AppHandle, db: State<'_, Db>) -> Result<(), AppError> {
    github::disconnect(&*db.conn()?, &app.path().app_config_dir()?)
}

/// Cached calendar, refreshed from GitHub once per local day (or when forced).
/// A failed refresh returns the cache with `error` set.
#[tauri::command]
pub async fn get_contributions(app: AppHandle, force: bool) -> Result<Contributions, AppError> {
    let dir = app.path().app_config_dir()?;
    let window = github::window(&jiff::Zoned::now())?;
    let token = github::load_token(&dir);
    let view = github::cached(&*app.state::<Db>().conn()?, token.is_some(), &window.from_date)?;
    let Some(token) = token else { return Ok(view) };
    if !github::needs_refresh(&view, &window.today, force) {
        return Ok(view);
    }
    let (from, to) = (window.from.clone(), window.to.clone());
    let fetched = tauri::async_runtime::spawn_blocking(move || github::parse(&github::fetch(&token, &from, &to)?))
        .await
        .map_err(blocking_error)?;
    let db = app.state::<Db>();
    let conn = db.conn()?;
    match fetched {
        Ok((login, days)) => {
            github::store(&conn, &login, &days, &window.from_date, &window.today)?;
            github::cached(&conn, true, &window.from_date)
        }
        Err(e) => Ok(Contributions { error: Some(e.to_string()), ..view }),
    }
}

#[tauri::command]
pub fn backup_now(app: AppHandle, db: State<'_, Db>) -> Result<String, AppError> {
    let path = backup::manual(&*db.conn()?, &backup_dir(&app)?, &time::now_stamp())?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn data_paths(app: AppHandle) -> Result<DataPaths, AppError> {
    Ok(DataPaths {
        data_dir: app.path().app_data_dir()?.display().to_string(),
        backup_dir: backup_dir(&app)?.display().to_string(),
        log_dir: app.path().app_log_dir()?.display().to_string(),
    })
}

/// Opens one of the app's own folders in the file manager. The frontend
/// never passes a path, so it cannot open anything else.
#[tauri::command]
pub fn open_folder(app: AppHandle, kind: String) -> Result<(), AppError> {
    let dir = match kind.as_str() {
        "data" => app.path().app_data_dir()?,
        "backup" => backup_dir(&app)?,
        "log" => app.path().app_log_dir()?,
        other => return Err(AppError::Other(format!("folder tidak dikenal: {other}"))),
    };
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}
