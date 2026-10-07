//! OS-level delivery of the reminders the notification panel already computes.
//!
//! The panel is the single source of reminder semantics (`dashboard::get` feeds
//! `src/notifications/reminders.ts`), so this module never re-derives them: it
//! flattens the same [`Dashboard`] into a list of due reminders and hands each
//! one to the notification plugin. Everything that decides *whether* to deliver
//! is a pure function over that list, the stored preferences and the set of ids
//! already delivered today, so the delivery policy is testable without a Tauri
//! app.
//!
//! "Even when the app is closed": a Tauri desktop process cannot hand a
//! notification to the OS once it has exited. This module keeps a background
//! thread alive for as long as the app runs — window visible, hidden or
//! minimized — and delivers each due reminder once per local day. When the
//! process truly exits, nothing fires until it is started again; keeping the
//! app alive in the tray (and starting it minimized) is what would make
//! delivery continue across "closing the window".

use std::collections::BTreeSet;
use std::thread;
use std::time::Duration;

use jiff::tz::TimeZone;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_notification::{NotificationExt, PermissionState};

use crate::bills::BillStatus;
use crate::dashboard::{self, Dashboard};
use crate::db::Db;
use crate::downloader::Downloader;
use crate::error::AppError;
use crate::overview::BudgetLevel;
use crate::profile::{self, NotifyPrefs};
use crate::security::SecurityState;
use crate::time;

/// How often the background thread looks for newly due reminders.
pub const TICK: Duration = Duration::from_secs(30);

/// `notify.os.delivered.<YYYY-MM-DD>` holds the ids delivered that day.
const DELIVERED_PREFIX: &str = "notify.os.delivered.";
const PROMPTED_KEY: &str = "notify.os.prompted";
const LOG_KEY: &str = "notify.os.log";
/// Delivery-log rows kept in the settings value.
const LOG_KEEP: usize = 300;
/// Rows returned to the settings screen.
const LOG_SHOWN: usize = 20;

/// Why a reminder was not shown as an OS notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skip {
    /// The user turned that category off in-app.
    Disabled,
    /// Already delivered today; never re-notified the same day.
    AlreadyToday,
}

/// One reminder of the panel, flattened for the OS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OsReminder {
    /// Stable across restarts, e.g. `task:abc`; also the deduplication key.
    pub id: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
}

/// What one tick decided to do.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Plan {
    /// Reminders to hand to the OS, in panel order.
    pub deliver: Vec<OsReminder>,
    /// `(reminder id, why it was skipped)`.
    pub skipped: Vec<(String, Skip)>,
}

/// Whether the preferences allow an OS notification for this reminder kind.
///
/// Mirrors the default the in-app panel applies (`reminders.ts`), so a category
/// the user never touched behaves the same in both places.
pub fn enabled(prefs: &NotifyPrefs, kind: &str) -> bool {
    match kind {
        "task" => prefs.task,
        "bill" => prefs.bill,
        "budget" => prefs.budget,
        "habit" => prefs.habit,
        "journal" => prefs.journal,
        _ => false,
    }
}

/// The same reminders the panel lists for "Terlambat" and "Hari ini", flattened.
///
/// The journal reminder is left out: it has no configured hour in the dashboard
/// payload and its dismissal state already lives in `settings`, so it keeps
/// its in-app behaviour until the two are unified.
pub fn due_reminders(dash: &Dashboard, tz: &TimeZone) -> Vec<OsReminder> {
    let mut out = Vec::new();
    for task in &dash.today {
        if task.completed_at.is_some() {
            continue;
        }
        let detail = if task.overdue {
            match time::local_date(task.due_at, tz) {
                Ok(date) => format!(
                    "Terlambat · jatuh tempo {} {}",
                    date.day(),
                    time::indonesian_short_month(date.month())
                ),
                Err(_) => "Terlambat".to_string(),
            }
        } else {
            "Jatuh tempo hari ini".to_string()
        };
        out.push(OsReminder {
            id: format!("task:{}", task.id),
            kind: "task".into(),
            title: if task.title.trim().is_empty() { "Tanpa judul".into() } else { task.title.clone() },
            detail,
        });
    }
    for bill in &dash.finance.due_bills {
        let detail = if bill.status == BillStatus::Overdue {
            format!("Terlambat {} hari", bill.days_late)
        } else {
            "Jatuh tempo hari ini".to_string()
        };
        out.push(OsReminder {
            id: format!("bill:{}", bill.id),
            kind: "bill".into(),
            title: bill.name.clone(),
            detail: format!("{detail} · {}", rupiah(bill.amount)),
        });
    }
    for habit in &dash.habit_reminders {
        out.push(OsReminder {
            id: format!("habit:{}", habit.id),
            kind: "habit".into(),
            title: habit.name.clone(),
            detail: format!("Belum dicentang · pengingat {}", habit.remind_at.replace(':', ".")),
        });
    }
    if let Some(budget) = &dash.finance.budget
        && budget.level != BudgetLevel::Ok
    {
        let percent = if budget.amount == 0 {
            0
        } else {
            dash.finance.expense.saturating_mul(100) / budget.amount
        };
        out.push(OsReminder {
            id: "budget:budget".into(),
            kind: "budget".into(),
            title: "Batas pengeluaran".into(),
            detail: format!("Pengeluaran {percent}% dari batas"),
        });
    }
    out
}

