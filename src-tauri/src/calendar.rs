//! Google Calendar, read-only pull (spec: "kalender bisa konek ke Google
//! Calendar"). One-way: events are pulled into the schedule cache; nothing is
//! ever written back to Google, so the user always sees a "Hanya baca" badge.
//!
//! Tokens follow the sync path: the refresh token lives only in the OS keyring
//! (`keystore::KeyringStore`, service `io.github.syharipf.anchoa`) and is
//! zeroized on drop; the database holds nothing but the event cache. The OAuth
//! flow is `sync::oauth::begin_calendar`, separate from the sync flow so the
//! two never share scopes or tokens.
use std::sync::{
    Mutex, MutexGuard, TryLockError,
    atomic::{AtomicBool, AtomicI64, Ordering},
};

use jiff::{Timestamp, ToSpan, civil::Date, tz::TimeZone};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::{Zeroize, Zeroizing};

use crate::{
    db::Db,
    error::AppError,
    keystore::KeyringStore,
    schedule::{ItemKind, ItemSource, ScheduleItem, ScheduleRange, range_bounds},
    sync::{
        oauth::{self, GoogleTokens},
        server::percent_encode,
    },
    tasks::TaskStatus,
    time,
};

/// How stale the cache may get before the next Jadwal look pulls again. The
/// sync scheduler convention is 60 s focused / 300 s background; a background
/// thread just to refresh a calendar the user is not looking at is waste, so
/// the pull happens on demand instead (see `refresh_in_background`).
const REFRESH_AFTER_MS: i64 = 300_000;
/// Minimum gap between background pulls. Neither a failing pull nor a range
/// the pull window can never cover may loop schedule → pull → event → schedule.
const RETRY_AFTER_MS: i64 = 60_000;
const KEYRING_KEY: &str = "calendar-session:primary";
/// Google caps a page at 2500, but a personal schedule rarely exceeds one page.
const MAX_RESULTS: u32 = 250;
/// Emitted after a background pull stored fresh events; Jadwal reloads on it.
pub const UPDATED_EVENT: &str = "calendar-updated";

pub struct CalendarState {
    keys: KeyringStore,
    cancel: AtomicBool,
    /// Held for the whole of a connect or a pull: never two at once.
    running: Mutex<()>,
    /// Epoch ms of the last background pull attempt.
    last_attempt: AtomicI64,
}

impl CalendarState {
    pub fn new(keys: KeyringStore) -> Self {
        Self {
            keys,
            cancel: AtomicBool::new(false),
            running: Mutex::new(()),
            last_attempt: AtomicI64::new(i64::MIN),
        }
    }

    /// Claims the background pull slot; false while one ran within `RETRY_AFTER_MS`.
    fn claim_attempt(&self, now: i64) -> bool {
        let last = self.last_attempt.load(Ordering::SeqCst);
        now.saturating_sub(last) >= RETRY_AFTER_MS
            && self
                .last_attempt
                .compare_exchange(last, now, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
    }

    /// None while a connect or another pull holds the lock.
    fn try_run(&self) -> Option<MutexGuard<'_, ()>> {
        match self.running.try_lock() {
            Ok(guard) => Some(guard),
            Err(TryLockError::Poisoned(p)) => Some(p.into_inner()),
            Err(TryLockError::WouldBlock) => None,
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|p| p.into_inner())
}

/// The grant the user gave us, exactly like sync's `Session` but keyed for
/// Calendar. Both secrets zeroize on drop and never reach the database, logs,
/// or the frontend.
#[derive(Serialize, Deserialize)]
struct Session {
    email: String,
    access_token: String,
    refresh_token: String,
    expires_at: i64,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.access_token.zeroize();
        self.refresh_token.zeroize();
    }
}

impl Session {
    fn store(&self, keys: &KeyringStore) -> Result<(), AppError> {
        let secret = Zeroizing::new(
            serde_json::to_string(self).map_err(|_| corrupt())?,
        );
        keys.set(KEYRING_KEY, &secret)
    }

    fn load(keys: &KeyringStore) -> Result<Option<Self>, AppError> {
        let Some(secret) = keys.get(KEYRING_KEY)? else { return Ok(None) };
        let secret = Zeroizing::new(secret);
        serde_json::from_str(&secret).map_err(|_| corrupt())
    }

    fn delete(keys: &KeyringStore) -> Result<(), AppError> {
        keys.delete(KEYRING_KEY)
    }
}

fn corrupt() -> AppError {
    AppError::Other("Kredensial Google Kalender rusak; sambungkan kembali".into())
}

