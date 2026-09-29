use jiff::{Timestamp, tz::TimeZone};

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

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(rfc3339: &str) -> i64 {
        rfc3339.parse::<Timestamp>().unwrap().as_millisecond()
    }

    #[test]
    fn day_bounds_follow_the_local_offset() {
        let jakarta = TimeZone::fixed(jiff::tz::offset(7));
        // 01:30 in Jakarta is still 28 Sep in UTC: the local date must win.
        let (start, end) = day_bounds(ms("2026-09-29T01:30:00+07:00"), &jakarta).unwrap();
        assert_eq!(start, ms("2026-09-29T00:00:00+07:00"));
        assert_eq!(end, ms("2026-09-30T00:00:00+07:00"));
    }
}
