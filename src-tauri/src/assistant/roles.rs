use crate::error::AppError;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RoleConfig {
    pub provider: String,
    pub model: String,
}

pub const ROLES: [&str; 4] = ["chat", "journal", "recap", "email"];
const DEFAULT_MODEL: &str = "qwen2.5:3b";

fn validate(role: &str, provider: &str, model: &str) -> Result<(), AppError> {
    if !ROLES.contains(&role) {
        return Err(AppError::Invalid("Peran AI tidak dikenal".into()));
    }
    if matches!(role, "journal" | "email") && provider != "ollama" {
        return Err(AppError::Invalid(
            "Jurnal dan email hanya boleh memakai penyedia lokal (Ollama)".into(),
        ));
    }
    if provider != "ollama" {
        return Err(AppError::Invalid(
            "Penyedia AI yang tersedia hanya Ollama".into(),
        ));
    }
    if model.trim().is_empty() || model.len() > 256 || model.chars().any(char::is_control) {
        return Err(AppError::Invalid("Nama model AI tidak valid".into()));
    }
    Ok(())
}

pub fn get_role(conn: &Connection, role: &str) -> Result<RoleConfig, AppError> {
    if !ROLES.contains(&role) {
        return Err(AppError::Invalid("Peran AI tidak dikenal".into()));
    }
    let setting = |field: &str, default: &str| -> Result<String, AppError> {
        Ok(conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [format!("ai.{role}.{field}")],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or_else(|| default.into()))
    };
    let config = RoleConfig {
        provider: setting("provider", "ollama")?,
        model: setting("model", DEFAULT_MODEL)?,
    };
    validate(role, &config.provider, &config.model)?;
    Ok(config)
}

pub fn set_role(
    conn: &Connection,
    role: &str,
    provider: &str,
    model: &str,
) -> Result<RoleConfig, AppError> {
    let model = model.trim();
    validate(role, provider, model)?;
    let tx = conn.unchecked_transaction()?;
    for (field, value) in [("provider", provider), ("model", model)] {
        tx.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![format!("ai.{role}.{field}"), value])?;
    }
    tx.commit()?;
    Ok(RoleConfig {
        provider: provider.into(),
        model: model.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn private_roles_reject_remote_provider() {
        let conn = open_in_memory();
        for role in ["journal", "email"] {
            let error = set_role(&conn, role, "openrouter", "remote").unwrap_err();
            assert!(error.to_string().contains("lokal"));
            assert_eq!(get_role(&conn, role).unwrap().provider, "ollama");
        }
    }

    #[test]
    fn roles_default_and_round_trip_with_validation() {
        let conn = open_in_memory();
        for role in ["chat", "journal", "recap", "email"] {
            assert_eq!(
                get_role(&conn, role).unwrap(),
                RoleConfig {
                    provider: "ollama".into(),
                    model: "qwen2.5:3b".into()
                }
            );
            assert_eq!(
                set_role(&conn, role, "ollama", "  qwen2.5:7b  ")
                    .unwrap()
                    .model,
                "qwen2.5:7b"
            );
            assert_eq!(get_role(&conn, role).unwrap().model, "qwen2.5:7b");
            assert!(set_role(&conn, role, "ollama", " ").is_err());
            assert!(set_role(&conn, role, "remote", "model").is_err());
        }
        assert!(get_role(&conn, "invalid").is_err());
        assert!(set_role(&conn, "invalid", "ollama", "model").is_err());
        for role in ["journal", "email"] {
            conn.execute(
                "UPDATE settings SET value = 'remote' WHERE key = ?1",
                [format!("ai.{role}.provider")],
            )
            .unwrap();
            assert!(get_role(&conn, role).is_err());
        }
    }
}
