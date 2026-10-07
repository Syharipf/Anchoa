//! Google Calendar two-way sync (issue #184).
//! Tasks with a due date are pushed to Google Calendar (extendedProperties.private.anchoaId).
//! Events from Google are pulled into Jadwal. Linked events update tasks via LWW.
//! Unlinked Google events are cached and can be edited/deleted from Jadwal.
//!
//! Tokens follow the sync path: the refresh token lives only in the OS keyring
//! (`keystore::KeyringStore`, service `io.github.syharipf.anchoa`) and is
//! zeroized on drop; the database holds only event cache and task links.
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
};
use std::time::Duration;

use parking_lot::{Mutex, MutexGuard};

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

const REFRESH_AFTER_MS: i64 = 300_000;
const RETRY_AFTER_MS: i64 = 60_000;
const KEYRING_KEY: &str = "calendar-session:primary";
const MAX_RESULTS: u32 = 250;
pub const UPDATED_EVENT: &str = "calendar-updated";
pub const SYNC_TOKEN_EXPIRED: &str = "SYNC_TOKEN_EXPIRED";
pub const READ_ONLY_ERROR: &str = "Izin Google Kalender hanya baca; sambungkan ulang untuk sinkron dua arah";

pub struct CalendarState {
    keys: KeyringStore,
    cancel: AtomicBool,
    /// Held for the whole of a connect or a sync: never two at once.
    running: Mutex<()>,
    /// Epoch ms of the last background pull attempt.
    last_attempt: AtomicI64,
    debounce_version: Arc<AtomicU64>,
}

impl CalendarState {
    pub fn new(keys: KeyringStore) -> Self {
        Self {
            keys,
            cancel: AtomicBool::new(false),
            running: Mutex::new(()),
            last_attempt: AtomicI64::new(i64::MIN),
            debounce_version: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Claims the background sync slot; false while one ran within `RETRY_AFTER_MS`.
    fn claim_attempt(&self, now: i64) -> bool {
        let last = self.last_attempt.load(Ordering::SeqCst);
        now.saturating_sub(last) >= RETRY_AFTER_MS
            && self
                .last_attempt
                .compare_exchange(last, now, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
    }

    /// None while a connect or another sync holds the lock.
    fn try_run(&self) -> Option<MutexGuard<'_, ()>> {
        self.running.try_lock()
    }

    /// Debounced trigger for background sync after task edits.
    pub fn schedule_debounce<F>(&self, action: F)
    where
        F: FnOnce() + Send + 'static,
    {
        let ver = self.debounce_version.fetch_add(1, Ordering::SeqCst) + 1;
        let deb_ver = Arc::clone(&self.debounce_version);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if deb_ver.load(Ordering::SeqCst) == ver {
                tauri::async_runtime::spawn_blocking(action);
            }
        });
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock()
}

#[derive(Serialize, Deserialize)]
struct Session {
    email: String,
    access_token: String,
    refresh_token: String,
    expires_at: i64,
    #[serde(default)]
    scope: Option<String>,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.access_token.zeroize();
        self.refresh_token.zeroize();
    }
}

impl Session {
    fn is_read_only(&self) -> bool {
        !self.scope.as_ref().is_some_and(|s| s.contains("calendar.events"))
    }

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
    pub account: Option<String>,
    pub fetched_at: Option<i64>,
    pub last_error: Option<String>,
    pub read_only: bool,
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
    let read_only = session.as_ref().is_some_and(|s| s.is_read_only());
    Ok(Status {
        connected: session.is_some(),
        account: session
            .as_ref()
            .map(|s| s.email.clone())
            .or_else(|| Some(account).filter(|a| !a.is_empty())),
        fetched_at: Some(fetched_at).filter(|&t| t > 0),
        last_error: Some(last_error).filter(|e| !e.is_empty()),
        read_only,
    })
}

