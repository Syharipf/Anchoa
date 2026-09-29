use serde::ser::{Serialize, SerializeStruct, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Teks tidak boleh kosong")]
    Empty,
    #[error("Item tidak ditemukan")]
    NotFound,
    #[error("Database tidak tersedia")]
    DbUnavailable,
    #[error("Database versi {0} dibuat oleh aplikasi yang lebih baru")]
    DbTooNew(i64),
    #[error("Kesalahan database: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Kesalahan file: {0}")]
    Io(#[from] std::io::Error),
    #[error("Kesalahan waktu: {0}")]
    Time(#[from] jiff::Error),
    #[error("Kesalahan aplikasi: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Empty => "empty",
            AppError::NotFound => "not_found",
            AppError::DbUnavailable => "db_unavailable",
            AppError::DbTooNew(_) => "db_too_new",
            AppError::Db(_) => "db",
            AppError::Io(_) => "io",
            AppError::Time(_) => "time",
            AppError::Tauri(_) | AppError::Other(_) => "other",
        }
    }
}

/// Sent to the frontend as `{ code, message }`.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}
