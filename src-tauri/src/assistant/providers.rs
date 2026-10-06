use crate::{db::Db, error::AppError, keystore::KeyringStore};
use super::{AssistantState, AiStatus, llm::{self, Endpoint}};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use tauri::State;
use zeroize::Zeroizing;

const KEY: &str = "ai.custom";
const DEFAULT_URL: &str = "http://127.0.0.1:20128/v1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAiConfig {
    pub name: String,
    pub base_url: String,
    pub has_key: bool,
}

pub fn validate_base_url(value: &str) -> Result<String, AppError> {
    let invalid = || AppError::Invalid("Base URL AI tidak valid; gunakan HTTPS atau HTTP loopback tanpa kredensial, query, atau fragment".into());
    if value.len() > 2048 || value.chars().any(char::is_control) { return Err(invalid()); }
    let url = tauri::Url::parse(value.trim()).map_err(|_| invalid())?;
    if value.split('/').nth(2).is_some_and(|authority| authority.contains('@')) { return Err(invalid()); }
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() || url.host_str().is_none() {
        return Err(invalid());
    }
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) { return Err(invalid()); }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

fn metadata(conn: &Connection) -> Result<(String, String), AppError> {
    let get = |key: &str, default: &str| -> Result<String, AppError> {
        Ok(conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |row| row.get(0)).optional()?.unwrap_or_else(|| default.into()))
    };
    Ok((get("ai.custom.name", "Kustom")?, validate_base_url(&get("ai.custom.base_url", DEFAULT_URL)?)?))
}

// Snapshot DB metadata first; caller releases DB guard before credential access.
pub fn base_url(conn: &Connection, provider: &str) -> Result<String, AppError> {
    match provider {
        "ollama" => Ok(local_endpoint()?.base_url.clone()),
        "custom" => Ok(metadata(conn)?.1),
        _ => Err(AppError::Invalid("Penyedia AI tidak dikenal".into())),
    }
}

pub fn local_endpoint() -> Result<Endpoint, AppError> {
    let endpoint = Endpoint::default();
    let url = tauri::Url::parse(&validate_base_url(&endpoint.base_url)?).map_err(|_| AppError::Invalid("Alamat Ollama tidak valid".into()))?;
    if !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")) {
        return Err(AppError::Invalid("Ollama harus memakai alamat loopback lokal".into()));
    }
    Ok(endpoint)
}

pub fn endpoint(base_url: String, store: &KeyringStore, provider: &str) -> Result<Endpoint, AppError> {
    Ok(Endpoint { base_url, api_key: if provider == "custom" { store.get(KEY)? } else { None } })
}

fn config(db: &Db, store: &KeyringStore) -> Result<CustomAiConfig, AppError> {
    let (name, base_url) = metadata(&*db.conn()?)?;
    let secret = store.get(KEY)?.map(Zeroizing::new);
    Ok(CustomAiConfig { name, base_url, has_key: secret.is_some() })
}

fn save(db: &Db, state: &AssistantState, store: &KeyringStore, name: &str, url: &str) -> Result<CustomAiConfig, AppError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 || name.chars().any(char::is_control) { return Err(AppError::Invalid("Nama penyedia AI tidak valid".into())); }
    let base_url = validate_base_url(url)?;
    let _gate = state.configuration_lock()?;
    let (_, old_url) = metadata(&*db.conn()?)?;
    // Retain a zeroized rollback copy; never hold DB during OS credential calls.
    let old_key = store.get(KEY)?.map(Zeroizing::new);
    let changed = old_url != base_url;
    if changed { store.delete(KEY)?; }
    let persisted = (|| -> Result<(), AppError> {
        let conn = db.conn()?;
        let tx = conn.unchecked_transaction()?;
        for (key, value) in [("ai.custom.name", name), ("ai.custom.base_url", base_url.as_str())] {
            tx.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value])?;
        }
        tx.commit()?;
        Ok(())
    })();
    if let Err(error) = persisted {
        if changed && let Some(key) = &old_key { store.set(KEY, key)?; }
        return Err(error);
    }
    if changed { state.reset()?; }
    let has_key = !changed && old_key.is_some();
    Ok(CustomAiConfig { name: name.into(), base_url, has_key })
}