/// `Rp1.500.000`, the same shape the panel shows.
fn rupiah(amount: i64) -> String {
    let digits = amount.unsigned_abs().to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3 + 3);
    if amount < 0 {
        grouped.push('-');
    }
    grouped.push_str("Rp");
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(c);
    }
    grouped
}

/// Picks the reminders to deliver right now.
///
/// `delivered` holds the ids already delivered today, so a reminder reaches the
/// OS at most once per local day.
pub fn plan(reminders: &[OsReminder], prefs: &NotifyPrefs, delivered: &BTreeSet<String>) -> Plan {
    let mut plan = Plan::default();
    for reminder in reminders {
        if !enabled(prefs, &reminder.kind) {
            plan.skipped.push((reminder.id.clone(), Skip::Disabled));
        } else if delivered.contains(&reminder.id) {
            plan.skipped.push((reminder.id.clone(), Skip::AlreadyToday));
        } else {
            plan.deliver.push(reminder.clone());
        }
    }
    plan
}

/// Whether this tick may ask the OS for permission.
///
/// Only when the user has enabled at least one category themselves, and only
/// while the OS still says "prompt" — never silently at startup, and never
/// again on every tick once the answer is known.
pub fn should_prompt(enabled_any: bool, permission: PermissionState) -> bool {
    enabled_any && permission == PermissionState::Prompt
}

/// What happened when one reminder was shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Shown,
    /// The OS refused, or is still asking; the in-app panel keeps working.
    Denied,
    Failed,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Shown => "shown",
            Outcome::Denied => "denied",
            Outcome::Failed => "failed",
        }
    }
}

/// Maps a permission state and the result of `show()` to a delivery outcome.
pub fn outcome(state: PermissionState, shown: Result<(), String>) -> Outcome {
    match state {
        PermissionState::Denied | PermissionState::Prompt | PermissionState::PromptWithRationale => Outcome::Denied,
        PermissionState::Granted => match shown {
            Ok(()) => Outcome::Shown,
            Err(_) => Outcome::Failed,
        },
    }
}

/// Human-readable reason for the settings screen when nothing can be shown.
pub fn denied_reason(state: PermissionState) -> Option<&'static str> {
    match state {
        PermissionState::Denied => Some("Izin notifikasi ditolak di pengaturan sistem. Panel dalam app tetap berjalan."),
        PermissionState::Prompt | PermissionState::PromptWithRationale => {
            Some("Izin notifikasi belum diberikan. Aktifkan lewat tombol di bawah.")
        }
        PermissionState::Granted => None,
    }
}

fn ids_key(today: &str) -> String {
    format!("{DELIVERED_PREFIX}{today}")
}

fn setting(conn: &Connection, key: &str) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()?)
}

fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Ids already delivered on `today`.
pub fn delivered_ids(conn: &Connection, today: &str) -> Result<BTreeSet<String>, AppError> {
    Ok(setting(conn, &ids_key(today))?
        .map(|raw| raw.split(',').filter(|id| !id.is_empty()).map(str::to_owned).collect())
        .unwrap_or_default())
}

