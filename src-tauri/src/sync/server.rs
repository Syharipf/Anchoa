//! Supabase transport and the public contract shared by the engine and commands.
use std::time::Duration;

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::{crypto::Kdf, record::MAX_RECORD_BYTES};
use crate::{error::AppError, keystore::KeyringStore};

pub const PAGE_SIZE: u32 = 500;
pub const DEFAULT_QUOTA_BYTES: u64 = 400 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider { Google, GitHub }

impl Provider {
    pub fn as_str(self) -> &'static str {
        match self { Self::Google => "google", Self::GitHub => "github" }
    }
}

/// Token strings are zeroized on drop. This type intentionally has no Debug.
/// expires_at is epoch milliseconds, like all other local timestamps.
#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct Session {
    pub user_id: String,
    pub email: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

impl Session {
    pub fn store(&self, keys: &KeyringStore) -> Result<(), AppError> {
        let secret = Zeroizing::new(serde_json::to_string(self).map_err(|_| invalid_response())?);
        keys.set(&format!("sync-session:{}", self.user_id), &secret)
    }
    pub fn load(keys: &KeyringStore, user_id: &str) -> Result<Option<Self>, AppError> {
        let Some(secret) = keys.get(&format!("sync-session:{user_id}"))? else { return Ok(None) };
        let secret = Zeroizing::new(secret);
        let session: Self = serde_json::from_str(&secret).map_err(|_| invalid_response())?;
        if session.user_id != user_id { return Err(invalid_response()) }
        Ok(Some(session))
    }
    pub fn delete(keys: &KeyringStore, user_id: &str) -> Result<(), AppError> {
        keys.delete(&format!("sync-session:{user_id}"))
    }
}

#[derive(Clone)]
pub struct Vault {
    pub kdf: Kdf,
    pub dek_by_passphrase: Vec<u8>,
    pub dek_by_recovery: Vec<u8>,
}

/// Payload is ciphertext. None is retained in the interface for compatibility,
/// but every transport rejects it, including for tombstones.
#[derive(Clone, Serialize, Deserialize)]
pub struct WireRecord {
    pub id: String,
    pub changed_at: i64,
    pub device_id: String,
    pub deleted: bool,
    #[serde(with = "bytea")]
    pub payload: Option<Vec<u8>>,
    #[serde(default)]
    pub seq: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Rejected {
    pub id: String,
    pub changed_at: i64,
    pub device_id: String,
}

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
pub struct Usage { pub rows: u64, pub bytes: u64 }

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub pulled: usize,
    pub pushed: usize,
    pub pending: usize,
    pub bytes_used: u64,
    pub quota_bytes: u64,
    pub stopped_by_quota: bool,
}

pub trait SyncServer: Send + Sync {
    fn authorize_url(&self, provider: Provider, redirect: &str, code_challenge: &str, state: &str) -> String;
    fn exchange_code(&self, code: &str, code_verifier: &str) -> Result<Session, AppError>;
    fn refresh(&self, session: &Session) -> Result<Session, AppError>;
    fn sign_out(&self, session: &Session) -> Result<(), AppError>;
    fn get_vault(&self, session: &Session) -> Result<Option<Vault>, AppError>;
    fn put_vault(&self, session: &Session, vault: &Vault) -> Result<(), AppError>;
    fn push(&self, session: &Session, rows: &[WireRecord]) -> Result<Vec<Rejected>, AppError>;
    fn pull(&self, session: &Session, after: i64, max: u32) -> Result<Vec<WireRecord>, AppError>;
    fn usage(&self, session: &Session) -> Result<Usage, AppError>;
    fn delete_my_data(&self, session: &Session) -> Result<(), AppError>;
    /// Debug fake servers bypass the browser; real transports return None.
    fn fake_session(&self) -> Option<Session> { None }
}

pub(crate) fn invalid_response() -> AppError { AppError::Invalid("Respons server sync tidak valid".into()) }
pub(crate) fn unreachable() -> AppError { AppError::Other("Tidak dapat menghubungi server sync; periksa koneksi atau konfigurasi".into()) }

pub(crate) fn canonical_uuid(value: &str) -> Result<String, AppError> {
    uuid::Uuid::parse_str(value).map(|id| id.to_string()).map_err(|_| invalid_response())
}

pub(crate) fn validate_record(row: &WireRecord) -> Result<(), AppError> {
    if row.id.chars().count() > 80 || row.payload.as_ref().is_none_or(|p| p.len() > MAX_RECORD_BYTES) {
        return Err(invalid_response());
    }
    canonical_uuid(&row.device_id)?;
    Ok(())
}

