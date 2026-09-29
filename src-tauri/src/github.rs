//! GitHub contribution calendar: token kept in a 0600 file outside the
//! database (so backups never contain it), days cached in SQLite and refreshed
//! at most once per local day.
use std::path::{Path, PathBuf};

use jiff::{ToSpan, Zoned};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::{Value, json};

use crate::error::AppError;

const TOKEN_FILE: &str = "github-token";
const ENDPOINT: &str = "https://api.github.com/graphql";
const QUERY: &str = "query($from: DateTime!, $to: DateTime!) { viewer { login contributionsCollection(from: $from, to: $to) { contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Day {
    pub date: String,
    pub count: i64,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contributions {
    pub connected: bool,
    pub login: Option<String>,
    pub fetched_on: Option<String>,
    pub days: Vec<Day>,
    /// Set when a refresh failed; `days` then holds the last cached data.
    pub error: Option<String>,
}

/// The six local calendar months shown by the heatmap, ending today.
#[derive(Debug, Clone, PartialEq)]
pub struct Window {
    /// First cached date, e.g. `2026-04-01`.
    pub from_date: String,
    /// Same instant as RFC 3339, for the GraphQL `from` argument.
    pub from: String,
    pub to: String,
    pub today: String,
}

pub fn window(now: &Zoned) -> Result<Window, AppError> {
    let today = now.date();
    let first = today.first_of_month().checked_sub(5.months())?;
    Ok(Window {
        from_date: first.to_string(),
        from: first.to_zoned(now.time_zone().clone())?.timestamp().to_string(),
        to: now.timestamp().to_string(),
        today: today.to_string(),
    })
}

fn token_path(dir: &Path) -> PathBuf {
    dir.join(TOKEN_FILE)
}

pub fn load_token(dir: &Path) -> Option<String> {
    let token = std::fs::read_to_string(token_path(dir)).ok()?;
    let token = token.trim().to_string();
    (!token.is_empty()).then_some(token)
}

/// Writes the token readable by the owner only.
pub fn save_token(dir: &Path, token: &str) -> Result<(), AppError> {
    let token = token.trim();
    if token.is_empty() {
        return Err(AppError::Other("Token tidak boleh kosong".into()));
    }
    std::fs::create_dir_all(dir)?;
    let path = token_path(dir);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        options.mode(0o600);
        // An older file keeps its old mode on open; tighten it first.
        if path.exists() {
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        }
    }
    use std::io::Write;
    options.open(&path)?.write_all(token.as_bytes())?;
    Ok(())
}

/// Removes the token and every cached day.
pub fn disconnect(conn: &Connection, dir: &Path) -> Result<(), AppError> {
    match std::fs::remove_file(token_path(dir)) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    conn.execute_batch("DELETE FROM contributions; DELETE FROM github_sync;")?;
    Ok(())
}

/// Sends the GraphQL query; returns the raw JSON body.
pub fn fetch(token: &str, from: &str, to: &str) -> Result<Value, AppError> {
    let body = json!({ "query": QUERY, "variables": { "from": from, "to": to } });
    let mut response = ureq::post(ENDPOINT)
        .header("User-Agent", "Anchoa")
        .header("Authorization", &format!("bearer {token}"))
        .send_json(&body)
        .map_err(|e| match e {
            ureq::Error::StatusCode(401) => AppError::Other("GitHub menolak token (401)".into()),
            other => AppError::Other(format!("Gagal menghubungi GitHub: {other}")),
        })?;
    response
        .body_mut()
        .read_json::<Value>()
        .map_err(|e| AppError::Other(format!("Respons GitHub tidak terbaca: {e}")))
}

/// Pulls (login, days) out of a GraphQL response, or the first GraphQL error.
pub fn parse(response: &Value) -> Result<(String, Vec<Day>), AppError> {
    if let Some(message) = response["errors"][0]["message"].as_str() {
        return Err(AppError::Other(format!("GitHub: {message}")));
    }
    let viewer = &response["data"]["viewer"];
    let login = viewer["login"].as_str().ok_or_else(|| AppError::Other("Respons GitHub tanpa login".into()))?;
    let weeks = viewer["contributionsCollection"]["contributionCalendar"]["weeks"]
        .as_array()
        .ok_or_else(|| AppError::Other("Respons GitHub tanpa kalender".into()))?;
    let days = weeks
        .iter()
        .filter_map(|w| w["contributionDays"].as_array())
        .flatten()
        .filter_map(|d| Some(Day { date: d["date"].as_str()?.to_string(), count: d["contributionCount"].as_i64()? }))
        .collect();
    Ok((login.to_string(), days))
}