/// Records ids as delivered on `today`, dropping every other day's record.
pub fn add_delivered(conn: &Connection, today: &str, ids: &BTreeSet<String>) -> Result<(), AppError> {
    let joined = ids.iter().map(String::as_str).collect::<Vec<_>>().join(",");
    set_setting(conn, &ids_key(today), &joined)?;
    conn.execute("DELETE FROM settings WHERE key LIKE ?1 AND key != ?2", params![
        format!("{DELIVERED_PREFIX}%"),
        ids_key(today)
    ])?;
    Ok(())
}

/// One delivery-log row, for the "Bukti pengiriman" list in settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryEntry {
    pub at: i64,
    pub id: String,
    pub title: String,
    pub state: String,
    pub reason: Option<String>,
}

fn append_log(conn: &Connection, entry: &DeliveryEntry) -> Result<(), AppError> {
    let line = serde_json::to_string(entry).map_err(|e| AppError::Other(e.to_string()))?;
    let previous = setting(conn, LOG_KEY)?.unwrap_or_default();
    let mut kept: Vec<&str> = previous.lines().collect();
    kept.push(&line);
    if kept.len() > LOG_KEEP {
        kept.drain(..kept.len() - LOG_KEEP);
    }
    set_setting(conn, LOG_KEY, &kept.join("\n"))
}

/// The most recent delivery rows, newest first.
pub fn log_entries(conn: &Connection) -> Result<Vec<DeliveryEntry>, AppError> {
    let mut entries = Vec::new();
    for line in setting(conn, LOG_KEY)?.unwrap_or_default().lines().rev().take(LOG_SHOWN) {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        entries.push(DeliveryEntry {
            at: value.get("at").and_then(serde_json::Value::as_i64).unwrap_or(0),
            id: value.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            title: value.get("title").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            state: value.get("state").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            reason: value.get("reason").and_then(|v| v.as_str()).map(str::to_owned),
        });
    }
    Ok(entries)
}

/// Snapshot of the OS bridge for the settings screen.
///
/// There is no "running" flag: every command is rejected while the app is
/// locked, so whenever this is readable the scheduler is delivering.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    /// `granted`, `denied` or `prompt`.
    pub permission: &'static str,
    pub reason: Option<&'static str>,
    /// The latest delivery-log rows, newest first.
    pub recent: Vec<DeliveryEntry>,
}

/// The wire name of a permission state; "prompt with rationale" is still "prompt".
pub fn permission_name(state: PermissionState) -> &'static str {
    match state {
        PermissionState::Granted => "granted",
        PermissionState::Denied => "denied",
        PermissionState::Prompt | PermissionState::PromptWithRationale => "prompt",
    }
}

/// Persists the delivery rows; skipped rows borrow their title from `due`.
fn record(
    conn: &Connection,
    due: &[OsReminder],
    shown: &[(OsReminder, Outcome)],
    skipped: &[(String, Skip)],
    at: i64,
) -> Result<(), AppError> {
    for (reminder, outcome) in shown {
        append_log(conn, &DeliveryEntry {
            at,
            id: reminder.id.clone(),
            title: reminder.title.clone(),
            state: outcome.as_str().into(),
            reason: None,
        })?;
    }
    for (id, reason) in skipped {
        if *reason != Skip::Disabled {
            continue;
        }
        let title = due.iter().find(|r| r.id == *id).map(|r| r.title.clone()).unwrap_or_default();
        append_log(conn, &DeliveryEntry {
            at,
            id: id.clone(),
            title,
            state: "skipped".into(),
            reason: Some("disabled".into()),
        })?;
    }
    Ok(())
}

/// Sends one reminder through the notification plugin.
pub fn show<R: Runtime>(app: &AppHandle<R>, reminder: &OsReminder) -> (PermissionState, Result<(), String>) {
    let notification = app.notification();
    let state = notification.permission_state().unwrap_or(PermissionState::Prompt);
    if state != PermissionState::Granted {
        return (state, Ok(()));
    }
    let result = notification
        .builder()
        .title(reminder.title.clone())
        .body(reminder.detail.clone())
        .show()
        .map_err(|e| e.to_string());
    (state, result)
}