fn not_connected() -> AppError {
    AppError::Invalid("Sambungkan Google Kalender terlebih dahulu".into())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: bool,
    /// The Google account. Kept after a revoked grant so the UI can name it.
    pub account: Option<String>,
    /// Epoch ms of the last successful pull.
    pub fetched_at: Option<i64>,
    pub last_error: Option<String>,
}

pub fn status(conn: &Connection, keys: &KeyringStore) -> Result<Status, AppError> {
    let (account, fetched_at, last_error): (String, i64, String) = conn
        .query_row(
            "SELECT account, fetched_at, last_error FROM calendar_sync WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .unwrap_or_default();
    let session = Session::load(keys)?;
    Ok(Status {
        connected: session.is_some(),
        account: session
            .as_ref()
            .map(|s| s.email.clone())
            .or_else(|| Some(account).filter(|a| !a.is_empty())),
        fetched_at: Some(fetched_at).filter(|&t| t > 0),
        last_error: Some(last_error).filter(|e| !e.is_empty()),
    })
}

/// Everything the network side must do, so tests drive the revoked-token and
/// empty-calendar paths without Google.
pub trait CalendarSource: Send + Sync {
    /// The account that granted the scopes.
    fn email(&self, access_token: &str) -> Result<String, AppError>;
    /// Events between two RFC 3339 instants, as the raw Calendar API JSON.
    fn events(&self, access_token: &str, time_min: &str, time_max: &str) -> Result<Value, AppError>;
    /// Trade the refresh token for a fresh grant. Rejection means revoked.
    fn refresh(&self, refresh_token: &str) -> Result<GoogleTokens, AppError>;
}

/// The real Google API. Errors are classified for the user; tokens are never
/// included in any error string.
pub struct GoogleApi;

const EVENTS_URL: &str = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";

fn http_error(status: u16) -> AppError {
    match status {
        401 | 403 => AppError::Invalid(oauth::CALENDAR_SESSION_REVOKED.into()),
        429 => AppError::Other("Google membatasi permintaan; coba lagi nanti".into()),
        400..=499 => AppError::Invalid("Google menolak permintaan kalender".into()),
        _ => AppError::Other("Tidak dapat menghubungi Google; periksa koneksi".into()),
    }
}

fn get_json(url: &str, access_token: &str) -> Result<Value, AppError> {
    let mut response = ureq::get(url)
        .header("Authorization", &format!("Bearer {access_token}"))
        .header("User-Agent", "Anchoa")
        .call()
        .map_err(|e| match e {
            ureq::Error::StatusCode(code) => http_error(code),
            other => AppError::Other(format!("Tidak dapat menghubungi Google: {other}")),
        })?;
    response
        .body_mut()
        .with_config()
        .limit(8 * 1024 * 1024)
        .read_json()
        .map_err(|_| AppError::Other("Respons Google Kalender tidak valid".into()))
}

impl CalendarSource for GoogleApi {
    fn email(&self, access_token: &str) -> Result<String, AppError> {
        let value = get_json(USERINFO_URL, access_token)?;
        value["email"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| AppError::Other("Respons Google tidak memuat email".into()))
    }

    fn events(&self, access_token: &str, time_min: &str, time_max: &str) -> Result<Value, AppError> {
        let url = format!(
            "{EVENTS_URL}?timeMin={}&timeMax={}&singleEvents=true&orderBy=startTime&maxResults={MAX_RESULTS}",
            percent_encode(time_min),
            percent_encode(time_max),
        );
        get_json(&url, access_token)
    }

    fn refresh(&self, refresh_token: &str) -> Result<GoogleTokens, AppError> {
        oauth::refresh_google_token(&oauth::google_client()?, refresh_token)
    }
}

// ---- pull ----

/// One Calendar API event worth keeping.
#[derive(Debug, Clone, PartialEq)]
struct Event {
    id: String,
    title: String,
    start_at: i64,
    /// Exclusive end, epoch ms, like every other local timestamp here.
    end_at: i64,
}

fn rfc3339(ms: i64, tz: &TimeZone) -> Result<String, AppError> {
    Ok(Timestamp::from_millisecond(ms)?
        .to_zoned(tz.clone())
        .strftime("%Y-%m-%dT%H:%M:%S%:z")
        .to_string())
}

fn instant(value: &Value, tz: &TimeZone) -> Option<i64> {
    if let Some(date_time) = value["dateTime"].as_str() {
        return date_time.parse::<Timestamp>().ok().map(|t| t.as_millisecond());
    }
    // All-day events carry a plain date; the day starts at local midnight.
    let date = value["date"].as_str()?.parse::<Date>().ok()?;
    Some(time::date_bounds(date, tz).ok()?.0)
}

/// Returns None for cancelled entries, entries without times, or malformed ids.
fn parse_event(value: &Value, tz: &TimeZone) -> Option<Event> {
    if value["status"].as_str() == Some("cancelled") {
        return None;
    }
    let id = value["id"].as_str()?.to_string();
    let summary = value["summary"].as_str().unwrap_or("").trim();
    let title = if summary.is_empty() { "(tanpa judul)" } else { summary }.to_string();
    let start_at = instant(&value["start"], tz)?;
    // Google's end is exclusive; a missing end means a zero-length event.
    let end_at = instant(&value["end"], tz).unwrap_or(start_at);
    Some(Event { id, title, start_at, end_at })
}

fn store_events(conn: &mut Connection, events: &[Event], from: &str, to: &str, now: i64, email: &str) -> Result<(), AppError> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM calendar_events", [])?;
    for event in events {
        tx.execute(
            "INSERT OR REPLACE INTO calendar_events (event_id, title, start_at, end_at) VALUES (?1, ?2, ?3, ?4)",
            params![event.id, event.title, event.start_at, event.end_at],
        )?;
    }
    tx.execute(
        "INSERT INTO calendar_sync (id, account, fetched_at, from_date, to_date, last_error)
         VALUES (1, ?1, ?2, ?3, ?4, '')
         ON CONFLICT(id) DO UPDATE SET account = excluded.account, fetched_at = excluded.fetched_at,
           from_date = excluded.from_date, to_date = excluded.to_date, last_error = ''",
        params![email, now, from, to],
    )?;
    tx.commit()?;
    Ok(())
}

