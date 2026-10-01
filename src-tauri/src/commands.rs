//! Thin Tauri glue: every function here only resolves state and delegates.
use std::path::PathBuf;

use jiff::tz::TimeZone;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::dashboard::{self, Dashboard};
use crate::db::Db;
use crate::error::AppError;
use crate::finance::{
    self, AccountInput, AccountView, Categories, TransactionInput, TransactionPage, TransactionQuery, TransactionView,
    TransferInput,
};
use crate::overview::{self, FinanceOverview};
use crate::bills::{self, BillInput, BillView};
use crate::github::{self, Contributions};
use crate::habits::{self, HabitInput, HabitRow, History as HabitHistory, Overview as HabitsOverview};
use crate::items::{self, Item, ItemPatch, ItemSummary};
use crate::journal::{self, Entry, EntryKind, EntryPatch, JournalList, ListQuery, Side};
use crate::projects::{self, Board, Overview as ProjectsOverview, ProjectDetail, ProjectInput};
use crate::schedule::{self, Schedule, ScheduleRange};
use crate::tasks::{self, NewTask, TaskCard, TaskDetail, TaskPatch};
use crate::{backup, downloader, downloads, files, time};

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
    let now = time::now_ms();
    let conn = db.conn()?;
    let item = items::update(&conn, &id, &patch, now)?;
    if item.kind == "note" {
        journal::after_note_saved(&conn, &item.id, now, &TimeZone::system())?;
    }
    Ok(item)
}