pub struct HttpServer { url: String, anon_key: String, agent: ureq::Agent }

impl HttpServer {
    pub fn new(url: &str, anon_key: &str) -> Result<Self, AppError> {
        if !url.starts_with("https://") || anon_key.is_empty() { return Err(AppError::Invalid("Konfigurasi sync tidak valid".into())) }
        Ok(Self {
            url: url.trim_end_matches('/').into(), anon_key: anon_key.into(),
            agent: ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(30))).max_redirects(0).build().into(),
        })
    }

    pub fn from_config() -> Result<Option<Self>, AppError> {
        let url = option_env!("ANCHOA_SUPABASE_URL").unwrap_or("").to_string();
        let key = option_env!("ANCHOA_SUPABASE_ANON_KEY").unwrap_or("").to_string();
        #[cfg(debug_assertions)]
        let (url, key) = (
            std::env::var("ANCHOA_SUPABASE_URL").unwrap_or(url),
            std::env::var("ANCHOA_SUPABASE_ANON_KEY").unwrap_or(key),
        );
        if url.is_empty() || key.is_empty() { return Ok(None) }
        Self::new(&url, &key).map(Some)
    }

    fn request(&self, path: &str, session: Option<&Session>, body: Option<Value>, prefer: Option<&str>) -> Result<Value, AppError> {
        let token = session.map_or(self.anon_key.as_str(), |s| s.access_token.as_str());
        let authorization = Zeroizing::new(format!("Bearer {token}"));
        let url = format!("{}{}", self.url, path);
        let response = if let Some(body) = body {
            let mut request = self.agent.post(&url).header("apikey", &self.anon_key).header("Authorization", authorization.as_str());
            if let Some(prefer) = prefer { request = request.header("Prefer", prefer) }
            request.send_json(body)
        } else {
            self.agent.get(&url).header("apikey", &self.anon_key).header("Authorization", authorization.as_str()).call()
        };
        let mut response = response.map_err(|error| match error {
            ureq::Error::StatusCode(401) => AppError::Other("Sesi sync kedaluwarsa; masuk kembali".into()),
            _ => unreachable(),
        })?;
        let bytes = Zeroizing::new(response.body_mut().with_config().limit(300 * 1024 * 1024).read_to_vec().map_err(|_| invalid_response())?);
        if bytes.is_empty() { return Ok(Value::Null) }
        serde_json::from_slice(&bytes).map_err(|_| invalid_response())
    }

    fn token(&self, grant: &str, body: Value) -> Result<Session, AppError> {
        // The response and request may contain tokens; never include either in errors.
        #[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
        struct TokenResponse {
            access_token: String,
            refresh_token: String,
            expires_at: Option<i64>,
            expires_in: Option<i64>,
        }
        let mut value = self.request(&format!("/auth/v1/token?grant_type={grant}"), None, Some(body), None)?;
        let result = serde_json::from_value::<TokenResponse>(value.take()).map_err(|_| invalid_response())?;
        let expires_at = match result.expires_at {
            Some(seconds) => seconds.checked_mul(1_000),
            None => result.expires_in.and_then(|s| s.checked_mul(1_000)).and_then(|ms| crate::time::now_ms().checked_add(ms)),
        }.ok_or_else(invalid_response)?;
        let mut session = Session { user_id: String::new(), email: String::new(), access_token: result.access_token.clone(), refresh_token: result.refresh_token.clone(), expires_at };
        let user = self.request("/auth/v1/user", Some(&session), None, None)?;
        session.user_id = canonical_uuid(user["id"].as_str().ok_or_else(invalid_response)?)?;
        session.email = user["email"].as_str().ok_or_else(invalid_response)?.into();
        Ok(session)
    }
}