fn store_error(conn: &Connection, message: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO calendar_sync (id, account, fetched_at, from_date, to_date, last_error)
         VALUES (1, '', 0, '', '', ?1)
         ON CONFLICT(id) DO UPDATE SET last_error = excluded.last_error",
        [message],
    )?;
    Ok(())
}

/// The pull window: everything the schedule can ever show plus a margin, so a
/// month of navigation never triggers a network round trip.
fn pull_window(today: Date) -> Result<(Date, Date), AppError> {
    let from = today.checked_sub(35.days())?;
    let to = today.checked_add(93.days())?;
    Ok((from, to))
}

/// Pulls events into the cache and returns how many were stored.
pub fn pull(
    db: &Db,
    keys: &KeyringStore,
    source: &dyn CalendarSource,
    now: i64,
    tz: &TimeZone,
) -> Result<usize, AppError> {
    let mut session = Session::load(keys)?.ok_or_else(not_connected)?;
    pull_session(db, keys, source, &mut session, now, tz)
}

/// Network calls run without the database lock; only the result is recorded
/// under it. Every failure lands in `last_error`, and a revoked grant is
/// dropped so the UI asks to reconnect instead of retrying a dead refresh
/// token forever. Never panics.
fn pull_session(
    db: &Db,
    keys: &KeyringStore,
    source: &dyn CalendarSource,
    session: &mut Session,
    now: i64,
    tz: &TimeZone,
) -> Result<usize, AppError> {
    let fetched = fetch(keys, source, session, now, tz);
    let mut conn = db.conn()?;
    match fetched {
        Ok(f) => {
            store_events(&mut conn, &f.events, &f.from.to_string(), &f.to.to_string(), now, &session.email)?;
            Ok(f.events.len())
        }
        Err(e) => {
            let message = e.to_string();
            if message.contains(oauth::CALENDAR_SESSION_REVOKED) {
                Session::delete(keys)?;
                store_error(&conn, oauth::CALENDAR_SESSION_REVOKED)?;
            } else {
                store_error(&conn, &message)?;
            }
            Err(e)
        }
    }
}

struct Fetched {
    events: Vec<Event>,
    from: Date,
    to: Date,
}

fn fetch(
    keys: &KeyringStore,
    source: &dyn CalendarSource,
    session: &mut Session,
    now: i64,
    tz: &TimeZone,
) -> Result<Fetched, AppError> {
    if refresh_if_expiring(source, session, now)? {
        session.store(keys)?;
    }

    let (from, to) = pull_window(time::local_date(now, tz)?)?;
    let time_min = rfc3339(time::date_bounds(from, tz)?.0, tz)?;
    let time_max = rfc3339(time::date_bounds(to, tz)?.1, tz)?;

    let value = source.events(&session.access_token, &time_min, &time_max)?;
    let items = value["items"].as_array().ok_or_else(|| {
        AppError::Other("Respons Google Kalender tidak valid".into())
    })?;
    let events = items.iter().filter_map(|v| parse_event(v, tz)).collect();
    Ok(Fetched { events, from, to })
}

