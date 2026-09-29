//! Thin Tauri glue: every function here only resolves state and delegates.
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::dashboard::{self, Dashboard};
use crate::db::Db;
use crate::error::AppError;
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
