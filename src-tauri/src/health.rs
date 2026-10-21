use std::str::FromStr;

use jiff::{civil::Date, tz::TimeZone};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::time;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthKind {
    WeightG,
    SleepMin,
    Steps,
    RestingHr,
}

impl HealthKind {
    pub const ALL: [HealthKind; 4] = [
        HealthKind::WeightG,
        HealthKind::SleepMin,
        HealthKind::Steps,
        HealthKind::RestingHr,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            HealthKind::WeightG => "weight_g",
            HealthKind::SleepMin => "sleep_min",
            HealthKind::Steps => "steps",
            HealthKind::RestingHr => "resting_hr",
        }
    }
}

impl FromStr for HealthKind {
    type Err = AppError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "weight_g" => Ok(HealthKind::WeightG),
            "sleep_min" => Ok(HealthKind::SleepMin),
            "steps" => Ok(HealthKind::Steps),
            "resting_hr" => Ok(HealthKind::RestingHr),
            _ => Err(AppError::Invalid(format!("Metrik health tidak valid: {s}"))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthMetric {
    pub kind: HealthKind,
    pub date: String,
    pub value: i64,
    pub note: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthField {
    pub kind: HealthKind,
    pub value: Option<i64>,
    pub delta: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthToday {
    pub date: String,
    pub fields: Vec<HealthField>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSeries {
    pub kind: HealthKind,
    pub points: Vec<Option<i64>>,
    pub min: Option<i64>,
    pub max: Option<i64>,
    pub avg: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthDayRow {
    pub date: String,
    pub weight_g: Option<i64>,
    pub sleep_min: Option<i64>,
    pub steps: Option<i64>,
    pub resting_hr: Option<i64>,
    pub note: Option<String>,
}

fn validate_metric(kind: HealthKind, date: &str, value: i64, now: i64, tz: &TimeZone) -> Result<Date, AppError> {
    let civil_date = time::parse_date(date)?;
    let today = time::local_date(now, tz).map_err(|e| AppError::Other(e.to_string()))?;
    if civil_date > today {
        return Err(AppError::Invalid(format!(
            "Tanggal tidak boleh melebihi hari ini ({today})"
        )));
    }
    if value < 0 {
        return Err(AppError::Invalid("Nilai metrik tidak boleh negatif".into()));
    }
    if kind != HealthKind::Steps && value == 0 {
        return Err(AppError::Invalid(format!(
            "Nilai metrik {} harus lebih dari 0",
            kind.as_str()
        )));
    }
    Ok(civil_date)
}

pub fn save_health_metric(
    conn: &Connection,
    kind: HealthKind,
    date: &str,
    value: i64,
    note: Option<String>,
    now: i64,
    tz: &TimeZone,
) -> Result<HealthMetric, AppError> {
    validate_metric(kind, date, value, now, tz)?;
    let note = note.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    conn.execute(
        "INSERT INTO health_metrics (kind, date, value, note, created_at, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, NULL)
         ON CONFLICT(kind, date) DO UPDATE SET
             value = excluded.value,
             note = excluded.note,
             updated_at = excluded.updated_at,
             deleted_at = NULL",
        params![kind.as_str(), date, value, note, now],
    )?;

    conn.query_row(
        "SELECT kind, date, value, note, created_at, updated_at, deleted_at
         FROM health_metrics WHERE kind = ?1 AND date = ?2",
        params![kind.as_str(), date],
        |r| {
            let kind_str: String = r.get(0)?;
            let kind = HealthKind::from_str(&kind_str).map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;
            Ok(HealthMetric {
                kind,
                date: r.get(1)?,
                value: r.get(2)?,
                note: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
                deleted_at: r.get(6)?,
            })
        },
    )
    .map_err(AppError::from)
}

pub fn delete_health_metric(
    conn: &Connection,
    kind: HealthKind,
    date: &str,
    now: i64,
) -> Result<(), AppError> {
    let affected = conn.execute(
        "UPDATE health_metrics
         SET deleted_at = ?3, updated_at = ?3
         WHERE kind = ?1 AND date = ?2 AND deleted_at IS NULL",
        params![kind.as_str(), date, now],
    )?;
    if affected == 0 {
        // Idempotent or row doesn't exist; update existing anyway to ensure updated_at is refreshed if already deleted
        conn.execute(
            "UPDATE health_metrics
             SET deleted_at = COALESCE(deleted_at, ?3), updated_at = ?3
             WHERE kind = ?1 AND date = ?2",
            params![kind.as_str(), date, now],
        )?;
    }
    Ok(())
}

pub fn health_today(conn: &Connection, now: i64, tz: &TimeZone) -> Result<HealthToday, AppError> {
    let today = time::local_date(now, tz).map_err(|e| AppError::Other(e.to_string()))?;
    let today_str = today.to_string();

    let mut fields = Vec::with_capacity(4);

    for kind in HealthKind::ALL {
        // Today's value
        let today_val: Option<i64> = conn
            .query_row(
                "SELECT value FROM health_metrics WHERE kind = ?1 AND date = ?2 AND deleted_at IS NULL",
                params![kind.as_str(), today_str],
                |r| r.get(0),
            )
            .optional()?;

        // Prior 7 days average
        let mut sum: i64 = 0;
        let mut count: i64 = 0;
        for i in 1..=7 {
            let past_date = today
                .checked_sub(jiff::ToSpan::days(i))
                .map_err(|e| AppError::Other(e.to_string()))?;
            let val: Option<i64> = conn
                .query_row(
                    "SELECT value FROM health_metrics WHERE kind = ?1 AND date = ?2 AND deleted_at IS NULL",
                    params![kind.as_str(), past_date.to_string()],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(v) = val {
                sum += v;
                count += 1;
            }
        }

        let delta = if let (Some(today_v), true) = (today_val, count > 0) {
            let avg = if sum >= 0 {
                (sum + count / 2) / count
            } else {
                (sum - count / 2) / count
            };
            Some(today_v - avg)
        } else {
            None
        };

        fields.push(HealthField {
            kind,
            value: today_val,
            delta,
        });
    }

    Ok(HealthToday {
        date: today_str,
        fields,
    })
}

pub fn health_series(
    conn: &Connection,
    kind: HealthKind,
    days: u32,
    now: i64,
    tz: &TimeZone,
) -> Result<HealthSeries, AppError> {
    if !(1..=365).contains(&days) {
        return Err(AppError::Invalid(
            "Jumlah hari deret harus antara 1 dan 365".into(),
        ));
    }

    let today = time::local_date(now, tz).map_err(|e| AppError::Other(e.to_string()))?;
    let start_date = today
        .checked_sub(jiff::ToSpan::days((days - 1) as i32))
        .map_err(|e| AppError::Other(e.to_string()))?;

    let mut stmt = conn.prepare(
        "SELECT date, value FROM health_metrics
         WHERE kind = ?1 AND date >= ?2 AND date <= ?3 AND deleted_at IS NULL",
    )?;
    let mut rows = stmt.query(params![kind.as_str(), start_date.to_string(), today.to_string()])?;

    let mut map = std::collections::HashMap::new();
    while let Some(row) = rows.next()? {
        let d: String = row.get(0)?;
        let v: i64 = row.get(1)?;
        map.insert(d, v);
    }

    let mut points = Vec::with_capacity(days as usize);
    let mut min: Option<i64> = None;
    let mut max: Option<i64> = None;
    let mut sum: i64 = 0;
    let mut count: i64 = 0;

    for i in 0..days {
        let cur_date = start_date
            .checked_add(jiff::ToSpan::days(i as i32))
            .map_err(|e| AppError::Other(e.to_string()))?;
        let val = map.get(&cur_date.to_string()).copied();
        if let Some(v) = val {
            min = Some(min.map_or(v, |m| m.min(v)));
            max = Some(max.map_or(v, |m| m.max(v)));
            sum += v;
            count += 1;
        }
        points.push(val);
    }

    let avg = if count > 0 {
        if sum >= 0 {
            Some((sum + count / 2) / count)
        } else {
            Some((sum - count / 2) / count)
        }
    } else {
        None
    };

    Ok(HealthSeries {
        kind,
        points,
        min,
        max,
        avg,
    })
}

pub fn health_history(
    conn: &Connection,
    days: u32,
    now: i64,
    tz: &TimeZone,
) -> Result<Vec<HealthDayRow>, AppError> {
    if !(1..=365).contains(&days) {
        return Err(AppError::Invalid(
            "Jumlah hari riwayat harus antara 1 dan 365".into(),
        ));
    }

    let today = time::local_date(now, tz).map_err(|e| AppError::Other(e.to_string()))?;
    let start_date = today
        .checked_sub(jiff::ToSpan::days((days - 1) as i32))
        .map_err(|e| AppError::Other(e.to_string()))?;

    let mut stmt = conn.prepare(
        "SELECT kind, date, value, note FROM health_metrics
         WHERE date >= ?1 AND date <= ?2 AND deleted_at IS NULL
         ORDER BY date DESC, kind ASC",
    )?;
    let mut rows = stmt.query(params![start_date.to_string(), today.to_string()])?;

    // Map: date -> (weight, sleep, steps, rhr, note)
    struct DayAccum {
        weight_g: Option<i64>,
        sleep_min: Option<i64>,
        steps: Option<i64>,
        resting_hr: Option<i64>,
        note: Option<String>,
    }

    let mut map: std::collections::HashMap<String, DayAccum> = std::collections::HashMap::new();

    while let Some(row) = rows.next()? {
        let kind_str: String = row.get(0)?;
        let date_str: String = row.get(1)?;
        let value: i64 = row.get(2)?;
        let note: Option<String> = row.get(3)?;

        let entry = map.entry(date_str).or_insert_with(|| DayAccum {
            weight_g: None,
            sleep_min: None,
            steps: None,
            resting_hr: None,
            note: None,
        });

        match kind_str.as_str() {
            "weight_g" => entry.weight_g = Some(value),
            "sleep_min" => entry.sleep_min = Some(value),
            "steps" => entry.steps = Some(value),
            "resting_hr" => entry.resting_hr = Some(value),
            _ => {}
        }
        if entry.note.is_none() && note.is_some() {
            entry.note = note;
        }
    }

    let mut result = Vec::with_capacity(days as usize);
    // Recent first (today down to start_date)
    for i in 0..days {
        let cur_date = today
            .checked_sub(jiff::ToSpan::days(i as i32))
            .map_err(|e| AppError::Other(e.to_string()))?;
        let d_str = cur_date.to_string();
        if let Some(accum) = map.remove(&d_str) {
            result.push(HealthDayRow {
                date: d_str,
                weight_g: accum.weight_g,
                sleep_min: accum.sleep_min,
                steps: accum.steps,
                resting_hr: accum.resting_hr,
                note: accum.note,
            });
        } else {
            result.push(HealthDayRow {
                date: d_str,
                weight_g: None,
                sleep_min: None,
                steps: None,
                resting_hr: None,
                note: None,
            });
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn fixed_now_and_tz() -> (i64, TimeZone) {
        // 2026-10-21 12:00:00 UTC
        let tz = TimeZone::UTC;
        let date = Date::new(2026, 10, 21).unwrap();
        let ms = date.to_zoned(tz.clone()).unwrap().timestamp().as_millisecond();
        (ms, tz)
    }

    #[test]
    fn test_validation() {
        let conn = open_in_memory();
        let (now, tz) = fixed_now_and_tz();

        // Future date rejected
        let res = save_health_metric(
            &conn,
            HealthKind::WeightG,
            "2026-10-22",
            70000,
            None,
            now,
            &tz,
        );
        assert!(res.is_err());

        // Zero weight rejected
        let res = save_health_metric(
            &conn,
            HealthKind::WeightG,
            "2026-10-21",
            0,
            None,
            now,
            &tz,
        );
        assert!(res.is_err());

        // Zero sleep rejected
        let res = save_health_metric(
            &conn,
            HealthKind::SleepMin,
            "2026-10-21",
            0,
            None,
            now,
            &tz,
        );
        assert!(res.is_err());

        // Zero resting hr rejected
        let res = save_health_metric(
            &conn,
            HealthKind::RestingHr,
            "2026-10-21",
            0,
            None,
            now,
            &tz,
        );
        assert!(res.is_err());

        // Zero steps accepted
        let res = save_health_metric(
            &conn,
            HealthKind::Steps,
            "2026-10-21",
            0,
            None,
            now,
            &tz,
        );
        assert!(res.is_ok());

        // Negative rejected
        let res = save_health_metric(
            &conn,
            HealthKind::Steps,
            "2026-10-21",
            -10,
            None,
            now,
            &tz,
        );
        assert!(res.is_err());
    }

    #[test]
    fn test_upsert_revives_deleted() {
        let conn = open_in_memory();
        let (now, tz) = fixed_now_and_tz();

        let metric = save_health_metric(
            &conn,
            HealthKind::WeightG,
            "2026-10-21",
            65000,
            Some("initial".into()),
            now,
            &tz,
        )
        .unwrap();
        assert_eq!(metric.value, 65000);
        assert!(metric.deleted_at.is_none());

        delete_health_metric(&conn, HealthKind::WeightG, "2026-10-21", now + 1000).unwrap();

        let deleted: Option<i64> = conn
            .query_row(
                "SELECT deleted_at FROM health_metrics WHERE kind = 'weight_g' AND date = '2026-10-21'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(deleted, Some(now + 1000));

        // Re-save revives
        let revived = save_health_metric(
            &conn,
            HealthKind::WeightG,
            "2026-10-21",
            66000,
            Some("revived".into()),
            now + 2000,
            &tz,
        )
        .unwrap();
        assert_eq!(revived.value, 66000);
        assert_eq!(revived.created_at, metric.created_at);
        assert_eq!(revived.updated_at, now + 2000);
        assert!(revived.deleted_at.is_none());
    }

    #[test]
    fn test_series_and_stats() {
        let conn = open_in_memory();
        let (now, tz) = fixed_now_and_tz();

        // Days limit test
        assert!(health_series(&conn, HealthKind::Steps, 0, now, &tz).is_err());
        assert!(health_series(&conn, HealthKind::Steps, 366, now, &tz).is_err());

        // 3 days series: 2026-10-19, 2026-10-20, 2026-10-21
        save_health_metric(&conn, HealthKind::Steps, "2026-10-19", 5000, None, now, &tz).unwrap();
        // 2026-10-20 missing (None)
        save_health_metric(&conn, HealthKind::Steps, "2026-10-21", 10000, None, now, &tz).unwrap();

        let series = health_series(&conn, HealthKind::Steps, 3, now, &tz).unwrap();
        assert_eq!(series.points, vec![Some(5000), None, Some(10000)]);
        assert_eq!(series.min, Some(5000));
        assert_eq!(series.max, Some(10000));
        assert_eq!(series.avg, Some(7500));
    }

    #[test]
    fn test_today_delta() {
        let conn = open_in_memory();
        let (now, tz) = fixed_now_and_tz();

        // 2026-10-21 steps = 8000
        save_health_metric(&conn, HealthKind::Steps, "2026-10-21", 8000, None, now, &tz).unwrap();

        // Prior 7 days: 2 days have steps: 2026-10-20 has 6000, 2026-10-19 has 4000 (avg = 5000)
        save_health_metric(&conn, HealthKind::Steps, "2026-10-20", 6000, None, now, &tz).unwrap();
        save_health_metric(&conn, HealthKind::Steps, "2026-10-19", 4000, None, now, &tz).unwrap();

        let today = health_today(&conn, now, &tz).unwrap();
        assert_eq!(today.date, "2026-10-21");
        assert_eq!(today.fields.len(), 4);

        let steps_field = today.fields.iter().find(|f| f.kind == HealthKind::Steps).unwrap();
        assert_eq!(steps_field.value, Some(8000));
        assert_eq!(steps_field.delta, Some(3000)); // 8000 - 5000

        let weight_field = today.fields.iter().find(|f| f.kind == HealthKind::WeightG).unwrap();
        assert_eq!(weight_field.value, None);
        assert_eq!(weight_field.delta, None);
    }

    #[test]
    fn test_history() {
        let conn = open_in_memory();
        let (now, tz) = fixed_now_and_tz();

        assert!(health_history(&conn, 0, now, &tz).is_err());
        assert!(health_history(&conn, 366, now, &tz).is_err());

        save_health_metric(&conn, HealthKind::WeightG, "2026-10-21", 70000, Some("morning".into()), now, &tz).unwrap();
        save_health_metric(&conn, HealthKind::Steps, "2026-10-21", 8000, None, now, &tz).unwrap();

        let hist = health_history(&conn, 2, now, &tz).unwrap();
        assert_eq!(hist.len(), 2);
        assert_eq!(hist[0].date, "2026-10-21");
        assert_eq!(hist[0].weight_g, Some(70000));
        assert_eq!(hist[0].steps, Some(8000));
        assert_eq!(hist[0].note.as_deref(), Some("morning"));

        assert_eq!(hist[1].date, "2026-10-20");
        assert_eq!(hist[1].weight_g, None);
        assert_eq!(hist[1].note, None);
    }
}