/// Refresh when the access token is within a minute of expiry. Returns whether
/// the session changed and must be stored again.
fn refresh_if_expiring(
    source: &dyn CalendarSource,
    session: &mut Session,
    now: i64,
) -> Result<bool, AppError> {
    if session.expires_at.saturating_sub(now) > 60_000 {
        return Ok(false);
    }
    if session.refresh_token.is_empty() {
        return Err(AppError::Invalid(oauth::CALENDAR_SESSION_REVOKED.into()));
    }
    let tokens = source.refresh(&session.refresh_token)?;
    session.access_token = tokens.access_token.to_string();
    if !tokens.refresh_token.is_empty() {
        session.refresh_token = tokens.refresh_token.to_string();
    }
    session.expires_at = tokens.expires_at;
    Ok(true)
}

// ---- schedule surface ----

/// The cached events as schedule items: `source` and `kind` "calendar", never
/// checkable, never overdue. Locally created tasks stay authoritative.
pub fn items(conn: &Connection, range: &ScheduleRange, tz: &TimeZone) -> Result<Vec<ScheduleItem>, AppError> {
    let (from_ms, to_ms) = range_bounds(range, tz)?;
    let mut stmt = conn.prepare(
        "SELECT event_id, title, start_at, end_at FROM calendar_events
         WHERE end_at > ?1 AND start_at < ?2
         ORDER BY start_at, event_id",
    )?;
    let rows = stmt.query_map(params![from_ms, to_ms], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
        ))
    })?;

    let mut items = Vec::new();
    for row in rows {
        let (event_id, title, start_at, end_at) = row?;
        let start_date = time::local_date(start_at, tz)?.to_string();
        // `end_at` is exclusive; step back one millisecond for the last day.
        let due_date = time::local_date(end_at.saturating_sub(1).max(start_at), tz)?.to_string();
        items.push(ScheduleItem {
            key: format!("calendar:{event_id}"),
            source: ItemSource::Calendar,
            id: event_id,
            kind: ItemKind::Calendar,
            title,
            group_id: "calendar".to_string(),
            group_name: "Google Kalender".to_string(),
            start_date: Some(start_date),
            due_date,
            status: TaskStatus::Plan,
            overdue: false,
            checkable: false,
        });
    }
    Ok(items)
}

/// Whether a pull is worth trying for `range`: the cache is stale or does not
/// cover it. No cache row means Calendar was never connected (connecting
/// always records a row, disconnecting deletes it), so there is nothing to pull.
fn needs_pull(conn: &Connection, range: &ScheduleRange, now: i64) -> Result<bool, AppError> {
    let row: Option<(i64, String, String)> = conn
        .query_row(
            "SELECT fetched_at, from_date, to_date FROM calendar_sync WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let Some((fetched_at, from, to)) = row else { return Ok(false) };
    if now.saturating_sub(fetched_at) >= REFRESH_AFTER_MS {
        return Ok(true);
    }
    Ok(range.from < from || range.to > to)
}

/// On-demand refresh for the `schedule` command. Chosen over pulling inline so
/// Jadwal never waits on Google: the command answers from the cache, and when
/// `needs_pull` says the cache is stale or too narrow, one pull runs on the
/// blocking pool and emits `UPDATED_EVENT` once it stored events, so the page
/// reloads. Failures land in `last_error` (shown in Integrasi) and never fail
/// the schedule. `claim_attempt` caps it at one pull per `RETRY_AFTER_MS`.
pub fn refresh_in_background(app: &AppHandle, conn: &Connection, range: &ScheduleRange, now: i64) {
    let Some(state) = app.try_state::<CalendarState>() else { return };
    match needs_pull(conn, range, now) {
        Ok(true) => {}
        Ok(false) => return,
        Err(e) => {
            log::warn!("google calendar cache check failed: {e}");
            return;
        }
    }
    if !state.claim_attempt(now) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (Some(state), Some(db)) = (app.try_state::<CalendarState>(), app.try_state::<Db>()) else {
            return;
        };
        match pull_if_connected(&state, &db, &GoogleApi, time::now_ms(), &TimeZone::system()) {
            Ok(true) => {
                if let Err(e) = app.emit(UPDATED_EVENT, ()) {
                    log::warn!("google calendar update event failed: {e}");
                }
            }
            Ok(false) => {}
            Err(e) => log::warn!("google calendar pull failed: {e}"),
        }
    });
}