/// The status shown in settings.
pub fn status<R: Runtime>(app: &AppHandle<R>) -> Result<BridgeStatus, AppError> {
    let state = app.notification().permission_state().unwrap_or(PermissionState::Prompt);
    let Some(db) = app.try_state::<Db>() else { return Err(AppError::DbUnavailable) };
    let conn = db.conn()?;
    Ok(BridgeStatus {
        permission: permission_name(state),
        reason: denied_reason(state),
        recent: log_entries(&conn)?,
    })
}

/// Asks the OS for notification permission; touches no state of its own.
fn ask_os_permission<R: Runtime>(app: &AppHandle<R>) -> Result<PermissionState, AppError> {
    app.notification()
        .request_permission()
        .map_err(|e| AppError::Other(format!("Minta izin notifikasi gagal: {e}")))
}

/// Asks the OS for notification permission and remembers a granted answer.
///
/// Called from an explicit user action, or from the first tick that finds an
/// enabled reminder — never at startup and never on an interval.
pub fn request_permission<R: Runtime>(app: &AppHandle<R>) -> Result<PermissionState, AppError> {
    let state = ask_os_permission(app)?;
    if state == PermissionState::Granted
        && let Some(db) = app.try_state::<Db>()
        && let Ok(conn) = db.conn()
    {
        set_setting(&conn, PROMPTED_KEY, "1")?;
    }
    Ok(state)
}

fn enabled_any(prefs: &NotifyPrefs) -> bool {
    prefs.task || prefs.bill || prefs.budget || prefs.habit || prefs.journal
}

/// The OS side of a tick. [`tick_with`] calls it only with the DB lock
/// released: the plugin talks D-Bus and may block, and the DB mutex is not
/// re-entrant, so holding it here would stall (or deadlock) every command.
trait OsNotifier {
    fn permission_state(&self) -> PermissionState;
    fn show(&self, reminder: &OsReminder) -> (PermissionState, Result<(), String>);
    fn request_permission(&self) -> Result<PermissionState, AppError>;
}

struct AppNotifier<'a, R: Runtime>(&'a AppHandle<R>);

impl<R: Runtime> OsNotifier for AppNotifier<'_, R> {
    fn permission_state(&self) -> PermissionState {
        self.0.notification().permission_state().unwrap_or(PermissionState::Prompt)
    }

    fn show(&self, reminder: &OsReminder) -> (PermissionState, Result<(), String>) {
        show(self.0, reminder)
    }

    fn request_permission(&self) -> Result<PermissionState, AppError> {
        ask_os_permission(self.0)
    }
}

/// The DB-backed part of a tick: lock, read, unlock; talk to the OS; lock,
/// write, unlock. Returns every reminder handed to the OS with its outcome.
fn tick_with(
    db: &Db,
    live: &std::collections::HashMap<String, crate::downloader::LiveProgress>,
    now: i64,
    tz: &TimeZone,
    os: &impl OsNotifier,
) -> Result<Vec<(OsReminder, Outcome)>, AppError> {
    let today = time::local_date(now, tz)?.to_string();
    let (prefs, due, plan, mut delivered, asked) = {
        let conn = db.conn()?;
        let prefs = profile::notify_prefs(&conn)?;
        let dashboard = dashboard::get(&conn, live, now, tz)?;
        let due = due_reminders(&dashboard, tz);
        let delivered = delivered_ids(&conn, &today)?;
        let plan = plan(&due, &prefs, &delivered);
        let asked = setting(&conn, PROMPTED_KEY)?.as_deref() == Some("1");
        (prefs, due, plan, delivered, asked)
    };

    if plan.deliver.is_empty() {
        // Asks for the OS permission only if it was never granted from this profile.
        if !asked
            && should_prompt(enabled_any(&prefs), os.permission_state())
            && os.request_permission()? == PermissionState::Granted
        {
            let conn = db.conn()?;
            set_setting(&conn, PROMPTED_KEY, "1")?;
        }
        return Ok(Vec::new());
    }

    let mut shown = Vec::new();
    for reminder in &plan.deliver {
        let (state, result) = os.show(reminder);
        let outcome = outcome(state, result);
        // Only reminders that really reached the OS are recorded, so a denied or
        // failed delivery is retried on the next tick instead of being lost.
        if outcome == Outcome::Shown {
            delivered.insert(reminder.id.clone());
        }
        shown.push((reminder.clone(), outcome));
    }
    {
        let conn = db.conn()?;
        add_delivered(&conn, &today, &delivered)?;
        record(&conn, &due, &shown, &plan.skipped, now)?;
    }
    Ok(shown)
}