pub trait CalendarSource: Send + Sync {
    fn email(&self, access_token: &str) -> Result<String, AppError>;
    fn events(
        &self,
        access_token: &str,
        time_min: Option<&str>,
        time_max: Option<&str>,
        sync_token: Option<&str>,
    ) -> Result<Value, AppError>;
    fn insert_event(&self, access_token: &str, event: &Value) -> Result<Value, AppError>;
    fn patch_event(&self, access_token: &str, event_id: &str, patch: &Value) -> Result<Value, AppError>;
    fn delete_event(&self, access_token: &str, event_id: &str) -> Result<(), AppError>;
    fn refresh(&self, refresh_token: &str) -> Result<GoogleTokens, AppError>;
}

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

    fn events(
        &self,
        access_token: &str,
        time_min: Option<&str>,
        time_max: Option<&str>,
        sync_token: Option<&str>,
    ) -> Result<Value, AppError> {
        let url = match sync_token.filter(|t| !t.is_empty()) {
            Some(token) => format!("{EVENTS_URL}?syncToken={}&maxResults={MAX_RESULTS}", percent_encode(token)),
            None => {
                let min = time_min.unwrap_or("");
                let max = time_max.unwrap_or("");
                format!(
                    "{EVENTS_URL}?timeMin={}&timeMax={}&singleEvents=true&orderBy=startTime&maxResults={MAX_RESULTS}",
                    percent_encode(min),
                    percent_encode(max),
                )
            }
        };
        let mut response = ureq::get(&url)
            .header("Authorization", &format!("Bearer {access_token}"))
            .header("User-Agent", "Anchoa")
            .call()
            .map_err(|e| match e {
                ureq::Error::StatusCode(410) => AppError::Other(SYNC_TOKEN_EXPIRED.into()),
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

    fn insert_event(&self, access_token: &str, event: &Value) -> Result<Value, AppError> {
        let mut response = ureq::post(EVENTS_URL)
            .header("Authorization", &format!("Bearer {access_token}"))
            .header("Content-Type", "application/json")
            .header("User-Agent", "Anchoa")
            .send_json(event)
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

    fn patch_event(&self, access_token: &str, event_id: &str, patch: &Value) -> Result<Value, AppError> {
        let url = format!("{EVENTS_URL}/{}", percent_encode(event_id));
        let mut response = ureq::patch(&url)
            .header("Authorization", &format!("Bearer {access_token}"))
            .header("Content-Type", "application/json")
            .header("User-Agent", "Anchoa")
            .send_json(patch)
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

    fn delete_event(&self, access_token: &str, event_id: &str) -> Result<(), AppError> {
        let url = format!("{EVENTS_URL}/{}", percent_encode(event_id));
        match ureq::delete(&url)
            .header("Authorization", &format!("Bearer {access_token}"))
            .header("User-Agent", "Anchoa")
            .call()
        {
            Ok(_) => Ok(()),
            Err(ureq::Error::StatusCode(404 | 410)) => Ok(()),
            Err(ureq::Error::StatusCode(code)) => Err(http_error(code)),
            Err(other) => Err(AppError::Other(format!("Tidak dapat menghubungi Google: {other}"))),
        }
    }

    fn refresh(&self, refresh_token: &str) -> Result<GoogleTokens, AppError> {
        oauth::refresh_google_token(&oauth::google_client()?, refresh_token)
    }
}

// ---- helpers ----

fn rfc3339(ms: i64, tz: &TimeZone) -> Result<String, AppError> {
    Ok(Timestamp::from_millisecond(ms)?
        .to_zoned(tz.clone())
        .strftime("%Y-%m-%dT%H:%M:%S%:z")
        .to_string())
}

fn parse_updated(value: &Value) -> i64 {
    value["updated"]
        .as_str()
        .and_then(|s| s.parse::<Timestamp>().ok().map(|t| t.as_millisecond()))
        .unwrap_or(0)
}

fn extract_anchoa_id(value: &Value) -> Option<String> {
    value["extendedProperties"]["private"]["anchoaId"]
        .as_str()
        .map(str::to_string)
}

fn parse_event_times(value: &Value, tz: &TimeZone) -> Option<(i64, i64, bool)> {
    if let Some(date_time) = value["start"]["dateTime"].as_str() {
        let start_ms = date_time.parse::<Timestamp>().ok()?.as_millisecond();
        let end_ms = value["end"]["dateTime"]
            .as_str()
            .and_then(|s| s.parse::<Timestamp>().ok().map(|t| t.as_millisecond()))
            .unwrap_or(start_ms);
        return Some((start_ms, end_ms, false));
    }
    let date = value["start"]["date"].as_str()?.parse::<Date>().ok()?;
    let (day_start, _) = time::date_bounds(date, tz).ok()?;
    let end_date = value["end"]["date"]
        .as_str()
        .and_then(|s| s.parse::<Date>().ok())
        .unwrap_or(date);
    let (end_start, _) = time::date_bounds(end_date, tz).ok()?;
    Some((day_start, end_start, true))
}

fn format_event_times(due_at: i64, start_at: Option<i64>, tz: &TimeZone) -> Result<(Value, Value), AppError> {
    let date = time::local_date(due_at, tz)?;
    let (day_start, _) = time::date_bounds(date, tz)?;
    if start_at.is_none() && due_at == day_start {
        let next_date = date.tomorrow()?;
        Ok((
            serde_json::json!({ "date": date.to_string() }),
            serde_json::json!({ "date": next_date.to_string() }),
        ))
    } else {
        let start_ms = start_at.unwrap_or(due_at);
        let end_ms = if due_at > start_ms { due_at } else { start_ms + 3_600_000 };
        Ok((
            serde_json::json!({ "dateTime": rfc3339(start_ms, tz)? }),
            serde_json::json!({ "dateTime": rfc3339(end_ms, tz)? }),
        ))
    }
}

fn format_range_times(start_at: i64, end_at: i64, tz: &TimeZone) -> Result<(Value, Value), AppError> {
    let s_date = time::local_date(start_at, tz)?;
    let (s_start, _) = time::date_bounds(s_date, tz)?;
    let e_date = time::local_date(end_at, tz)?;
    let (e_start, _) = time::date_bounds(e_date, tz)?;
    if start_at == s_start && end_at == e_start && end_at > start_at {
        Ok((
            serde_json::json!({ "date": s_date.to_string() }),
            serde_json::json!({ "date": e_date.to_string() }),
        ))
    } else {
        let effective_end = if end_at > start_at { end_at } else { start_at + 3_600_000 };
        Ok((
            serde_json::json!({ "dateTime": rfc3339(start_at, tz)? }),
            serde_json::json!({ "dateTime": rfc3339(effective_end, tz)? }),
        ))
    }
}

fn pull_window(today: Date) -> Result<(Date, Date), AppError> {
    let from = today.checked_sub(35.days())?;
    let to = today.checked_add(93.days())?;
    Ok((from, to))
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
    if tokens.scope.is_some() {
        session.scope = tokens.scope;
    }
    session.expires_at = tokens.expires_at;
    Ok(true)
}

// ---- two-way sync engine ----

struct PushItem {
    item_id: String,
    title: String,
    due_at: i64,
    start_at: Option<i64>,
    updated_at: i64,
    google_event_id: Option<String>,
}

struct DeleteItem {
    item_id: String,
    google_event_id: String,
}
struct PushPlan {
    to_create: Vec<PushItem>,
    to_update: Vec<PushItem>,
    to_delete: Vec<DeleteItem>,
    sync_token: String,
}

fn gather_push_plan(
    conn: &Connection,
    is_read_only: bool,
) -> Result<PushPlan, AppError> {
    let sync_token: String = conn
        .query_row(
            "SELECT sync_token FROM calendar_sync WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or_default();

    if is_read_only {
        return Ok(PushPlan {
            to_create: Vec::new(),
            to_update: Vec::new(),
            to_delete: Vec::new(),
            sync_token,
        });
    }

    let mut del_stmt = conn.prepare(
        "SELECT l.item_id, l.google_event_id
         FROM calendar_task_links l
         LEFT JOIN items i ON i.id = l.item_id
         WHERE l.deleted_at IS NULL
           AND (i.id IS NULL OR i.deleted_at IS NOT NULL OR i.due_at IS NULL)",
    )?;
    let to_delete = del_stmt
        .query_map([], |r| {
            Ok(DeleteItem {
                item_id: r.get(0)?,
                google_event_id: r.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut create_stmt = conn.prepare(
        "SELECT i.id, i.title, i.due_at, t.start_at, i.updated_at
         FROM items i
         JOIN tasks t ON t.item_id = i.id
         LEFT JOIN calendar_task_links l ON l.item_id = i.id AND l.deleted_at IS NULL
         WHERE i.deleted_at IS NULL
           AND i.due_at IS NOT NULL
           AND l.item_id IS NULL",
    )?;
    let to_create = create_stmt
        .query_map([], |r| {
            Ok(PushItem {
                item_id: r.get(0)?,
                title: r.get(1)?,
                due_at: r.get(2)?,
                start_at: r.get(3)?,
                updated_at: r.get(4)?,
                google_event_id: None,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut update_stmt = conn.prepare(
        "SELECT i.id, i.title, i.due_at, t.start_at, i.updated_at, l.google_event_id
         FROM items i
         JOIN tasks t ON t.item_id = i.id
         JOIN calendar_task_links l ON l.item_id = i.id
         WHERE i.deleted_at IS NULL
           AND i.due_at IS NOT NULL
           AND l.deleted_at IS NULL
           AND i.updated_at > l.local_updated_at",
    )?;
    let to_update = update_stmt
        .query_map([], |r| {
            Ok(PushItem {
                item_id: r.get(0)?,
                title: r.get(1)?,
                due_at: r.get(2)?,
                start_at: r.get(3)?,
                updated_at: r.get(4)?,
                google_event_id: Some(r.get(5)?),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(PushPlan {
        to_create,
        to_update,
        to_delete,
        sync_token,
    })
}
pub fn pull(
    db: &Db,
    keys: &KeyringStore,
    source: &dyn CalendarSource,
    now: i64,
    tz: &TimeZone,
) -> Result<usize, AppError> {
    let mut session = Session::load(keys)?.ok_or_else(not_connected)?;
    sync_session(db, keys, source, &mut session, now, tz)
}

fn sync_session(
    db: &Db,
    keys: &KeyringStore,
    source: &dyn CalendarSource,
    session: &mut Session,
    now: i64,
    tz: &TimeZone,
) -> Result<usize, AppError> {
    match refresh_if_expiring(source, session, now) {
        Ok(true) => {
            session.store(keys)?;
        }
        Ok(false) => {}
        Err(e) => {
            handle_network_error(db, keys, &e)?;
            return Err(e);
        }
    }

    // Step 1: Gather push items under brief DB lock
    let PushPlan {
        to_create,
        to_update,
        to_delete,
        sync_token,
    } = {
        let conn = db.conn()?;
        gather_push_plan(&conn, session.is_read_only())?
    };

    // Step 2: Network operations outside DB lock
    let mut created_results = Vec::new();
    let mut updated_results = Vec::new();

    if !session.is_read_only() {
        for del in &to_delete {
            let _ = source.delete_event(&session.access_token, &del.google_event_id);
        }

        for item in &to_create {
            let summary = if item.title.trim().is_empty() { "(tanpa judul)" } else { item.title.trim() };
            let (start_obj, end_obj) = format_event_times(item.due_at, item.start_at, tz)?;
            let payload = serde_json::json!({
                "summary": summary,
                "start": start_obj,
                "end": end_obj,
                "extendedProperties": {
                    "private": {
                        "anchoaId": item.item_id
                    }
                }
            });
            match source.insert_event(&session.access_token, &payload) {
                Ok(res) => {
                    if let Some(gid) = res["id"].as_str() {
                        let etag = res["etag"].as_str().unwrap_or("").to_string();
                        let g_up = parse_updated(&res);
                        created_results.push((item.item_id.clone(), gid.to_string(), etag, g_up, item.updated_at));
                    }
                }
                Err(e) => {
                    handle_network_error(db, keys, &e)?;
                    return Err(e);
                }
            }
        }

        for item in &to_update {
            if let Some(gid) = &item.google_event_id {
                let summary = if item.title.trim().is_empty() { "(tanpa judul)" } else { item.title.trim() };
                let (start_obj, end_obj) = format_event_times(item.due_at, item.start_at, tz)?;
                let payload = serde_json::json!({
                    "summary": summary,
                    "start": start_obj,
                    "end": end_obj,
                });
                match source.patch_event(&session.access_token, gid, &payload) {
                    Ok(res) => {
                        let etag = res["etag"].as_str().unwrap_or("").to_string();
                        let g_up = parse_updated(&res);
                        updated_results.push((item.item_id.clone(), etag, g_up, item.updated_at));
                    }
                    Err(e) => {
                        handle_network_error(db, keys, &e)?;
                        return Err(e);
                    }
                }
            }
        }
    }

    // Network pull
    let (from, to) = pull_window(time::local_date(now, tz)?)?;
    let time_min = rfc3339(time::date_bounds(from, tz)?.0, tz)?;
    let time_max = rfc3339(time::date_bounds(to, tz)?.1, tz)?;

    let (events_val, was_full_pull) = if !sync_token.is_empty() {
        match source.events(&session.access_token, None, None, Some(&sync_token)) {
            Ok(val) => (val, false),
            Err(e) if e.to_string().contains(SYNC_TOKEN_EXPIRED) || e.to_string().contains("410") => {
                match source.events(&session.access_token, Some(&time_min), Some(&time_max), None) {
                    Ok(val) => (val, true),
                    Err(e) => {
                        handle_network_error(db, keys, &e)?;
                        return Err(e);
                    }
                }
            }
            Err(e) => {
                handle_network_error(db, keys, &e)?;
                return Err(e);
            }
        }
    } else {
        match source.events(&session.access_token, Some(&time_min), Some(&time_max), None) {
            Ok(val) => (val, true),
            Err(e) => {
                handle_network_error(db, keys, &e)?;
                return Err(e);
            }
        }
    };

    let next_sync_token = events_val["nextSyncToken"].as_str().unwrap_or("").to_string();
    let raw_items = events_val["items"].as_array().cloned().unwrap_or_default();

    // Step 3: Apply changes under DB transaction
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;

    for del in &to_delete {
        tx.execute(
            "UPDATE calendar_task_links SET deleted_at = ?2 WHERE item_id = ?1",
            params![del.item_id, now],
        )?;
    }

    for (item_id, event_id, etag, google_up, local_up) in &created_results {
        tx.execute(
            "INSERT INTO calendar_task_links (item_id, google_event_id, etag, google_updated, local_updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL)
             ON CONFLICT(item_id) DO UPDATE SET
               google_event_id = excluded.google_event_id,
               etag = excluded.etag,
               google_updated = excluded.google_updated,
               local_updated_at = excluded.local_updated_at,
               deleted_at = NULL",
            params![item_id, event_id, etag, google_up, local_up],
        )?;
    }

    for (item_id, etag, google_up, local_up) in &updated_results {
        tx.execute(
            "UPDATE calendar_task_links SET etag = ?2, google_updated = ?3, local_updated_at = ?4, deleted_at = NULL
             WHERE item_id = ?1",
            params![item_id, etag, google_up, local_up],
        )?;
    }

    let mut pulled_unlinked_ids = Vec::new();

    for item_val in &raw_items {
        let Some(event_id) = item_val["id"].as_str() else { continue };
        let is_cancelled = item_val["status"].as_str() == Some("cancelled");

        let anchoa_id = extract_anchoa_id(item_val);
        let linked_item_id: Option<String> = if let Some(aid) = anchoa_id {
            Some(aid)
        } else {
            tx.query_row(
                "SELECT item_id FROM calendar_task_links WHERE google_event_id = ?1",
                [event_id],
                |r| r.get(0),
            )
            .optional()?
        };

        if is_cancelled {
            if linked_item_id.is_some() {
                tx.execute(
                    "UPDATE calendar_task_links SET deleted_at = ?2 WHERE google_event_id = ?1",
                    params![event_id, now],
                )?;
            }
            tx.execute("DELETE FROM calendar_events WHERE event_id = ?1", [event_id])?;
            continue;
        }

        if let Some(item_id) = linked_item_id {
            let task_row: Option<(String, i64, i64)> = tx
                .query_row(
                    "SELECT title, updated_at, due_at FROM items WHERE id = ?1 AND deleted_at IS NULL",
                    [&item_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;

            if let Some((_local_title, local_updated_at, _local_due)) = task_row {
                let google_updated = parse_updated(item_val);
                let etag = item_val["etag"].as_str().unwrap_or("");

                if google_updated > local_updated_at {
                    let summary = item_val["summary"].as_str().unwrap_or("").trim();
                    let title = if summary.is_empty() { "(tanpa judul)" } else { summary };
                    if let Some((start_ms, end_ms, is_all_day)) = parse_event_times(item_val, tz) {
                        let due_at = if is_all_day { start_ms } else { end_ms };
                        let start_at = if is_all_day { None } else { Some(start_ms) };
                        tx.execute(
                            "UPDATE items SET title = ?2, due_at = ?3, updated_at = ?4 WHERE id = ?1",
                            params![item_id, title, due_at, google_updated],
                        )?;
                        tx.execute(
                            "UPDATE tasks SET start_at = ?2 WHERE item_id = ?1",
                            params![item_id, start_at],
                        )?;
                    }
                }

                tx.execute(
                    "INSERT INTO calendar_task_links (item_id, google_event_id, etag, google_updated, local_updated_at, deleted_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, NULL)
                     ON CONFLICT(item_id) DO UPDATE SET
                       google_event_id = excluded.google_event_id,
                       etag = excluded.etag,
                       google_updated = excluded.google_updated,
                       deleted_at = NULL",
                    params![item_id, event_id, etag, google_updated, google_updated.max(local_updated_at)],
                )?;

                tx.execute("DELETE FROM calendar_events WHERE event_id = ?1", [event_id])?;
                continue;
            }
        }

        if let Some((start_ms, end_ms, _)) = parse_event_times(item_val, tz) {
            let summary = item_val["summary"].as_str().unwrap_or("").trim();
            let title = if summary.is_empty() { "(tanpa judul)" } else { summary };
            tx.execute(
                "INSERT OR REPLACE INTO calendar_events (event_id, title, start_at, end_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![event_id, title, start_ms, end_ms],
            )?;
            pulled_unlinked_ids.push(event_id.to_string());
        }
    }

    if was_full_pull {
        let (from_ms, to_ms) = (
            time::date_bounds(from, tz)?.0,
            time::date_bounds(to, tz)?.1,
        );
        if pulled_unlinked_ids.is_empty() {
            tx.execute(
                "DELETE FROM calendar_events WHERE start_at < ?2 AND end_at > ?1",
                params![from_ms, to_ms],
            )?;
        } else {
            let placeholders = pulled_unlinked_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let query = format!(
                "DELETE FROM calendar_events WHERE start_at < ?2 AND end_at > ?1 AND event_id NOT IN ({placeholders})"
            );
            let mut del_params: Vec<rusqlite::types::Value> = vec![from_ms.into(), to_ms.into()];
            for id in &pulled_unlinked_ids {
                del_params.push(id.clone().into());
            }
            tx.execute(&query, rusqlite::params_from_iter(del_params))?;
        }
    }

    tx.execute(
        "DELETE FROM calendar_events WHERE event_id IN (
            SELECT google_event_id FROM calendar_task_links WHERE deleted_at IS NULL
         )",
        [],
    )?;

    tx.execute(
        "INSERT INTO calendar_sync (id, account, fetched_at, from_date, to_date, last_error, sync_token)
         VALUES (1, ?1, ?2, ?3, ?4, '', ?5)
         ON CONFLICT(id) DO UPDATE SET
           account = excluded.account,
           fetched_at = excluded.fetched_at,
           from_date = excluded.from_date,
           to_date = excluded.to_date,
           last_error = '',
           sync_token = excluded.sync_token",
        params![session.email, now, from.to_string(), to.to_string(), next_sync_token],
    )?;

    tx.commit()?;
    Ok(raw_items.len() + to_create.len() + to_update.len())
}

fn handle_network_error(db: &Db, keys: &KeyringStore, error: &AppError) -> Result<(), AppError> {
    let message = error.to_string();
    let conn = db.conn()?;
    if message.contains(oauth::CALENDAR_SESSION_REVOKED) {
        Session::delete(keys)?;
        store_error(&conn, oauth::CALENDAR_SESSION_REVOKED)?;
    } else {
        store_error(&conn, &message)?;
    }
    Ok(())
}

// ---- schedule surface ----

pub fn items(conn: &Connection, range: &ScheduleRange, tz: &TimeZone) -> Result<Vec<ScheduleItem>, AppError> {
    let (from_ms, to_ms) = range_bounds(range, tz)?;
    let mut stmt = conn.prepare(
        "SELECT event_id, title, start_at, end_at FROM calendar_events
         WHERE end_at > ?1 AND start_at < ?2
           AND event_id NOT IN (SELECT google_event_id FROM calendar_task_links WHERE deleted_at IS NULL)
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
            start_at: Some(start_at),
            end_at: Some(end_at),
        });
    }
    Ok(items)
}

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
        match sync_if_connected(&state, &db, &GoogleApi, time::now_ms(), &TimeZone::system()) {
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

pub fn trigger_sync(app: &AppHandle) {
    let Some(state) = app.try_state::<CalendarState>() else { return };
    let app = app.clone();
    state.schedule_debounce(move || {
        let (Some(state), Some(db)) = (app.try_state::<CalendarState>(), app.try_state::<Db>()) else {
            return;
        };
        match sync_if_connected(&state, &db, &GoogleApi, time::now_ms(), &TimeZone::system()) {
            Ok(true) => {
                if let Err(e) = app.emit(UPDATED_EVENT, ()) {
                    log::warn!("google calendar trigger sync event emit failed: {e}");
                }
            }
            Ok(false) => {}
            Err(e) => log::warn!("google calendar triggered sync failed: {e}"),
        }
    });
}

fn sync_if_connected(
    state: &CalendarState,
    db: &Db,
    source: &dyn CalendarSource,
    now: i64,
    tz: &TimeZone,
) -> Result<bool, AppError> {
    let Some(_running) = state.try_run() else { return Ok(false) };
    let Ok(Some(mut session)) = Session::load(&state.keys) else { return Ok(false) };
    sync_session(db, &state.keys, source, &mut session, now, tz).map(|_| true)
}

// ---- connect / disconnect ----

fn session_from(tokens: GoogleTokens, email: String) -> Session {
    Session {
        email,
        access_token: tokens.access_token.to_string(),
        refresh_token: tokens.refresh_token.to_string(),
        expires_at: tokens.expires_at,
        scope: tokens.scope,
    }
}

fn current_status(state: &CalendarState, db: &Db) -> Result<Status, AppError> {
    status(&*db.conn()?, &state.keys)
}

fn connect(state: &CalendarState, db: &Db, source: &dyn CalendarSource, tz: &TimeZone) -> Result<Status, AppError> {
    let _running = lock(&state.running);
    state.cancel.store(false, Ordering::SeqCst);
    let flow = oauth::begin_calendar(oauth::google_client()?)?;
    let tokens = flow.wait_cancellable(oauth::DEFAULT_TIMEOUT, &state.cancel)?;
    let email = source.email(&tokens.access_token)?;
    let mut session = session_from(tokens, email);
    session.store(&state.keys)?;
    match sync_session(db, &state.keys, source, &mut session, time::now_ms(), tz) {
        Ok(synced) => log::info!("google calendar connected: {synced} items synced"),
        Err(e) => log::warn!("google calendar first sync failed: {e}"),
    }
    current_status(state, db)
}

fn refresh(state: &CalendarState, db: &Db, source: &dyn CalendarSource, tz: &TimeZone) -> Result<Status, AppError> {
    let Some(_running) = state.try_run() else {
        return Err(AppError::Invalid("Google Kalender sedang diproses; coba lagi sebentar lagi".into()));
    };
    pull(db, &state.keys, source, time::now_ms(), tz)?;
    current_status(state, db)
}

fn disconnect(state: &CalendarState, db: &Db) -> Result<Status, AppError> {
    state.cancel.store(true, Ordering::SeqCst);
    let _running = lock(&state.running);
    Session::delete(&state.keys)?;
    let conn = db.conn()?;
    conn.execute_batch("DELETE FROM calendar_events; DELETE FROM calendar_sync; DELETE FROM calendar_task_links;")?;
    status(&conn, &state.keys)
}

// ---- event mutation on Google Calendar ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCalendarEventArgs {
    pub id: String,
    pub title: String,
    pub start_at: i64,
    pub end_at: i64,
}

pub fn update_event(
    state: &CalendarState,
    db: &Db,
    source: &dyn CalendarSource,
    args: UpdateCalendarEventArgs,
    tz: &TimeZone,
) -> Result<(), AppError> {
    let mut session = Session::load(&state.keys)?.ok_or_else(not_connected)?;
    if session.is_read_only() {
        return Err(AppError::Invalid(READ_ONLY_ERROR.into()));
    }
    let now = time::now_ms();
    if refresh_if_expiring(source, &mut session, now)? {
        session.store(&state.keys)?;
    }

    let summary = if args.title.trim().is_empty() { "(tanpa judul)" } else { args.title.trim() };
    let (start_obj, end_obj) = format_range_times(args.start_at, args.end_at, tz)?;
    let patch = serde_json::json!({
        "summary": summary,
        "start": start_obj,
        "end": end_obj,
    });

    source.patch_event(&session.access_token, &args.id, &patch)?;

    let conn = db.conn()?;
    conn.execute(
        "UPDATE calendar_events SET title = ?2, start_at = ?3, end_at = ?4 WHERE event_id = ?1",
        params![args.id, summary, args.start_at, args.end_at],
    )?;

    Ok(())
}

pub fn delete_event(
    state: &CalendarState,
    db: &Db,
    source: &dyn CalendarSource,
    id: &str,
) -> Result<(), AppError> {
    let mut session = Session::load(&state.keys)?.ok_or_else(not_connected)?;
    if session.is_read_only() {
        return Err(AppError::Invalid(READ_ONLY_ERROR.into()));
    }
    let now = time::now_ms();
    if refresh_if_expiring(source, &mut session, now)? {
        session.store(&state.keys)?;
    }

    source.delete_event(&session.access_token, id)?;

    let conn = db.conn()?;
    conn.execute("DELETE FROM calendar_events WHERE event_id = ?1", [id])?;

    Ok(())
}

// ---- commands ----

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

#[tauri::command]
pub async fn calendar_update_event(
    app: AppHandle,
    input: UpdateCalendarEventArgs,
) -> Result<(), AppError> {
    run(app.clone(), move |state, db| {
        update_event(state, db, &GoogleApi, input, &TimeZone::system())
    })
    .await?;
    let _ = app.emit(UPDATED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub async fn calendar_delete_event(
    app: AppHandle,
    id: String,
) -> Result<(), AppError> {
    run(app.clone(), move |state, db| {
        delete_event(state, db, &GoogleApi, &id)
    })
    .await?;
    let _ = app.emit(UPDATED_EVENT, ());
    Ok(())
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
        serde_json::json!({ "id": id, "summary": title, "start": start_obj, "end": end_obj, "status": "confirmed" })
    }

    fn cancelled(id: &str) -> Value {
        let mut value = event_json(id, "x", "2026-10-06", "2026-10-07");
        value["status"] = serde_json::json!("cancelled");
        value
    }

    fn events_response(items: Value) -> Value {
        serde_json::json!({ "items": items, "nextSyncToken": "token-1" })
    }

    fn tokens(expires_in: i64) -> GoogleTokens {
        GoogleTokens {
            access_token: Zeroizing::new("at".into()),
            refresh_token: Zeroizing::new("rt".into()),
            expires_at: time::now_ms() + expires_in * 1000,
            scope: Some("https://www.googleapis.com/auth/calendar.events openid email".into()),
        }
    }

    const OFFLINE: &str = "Tidak dapat menghubungi Google; periksa koneksi";

    struct FakeSource {
        response: Mutex<Value>,
        revoked: bool,
        offline: bool,
        status_410_once: AtomicBool,
        inserted: Mutex<Vec<Value>>,
        patched: Mutex<Vec<(String, Value)>>,
        deleted: Mutex<Vec<String>>,
    }

    impl FakeSource {
        fn ok(response: Value) -> Self {
            Self {
                response: Mutex::new(response),
                revoked: false,
                offline: false,
                status_410_once: AtomicBool::new(false),
                inserted: Mutex::new(Vec::new()),
                patched: Mutex::new(Vec::new()),
                deleted: Mutex::new(Vec::new()),
            }
        }
        fn revoked() -> Self {
            let mut s = Self::ok(events_response(serde_json::json!([])));
            s.revoked = true;
            s
        }
        fn offline() -> Self {
            let mut s = Self::ok(events_response(serde_json::json!([])));
            s.offline = true;
            s
        }
        fn with_410_once(response: Value) -> Self {
            let mut s = Self::ok(response);
            s.status_410_once = AtomicBool::new(true);
            s
        }
    }

    impl CalendarSource for FakeSource {
        fn email(&self, _access_token: &str) -> Result<String, AppError> {
            Ok("ako@example.test".into())
        }
        fn events(
            &self,
            _access: &str,
            _min: Option<&str>,
            _max: Option<&str>,
            sync_token: Option<&str>,
        ) -> Result<Value, AppError> {
            if self.offline {
                return Err(AppError::Other(OFFLINE.into()));
            }
            if sync_token.is_some() && self.status_410_once.swap(false, Ordering::SeqCst) {
                return Err(AppError::Other(SYNC_TOKEN_EXPIRED.into()));
            }
            Ok(self.response.lock().clone())
        }
        fn insert_event(&self, _access_token: &str, event: &Value) -> Result<Value, AppError> {
            if self.offline {
                return Err(AppError::Other(OFFLINE.into()));
            }
            self.inserted.lock().push(event.clone());
            let count = self.inserted.lock().len();
            let mut ret = event.clone();
            ret["id"] = serde_json::json!(format!("g-{count}"));
            ret["etag"] = serde_json::json!("etag-1");
            ret["updated"] = serde_json::json!("2026-10-07T12:00:00.000Z");
            Ok(ret)
        }
        fn patch_event(&self, _access_token: &str, event_id: &str, patch: &Value) -> Result<Value, AppError> {
            if self.offline {
                return Err(AppError::Other(OFFLINE.into()));
            }
            self.patched.lock().push((event_id.to_string(), patch.clone()));
            let mut ret = patch.clone();
            ret["id"] = serde_json::json!(event_id);
            ret["etag"] = serde_json::json!("etag-2");
            ret["updated"] = serde_json::json!("2026-10-07T12:05:00.000Z");
            Ok(ret)
        }
        fn delete_event(&self, _access_token: &str, event_id: &str) -> Result<(), AppError> {
            if self.offline {
                return Err(AppError::Other(OFFLINE.into()));
            }
            self.deleted.lock().push(event_id.to_string());
            Ok(())
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
            scope: Some("https://www.googleapis.com/auth/calendar.events openid email".into()),
        }
        .store(keys)
        .unwrap();
    }

    #[test]
    fn calendar_scopes_stay_separate_from_the_sync_flow() {
        let sync_url = crate::sync::server::HttpServer::new("https://sync.example.test", "anon")
            .unwrap()
            .authorize_url(
                crate::sync::server::Provider::Google,
                "http://127.0.0.1:1/callback?state=s",
                "challenge",
                "s",
            );
        assert!(!sync_url.contains("calendar"));
        let joined = oauth::CALENDAR_SCOPES.join(" ");
        assert_eq!(
            joined.split(' ').count(),
            oauth::CALENDAR_SCOPES.len(),
            "no scope contains a space"
        );
        assert!(joined.contains("https://www.googleapis.com/auth/calendar.events"));
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
        assert_eq!(pulled, 3); // 2 events + 1 nextSyncToken/cancelled processed

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
    fn status_and_disconnect_commands_use_the_managed_keyring() {
        let (_dir, db) = db();
        let tz = tz();
        let state = CalendarState::new(keys());
        let disconnected = Status { connected: false, account: None, fetched_at: None, last_error: None, read_only: false };
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
    fn push_create_update_delete() {
        let (_dir, db) = db();
        let tz = tz();
        let keys = keys();
        store_session(&keys, 3600);
        let source = FakeSource::ok(events_response(serde_json::json!([])));

        let now = time::now_ms();
        let task_id = {
            let conn = db.conn().unwrap();
            let id = crate::items::insert(&conn, "task", "Kirim invoice", "", now).unwrap();
            let due = time::date_bounds(Date::new(2026, 10, 15).unwrap(), &tz).unwrap().0;
            conn.execute("INSERT INTO tasks (item_id, status) VALUES (?1, 'plan')", [&id]).unwrap();
            crate::items::update(&conn, &id, &crate::items::ItemPatch { due_at: Some(Some(due)), ..Default::default() }, now).unwrap();
            id
        };

        pull(&db, &keys, &source, now + 1, &tz).unwrap();
        assert_eq!(source.inserted.lock().len(), 1);
        let inserted = source.inserted.lock()[0].clone();
        assert_eq!(inserted["summary"], "Kirim invoice");
        assert_eq!(inserted["extendedProperties"]["private"]["anchoaId"], task_id);
        assert_eq!(inserted["start"]["date"], "2026-10-15");
        assert_eq!(inserted["end"]["date"], "2026-10-16");

        {
            let conn = db.conn().unwrap();
            let (gid, del): (String, Option<i64>) = conn.query_row(
                "SELECT google_event_id, deleted_at FROM calendar_task_links WHERE item_id = ?1",
                [&task_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            ).unwrap();
            assert_eq!(gid, "g-1");
            assert!(del.is_none());
        }

        {
            let conn = db.conn().unwrap();
            crate::items::update(&conn, &task_id, &crate::items::ItemPatch { title: Some("Kirim invoice revisi".into()), ..Default::default() }, now + 10).unwrap();
        }
        pull(&db, &keys, &source, now + 15, &tz).unwrap();
        assert_eq!(source.patched.lock().len(), 1);
        let (patch_id, patch_val) = source.patched.lock()[0].clone();
        assert_eq!(patch_id, "g-1");
        assert_eq!(patch_val["summary"], "Kirim invoice revisi");
        {
            let conn = db.conn().unwrap();
            crate::items::delete(&conn, &task_id, now + 20).unwrap();
        }
        pull(&db, &keys, &source, now + 25, &tz).unwrap();
        assert_eq!(*source.deleted.lock(), vec!["g-1".to_string()]);
        {
            let conn = db.conn().unwrap();
            let del: Option<i64> = conn.query_row(
                "SELECT deleted_at FROM calendar_task_links WHERE item_id = ?1",
                [&task_id],
                |r| r.get(0),
            ).unwrap();
            assert!(del.is_some());
        }
    }

    #[test]
    fn pull_lww_both_directions() {
        let (_dir, db) = db();
        let tz = tz();
        let keys = keys();
        store_session(&keys, 3600);

        let task_id = {
            let conn = db.conn().unwrap();
            let id = crate::items::insert(&conn, "task", "Lokal Asli", "", 1000).unwrap();
            let due = time::date_bounds(Date::new(2026, 10, 10).unwrap(), &tz).unwrap().0;
            conn.execute("INSERT INTO tasks (item_id, status) VALUES (?1, 'plan')", [&id]).unwrap();
            crate::items::update(&conn, &id, &crate::items::ItemPatch { due_at: Some(Some(due)), ..Default::default() }, 1000).unwrap();
            conn.execute(
                "INSERT INTO calendar_task_links (item_id, google_event_id, etag, google_updated, local_updated_at)
                 VALUES (?1, 'g-lww', 'e1', 1000, 1000)",
                [&id],
            ).unwrap();
            id
        };

        // Direction 1: Google has newer updated timestamp -> Google wins
        let google_event = serde_json::json!({
            "id": "g-lww",
            "summary": "Google Menang",
            "start": { "date": "2026-10-12" },
            "end": { "date": "2026-10-13" },
            "updated": "2026-10-07T12:00:00.000Z",
            "extendedProperties": { "private": { "anchoaId": task_id } }
        });
        let source = FakeSource::ok(events_response(serde_json::json!([google_event])));
        pull(&db, &keys, &source, 2000, &tz).unwrap();

        {
            let conn = db.conn().unwrap();
            let (title, due_at): (String, i64) = conn.query_row(
                "SELECT title, due_at FROM items WHERE id = ?1",
                [&task_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            ).unwrap();
            assert_eq!(title, "Google Menang");
            let expected_due = time::date_bounds(Date::new(2026, 10, 12).unwrap(), &tz).unwrap().0;
            assert_eq!(due_at, expected_due);
        }

        // Direction 2: Local task has newer updated_at than Google updated -> Local wins
        {
            let conn = db.conn().unwrap();
            crate::items::update(&conn, &task_id, &crate::items::ItemPatch { title: Some("Lokal Menang".into()), ..Default::default() }, 2_000_000_000_000).unwrap();
        }
        let older_google_event = serde_json::json!({
            "id": "g-lww",
            "summary": "Google Lama",
            "start": { "date": "2026-10-12" },
            "end": { "date": "2026-10-13" },
            "updated": "2026-10-07T12:00:00.000Z",
            "extendedProperties": { "private": { "anchoaId": task_id } }
        });
        *source.response.lock() = events_response(serde_json::json!([older_google_event]));
        pull(&db, &keys, &source, 2_000_000_000_001, &tz).unwrap();

        {
            let conn = db.conn().unwrap();
            let title: String = conn.query_row("SELECT title FROM items WHERE id = ?1", [&task_id], |r| r.get(0)).unwrap();
            assert_eq!(title, "Lokal Menang", "Local edit must not be overwritten by older Google event");
        }
    }

    #[test]
    fn google_deletion_unlinks() {
        let (_dir, db) = db();
        let tz = tz();
        let keys = keys();
        store_session(&keys, 3600);

        let task_id = {
            let conn = db.conn().unwrap();
            let id = crate::items::insert(&conn, "task", "Tetap Ada", "", 1000).unwrap();
            let due = time::date_bounds(Date::new(2026, 10, 10).unwrap(), &tz).unwrap().0;
            conn.execute("INSERT INTO tasks (item_id, status) VALUES (?1, 'plan')", [&id]).unwrap();
            crate::items::update(&conn, &id, &crate::items::ItemPatch { due_at: Some(Some(due)), ..Default::default() }, 1000).unwrap();
            conn.execute(
                "INSERT INTO calendar_task_links (item_id, google_event_id, etag, google_updated, local_updated_at)
                 VALUES (?1, 'g-del', 'e1', 1000, 1000)",
                [&id],
            ).unwrap();
            id
        };

        let cancelled_event = serde_json::json!({
            "id": "g-del",
            "status": "cancelled",
        });
        let source = FakeSource::ok(events_response(serde_json::json!([cancelled_event])));
        pull(&db, &keys, &source, 2000, &tz).unwrap();

        let conn = db.conn().unwrap();
        let (title, deleted_at): (String, Option<i64>) = conn.query_row(
            "SELECT title, deleted_at FROM items WHERE id = ?1",
            [&task_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(title, "Tetap Ada");
        assert!(deleted_at.is_none());

        let link_deleted: Option<i64> = conn.query_row(
            "SELECT deleted_at FROM calendar_task_links WHERE google_event_id = 'g-del'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert!(link_deleted.is_some());
    }

    #[test]
    fn full_resync_on_410() {
        let (_dir, db) = db();
        let tz = tz();
        let keys = keys();
        store_session(&keys, 3600);

        {
            let conn = db.conn().unwrap();
            conn.execute(
                "INSERT INTO calendar_sync (id, account, fetched_at, from_date, to_date, sync_token)
                 VALUES (1, 'ako@example.test', 1000, '2026-09-01', '2027-01-01', 'expired-token')",
                [],
            ).unwrap();
        }

        let event = event_json("e-fresh", "Acara Baru", "2026-10-10", "2026-10-11");
        let mut resp = events_response(serde_json::json!([event]));
        resp["nextSyncToken"] = serde_json::json!("new-valid-token");
        let source = FakeSource::with_410_once(resp);

        pull(&db, &keys, &source, 2000, &tz).unwrap();

        let conn = db.conn().unwrap();
        let token: String = conn.query_row("SELECT sync_token FROM calendar_sync WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(token, "new-valid-token");
        let cal_items = items(&conn, &october(), &tz).unwrap();
        assert_eq!(cal_items.len(), 1);
        assert_eq!(cal_items[0].id, "e-fresh");
    }

    #[test]
    fn read_only_grant_refuses_writes_with_a_clear_error() {
        let (_dir, db) = db();
        let tz = tz();
        let keys = keys();
        Session {
            email: "ako@example.test".into(),
            access_token: "at".into(),
            refresh_token: "rt".into(),
            expires_at: time::now_ms() + 3600 * 1000,
            scope: Some("https://www.googleapis.com/auth/calendar.readonly openid email".into()),
        }
        .store(&keys)
        .unwrap();

        let state = CalendarState::new(keys);
        let err = update_event(
            &state,
            &db,
            &FakeSource::ok(events_response(serde_json::json!([]))),
            UpdateCalendarEventArgs {
                id: "e1".into(),
                title: "Ganti".into(),
                start_at: 1000,
                end_at: 2000,
            },
            &tz,
        )
        .unwrap_err();
        assert!(err.to_string().contains("hanya baca"));

        let err_del = delete_event(
            &state,
            &db,
            &FakeSource::ok(events_response(serde_json::json!([]))),
            "e1",
        )
        .unwrap_err();
        assert!(err_del.to_string().contains("hanya baca"));

        let st = current_status(&state, &db).unwrap();
        assert!(st.read_only);
    }

    #[test]
    fn no_duplicate_events_after_repeated_syncs() {
        let (_dir, db) = db();
        let tz = tz();
        let keys = keys();
        store_session(&keys, 3600);

        let now = time::now_ms();
        let task_id = {
            let conn = db.conn().unwrap();
            let id = crate::items::insert(&conn, "task", "Tugas Tunggal", "", now).unwrap();
            let due = time::date_bounds(Date::new(2026, 10, 15).unwrap(), &tz).unwrap().0;
            conn.execute("INSERT INTO tasks (item_id, status) VALUES (?1, 'plan')", [&id]).unwrap();
            crate::items::update(&conn, &id, &crate::items::ItemPatch { due_at: Some(Some(due)), ..Default::default() }, now).unwrap();
            id
        };

        let source = FakeSource::ok(events_response(serde_json::json!([])));
        pull(&db, &keys, &source, now + 1, &tz).unwrap();

        let google_event = serde_json::json!({
            "id": "g-1",
            "summary": "Tugas Tunggal",
            "start": { "date": "2026-10-15" },
            "end": { "date": "2026-10-16" },
            "updated": "2026-10-07T12:00:00.000Z",
            "extendedProperties": { "private": { "anchoaId": task_id } }
        });
        *source.response.lock() = events_response(serde_json::json!([google_event]));
        pull(&db, &keys, &source, now + 10, &tz).unwrap();
        pull(&db, &keys, &source, now + 20, &tz).unwrap();

        let conn = db.conn().unwrap();
        let cal_items = items(&conn, &october(), &tz).unwrap();
        assert_eq!(cal_items.len(), 0, "linked task must not be in calendar_events");

        let sched = crate::schedule::schedule(&conn, &october(), now + 20, &tz).unwrap();
        let matching: Vec<_> = sched.items.iter().filter(|i| i.title == "Tugas Tunggal").collect();
        assert_eq!(matching.len(), 1, "task must appear exactly once in schedule");
    }
}