/// Ok(false) when not connected or a connect or pull is already running.
fn pull_if_connected(
    state: &CalendarState,
    db: &Db,
    source: &dyn CalendarSource,
    now: i64,
    tz: &TimeZone,
) -> Result<bool, AppError> {
    let Some(_running) = state.try_run() else { return Ok(false) };
    let Some(mut session) = Session::load(&state.keys)? else { return Ok(false) };
    pull_session(db, &state.keys, source, &mut session, now, tz).map(|_| true)
}

// ---- connect / disconnect ----

fn session_from(tokens: GoogleTokens, email: String) -> Session {
    Session {
        email,
        access_token: tokens.access_token.to_string(),
        refresh_token: tokens.refresh_token.to_string(),
        expires_at: tokens.expires_at,
    }
}

fn current_status(state: &CalendarState, db: &Db) -> Result<Status, AppError> {
    status(&*db.conn()?, &state.keys)
}

/// Runs the browser loopback flow, stores the grant, and pulls once. Blocking;
/// the database is only locked after the browser step. A failed first pull
/// still leaves the account connected, with the error in `last_error`.
fn connect(state: &CalendarState, db: &Db, source: &dyn CalendarSource, tz: &TimeZone) -> Result<Status, AppError> {
    let _running = lock(&state.running);
    state.cancel.store(false, Ordering::SeqCst);
    let flow = oauth::begin_calendar(oauth::google_client()?)?;
    let tokens = flow.wait_cancellable(oauth::DEFAULT_TIMEOUT, &state.cancel)?;
    let email = source.email(&tokens.access_token)?;
    let mut session = session_from(tokens, email);
    session.store(&state.keys)?;
    match pull_session(db, &state.keys, source, &mut session, time::now_ms(), tz) {
        Ok(pulled) => log::info!("google calendar connected: {pulled} events"),
        Err(e) => log::warn!("google calendar first pull failed: {e}"),
    }
    current_status(state, db)
}

/// Pull now, from the Integrasi row. Fails instead of waiting while a connect
/// is still in the browser.
fn refresh(state: &CalendarState, db: &Db, source: &dyn CalendarSource, tz: &TimeZone) -> Result<Status, AppError> {
    let Some(_running) = state.try_run() else {
        return Err(AppError::Invalid("Google Kalender sedang diproses; coba lagi sebentar lagi".into()));
    };
    pull(db, &state.keys, source, time::now_ms(), tz)?;
    current_status(state, db)
}

/// Stops a waiting connect and waits for a pull in flight, so neither can put
/// the token or the cache back after the grant is gone.
fn disconnect(state: &CalendarState, db: &Db) -> Result<Status, AppError> {
    state.cancel.store(true, Ordering::SeqCst);
    let _running = lock(&state.running);
    Session::delete(&state.keys)?;
    let conn = db.conn()?;
    conn.execute_batch("DELETE FROM calendar_events; DELETE FROM calendar_sync;")?;
    status(&conn, &state.keys)
}

// ---- commands ----

/// Network and keyring work runs on the blocking pool, like the sync commands.
async fn run<T: Send + 'static>(
    app: AppHandle,
    action: impl FnOnce(&CalendarState, &Db) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app
            .try_state::<CalendarState>()
            .ok_or_else(|| AppError::Other("Google Kalender tidak tersedia".into()))?;
        let db = app.try_state::<Db>().ok_or(AppError::DbUnavailable)?;
        action(&state, &db)
    })
    .await
    .map_err(|_| AppError::Other("Operasi Google Kalender tidak dapat diselesaikan".into()))?
}

#[tauri::command]
pub async fn calendar_status(app: AppHandle) -> Result<Status, AppError> {
    run(app, current_status).await
}

/// Opens the browser and resolves when the grant is stored; rejects after
/// `calendar_cancel_connect` or when this build has no Google client id.
#[tauri::command]
pub async fn calendar_connect(app: AppHandle) -> Result<Status, AppError> {
    run(app, |state, db| connect(state, db, &GoogleApi, &TimeZone::system())).await
}

#[tauri::command]
pub fn calendar_cancel_connect(state: State<'_, CalendarState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn calendar_disconnect(app: AppHandle) -> Result<Status, AppError> {
    run(app, disconnect).await
}

