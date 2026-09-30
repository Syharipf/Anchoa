use jiff::{Timestamp, ToSpan, Zoned, civil::Date, tz::TimeZone};

use crate::error::AppError;

pub fn now_ms() -> i64 {
    Timestamp::now().as_millisecond()
}

/// Start (inclusive) and end (exclusive) of the local day containing `now_ms`.
pub fn day_bounds(now_ms: i64, tz: &TimeZone) -> Result<(i64, i64), jiff::Error> {
    let today = Timestamp::from_millisecond(now_ms)?.to_zoned(tz.clone()).date();
    let start = today.to_zoned(tz.clone())?;
    let end = today.tomorrow()?.to_zoned(tz.clone())?;
    Ok((start.timestamp().as_millisecond(), end.timestamp().as_millisecond()))
}

/// Local month containing `now_ms`, as `YYYY-MM`.
pub fn month_of(now_ms: i64, tz: &TimeZone) -> Result<String, jiff::Error> {
    Ok(Timestamp::from_millisecond(now_ms)?.to_zoned(tz.clone()).strftime("%Y-%m").to_string())
}

/// First day of a `YYYY-MM` month.
fn first_day(month: &str) -> Result<Date, AppError> {
    let invalid = || AppError::Invalid(format!("Bulan tidak valid: {month}"));
    let (year, mon) = month.split_once('-').ok_or_else(invalid)?;
    if year.len() != 4 || mon.len() != 2 {
        return Err(invalid());
    }
    let year: i16 = year.parse().map_err(|_| invalid())?;
    let mon: i8 = mon.parse().map_err(|_| invalid())?;
    Date::new(year, mon, 1).map_err(|_| invalid())
}

/// Start (inclusive) and end (exclusive) of a local month given as `YYYY-MM`.
pub fn month_bounds(month: &str, tz: &TimeZone) -> Result<(i64, i64), AppError> {
    let first = first_day(month)?;
    let start = first.to_zoned(tz.clone())?;
    let end = first.checked_add(1.month())?.to_zoned(tz.clone())?;
    Ok((start.timestamp().as_millisecond(), end.timestamp().as_millisecond()))
}

/// `month` moved by `n` months, e.g. `add_months("2026-01", -1)` is `2025-12`.
pub fn add_months(month: &str, n: i32) -> Result<String, AppError> {
    Ok(first_day(month)?.checked_add(n.months())?.strftime("%Y-%m").to_string())
}

/// Local date for daily backup names, e.g. `2026-09-29`.
pub fn today_stamp() -> String {
    Zoned::now().strftime("%Y-%m-%d").to_string()
}

/// Local date and time for manual backup names, e.g. `2026-09-29-142501`.
pub fn now_stamp() -> String {
    Zoned::now().strftime("%Y-%m-%d-%H%M%S").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(rfc3339: &str) -> i64 {
        rfc3339.parse::<Timestamp>().unwrap().as_millisecond()
    }

    fn jakarta() -> TimeZone {
        TimeZone::fixed(jiff::tz::offset(7))
    }

    #[test]
    fn day_bounds_follow_the_local_offset() {
        let jakarta = TimeZone::fixed(jiff::tz::offset(7));
        // 01:30 in Jakarta is still 28 Sep in UTC: the local date must win.
        let (start, end) = day_bounds(ms("2026-09-29T01:30:00+07:00"), &jakarta).unwrap();
        assert_eq!(start, ms("2026-09-29T00:00:00+07:00"));
        assert_eq!(end, ms("2026-09-30T00:00:00+07:00"));
    }

    #[test]
    fn month_bounds_follow_the_local_offset() {
        let (start, end) = month_bounds("2026-09", &jakarta()).unwrap();
        assert_eq!(start, ms("2026-09-01T00:00:00+07:00"));
        assert_eq!(end, ms("2026-10-01T00:00:00+07:00"));
        let (_, end) = month_bounds("2026-12", &jakarta()).unwrap();
        assert_eq!(end, ms("2027-01-01T00:00:00+07:00"));
    }

    #[test]
    fn month_bounds_reject_bad_input() {
        for bad in ["2026", "2026-13", "abcd-01", "", "2026-9-1", "2026-9"] {
            assert!(matches!(month_bounds(bad, &jakarta()), Err(AppError::Invalid(_))), "{bad}");
        }
    }

    #[test]
    fn month_of_uses_the_local_date() {
        // 30 Sep 20:00 UTC is already 1 Oct in Jakarta.
        assert_eq!(month_of(ms("2026-09-30T20:00:00Z"), &jakarta()).unwrap(), "2026-10");
    }

    #[test]
    fn add_months_crosses_years() {
        assert_eq!(add_months("2026-01", -1).unwrap(), "2025-12");
        assert_eq!(add_months("2026-09", -5).unwrap(), "2026-04");
        assert_eq!(add_months("2026-12", 1).unwrap(), "2027-01");
        assert!(matches!(add_months("x", 1), Err(AppError::Invalid(_))));
    }
}