#[tauri::command]
pub fn ai_custom_config(db: State<'_, Db>, state: State<'_, AssistantState>, store: State<'_, KeyringStore>) -> Result<CustomAiConfig, AppError> {
    let _gate = state.configuration_lock()?;
    config(&db, &store)
}
#[tauri::command]
pub fn save_ai_custom(db: State<'_, Db>, state: State<'_, AssistantState>, store: State<'_, KeyringStore>, name: String, base_url: String) -> Result<CustomAiConfig, AppError> {
    save(&db, &state, &store, &name, &base_url)
}
#[tauri::command]
pub fn set_ai_custom_key(db: State<'_, Db>, state: State<'_, AssistantState>, store: State<'_, KeyringStore>, key: String) -> Result<CustomAiConfig, AppError> {
    change_key(&db, &state, &store, Some(key))
}
#[tauri::command]
pub fn delete_ai_custom_key(db: State<'_, Db>, state: State<'_, AssistantState>, store: State<'_, KeyringStore>) -> Result<CustomAiConfig, AppError> {
    change_key(&db, &state, &store, None)
}

fn change_key(db: &Db, state: &AssistantState, store: &KeyringStore, key: Option<String>) -> Result<CustomAiConfig, AppError> {
    let key = key.map(Zeroizing::new);
    if key.as_ref().is_some_and(|key| key.trim().is_empty() || key.len() > 8192 || key.chars().any(char::is_control)) {
        return Err(AppError::Invalid("API key tidak valid".into()));
    }
    let _gate = state.configuration_lock()?;
    let (name, base_url) = metadata(&*db.conn()?)?;
    match &key { Some(key) => store.set(KEY, key)?, None => store.delete(KEY)? }
    state.reset()?;
    Ok(CustomAiConfig { name, base_url, has_key: key.is_some() })
}
pub(crate) fn status(app: &tauri::AppHandle, provider: Option<String>) -> Result<AiStatus, AppError> {
    use tauri::Manager;
    let state = app.state::<AssistantState>();
    let (provider, name, endpoint) = {
        let _gate = state.configuration_lock()?;
        // Copy metadata, release DB, then read key while config gate prevents mutation.
        let (provider, name, base) = {
            let db = app.state::<Db>();
            let conn = db.conn()?;
            let provider = match provider { Some(provider) => provider, None => super::roles::get_role(&conn, "chat")?.provider };
            let name = if provider == "custom" { metadata(&conn)?.0 } else { "Ollama".into() };
            let base = base_url(&conn, &provider)?;
            (provider, name, base)
        };
        let endpoint = endpoint(base, &app.state::<KeyringStore>(), &provider)?;
        (provider, name, endpoint)
    };
    let result = if provider == "custom" { llm::list_custom_models(&endpoint) } else { llm::list_models(&endpoint.base_url) };
    Ok(match result {
        Ok(models) => AiStatus { available: true, models, error: None, provider, name },
        Err(error) => AiStatus { available: false, models: vec![], error: Some(error.to_string()), provider, name },
    })
}

