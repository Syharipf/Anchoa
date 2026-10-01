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
use crate::{backup, files, time};

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

fn current_user_and_roots(app: &AppHandle) -> Result<(String, files::Roots), AppError> {
    let home = app.path().home_dir()?;
    let user = std::env::var("USER").unwrap_or_else(|_| {
        home.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "user".to_string())
    });
    let mounts_text = std::fs::read_to_string("/proc/mounts").unwrap_or_default();
    let devices = files::parse_mounts(&mounts_text, &user)
        .into_iter()
        .map(|p| PathBuf::from(p.path))
        .collect();
    let roots = files::Roots::new(home, devices);
    Ok((user, roots))
}

#[tauri::command]
pub fn file_places(app: AppHandle) -> Result<files::FilePlaces, AppError> {
    let (user, roots) = current_user_and_roots(&app)?;
    let user_dirs_path = roots.home.join(".config").join("user-dirs.dirs");
    let user_dirs_text = std::fs::read_to_string(&user_dirs_path).ok();
    let data_dir = app.path().app_data_dir()?;
    let places = files::xdg_places(&roots.home, user_dirs_text.as_deref(), &data_dir);
    let mounts_text = std::fs::read_to_string("/proc/mounts").unwrap_or_default();
    let devices = files::parse_mounts(&mounts_text, &user);
    Ok(files::FilePlaces { places, devices })
}

#[tauri::command]
pub fn list_dir(app: AppHandle, path: String, hidden: bool) -> Result<files::Listing, AppError> {
    let (_user, roots) = current_user_and_roots(&app)?;
    files::list_dir(&path, hidden, &roots)
}

#[tauri::command]
pub fn read_text(app: AppHandle, path: String) -> Result<files::TextPreview, AppError> {
    let (_user, roots) = current_user_and_roots(&app)?;
    files::read_text(&path, &roots)
}

#[tauri::command]
pub async fn paste_items(
    app: AppHandle,
    req: files::PasteRequest,
) -> Result<files::OpReport, AppError> {
    let (_user, roots) = current_user_and_roots(&app)?;
    tauri::async_runtime::spawn_blocking(move || files::paste(&req, &roots))
        .await
        .map_err(blocking_error)?
}

#[tauri::command]
pub async fn trash_items(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<files::OpReport, AppError> {
    let (_user, roots) = current_user_and_roots(&app)?;
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
    let (_user, roots) = current_user_and_roots(&app)?;
    let canonical = files::guard(&path, &roots)?;
    app.opener()
        .open_path(canonical.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}