/// Replaces the cached days from `from` onwards and records the sync.
pub fn store(conn: &Connection, login: &str, days: &[Day], from: &str, today: &str) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM contributions WHERE date >= ?1", [from])?;
    for day in days {
        tx.execute("INSERT OR REPLACE INTO contributions (date, count) VALUES (?1, ?2)", params![day.date, day.count])?;
    }
    tx.execute(
        "INSERT INTO github_sync (id, login, fetched_on) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET login = excluded.login, fetched_on = excluded.fetched_on",
        params![login, today],
    )?;
    tx.commit()?;
    Ok(())
}

/// Cached view; `connected` reflects whether a token exists.
pub fn cached(conn: &Connection, connected: bool, from: &str) -> Result<Contributions, AppError> {
    let sync: Option<(String, String)> = conn
        .query_row("SELECT login, fetched_on FROM github_sync WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let mut stmt = conn.prepare("SELECT date, count FROM contributions WHERE date >= ?1 ORDER BY date")?;
    let days = stmt.query_map([from], |r| Ok(Day { date: r.get(0)?, count: r.get(1)? }))?.collect::<Result<_, _>>()?;
    let (login, fetched_on) = sync.map_or((None, None), |(l, f)| (Some(l), Some(f)));
    Ok(Contributions { connected, login, fetched_on, days, error: None })
}

pub fn login(conn: &Connection) -> Result<Option<String>, AppError> {
    Ok(conn.query_row("SELECT login FROM github_sync WHERE id = 1", [], |r| r.get(0)).optional()?)
}

/// A refresh is due when forced, or when the cache is not from today.
pub fn needs_refresh(view: &Contributions, today: &str, force: bool) -> bool {
    force || view.fetched_on.as_deref() != Some(today)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn sample() -> Value {
        json!({ "data": { "viewer": { "login": "syharipf", "contributionsCollection": { "contributionCalendar": { "weeks": [
            { "contributionDays": [ { "date": "2026-09-28", "contributionCount": 3 }, { "date": "2026-09-29", "contributionCount": 0 } ] },
            { "contributionDays": [ { "date": "2026-09-30", "contributionCount": 12 } ] }
        ] } } } } })
    }

    #[test]
    fn window_covers_six_local_months() {
        let now: Zoned = "2026-09-30T02:00:00+07:00[Asia/Jakarta]".parse().unwrap();
        let w = window(&now).unwrap();
        assert_eq!((w.from_date.as_str(), w.today.as_str()), ("2026-04-01", "2026-09-30"));
        assert_eq!(w.from, "2026-03-31T17:00:00Z");
        assert_eq!(w.to, "2026-09-29T19:00:00Z");
    }

    #[test]
    fn parses_login_and_days() {
        let (login, days) = parse(&sample()).unwrap();
        assert_eq!(login, "syharipf");
        assert_eq!(days.len(), 3);
        assert_eq!(days[2], Day { date: "2026-09-30".into(), count: 12 });
    }

    #[test]
    fn graphql_errors_are_reported() {
        let response = json!({ "errors": [ { "message": "Bad credentials" } ] });
        assert!(matches!(parse(&response), Err(AppError::Other(m)) if m.contains("Bad credentials")));
        assert!(parse(&json!({ "data": {} })).is_err());
    }

    #[test]
    fn store_replaces_cache_and_records_sync() {
        let conn = open_in_memory();
        let (login, days) = parse(&sample()).unwrap();
        store(&conn, &login, &days, "2026-04-01", "2026-09-29").unwrap();
        store(&conn, &login, &days[..1], "2026-09-29", "2026-09-30").unwrap();

        let view = cached(&conn, true, "2026-04-01").unwrap();

        assert_eq!(view.days, vec![Day { date: "2026-09-28".into(), count: 3 }]);
        assert_eq!((view.login.as_deref(), view.fetched_on.as_deref()), (Some("syharipf"), Some("2026-09-30")));
        assert_eq!(super::login(&conn).unwrap().as_deref(), Some("syharipf"));
        assert!(!needs_refresh(&view, "2026-09-30", false));
        assert!(needs_refresh(&view, "2026-09-30", true));
        assert!(needs_refresh(&view, "2026-10-01", false));
    }

    #[test]
    fn token_file_is_private_and_removable() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_in_memory();
        assert!(save_token(dir.path(), "   ").is_err());
        save_token(dir.path(), " ghp_secret \n").unwrap();
        assert_eq!(load_token(dir.path()).as_deref(), Some("ghp_secret"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join(TOKEN_FILE)).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        store(&conn, "x", &[Day { date: "2026-09-30".into(), count: 1 }], "2026-09-01", "2026-09-30").unwrap();

        disconnect(&conn, dir.path()).unwrap();
        disconnect(&conn, dir.path()).unwrap();

        assert_eq!(load_token(dir.path()), None);
        assert_eq!(cached(&conn, false, "2026-01-01").unwrap().days, vec![]);
    }
}
