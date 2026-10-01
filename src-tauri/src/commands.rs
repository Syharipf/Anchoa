//! Thin Tauri glue: every function here only resolves state and delegates.
use std::collections::HashMap;
use std::path::PathBuf;

use jiff::tz::TimeZone;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::activities::{self, Activity, NewActivity};
use crate::agent_runner::{self, AgentRunner};
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
use crate::{backup, downloader, downloads, files, links, notes, search, time};

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
pub fn agent_request(
    app: AppHandle,
    db: State<'_, Db>,
    runner: State<'_, AgentRunner>,
    project_id: String,
    text: String,
) -> Result<TaskCard, AppError> {
    runner.ensure_idle(&project_id)?;
    let (task, should_start) = agent_runner::create_request(
        &*db.conn()?,
        &project_id,
        &text,
        time::now_ms(),
        &TimeZone::system(),
    )?;
    // The DB guard above is dropped before start() loads the project again.
    if should_start {
        runner.start(&app, &project_id, &task.id, &text)?;
    }
    Ok(task)
}

#[tauri::command]
pub fn agent_stop(runner: State<'_, AgentRunner>, project_id: String) -> Result<(), AppError> {
    runner.stop(&project_id)
}

#[tauri::command]
pub fn agent_running(runner: State<'_, AgentRunner>) -> Vec<String> {
    runner.running()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastActor {
    pub actor: String,
    pub role: activities::Role,
}

#[tauri::command]
pub fn agent_last_actors(
    db: State<'_, Db>,
    project_id: String,
) -> Result<HashMap<String, LastActor>, AppError> {
    Ok(activities::last_for_tasks(&*db.conn()?, &project_id)?
        .into_iter()
        .map(|(task_id, (actor, role))| (task_id, LastActor { actor, role }))
        .collect())
}

#[tauri::command]
pub fn task_activities(db: State<'_, Db>, task_id: String) -> Result<Vec<Activity>, AppError> {
    activities::for_task(&*db.conn()?, &task_id)
}

#[tauri::command]
pub fn add_activity(db: State<'_, Db>, input: NewActivity) -> Result<Activity, AppError> {
    activities::add(&*db.conn()?, &input, time::now_ms())
}

#[tauri::command]
pub fn agent_log(app: AppHandle, db: State<'_, Db>, task_id: String) -> Result<String, AppError> {
    tasks::get_task(&*db.conn()?, &task_id, time::now_ms(), &TimeZone::system())?;
    agent_runner::read_log(&app.path().app_data_dir()?, &task_id)
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
pub fn get_dashboard(
    db: State<'_, Db>,
    downloader: State<'_, downloader::Downloader>,
) -> Result<Dashboard, AppError> {
    let live = downloader.live();
    dashboard::get(&*db.conn()?, &live, time::now_ms(), &TimeZone::system())
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadView {
    #[serde(flatten)]
    pub row: downloads::DownloadRow,
    pub speed: Option<f64>,
    pub eta: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadsPayload {
    pub items: Vec<DownloadView>,
    pub speed: f64,
    pub active: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtDlpEngine {
    pub version: String,
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegEngine {
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
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
        .map(|mut row| {
            let l = live.get(&row.id);
            // Live bytes start at 0 until the first update; keep the stored ones until then.
            if let Some(l) = l.filter(|l| l.done > 0) {
                row.done_bytes = l.done as i64;
                row.total_bytes = l.total.map(|t| t as i64).or(row.total_bytes);
            }
            DownloadView {
                speed: l.and_then(|l| l.speed),
                eta: l.and_then(|l| l.eta),
                row,
            }
        })
        .collect();

    // A paused worker can linger in the live map for a moment: count running rows only.
    let running = || {
        items.iter().filter(|i| {
            matches!(
                i.row.status,
                downloads::DownloadStatus::Running | downloads::DownloadStatus::Processing
            )
        })
    };
    let speed = running().filter_map(|i| i.speed).sum();
    let active = running().count();

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
        row,
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
    // Paused first: a worker that still finishes in the meantime then ends as Done.
    downloads::set_status(
        &*db.conn()?,
        &id,
        downloads::DownloadStatus::Paused,
        None,
        time::now_ms(),
    )?;
    downloader.stop(&id)?;
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
    downloader.schedule(&app)
}

#[tauri::command]
pub fn retry_download(
    app: AppHandle,
    db: State<'_, Db>,
    downloader: State<'_, downloader::Downloader>,
    id: String,
) -> Result<(), AppError> {
    resume_download(app, db, downloader, id)
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
    downloads::remove(&conn, &id, time::now_ms())?;
    downloader.stop(&id)?;
    // A running worker removes its own temp folder once it has stopped.
    if matches!(
        row.status,
        downloads::DownloadStatus::Queued
            | downloads::DownloadStatus::Paused
            | downloads::DownloadStatus::Failed
    ) {
        let dir = downloader::current_settings(&app, &conn)?.dir;
        let _ = std::fs::remove_dir_all(PathBuf::from(dir).join(".anchoa-part").join(&id));
    }
    // schedule() locks the database itself.
    drop(conn);
    let _ = downloader.schedule(&app);
    Ok(())
}

#[tauri::command]
pub fn open_download(app: AppHandle, db: State<'_, Db>, id: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    let row = downloads::get(&conn, &id)?;
    let path = match row.file_path {
        Some(file) if row.status == downloads::DownloadStatus::Done => file,
        _ => downloader::current_settings(&app, &conn)?.dir,
    };
    drop(conn);
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub fn reveal_download(app: AppHandle, db: State<'_, Db>, id: String) -> Result<String, AppError> {
    let conn = db.conn()?;
    let row = downloads::get(&conn, &id)?;
    match row.file_path.as_deref().map(std::path::Path::new).and_then(std::path::Path::parent) {
        Some(parent) => Ok(parent.to_string_lossy().into_owned()),
        None => Ok(downloader::current_settings(&app, &conn)?.dir),
    }
}

/// Async so that starting yt-dlp and ffmpeg does not block the UI thread.
#[tauri::command]
pub async fn download_engines() -> Result<EnginesInfo, AppError> {
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
    downloader::current_settings(&app, &*db.conn()?)
}

#[tauri::command]
pub fn save_download_settings(
    app: AppHandle,
    db: State<'_, Db>,
    downloader: State<'_, downloader::Downloader>,
    settings: downloads::DownloadSettings,
) -> Result<downloads::DownloadSettings, AppError> {
    let home = app.path().home_dir()?;
    // The guard is dropped at the end of this line: schedule() locks the database itself.
    let saved = downloads::save_settings(&*db.conn()?, &settings, &home)?;
    let _ = downloader.schedule(&app);
    Ok(saved)
}

#[tauri::command]
pub fn pages_tree(db: State<'_, Db>) -> Result<Vec<notes::PageNode>, AppError> {
    notes::tree(&*db.conn()?)
}

#[tauri::command]
pub fn create_page(
    db: State<'_, Db>,
    parent_id: Option<String>,
    title: String,
) -> Result<notes::PageNode, AppError> {
    notes::create(&*db.conn()?, parent_id.as_deref(), &title, time::now_ms())
}

#[tauri::command]
pub fn rename_page(
    db: State<'_, Db>,
    id: String,
    title: String,
) -> Result<notes::PageNode, AppError> {
    notes::rename(&*db.conn()?, &id, &title, time::now_ms())
}

#[tauri::command]
pub fn move_page(
    db: State<'_, Db>,
    id: String,
    parent_id: Option<String>,
) -> Result<notes::PageNode, AppError> {
    notes::move_page(&*db.conn()?, &id, parent_id.as_deref(), time::now_ms())
}

#[tauri::command]
pub fn save_page_body(
    db: State<'_, Db>,
    id: String,
    body: String,
) -> Result<(), AppError> {
    notes::save_body(&*db.conn()?, &id, &body, time::now_ms())
}

#[tauri::command]
pub fn delete_page(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    notes::delete(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn pages_trash(db: State<'_, Db>) -> Result<Vec<notes::TrashEntry>, AppError> {
    notes::trash(&*db.conn()?)
}

#[tauri::command]
pub fn restore_page(db: State<'_, Db>, id: String) -> Result<notes::PageNode, AppError> {
    notes::restore(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn page_backlinks(db: State<'_, Db>, id: String) -> Result<Vec<links::Backlink>, AppError> {
    links::backlinks(&*db.conn()?, &id)
}

#[tauri::command]
pub fn resolve_link(db: State<'_, Db>, title: String) -> Result<Option<ItemSummary>, AppError> {
    links::resolve(&*db.conn()?, &title)
}

#[tauri::command]
pub fn search_items(
    db: State<'_, Db>,
    text: String,
    pages_only: bool,
    limit: u32,
) -> Result<Vec<search::SearchHit>, AppError> {
    search::search(&*db.conn()?, &text, pages_only, limit as usize)
}

#[tauri::command]
pub fn export_pages(app: AppHandle, db: State<'_, Db>) -> Result<String, AppError> {
    let home = app.path().home_dir()?;
    let user_dirs = std::fs::read_to_string(home.join(".config/user-dirs.dirs")).ok();
    let root = files::xdg_dir(&home, user_dirs.as_deref(), "XDG_DOCUMENTS_DIR", "Documents");
    let path = notes::export(&*db.conn()?, &root)?;
    Ok(path.display().to_string())
}

pub fn check_link(url: &str) -> Result<(), AppError> {
    let lower = url.trim().to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        Ok(())
    } else {
        Err(AppError::Invalid("Tautan harus dimulai dengan http:// atau https://".into()))
    }
}

#[tauri::command]
pub fn open_link(app: AppHandle, url: String) -> Result<(), AppError> {
    check_link(&url)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_actors_serialize_as_a_task_keyed_object() {
        let actors = HashMap::from([
            (
                "first-task".to_string(),
                LastActor {
                    actor: "Sol".into(),
                    role: activities::Role::Implement,
                },
            ),
            (
                "done-task".to_string(),
                LastActor {
                    actor: "Kamu".into(),
                    role: activities::Role::Merge,
                },
            ),
        ]);
        assert_eq!(
            serde_json::to_value(actors).unwrap(),
            serde_json::json!({
                "first-task": { "actor": "Sol", "role": "implement" },
                "done-task": { "actor": "Kamu", "role": "merge" },
            }),
        );
        assert_eq!(
            serde_json::to_value(HashMap::<String, LastActor>::new()).unwrap(),
            serde_json::json!({}),
        );
    }

    #[test]
    fn is_ytdlp_stale_identifies_old_and_current_versions() {
        assert!(is_ytdlp_stale("2020.01.01"));
        let today = jiff::Zoned::now().date();
        let current = format!("{}.{:02}.{:02}", today.year(), today.month(), today.day());
        assert!(!is_ytdlp_stale(&current));
        assert!(!is_ytdlp_stale("invalid.version"));
    }

    #[test]
    fn open_link_rejects_file_and_javascript() {
        assert!(check_link("http://example.com").is_ok());
        assert!(check_link("https://example.com/notes").is_ok());
        assert!(check_link("HTTP://EXAMPLE.COM").is_ok());
        assert!(check_link("file:///etc/passwd").is_err());
        assert!(check_link("javascript:alert(1)").is_err());
        assert!(check_link("ftp://example.com").is_err());
        assert!(check_link("data:text/html,bad").is_err());
        assert!(check_link("").is_err());
    }
}
