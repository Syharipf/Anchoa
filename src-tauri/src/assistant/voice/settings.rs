use crate::error::AppError;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceParams {
    pub length_scale: f64,
    pub noise_scale: f64,
    pub noise_w: f64,
}

impl Default for VoiceParams {
    fn default() -> Self {
        Self {
            length_scale: 1.0,
            noise_scale: 0.667,
            noise_w: 0.8,
        }
    }
}

impl VoiceParams {
    pub fn clamped(self) -> Result<Self, AppError> {
        if ![self.length_scale, self.noise_scale, self.noise_w]
            .iter()
            .all(|value| value.is_finite())
        {
            return Err(AppError::Invalid(
                "Parameter suara harus berupa angka yang valid".into(),
            ));
        }
        Ok(Self {
            length_scale: self.length_scale.clamp(0.8, 1.3),
            noise_scale: self.noise_scale.clamp(0.3, 0.9),
            noise_w: self.noise_w.clamp(0.5, 1.0),
        })
    }
}

pub const DEFAULT_VOICE: &str = "id_ID-news_tts-medium";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct VoiceSettings {
    pub id: String,
    pub params: VoiceParams,
}

fn value(conn: &Connection, key: &str) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?)
}

pub fn get(conn: &Connection) -> Result<VoiceSettings, AppError> {
    let id = value(conn, "voice.id")?.unwrap_or_else(|| DEFAULT_VOICE.into());
    let defaults = VoiceParams::default();
    let number = |key: &str, default| -> Result<f64, AppError> {
        Ok(value(conn, &format!("voice.{key}"))?
            .and_then(|number| number.parse().ok())
            .unwrap_or(default))
    };
    let params = VoiceParams {
        length_scale: number("length_scale", defaults.length_scale)?,
        noise_scale: number("noise_scale", defaults.noise_scale)?,
        noise_w: number("noise_w", defaults.noise_w)?,
    }
    .clamped()?;
    Ok(VoiceSettings { id, params })
}

pub fn for_voice(conn: &Connection, id: &str) -> Result<VoiceParams, AppError> {
    let current = get(conn)?;
    if current.id == id {
        return Ok(current.params);
    }
    let defaults = VoiceParams::default();
    let number = |field: &str, default| -> Result<f64, AppError> {
        Ok(value(conn, &format!("voice.{id}.{field}"))?
            .and_then(|value| value.parse().ok())
            .unwrap_or(default))
    };
    VoiceParams {
        length_scale: number("length_scale", defaults.length_scale)?,
        noise_scale: number("noise_scale", defaults.noise_scale)?,
        noise_w: number("noise_w", defaults.noise_w)?,
    }
    .clamped()
}

pub fn set(
    conn: &Connection,
    id: &str,
    voice_params: VoiceParams,
) -> Result<VoiceSettings, AppError> {
    let voice_params = voice_params.clamped()?;
    let tx = conn.unchecked_transaction()?;
    let mut values = vec![("voice.id".to_owned(), id.to_owned())];
    for (field, value) in [
        ("length_scale", voice_params.length_scale),
        ("noise_scale", voice_params.noise_scale),
        ("noise_w", voice_params.noise_w),
    ] {
        values.push((format!("voice.{field}"), value.to_string()));
        values.push((format!("voice.{id}.{field}"), value.to_string()));
    }
    for (key, value) in values {
        tx.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value])?;
    }
    tx.commit()?;
    Ok(VoiceSettings {
        id: id.into(),
        params: voice_params,
    })
}