impl SyncServer for HttpServer {
    fn authorize_url(&self, provider: Provider, redirect: &str, challenge: &str, state: &str) -> String {
        // Only a loopback URL produced by oauth::begin is allowed here.
        if !valid_redirect(redirect) { return String::new() }
        format!("{}/auth/v1/authorize?provider={}&redirect_to={}&code_challenge={}&code_challenge_method=s256&state={}", self.url, provider.as_str(), percent_encode(redirect), percent_encode(challenge), percent_encode(state))
    }
    fn exchange_code(&self, code: &str, verifier: &str) -> Result<Session, AppError> {
        self.token("pkce", json!({"auth_code":code,"code_verifier":verifier}))
    }
    fn refresh(&self, session: &Session) -> Result<Session, AppError> {
        let result = self.token("refresh_token", json!({"refresh_token":session.refresh_token}))?;
        if result.user_id != session.user_id { return Err(invalid_response()) }
        Ok(result)
    }
    fn sign_out(&self, session: &Session) -> Result<(), AppError> {
        self.request("/auth/v1/logout", Some(session), Some(json!({})), None).map(|_| ())
    }
    fn get_vault(&self, session: &Session) -> Result<Option<Vault>, AppError> {
        let value = self.request("/rest/v1/vault?select=kdf,dek_by_passphrase,dek_by_recovery", Some(session), None, None)?;
        let rows = value.as_array().ok_or_else(invalid_response)?;
        if rows.len() > 1 { return Err(invalid_response()) }
        rows.first().map(vault_from_json).transpose()
    }
    fn put_vault(&self, session: &Session, vault: &Vault) -> Result<(), AppError> {
        let mut value = vault_json(vault);
        value["user_id"] = Value::String(canonical_uuid(&session.user_id)?);
        self.request("/rest/v1/vault?on_conflict=user_id", Some(session), Some(value), Some("resolution=merge-duplicates,return=minimal")).map(|_| ())
    }
    fn push(&self, session: &Session, rows: &[WireRecord]) -> Result<Vec<Rejected>, AppError> {
        if rows.len() > PAGE_SIZE as usize { return Err(invalid_response()) }
        let mut rows = rows.to_vec();
        for row in &mut rows { validate_record(row)?; row.device_id = canonical_uuid(&row.device_id)? }
        let value = self.request("/rest/v1/rpc/push_records", Some(session), Some(json!({"rows":rows})), None)?;
        let mut rejected: Vec<Rejected> = serde_json::from_value(value["rejected"].clone()).map_err(|_| invalid_response())?;
        if rejected.len() > rows.len() { return Err(invalid_response()) }
        for row in &mut rejected { row.device_id = canonical_uuid(&row.device_id)? }
        Ok(rejected)
    }
    fn pull(&self, session: &Session, after: i64, max: u32) -> Result<Vec<WireRecord>, AppError> {
        let max = max.clamp(1, PAGE_SIZE);
        let value = self.request("/rest/v1/rpc/pull_records", Some(session), Some(json!({"after":after,"max":max})), None)?;
        let mut rows: Vec<WireRecord> = serde_json::from_value(value).map_err(|_| invalid_response())?;
        if rows.len() > max as usize { return Err(invalid_response()) }
        for row in &mut rows { validate_record(row)?; row.device_id = canonical_uuid(&row.device_id)? }
        Ok(rows)
    }
    fn usage(&self, session: &Session) -> Result<Usage, AppError> {
        let value = self.request("/rest/v1/rpc/usage", Some(session), Some(json!({})), None)?;
        serde_json::from_value(value.as_array().and_then(|v| (v.len() == 1).then(|| v[0].clone())).ok_or_else(invalid_response)?).map_err(|_| invalid_response())
    }
    fn delete_my_data(&self, session: &Session) -> Result<(), AppError> {
        self.request("/rest/v1/rpc/delete_my_data", Some(session), Some(json!({})), None).map(|_| ())
    }
}

pub fn configured_server() -> Result<Option<std::sync::Arc<dyn SyncServer>>, AppError> {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("ANCHOA_FAKE_SYNC").filter(|p| !p.is_empty()) {
        return Ok(Some(std::sync::Arc::new(super::fake::FileServer::open(std::path::Path::new(&path))?)));
    }
    Ok(HttpServer::from_config()?.map(|server| std::sync::Arc::new(server) as std::sync::Arc<dyn SyncServer>))
}

fn valid_redirect(redirect: &str) -> bool {
    redirect.strip_prefix("http://127.0.0.1:").and_then(|s| s.strip_suffix("/callback")).and_then(|p| p.parse::<u16>().ok()).is_some_and(|port| port != 0)
}

pub(crate) fn percent_encode(value: &str) -> String {
    let mut result = String::new();
    for b in value.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { result.push(char::from(b)) }
        else { result.push('%'); result.push(char::from(HEX[(b >> 4) as usize]).to_ascii_uppercase()); result.push(char::from(HEX[(b & 15) as usize]).to_ascii_uppercase()) }
    }
    result
}