#[tauri::command]
pub async fn calendar_refresh(app: AppHandle) -> Result<Status, AppError> {
    run(app, |state, db| refresh(state, db, &GoogleApi, &TimeZone::system())).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::sync::server::SyncServer;

    fn tz() -> TimeZone {
        TimeZone::get("Asia/Jakarta").unwrap()
    }

    fn db() -> (tempfile::TempDir, Db) {
        let dir = tempfile::Builder::new().prefix("calendar-test-").tempdir_in(".").unwrap();
        let db = Db::open_at(dir.path().join("app.db"));
        (dir, db)
    }

    fn october() -> ScheduleRange {
        ScheduleRange { from: "2026-10-01".into(), to: "2026-10-31".into() }
    }

    fn event_json(id: &str, title: &str, start: &str, end: &str) -> Value {
        let start_obj = if start.contains('T') {
            serde_json::json!({ "dateTime": start })
        } else {
            serde_json::json!({ "date": start })
        };
        let end_obj = if end.contains('T') {
            serde_json::json!({ "dateTime": end })
        } else {
            serde_json::json!({ "date": end })
        };
        serde_json::json!({ "id": id, "summary": title, "start": start_obj, "end": end_obj })
    }

    fn cancelled(id: &str) -> Value {
        let mut value = event_json(id, "x", "2026-10-06", "2026-10-07");
        value["status"] = serde_json::json!("cancelled");
        value
    }

    fn events_response(items: Value) -> Value {
        serde_json::json!({ "items": items })
    }

    fn tokens(expires_in: i64) -> GoogleTokens {
        GoogleTokens {
            access_token: Zeroizing::new("at".into()),
            refresh_token: Zeroizing::new("rt".into()),
            expires_at: time::now_ms() + expires_in * 1000,
        }
    }

    const OFFLINE: &str = "Tidak dapat menghubungi Google; periksa koneksi";

    struct FakeSource {
        response: Value,
        revoked: bool,
        offline: bool,
    }

    impl FakeSource {
        fn ok(response: Value) -> Self {
            Self { response, revoked: false, offline: false }
        }
        fn revoked() -> Self {
            Self { response: events_response(serde_json::json!([])), revoked: true, offline: false }
        }
        fn offline() -> Self {
            Self { response: events_response(serde_json::json!([])), revoked: false, offline: true }
        }
    }

    impl CalendarSource for FakeSource {
        fn email(&self, _access_token: &str) -> Result<String, AppError> {
            Ok("ako@example.test".into())
        }
        fn events(&self, _access: &str, _min: &str, _max: &str) -> Result<Value, AppError> {
            if self.offline {
                return Err(AppError::Other(OFFLINE.into()));
            }
            Ok(self.response.clone())
        }
        fn refresh(&self, _refresh_token: &str) -> Result<GoogleTokens, AppError> {
            if self.revoked {
                return Err(AppError::Invalid(oauth::CALENDAR_SESSION_REVOKED.into()));
            }
            Ok(tokens(3600))
        }
    }

    fn keys() -> KeyringStore {
        KeyringStore::with_builder(keyring::mock::default_credential_builder())
    }

    fn store_session(keys: &KeyringStore, expires_in: i64) {
        Session {
            email: "ako@example.test".into(),
            access_token: "at".into(),
            refresh_token: "rt".into(),
            expires_at: time::now_ms() + expires_in * 1000,
        }
        .store(keys)
        .unwrap();
    }

    #[test]
    fn calendar_scopes_stay_separate_from_the_sync_flow() {
        // The sync flow goes through Supabase and never asks for Calendar.
        let sync_url = crate::sync::server::HttpServer::new("https://sync.example.test", "anon")
            .unwrap()
            .authorize_url(
                crate::sync::server::Provider::Google,
                "http://127.0.0.1:1/callback?state=s",
                "challenge",
                "s",
            );
        assert!(!sync_url.contains("calendar"));
        // The Calendar flow asks for readonly and nothing else.
        let joined = oauth::CALENDAR_SCOPES.join(" ");
        assert_eq!(
            joined.split(' ').count(),
            oauth::CALENDAR_SCOPES.len(),
            "no scope contains a space"
        );
        assert!(joined.contains("https://www.googleapis.com/auth/calendar.readonly"));
        assert!(!joined.contains("calendar.events"), "read-only, no write-back");
        assert!(!joined.contains("supabase") && !joined.contains("sync"));
    }

    #[test]
    fn events_map_into_the_schedule_shape() {
        let (_dir, db) = db();
        let tz = tz();
        let keys = keys();
        store_session(&keys, 3600);
        let source = FakeSource::ok(events_response(serde_json::json!([
            event_json("e1", "Rapat mingguan", "2026-10-06T09:00:00+07:00", "2026-10-06T10:00:00+07:00"),
            event_json("e2", "Libur tiga hari", "2026-10-10", "2026-10-13"),
            cancelled("e3"),
        ])));
        let pulled = pull(&db, &keys, &source, time::now_ms(), &tz).unwrap();
        assert_eq!(pulled, 2, "cancelled events are dropped");

        let items = items(&db.conn().unwrap(), &october(), &tz).unwrap();
        assert_eq!(items.len(), 2);
        let rapat = items.iter().find(|i| i.id == "e1").unwrap();
        assert_eq!(rapat.key, "calendar:e1");
        assert_eq!(rapat.source, ItemSource::Calendar);
        assert_eq!(rapat.kind, ItemKind::Calendar);
        assert_eq!(rapat.group_name, "Google Kalender");
        assert_eq!(rapat.due_date, "2026-10-06");
        assert_eq!(rapat.start_date.as_deref(), Some("2026-10-06"));
        assert!(!rapat.checkable);
        assert!(!rapat.overdue);
        let libur = items.iter().find(|i| i.id == "e2").unwrap();
        // All-day end is exclusive: three day-rows, ending on the 12th.
        assert_eq!(libur.start_date.as_deref(), Some("2026-10-10"));
        assert_eq!(libur.due_date, "2026-10-12");
    }

    #[test]
    fn revoked_token_fails_clearly_and_forces_reauth() {
        let (_dir, db) = db();
        let tz = tz();
        let keys = keys();
        store_session(&keys, 0);
        let source = FakeSource::revoked();
        let err = pull(&db, &keys, &source, time::now_ms(), &tz).unwrap_err();
        assert!(err.to_string().contains("Sesi Google Kalender berakhir"));
        // The dead grant is gone, so the UI shows the connect row again.
        assert!(Session::load(&keys).unwrap().is_none());
        let view = status(&db.conn().unwrap(), &keys).unwrap();
        assert!(!view.connected);
        assert_eq!(view.last_error.as_deref(), Some(oauth::CALENDAR_SESSION_REVOKED));
    }

    #[test]
    fn empty_calendar_is_a_clean_empty_result() {
        let (_dir, db) = db();
        let tz = tz();
        let keys = keys();
        store_session(&keys, 3600);
        let source = FakeSource::ok(events_response(serde_json::json!([])));
        let pulled = pull(&db, &keys, &source, time::now_ms(), &tz).unwrap();
        assert_eq!(pulled, 0);
        let conn = db.conn().unwrap();
        assert!(items(&conn, &october(), &tz).unwrap().is_empty());
        let view = status(&conn, &keys).unwrap();
        assert!(view.connected);
        assert!(view.last_error.is_none());
    }

    #[test]
    fn pull_only_when_the_cache_is_stale_or_too_narrow() {
        let conn = open_in_memory();
        let now = time::now_ms();
        let fresh_range = october();
        assert!(!needs_pull(&conn, &fresh_range, now).unwrap(), "never connected");
        conn.execute(
            "INSERT INTO calendar_sync (id, account, fetched_at, from_date, to_date, last_error)
             VALUES (1, 'ako@example.test', ?1, '2026-09-01', '2027-01-01', '')",
            [now],
        )
        .unwrap();
        assert!(!needs_pull(&conn, &fresh_range, now).unwrap(), "fresh and covering");
        assert!(
            needs_pull(&conn, &ScheduleRange { from: "2026-08-01".into(), to: "2026-10-31".into() }, now).unwrap(),
            "older than the cache"
        );
        assert!(
            needs_pull(&conn, &fresh_range, now + REFRESH_AFTER_MS).unwrap(),
            "stale"
        );
    }

    #[test]
    fn background_pulls_are_throttled() {
        let state = CalendarState::new(keys());
        let now = time::now_ms();
        assert!(state.claim_attempt(now));
        assert!(!state.claim_attempt(now + 1), "a failing pull must not loop");
        assert!(state.claim_attempt(now + RETRY_AFTER_MS));
    }

    #[test]
    fn malformed_events_never_panic() {
        let tz = tz();
        for value in [
            serde_json::json!({}),
            serde_json::json!({ "id": "x" }),
            serde_json::json!({ "id": "x", "start": { "dateTime": "nonsense" } }),
            cancelled("y"),
        ] {
            assert!(parse_event(&value, &tz).is_none(), "{value}");
        }
        let no_title = parse_event(&event_json("z", "", "2026-10-06", "2026-10-07"), &tz).unwrap();
        assert_eq!(no_title.title, "(tanpa judul)");
    }

    #[test]
    fn status_and_disconnect_commands_use_the_managed_keyring() {
        let (_dir, db) = db();
        let tz = tz();
        let state = CalendarState::new(keys());
        let disconnected = Status { connected: false, account: None, fetched_at: None, last_error: None };
        assert_eq!(current_status(&state, &db).unwrap(), disconnected);

        store_session(&state.keys, 3600);
        let source = FakeSource::ok(events_response(serde_json::json!([
            event_json("e1", "Rapat", "2026-10-06T09:00:00+07:00", "2026-10-06T10:00:00+07:00"),
        ])));
        let now = time::now_ms();
        let connected = refresh(&state, &db, &source, &tz).unwrap();
        assert!(connected.connected);
        assert_eq!(connected.account.as_deref(), Some("ako@example.test"));
        assert!(connected.fetched_at.is_some_and(|t| t >= now));
        assert_eq!(connected.last_error, None);

        assert_eq!(disconnect(&state, &db).unwrap(), disconnected);
        assert!(Session::load(&state.keys).unwrap().is_none(), "token leaves the keyring");
        assert!(items(&db.conn().unwrap(), &october(), &tz).unwrap().is_empty(), "cache is cleared");
        assert_eq!(current_status(&state, &db).unwrap(), disconnected);
    }

    #[test]
    fn disconnect_waits_for_an_in_flight_pull_so_the_grant_stays_gone() {
        let (_dir, db) = db();
        let state = CalendarState::new(keys());
        store_session(&state.keys, 3600);
        std::thread::scope(|scope| {
            // A pull (or connect) holds `running` and has the session in hand.
            let pulling = lock(&state.running);
            let disconnecting = scope.spawn(|| disconnect(&state, &db));
            std::thread::sleep(std::time::Duration::from_millis(200));
            assert!(state.cancel.load(Ordering::SeqCst), "a waiting connect is told to stop");
            // The pull refreshes its token and stores it, then finishes.
            store_session(&state.keys, 3600);
            drop(pulling);
            assert!(!disconnecting.join().unwrap().unwrap().connected);
        });
        assert!(Session::load(&state.keys).unwrap().is_none(), "the in-flight pull cannot restore the token");
        assert!(!current_status(&state, &db).unwrap().connected);
    }

    #[test]
    fn refresh_failures_land_in_last_error_and_keep_the_grant() {
        let (_dir, db) = db();
        let tz = tz();
        let state = CalendarState::new(keys());
        let err = refresh(&state, &db, &FakeSource::offline(), &tz).unwrap_err();
        assert_eq!(err.to_string(), "Sambungkan Google Kalender terlebih dahulu");

        store_session(&state.keys, 3600);
        let err = refresh(&state, &db, &FakeSource::offline(), &tz).unwrap_err();
        assert_eq!(err.to_string(), OFFLINE);
        let view = current_status(&state, &db).unwrap();
        assert!(view.connected, "a network error is not a revoked grant");
        assert_eq!(view.last_error.as_deref(), Some(OFFLINE));
    }

    #[test]
    fn background_pull_skips_when_disconnected_or_busy() {
        let (_dir, db) = db();
        let tz = tz();
        let state = CalendarState::new(keys());
        let source = FakeSource::ok(events_response(serde_json::json!([])));
        let now = time::now_ms();
        assert!(!pull_if_connected(&state, &db, &source, now, &tz).unwrap(), "not connected");

        store_session(&state.keys, 3600);
        {
            let _connecting = lock(&state.running);
            assert!(!pull_if_connected(&state, &db, &source, now, &tz).unwrap(), "connect running");
            assert!(refresh(&state, &db, &source, &tz).is_err(), "manual pull never waits on a connect");
        }
        assert!(pull_if_connected(&state, &db, &source, now, &tz).unwrap());
        let today = time::local_date(now, &tz).unwrap().to_string();
        let this_day = ScheduleRange { from: today.clone(), to: today };
        assert!(!needs_pull(&db.conn().unwrap(), &this_day, now).unwrap(), "fresh after the pull");
    }

    #[test]
    fn unconfigured_build_fails_connect_with_a_message() {
        if option_env!("ANCHOA_GOOGLE_CLIENT_ID").is_some() || std::env::var_os("ANCHOA_GOOGLE_CLIENT_ID").is_some() {
            return;
        }
        let (_dir, db) = db();
        let state = CalendarState::new(keys());
        let source = FakeSource::ok(events_response(serde_json::json!([])));
        let err = connect(&state, &db, &source, &tz()).unwrap_err();
        assert_eq!(err.to_string(), "Google Kalender belum dikonfigurasi di build ini");
        assert!(!current_status(&state, &db).unwrap().connected);
    }
}