#[tauri::command]
pub async fn ai_provider_status(app: tauri::AppHandle, provider: String) -> Result<AiStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || status(&app, Some(provider)))
        .await.map_err(|_| AppError::Other("Pemeriksaan penyedia AI gagal".into()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn urls_reject_unsafe_origins_and_normalize() {
        for url in ["http://example.com/v1", "https://user:secret@example.com/v1", "https://example.com/v1?q=1", "https://example.com/#x", "ftp://localhost/v1", "http://localhost:99999/v1"] { assert!(validate_base_url(url).is_err(), "{url}"); }
        for url in ["http://127.0.0.1:20128/v1", "http://localhost/v1", "http://[::1]/v1", "https://example.com/v1"] { assert!(validate_base_url(url).is_ok(), "{url}"); }
        assert_eq!(validate_base_url("http://localhost/v1///").unwrap(), "http://localhost/v1");
    }

    #[test]
    fn metadata_preserves_key_and_url_change_deletes_it_before_commit() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open_at(dir.path().join("providers.db"));
        let state = AssistantState::default();
        let keys = KeyringStore::with_builder(keyring::mock::default_credential_builder());
        keys.set(KEY, "SECRET_SENTINEL").unwrap();
        assert!(save(&db, &state, &keys, " Router ", DEFAULT_URL).unwrap().has_key);
        let entry = keys.entry_for_test(KEY);
        let mock = entry.get_credential().downcast_ref::<keyring::mock::MockCredential>().unwrap();
        mock.set_error(keyring::Error::Invalid("key".into(), "SECRET_SENTINEL".into()));
        let error = save(&db, &state, &keys, "Router", "https://example.com/v1").unwrap_err();
        assert!(!error.to_string().contains("SECRET_SENTINEL"));
        assert_eq!(metadata(&db.conn().unwrap()).unwrap().1, DEFAULT_URL);
        assert_eq!(keys.get(KEY).unwrap().as_deref(), Some("SECRET_SENTINEL"));
        assert!(!save(&db, &state, &keys, "Router", "https://example.com/v1").unwrap().has_key);
        assert!(keys.get(KEY).unwrap().is_none());
        assert!(endpoint("https://example.com/v1".into(), &keys, "custom").unwrap().api_key.is_none());
        let output = serde_json::to_string(&config(&db, &keys).unwrap()).unwrap();
        assert!(!output.contains("SECRET_SENTINEL"));
        let reopened = Db::open_at(dir.path().join("providers.db"));
        assert_eq!(metadata(&reopened.conn().unwrap()).unwrap().1, "https://example.com/v1");
    }

    #[test]
    fn custom_models_use_optional_bearer_and_reject_invalid_rows() {
        use super::super::test_server::{Server, response};
        for key in [None, Some("SECRET_SENTINEL".to_owned())] {
            let server = Server::new(vec![response("200 OK", r#"{"data":[{"id":"model-b"},{"id":"model-a"},{"id":"model-a"}]}"#)]);
            let ep = Endpoint { base_url: server.base.clone(), api_key: key.clone() };
            assert_eq!(llm::list_custom_models(&ep).unwrap(), vec!["model-a", "model-b"]);
            let (headers, _) = server.requests.recv().unwrap();
            assert!(headers.starts_with("GET /v1/models "));
            assert_eq!(headers.to_lowercase().contains("authorization: bearer secret_sentinel"), key.is_some());
            server.finish();
        }
        for body in [r#"{"data":[{"id":""}]}"#, r#"{"data":[{"id":12}]}"#, r#"{"data":[{}]}"#] {
            let server = Server::new(vec![response("200 OK", body)]);
            assert!(llm::list_custom_models(&Endpoint { base_url: server.base.clone(), api_key: None }).is_err());
            server.finish();
        }
    }

    #[test]
    fn credentialed_requests_do_not_follow_redirects() {
        use super::super::test_server::Server;
        let target = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let location = format!("http://{}/v1/models", target.local_addr().unwrap());
        let server = Server::new(vec![format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")]);
        let error = llm::list_custom_models(&Endpoint { base_url: server.base.clone(), api_key: Some("SECRET_SENTINEL".into()) }).unwrap_err();
        assert!(!error.to_string().contains("SECRET_SENTINEL"));
        server.finish();
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(target.accept().is_err(), "redirect target received a request");
    }

    #[test]
    fn failed_mutations_preserve_session_and_credential() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open_at(dir.path().join("providers.db"));
        let state = AssistantState::default();
        let keys = KeyringStore::with_builder(keyring::mock::default_credential_builder());
        keys.set(KEY, "OLD_SECRET").unwrap();
        {
            let mut conversation = state.lock().unwrap();
            conversation.history.push(llm::ChatMessage::text("user", "Keep history"));
            let proposal = super::super::tools::propose(super::super::tools::Policy::Local, "create_task", &serde_json::json!({"title":"Keep proposal"})).unwrap();
            conversation.pending.insert(proposal.id.clone(), (proposal, None));
        }
        let generation = state.lock().unwrap().generation;
        db.conn().unwrap().execute_batch("CREATE TRIGGER fail_custom_write BEFORE INSERT ON settings WHEN NEW.key='ai.custom.base_url' BEGIN SELECT RAISE(ABORT, 'forced write failure'); END;").unwrap();
        assert!(save(&db, &state, &keys, "Router", "https://example.com/v1").is_err());
        assert_eq!(metadata(&db.conn().unwrap()).unwrap().1, DEFAULT_URL);
        assert_eq!(keys.get(KEY).unwrap().as_deref(), Some("OLD_SECRET"));
        let entry = keys.entry_for_test(KEY);
        let mock = entry.get_credential().downcast_ref::<keyring::mock::MockCredential>().unwrap();
        for key in [Some("NEW_SECRET".to_owned()), None] {
            mock.set_error(keyring::Error::Invalid("secret".into(), "OLD_SECRET".into()));
            assert!(change_key(&db, &state, &keys, key).is_err());
            assert_eq!(keys.get(KEY).unwrap().as_deref(), Some("OLD_SECRET"));
            let conversation = state.lock().unwrap();
            assert_eq!(conversation.generation, generation);
            assert_eq!(conversation.history.len(), 1);
            assert_eq!(conversation.pending.len(), 1);
        }
    }
}
