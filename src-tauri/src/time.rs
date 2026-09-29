use jiff::Timestamp;

pub fn now_ms() -> i64 {
    Timestamp::now().as_millisecond()
}