#[tauri::command]
pub fn delete_item(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    items::delete(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn projects_overview(db: State<'_, Db>) -> Result<ProjectsOverview, AppError> {
    projects::projects_overview(&*db.conn()?, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn project_board(db: State<'_, Db>, id: Option<String>) -> Result<Board, AppError> {
    projects::project_board(&*db.conn()?, id.as_deref(), time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn save_project(db: State<'_, Db>, input: ProjectInput) -> Result<ProjectDetail, AppError> {
    projects::save_project(&*db.conn()?, &input, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn delete_project(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    projects::delete_project(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn open_repo(app: AppHandle, db: State<'_, Db>, id: String) -> Result<(), AppError> {
    let url = projects::repo_url(&*db.conn()?, &id)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub fn create_task(db: State<'_, Db>, input: NewTask) -> Result<TaskCard, AppError> {
    tasks::create_task(&*db.conn()?, &input, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn get_task(db: State<'_, Db>, id: String) -> Result<TaskDetail, AppError> {
    tasks::get_task(&*db.conn()?, &id, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn update_task(db: State<'_, Db>, id: String, patch: TaskPatch) -> Result<TaskDetail, AppError> {
    tasks::update_task(&*db.conn()?, &id, &patch, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn delete_task(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    tasks::delete_task(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn convert_to_task(db: State<'_, Db>, id: String) -> Result<TaskDetail, AppError> {
    tasks::convert_to_task(&*db.conn()?, &id, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn list_inbox(db: State<'_, Db>) -> Result<Vec<ItemSummary>, AppError> {
    items::list_inbox(&*db.conn()?)
}

#[tauri::command]
pub fn get_dashboard(db: State<'_, Db>) -> Result<Dashboard, AppError> {
    dashboard::get(&*db.conn()?, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn list_accounts(db: State<'_, Db>) -> Result<Vec<AccountView>, AppError> {
    finance::list_accounts(&*db.conn()?, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn save_account(db: State<'_, Db>, input: AccountInput) -> Result<AccountView, AppError> {
    finance::save_account(&*db.conn()?, &input, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn delete_account(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    finance::delete_account(&*db.conn()?, &id, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn list_transactions(db: State<'_, Db>, query: TransactionQuery) -> Result<TransactionPage, AppError> {
    finance::list_transactions(&*db.conn()?, &query, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn save_transaction(db: State<'_, Db>, input: TransactionInput) -> Result<TransactionView, AppError> {
    finance::save_transaction(&*db.conn()?, &input, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn save_transfer(db: State<'_, Db>, input: TransferInput) -> Result<TransactionView, AppError> {
    finance::save_transfer(&*db.conn()?, &input, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn delete_transaction(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    finance::delete_transaction(&*db.conn()?, &id, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn finance_categories(db: State<'_, Db>) -> Result<Categories, AppError> {
    finance::categories(&*db.conn()?)
}

/// `month: None` is the current local month.
#[tauri::command]
pub fn finance_overview(db: State<'_, Db>, month: Option<String>) -> Result<FinanceOverview, AppError> {
    overview::overview(&*db.conn()?, month.as_deref(), time::now_ms(), &TimeZone::system())
}

/// `amount: None` removes the monthly limit.
#[tauri::command]
pub fn set_budget(db: State<'_, Db>, amount: Option<i64>) -> Result<(), AppError> {
    overview::set_budget(&*db.conn()?, amount, time::now_ms())
}

#[tauri::command]
pub fn list_bills(db: State<'_, Db>) -> Result<Vec<BillView>, AppError> {
    bills::list_bills(&*db.conn()?, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn save_bill(db: State<'_, Db>, input: BillInput) -> Result<BillView, AppError> {
    bills::save_bill(&*db.conn()?, &input, time::now_ms(), &TimeZone::system())
}

/// Returns the recorded expense, so the toast can open it for editing.
#[tauri::command]
pub fn pay_bill(db: State<'_, Db>, id: String) -> Result<TransactionView, AppError> {
    bills::pay_bill(&*db.conn()?, &id, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn delete_bill(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    bills::delete_bill(&*db.conn()?, &id, time::now_ms(), &TimeZone::system())
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
pub fn schedule(db: State<'_, Db>, range: ScheduleRange) -> Result<Schedule, AppError> {
    schedule::schedule(&*db.conn()?, &range, time::now_ms(), &TimeZone::system())
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

#[tauri::command]
pub fn habits_overview(db: State<'_, Db>) -> Result<HabitsOverview, AppError> {
    habits::habits_overview(&*db.conn()?, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn habit_history(db: State<'_, Db>, id: String, month: String) -> Result<HabitHistory, AppError> {
    habits::habit_history(&*db.conn()?, &id, &month, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn save_habit(db: State<'_, Db>, input: HabitInput) -> Result<HabitRow, AppError> {
    habits::save_habit(&*db.conn()?, &input, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn delete_habit(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    habits::delete_habit(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn check_habit(db: State<'_, Db>, id: String, done: bool) -> Result<HabitRow, AppError> {
    habits::check_habit(&*db.conn()?, &id, done, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn journal_list(
    db: State<'_, Db>,
    query: Option<String>,
    kind: Option<EntryKind>,
) -> Result<JournalList, AppError> {
    let q = ListQuery { query, kind };
    let groups = journal::journal_list(&*db.conn()?, &q, time::now_ms(), &TimeZone::system())?;
    Ok(JournalList { groups })
}

#[tauri::command]
pub fn journal_entry(db: State<'_, Db>, id: String) -> Result<Entry, AppError> {
    journal::journal_entry(&*db.conn()?, &id, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn create_entry(
    db: State<'_, Db>,
    kind: EntryKind,
    title: Option<String>,
) -> Result<Entry, AppError> {
    journal::create_entry(&*db.conn()?, kind, title.as_deref(), time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn update_entry(
    db: State<'_, Db>,
    id: String,
    patch: EntryPatch,
) -> Result<Entry, AppError> {
    journal::update_entry(&*db.conn()?, &id, &patch, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn entry_to_task(db: State<'_, Db>, id: String) -> Result<Entry, AppError> {
    journal::entry_to_task(&*db.conn()?, &id, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn journal_side(db: State<'_, Db>) -> Result<Side, AppError> {
    journal::journal_side(&*db.conn()?, time::now_ms(), &TimeZone::system())
}

fn current_user_and_roots(app: &AppHandle) -> Result<(String, files::Roots, Vec<files::Place>), AppError> {
    let home = app.path().home_dir()?;
    let user = std::env::var("USER").unwrap_or_else(|_| {
        home.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "user".to_string())
    });
    let mounts_text = std::fs::read_to_string("/proc/mounts").unwrap_or_default();
    let devices = files::parse_mounts(&mounts_text, &user);
    let device_paths = devices.iter().map(|p| PathBuf::from(&p.path)).collect();
    let roots = files::Roots::new(home, device_paths);
    Ok((user, roots, devices))
}

#[tauri::command]
pub fn file_places(app: AppHandle) -> Result<files::FilePlaces, AppError> {
    let (_user, roots, devices) = current_user_and_roots(&app)?;
    let user_dirs_path = roots.home.join(".config").join("user-dirs.dirs");
    let user_dirs_text = std::fs::read_to_string(&user_dirs_path).ok();
    let data_dir = app.path().app_data_dir()?;
    let places = files::xdg_places(&roots.home, user_dirs_text.as_deref(), &data_dir);
    Ok(files::FilePlaces { places, devices })
}

#[tauri::command]
pub fn list_dir(app: AppHandle, path: String, hidden: bool) -> Result<files::Listing, AppError> {
    let (_user, roots, _) = current_user_and_roots(&app)?;
    files::list_dir(&path, hidden, &roots)
}

#[tauri::command]
pub fn read_text(app: AppHandle, path: String) -> Result<files::TextPreview, AppError> {
    let (_user, roots, _) = current_user_and_roots(&app)?;
    files::read_text(&path, &roots)
}

#[tauri::command]
pub async fn paste_items(
    app: AppHandle,
    req: files::PasteRequest,
) -> Result<files::OpReport, AppError> {
    let (_user, roots, _) = current_user_and_roots(&app)?;
    tauri::async_runtime::spawn_blocking(move || files::paste(&req, &roots))
        .await
        .map_err(blocking_error)?
}

#[tauri::command]
pub async fn trash_items(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<files::OpReport, AppError> {
    let (_user, roots, _) = current_user_and_roots(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        files::trash(&paths, &roots, |p| {
            let status = std::process::Command::new("gio")
                .args(["trash", "--"])
                .arg(p)
                .status()?;
            if !status.success() {
                return Err(std::io::Error::other(format!(
                    "gio trash gagal dengan status: {status}"
                )));
            }
            Ok(())
        })
    })
    .await
    .map_err(blocking_error)?
}

#[tauri::command]
pub fn open_file(app: AppHandle, path: String) -> Result<(), AppError> {
    let (_user, roots, _) = current_user_and_roots(&app)?;
    let canonical = files::guard(&path, &roots)?;
    app.opener()
        .open_path(canonical.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadView {
    pub id: String,
    pub title: String,
    pub url: String,
    pub kind: downloads::DownloadKind,
    pub options: Option<downloads::MediaOptions>,
    pub status: downloads::DownloadStatus,
    pub total_bytes: Option<i64>,
    pub done_bytes: i64,
    pub file_path: Option<String>,
    pub error: Option<String>,
    pub created_at: i64,
    pub finished_at: Option<i64>,
    pub speed: Option<f64>,
    pub eta: Option<u64>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadsPayload {
    pub items: Vec<DownloadView>,
    pub speed: f64,
    pub active: usize,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YtDlpEngine {
    pub version: String,
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegEngine {
    pub version: String,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnginesInfo {
    pub ytdlp: Option<YtDlpEngine>,
    pub ffmpeg: Option<FfmpegEngine>,
    pub hint: Option<String>,
}

pub fn is_ytdlp_stale(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() < 3 {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        parts[0].parse::<i16>(),
        parts[1].parse::<i8>(),
        parts[2].parse::<i8>(),
    ) else {
        return false;
    };
    let Ok(ver_date) = jiff::civil::Date::new(year, month, day) else {
        return false;
    };
    let today = jiff::Zoned::now().date();
    today.since(ver_date).is_ok_and(|span| span.get_days() > 60)
}

#[tauri::command]
pub fn downloads_list(
    db: State<'_, Db>,
    downloader: State<'_, downloader::Downloader>,
) -> Result<DownloadsPayload, AppError> {
    let rows = downloads::list(&*db.conn()?)?;
    let live = downloader.live();

    let items: Vec<DownloadView> = rows
        .into_iter()
        .map(|r| {
            if let Some(l) = live.get(&r.id) {
                DownloadView {
                    id: r.id,
                    title: r.title,
                    url: r.url,
                    kind: r.kind,
                    options: r.options,
                    status: r.status,
                    total_bytes: l.total.map(|t| t as i64).or(r.total_bytes),
                    done_bytes: l.done as i64,
                    file_path: r.file_path,
                    error: r.error,
                    created_at: r.created_at,
                    finished_at: r.finished_at,
                    speed: l.speed,
                    eta: l.eta,
                }
            } else {
                DownloadView {
                    id: r.id,
                    title: r.title,
                    url: r.url,
                    kind: r.kind,
                    options: r.options,
                    status: r.status,
                    total_bytes: r.total_bytes,
                    done_bytes: r.done_bytes,
                    file_path: r.file_path,
                    error: r.error,
                    created_at: r.created_at,
                    finished_at: r.finished_at,
                    speed: None,
                    eta: None,
                }
            }
        })
        .collect();

    let speed: f64 = items.iter().filter_map(|i| i.speed).sum();
    let active = items
        .iter()
        .filter(|i| {
            matches!(
                i.status,
                downloads::DownloadStatus::Running | downloads::DownloadStatus::Processing
            )
        })
        .count();

    Ok(DownloadsPayload {
        items,
        speed,
        active,
    })
}

#[tauri::command]
pub fn add_download(
    app: AppHandle,
    db: State<'_, Db>,
    downloader: State<'_, downloader::Downloader>,
    input: downloads::NewDownload,
) -> Result<DownloadView, AppError> {
    let row = downloads::add(&*db.conn()?, &input, time::now_ms())?;
    let _ = downloader.schedule(&app);
    Ok(DownloadView {
        id: row.id,
        title: row.title,
        url: row.url,
        kind: row.kind,
        options: row.options,
        status: row.status,
        total_bytes: row.total_bytes,
        done_bytes: row.done_bytes,
        file_path: row.file_path,
        error: row.error,
        created_at: row.created_at,
        finished_at: row.finished_at,
        speed: None,
        eta: None,
    })
}

#[tauri::command]
pub fn pause_download(
    app: AppHandle,
    db: State<'_, Db>,
    downloader: State<'_, downloader::Downloader>,
    id: String,
) -> Result<(), AppError> {
    let _ = downloader.pause(&id);
    downloads::set_status(
        &*db.conn()?,
        &id,
        downloads::DownloadStatus::Paused,
        None,
        time::now_ms(),
    )?;
    let _ = downloader.schedule(&app);
    Ok(())
}

#[tauri::command]
pub fn resume_download(
    app: AppHandle,
    db: State<'_, Db>,
    downloader: State<'_, downloader::Downloader>,
    id: String,
) -> Result<(), AppError> {
    downloads::set_status(
        &*db.conn()?,
        &id,
        downloads::DownloadStatus::Queued,
        None,
        time::now_ms(),
    )?;
    downloader.schedule(&app)?;
    Ok(())
}

#[tauri::command]
pub fn retry_download(
    app: AppHandle,
    db: State<'_, Db>,
    downloader: State<'_, downloader::Downloader>,
    id: String,
) -> Result<(), AppError> {
    downloads::set_status(
        &*db.conn()?,
        &id,
        downloads::DownloadStatus::Queued,
        None,
        time::now_ms(),
    )?;
    downloader.schedule(&app)?;
    Ok(())
}

#[tauri::command]
pub fn remove_download(
    app: AppHandle,
    db: State<'_, Db>,
    downloader: State<'_, downloader::Downloader>,
    id: String,
) -> Result<(), AppError> {
    let conn = db.conn()?;
    let row = downloads::get(&conn, &id)?;
    if row.status != downloads::DownloadStatus::Done {
        let _ = downloader.cancel(&id);
        let home = app.path().home_dir()?;
        let user_dirs_path = home.join(".config").join("user-dirs.dirs");
        let user_dirs_text = std::fs::read_to_string(&user_dirs_path).ok();
        let default_dir =
            files::xdg_dir(&home, user_dirs_text.as_deref(), "XDG_DOWNLOAD_DIR", "Downloads");
        let s = downloads::settings(&conn, &default_dir)?;
        let part_dir = PathBuf::from(&s.dir).join(".anchoa-part").join(&id);
        let _ = std::fs::remove_dir_all(&part_dir);
    }
    downloads::remove(&conn, &id, time::now_ms())?;
    let _ = downloader.schedule(&app);
    Ok(())
}

#[tauri::command]
pub fn open_download(
    app: AppHandle,
    db: State<'_, Db>,
    id: String,
) -> Result<(), AppError> {
    let conn = db.conn()?;
    let row = downloads::get(&conn, &id)?;
    let home = app.path().home_dir()?;
    let user_dirs_path = home.join(".config").join("user-dirs.dirs");
    let user_dirs_text = std::fs::read_to_string(&user_dirs_path).ok();
    let default_dir =
        files::xdg_dir(&home, user_dirs_text.as_deref(), "XDG_DOWNLOAD_DIR", "Downloads");
    let s = downloads::settings(&conn, &default_dir)?;

    if row.status == downloads::DownloadStatus::Done && let Some(file_path) = row.file_path {
        app.opener()
            .open_path(file_path, None::<&str>)
            .map_err(|e| AppError::Other(e.to_string()))
    } else {
        app.opener()
            .open_path(s.dir, None::<&str>)
            .map_err(|e| AppError::Other(e.to_string()))
    }
}

#[tauri::command]
pub fn reveal_download(
    app: AppHandle,
    db: State<'_, Db>,
    id: String,
) -> Result<String, AppError> {
    let conn = db.conn()?;
    let row = downloads::get(&conn, &id)?;
    if let Some(fp) = row.file_path {
        let p = PathBuf::from(&fp);
        if let Some(parent) = p.parent() {
            return Ok(parent.to_string_lossy().to_string());
        }
        return Ok(fp);
    }
    let home = app.path().home_dir()?;
    let user_dirs_path = home.join(".config").join("user-dirs.dirs");
    let user_dirs_text = std::fs::read_to_string(&user_dirs_path).ok();
    let default_dir =
        files::xdg_dir(&home, user_dirs_text.as_deref(), "XDG_DOWNLOAD_DIR", "Downloads");
    let s = downloads::settings(&conn, &default_dir)?;
    Ok(s.dir)
}

#[tauri::command]
pub fn download_engines() -> Result<EnginesInfo, AppError> {
    let ytdlp_out = std::process::Command::new("yt-dlp")
        .arg("--version")
        .output()
        .ok();
    let ytdlp = ytdlp_out
        .filter(|o| o.status.success())
        .and_then(|o| {
            let ver = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if ver.is_empty() {
                None
            } else {
                let stale = is_ytdlp_stale(&ver);
                Some(YtDlpEngine {
                    version: ver,
                    stale,
                })
            }
        });

    let ffmpeg_out = std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
        .ok();
    let ffmpeg = ffmpeg_out
        .filter(|o| o.status.success())
        .and_then(|o| {
            let first_line = String::from_utf8_lossy(&o.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if first_line.is_empty() {
                None
            } else {
                Some(FfmpegEngine { version: first_line })
            }
        });

    let hint = if ytdlp.is_none() || ffmpeg.is_none() {
        Some("sudo dnf install yt-dlp ffmpeg".to_string())
    } else if ytdlp.as_ref().is_some_and(|y| y.stale) {
        Some("Perbarui: sudo dnf upgrade yt-dlp".to_string())
    } else {
        None
    };

    Ok(EnginesInfo {
        ytdlp,
        ffmpeg,
        hint,
    })
}

#[tauri::command]
pub fn download_settings(
    app: AppHandle,
    db: State<'_, Db>,
) -> Result<downloads::DownloadSettings, AppError> {
    let conn = db.conn()?;
    let home = app.path().home_dir()?;
    let user_dirs_path = home.join(".config").join("user-dirs.dirs");
    let user_dirs_text = std::fs::read_to_string(&user_dirs_path).ok();
    let default_dir =
        files::xdg_dir(&home, user_dirs_text.as_deref(), "XDG_DOWNLOAD_DIR", "Downloads");
    downloads::settings(&conn, &default_dir)
}

#[tauri::command]
pub fn save_download_settings(
    app: AppHandle,
    db: State<'_, Db>,
    downloader: State<'_, downloader::Downloader>,
    settings: downloads::DownloadSettings,
) -> Result<downloads::DownloadSettings, AppError> {
    let conn = db.conn()?;
    let home = app.path().home_dir()?;
    let saved = downloads::save_settings(&conn, &settings, &home)?;
    let _ = downloader.schedule(&app);
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_ytdlp_stale_identifies_old_and_current_versions() {
        assert!(is_ytdlp_stale("2020.01.01"));
        let today = jiff::Zoned::now().date();
        let current = format!("{}.{:02}.{:02}", today.year(), today.month(), today.day());
        assert!(!is_ytdlp_stale(&current));
        assert!(!is_ytdlp_stale("invalid.version"));
    }
}