const HEX: &[u8;16] = b"0123456789abcdef";
pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().flat_map(|b| [char::from(HEX[(b >> 4) as usize]), char::from(HEX[(b & 15) as usize])]).collect()
}
pub(crate) fn hex_decode(value: &str) -> Result<Vec<u8>, AppError> {
    if !value.len().is_multiple_of(2) { return Err(invalid_response()) }
    value.as_bytes().as_chunks::<2>().0.iter().map(|pair| {
        let a = char::from(pair[0]).to_digit(16).ok_or_else(invalid_response)?;
        let b = char::from(pair[1]).to_digit(16).ok_or_else(invalid_response)?;
        Ok((a * 16 + b) as u8)
    }).collect()
}

mod bytea {
    use super::*;
    pub fn serialize<S: serde::Serializer>(value: &Option<Vec<u8>>, serializer: S) -> Result<S::Ok, S::Error> {
        let bytes = value.as_ref().filter(|v| v.len() <= MAX_RECORD_BYTES).ok_or_else(|| serde::ser::Error::custom("Payload sync tidak valid"))?;
        serializer.serialize_str(&format!("\\x{}", hex_encode(bytes)))
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Vec<u8>>, D::Error> {
        let value = String::deserialize(deserializer)?;
        if value.len() > MAX_RECORD_BYTES * 2 + 2 { return Err(serde::de::Error::custom("Payload sync terlalu besar")) }
        value.strip_prefix("\\x").ok_or_else(invalid_response).and_then(hex_decode).map(Some).map_err(|_| serde::de::Error::custom("Payload sync tidak valid"))
    }
}

/// Small dependency-free base64 encoder. PKCE uses the URL alphabet without padding.
pub(crate) fn base64_encode(bytes: &[u8], url: bool) -> String {
    let alphabet = if url { b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" } else { b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/" };
    let mut result = String::new();
    for chunk in bytes.chunks(3) {
        let bits = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 { if i <= chunk.len() { result.push(char::from(alphabet[((bits >> (18 - i * 6)) & 63) as usize])) } else if !url { result.push('=') } }
    }
    result
}
fn salt_decode(value: &str) -> Result<[u8;16], AppError> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if value.len() != 24 || !value.ends_with("==") { return Err(invalid_response()) }
    let mut bytes = Vec::new();
    let mut bits = 0_u32;
    let mut count = 0;
    for b in value.bytes().take(22) {
        bits = (bits << 6) | alphabet.iter().position(|&v| v == b).ok_or_else(invalid_response)? as u32;
        count += 6;
        if count >= 8 { count -= 8; bytes.push((bits >> count) as u8) }
    }
    let salt: [u8;16] = bytes.try_into().map_err(|_| invalid_response())?;
    if base64_encode(&salt, false) != value { return Err(invalid_response()) }
    Ok(salt)
}
pub(crate) fn vault_json(vault: &Vault) -> Value {
    json!({"kdf":{"alg":"argon2id","m":vault.kdf.m_kib,"t":vault.kdf.t,"p":vault.kdf.p,"salt":base64_encode(&vault.kdf.salt,false)},"dek_by_passphrase":format!("\\x{}",hex_encode(&vault.dek_by_passphrase)),"dek_by_recovery":format!("\\x{}",hex_encode(&vault.dek_by_recovery))})
}
pub(crate) fn vault_from_json(value: &Value) -> Result<Vault, AppError> {
    #[derive(Deserialize)]
    struct KdfJson { alg: String, m: u32, t: u32, p: u32, salt: String }
    let kdf: KdfJson = serde_json::from_value(value["kdf"].clone()).map_err(|_| invalid_response())?;
    if kdf.alg != "argon2id" || !(8..=1_048_576).contains(&kdf.m) || !(1..=10).contains(&kdf.t) || !(1..=4).contains(&kdf.p) { return Err(invalid_response()) }
    let blob = |name: &str| value[name].as_str().filter(|s| s.len() == 146).and_then(|s| s.strip_prefix("\\x")).ok_or_else(invalid_response).and_then(hex_decode);
    Ok(Vault { kdf: Kdf { m_kib: kdf.m, t: kdf.t, p: kdf.p, salt: salt_decode(&kdf.salt)? }, dek_by_passphrase: blob("dek_by_passphrase")?, dek_by_recovery: blob("dek_by_recovery")? })
}

pub(crate) fn stored_vault(conn: &rusqlite::Connection, user_id: &str) -> Result<Option<Vault>, AppError> {
    let value: Option<String> = conn.query_row("SELECT document FROM fake_vault WHERE user_id=?1", [user_id], |r| r.get(0)).optional()?;
    value.map(|v| serde_json::from_str(&v).map_err(|_| invalid_response()).and_then(|v| vault_from_json(&v))).transpose()
}