/// One tick of the background loop: the reminders handed to the OS.
pub fn tick(app: &AppHandle, tz: &TimeZone) -> Result<Vec<OsReminder>, AppError> {
    // Locked: the in-app panel is not shown either, so stay quiet until unlock.
    if app.try_state::<SecurityState>().is_some_and(|s| s.is_locked()) {
        return Ok(Vec::new());
    }
    let (Some(db), Some(downloader)) = (app.try_state::<Db>(), app.try_state::<Downloader>()) else {
        return Ok(Vec::new());
    };
    let attempts = tick_with(&db, &downloader.live(), time::now_ms(), tz, &AppNotifier(app))?;
    if attempts.is_empty() {
        return Ok(Vec::new());
    }
    let shown: Vec<OsReminder> =
        attempts.into_iter().filter(|(_, o)| *o == Outcome::Shown).map(|(r, _)| r).collect();
    let _ = app.emit("notify-os-delivered", shown.len());
    Ok(shown)
}

/// One thread, one tick every [`TICK`] — the same convention as the sync and
/// download schedulers. It keeps running while the window is hidden or
/// minimized, and stops when the process exits.
pub fn spawn_scheduler(app: AppHandle) {
    thread::spawn(move || {
        loop {
            // Resolved per tick, so a timezone change is picked up without a restart.
            if let Err(error) = tick(&app, &TimeZone::system()) {
                log::debug!("notify tick: {error}");
            }
            thread::sleep(TICK);
        }
    });
}

/// Settings: OS permission, why nothing is shown, and the recent delivery log.
#[tauri::command]
pub fn notify_status(app: AppHandle) -> Result<BridgeStatus, AppError> {
    status(&app)
}

/// Settings button: asks the OS for permission, then returns the fresh status.
#[tauri::command]
pub fn notify_request_permission(app: AppHandle) -> Result<BridgeStatus, AppError> {
    request_permission(&app)?;
    status(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bills;
    use crate::db::open_in_memory;
    use crate::habits;
    use crate::items::ItemPatch;
    use crate::items::update;
    use crate::overview::budget_view;
    use crate::tasks::{self, NewTask, TaskStatus};
    use jiff::Timestamp;

    fn jakarta() -> TimeZone {
        TimeZone::fixed(jiff::tz::offset(7))
    }

    fn ms(rfc3339: &str) -> i64 {
        rfc3339.parse::<Timestamp>().unwrap().as_millisecond()
    }

    fn prefs() -> NotifyPrefs {
        NotifyPrefs {
            task: true,
            bill: true,
            budget: true,
            habit: true,
            journal: false,
            journal_at: "20:00".into(),
        }
    }

    fn task_due(conn: &Connection, title: &str, due: &str) -> String {
        let card = tasks::create_task(
            conn,
            &NewTask { title: title.into(), status: TaskStatus::Plan, ..Default::default() },
            1,
            &jakarta(),
        )
        .unwrap();
        update(conn, &card.id, &ItemPatch { due_at: Some(Some(ms(due))), ..Default::default() }, 1).unwrap();
        card.id
    }

    fn dashboard_with(conn: &Connection, now: i64) -> Dashboard {
        dashboard::get(conn, &std::collections::HashMap::new(), now, &jakarta()).unwrap()
    }

    fn ids(reminders: &[OsReminder]) -> Vec<&str> {
        reminders.iter().map(|r| r.id.as_str()).collect()
    }

    /// Fails the test if the DB mutex is held while the OS is called, which
    /// is what deadlocked the scheduler thread.
    struct FakeOs<'a> {
        db: &'a Db,
        permission: PermissionState,
        shows: std::cell::Cell<usize>,
        requests: std::cell::Cell<usize>,
    }

    impl<'a> FakeOs<'a> {
        fn new(db: &'a Db, permission: PermissionState) -> Self {
            Self { db, permission, shows: Default::default(), requests: Default::default() }
        }
    }

    impl OsNotifier for FakeOs<'_> {
        fn permission_state(&self) -> PermissionState {
            assert!(self.db.is_unlocked_for_test(), "DB locked while reading permission");
            self.permission
        }

        fn show(&self, _: &OsReminder) -> (PermissionState, Result<(), String>) {
            assert!(self.db.is_unlocked_for_test(), "DB locked during show()");
            self.shows.set(self.shows.get() + 1);
            (self.permission, Ok(()))
        }

        fn request_permission(&self) -> Result<PermissionState, AppError> {
            assert!(self.db.is_unlocked_for_test(), "DB locked during request_permission");
            self.requests.set(self.requests.get() + 1);
            Ok(PermissionState::Granted)
        }
    }

    fn temp_db() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open_at(dir.path().join("notify.db"));
        (dir, db)
    }

    #[test]
    fn a_tick_with_a_due_reminder_shows_it_without_holding_the_db_lock() {
        let (_dir, db) = temp_db();
        let now = ms("2026-10-06T09:00:00+07:00");
        let id = task_due(&db.conn().unwrap(), "Kirim laporan", "2026-10-06T17:00:00+07:00");
        let os = FakeOs::new(&db, PermissionState::Granted);
        let live = std::collections::HashMap::new();

        let attempts = tick_with(&db, &live, now, &jakarta(), &os).unwrap();

        assert_eq!(os.shows.get(), 1);
        assert_eq!(attempts.len(), 1);
        assert_eq!(attempts[0].1, Outcome::Shown);
        assert!(db.is_unlocked_for_test());
        let conn = db.conn().unwrap();
        assert!(delivered_ids(&conn, "2026-10-06").unwrap().contains(&format!("task:{id}")));
        assert_eq!(log_entries(&conn).unwrap()[0].state, "shown");
        drop(conn);

        // Delivered once per day: the next tick hands nothing to the OS.
        assert!(tick_with(&db, &live, now + 30_000, &jakarta(), &os).unwrap().is_empty());
        assert_eq!(os.shows.get(), 1);
    }

    #[test]
    fn a_denied_tick_is_logged_and_retried_without_holding_the_db_lock() {
        let (_dir, db) = temp_db();
        let now = ms("2026-10-06T09:00:00+07:00");
        task_due(&db.conn().unwrap(), "Kirim laporan", "2026-10-06T17:00:00+07:00");
        let os = FakeOs::new(&db, PermissionState::Denied);
        let live = std::collections::HashMap::new();

        let attempts = tick_with(&db, &live, now, &jakarta(), &os).unwrap();

        assert_eq!(attempts[0].1, Outcome::Denied);
        assert!(delivered_ids(&db.conn().unwrap(), "2026-10-06").unwrap().is_empty());
        assert_eq!(log_entries(&db.conn().unwrap()).unwrap()[0].state, "denied");
        tick_with(&db, &live, now + 30_000, &jakarta(), &os).unwrap();
        assert_eq!(os.shows.get(), 2);
    }

    #[test]
    fn an_idle_tick_asks_permission_once_without_holding_the_db_lock() {
        let (_dir, db) = temp_db();
        let now = ms("2026-10-06T09:00:00+07:00");
        let os = FakeOs::new(&db, PermissionState::Prompt);
        let live = std::collections::HashMap::new();

        assert!(tick_with(&db, &live, now, &jakarta(), &os).unwrap().is_empty());
        assert_eq!(os.requests.get(), 1);
        assert_eq!(setting(&db.conn().unwrap(), PROMPTED_KEY).unwrap().as_deref(), Some("1"));

        tick_with(&db, &live, now + 30_000, &jakarta(), &os).unwrap();
        assert_eq!(os.requests.get(), 1);
    }

    #[test]
    fn enabled_mirrors_the_panel_preferences() {
        let mut p = prefs();
        assert!(enabled(&p, "task"));
        assert!(!enabled(&p, "journal"));
        assert!(!enabled(&p, "lain"));
        p.task = false;
        p.habit = false;
        assert!(!enabled(&p, "task"));
        assert!(!enabled(&p, "habit"));
        assert!(enabled(&p, "bill"));
    }

    #[test]
    fn due_reminders_flatten_tasks_bills_habits_and_budget() {
        let conn = open_in_memory();
        let today = ms("2026-10-06T09:00:00+07:00");
        task_due(&conn, "Kirim laporan", "2026-10-06T17:00:00+07:00");
        task_due(&conn, "Bayar sewa", "2026-10-04T09:00:00+07:00");
        habits::save_habit(
            &conn,
            &habits::HabitInput {
                id: None,
                name: "Minum air".into(),
                days: 127,
                remind_at: Some("07:00".into()),
                remind_on: true,
                auto_journal: false,
            },
            today,
            &jakarta(),
        )
        .unwrap();

        let dash = dashboard_with(&conn, today);
        let reminders = due_reminders(&dash, &jakarta());

        assert_eq!(reminders.len(), 3);
        assert_eq!(reminders[0].kind, "task");
        assert_eq!(reminders[0].title, "Bayar sewa");
        assert_eq!(reminders[0].detail, "Terlambat · jatuh tempo 4 Okt");
        assert_eq!(reminders[1].kind, "task");
        assert_eq!(reminders[1].title, "Kirim laporan");
        assert_eq!(reminders[1].detail, "Jatuh tempo hari ini");
        assert_eq!(reminders[2].detail, "Belum dicentang · pengingat 07.00");
        assert_eq!(ids(&reminders)[0], format!("task:{}", dash.today[0].id));
    }

    #[test]
    fn due_reminders_skip_completed_tasks() {
        let conn = open_in_memory();
        let today = ms("2026-10-06T09:00:00+07:00");
        let id = task_due(&conn, "Sudah selesai", "2026-10-06T17:00:00+07:00");
        update(&conn, &id, &ItemPatch { due_at: None, ..Default::default() }, 1).unwrap();
        tasks::update_task(&conn, &id, &tasks::TaskPatch { status: Some(TaskStatus::Done), ..Default::default() }, today, &jakarta()).unwrap();

        let dash = dashboard_with(&conn, today);
        let done = dash.today.iter().all(|t| t.completed_at.is_some());
        assert!(done, "the dashboard should report the task as done");
        assert!(due_reminders(&dash, &jakarta()).is_empty());
    }

    #[test]
    fn due_reminders_include_the_budget_once_it_is_high() {
        let conn = open_in_memory();
        let today = ms("2026-10-06T09:00:00+07:00");
        crate::overview::set_budget(&conn, Some(10_000_000), today).unwrap();
        let budget = budget_view(&conn, 9_000_000).unwrap().unwrap();

        let mut dash = dashboard_with(&conn, today);
        dash.finance.expense = 9000000;
        dash.finance.budget = Some(budget);
        let reminders = due_reminders(&dash, &jakarta());
        let budget_reminder = reminders.iter().find(|r| r.kind == "budget").expect("budget reminder");
        assert!(budget_reminder.detail.ends_with("% dari batas"), "{}", budget_reminder.detail);
        assert_eq!(budget_reminder.id, "budget:budget");
    }

    #[test]
    fn a_due_reminder_is_delivered_once_and_then_suppressed() {
        let reminders = vec![OsReminder {
            id: "task:t1".into(),
            kind: "task".into(),
            title: "Kirim laporan".into(),
            detail: "Jatuh tempo hari ini".into(),
        }];
        let mut delivered = BTreeSet::new();

        let first = plan(&reminders, &prefs(), &delivered);
        assert_eq!(first.deliver.len(), 1);
        assert!(first.skipped.is_empty());

        delivered.insert("task:t1".to_string());
        let second = plan(&reminders, &prefs(), &delivered);
        assert!(second.deliver.is_empty());
        assert_eq!(second.skipped, vec![("task:t1".to_string(), Skip::AlreadyToday)]);
    }

    #[test]
    fn a_disabled_category_is_never_delivered() {
        let reminders = vec![
            OsReminder { id: "task:t1".into(), kind: "task".into(), title: "A".into(), detail: "".into() },
            OsReminder { id: "bill:b1".into(), kind: "bill".into(), title: "B".into(), detail: "".into() },
        ];
        let mut p = prefs();
        p.bill = false;

        let result = plan(&reminders, &p, &BTreeSet::new());
        assert_eq!(result.deliver.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["task:t1"]);
        assert_eq!(result.skipped, vec![("bill:b1".to_string(), Skip::Disabled)]);
    }

    #[test]
    fn a_denied_permission_degrades_gracefully() {
        let reminder = OsReminder {
            id: "task:t1".into(),
            kind: "task".into(),
            title: "Kirim laporan".into(),
            detail: "Jatuh tempo hari ini".into(),
        };
        // Denied and still-asking both count as "not shown", with a reason for the panel.
        assert_eq!(outcome(PermissionState::Denied, Ok(())), Outcome::Denied);
        assert_eq!(outcome(PermissionState::Prompt, Ok(())), Outcome::Denied);
        assert_eq!(outcome(PermissionState::Granted, Err("boom".into())), Outcome::Failed);
        assert_eq!(outcome(PermissionState::Granted, Ok(())), Outcome::Shown);
        assert!(denied_reason(PermissionState::Denied).is_some());
        assert!(denied_reason(PermissionState::Prompt).is_some());
        assert!(denied_reason(PermissionState::Granted).is_none());
        assert_eq!(reminder.kind, "task");
    }

    #[test]
    fn permission_is_asked_only_when_enabled_and_unknown() {
        assert!(!should_prompt(false, PermissionState::Prompt));
        assert!(should_prompt(true, PermissionState::Prompt));
        assert!(!should_prompt(true, PermissionState::Granted));
        assert!(!should_prompt(true, PermissionState::Denied));
    }

    #[test]
    fn permission_names_match_the_settings_contract() {
        assert_eq!(permission_name(PermissionState::Granted), "granted");
        assert_eq!(permission_name(PermissionState::Denied), "denied");
        assert_eq!(permission_name(PermissionState::Prompt), "prompt");
        assert_eq!(permission_name(PermissionState::PromptWithRationale), "prompt");
    }

    #[test]
    fn delivered_ids_are_recorded_per_local_day() {
        let conn = open_in_memory();
        let mut first = BTreeSet::new();
        first.insert("task:t1".to_string());
        first.insert("bill:b1".to_string());
        add_delivered(&conn, "2026-10-06", &first).unwrap();
        assert_eq!(delivered_ids(&conn, "2026-10-06").unwrap(), first);

        // A new day starts empty, and the old day's row is pruned.
        assert!(delivered_ids(&conn, "2026-10-07").unwrap().is_empty());
        let mut second = BTreeSet::new();
        second.insert("habit:h1".to_string());
        add_delivered(&conn, "2026-10-07", &second).unwrap();
        assert_eq!(delivered_ids(&conn, "2026-10-07").unwrap(), second);
        assert!(delivered_ids(&conn, "2026-10-06").unwrap().is_empty());
    }

    #[test]
    fn the_delivery_log_keeps_newest_first_and_is_bounded() {
        let conn = open_in_memory();
        for i in 0..(LOG_KEEP + 5) {
            append_log(&conn, &DeliveryEntry {
                at: i as i64,
                id: format!("task:{i}"),
                title: format!("T{i}"),
                state: "shown".into(),
                reason: None,
            })
            .unwrap();
        }
        let entries = log_entries(&conn).unwrap();
        assert_eq!(entries.len(), LOG_SHOWN);
        assert_eq!(entries[0].id, format!("task:{}", LOG_KEEP + 4));

        let raw = setting(&conn, LOG_KEY).unwrap().unwrap();
        assert_eq!(raw.lines().count(), LOG_KEEP);
    }

    #[test]
    fn rupiah_matches_the_panel_format() {
        assert_eq!(rupiah(150_000), "Rp150.000");
        assert_eq!(rupiah(1_500_000), "Rp1.500.000");
        assert_eq!(rupiah(0), "Rp0");
    }

    #[test]
    fn bills_are_labelled_by_their_status() {
        let conn = open_in_memory();
        let today = ms("2026-10-06T09:00:00+07:00");
        let mut dash = dashboard_with(&conn, today);
        dash.finance.due_bills = vec![bills::BillView {
            id: "b1".into(),
            name: "Internet".into(),
            amount: 350_000,
            account_id: "a".into(),
            account_name: "BCA".into(),
            repeat: bills::Repeat::Monthly,
            due_at: today,
            status: BillStatus::Overdue,
            days_late: 3,
        }];
        let reminders = due_reminders(&dash, &jakarta());
        assert_eq!(reminders.len(), 1);
        assert_eq!(reminders[0].id, "bill:b1");
        assert_eq!(reminders[0].detail, "Terlambat 3 hari · Rp350.000");
    }
}
