//! OAuth loopback flow with PKCE S256 (RFC 8252).
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use chacha20poly1305::aead::rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::server::{self, Provider, Session, SyncServer};
use crate::error::AppError;

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);

pub struct OAuthFlow {
    server: Arc<dyn SyncServer>,
    verifier: Zeroizing<String>,
    loopback: Loopback,
    authorize_url: String,
    redirect_uri: String,
    fake_session: Option<Session>,
}

/// Loopback redirect socket shared by the sync and Google Calendar flows. It
/// owns the PKCE `state`, accepts exactly one valid callback, and hands back
/// the authorization code. Each flow exchanges that code against its own
/// provider and scope list, so the two never share tokens or permissions.
struct Loopback {
    listener: Mutex<Option<TcpListener>>,
    state: String,
}

impl Loopback {
    fn bind() -> Result<(Self, u16), AppError> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| AppError::Other(format!("Gagal membuka port listener OAuth: {e}")))?;
        let port = listener
            .local_addr()
            .map_err(|e| AppError::Other(e.to_string()))?
            .port();
        let mut state_bytes = [0u8; 32];
        OsRng.fill_bytes(&mut state_bytes);
        let state = server::base64_encode(&state_bytes, true);
        listener
            .set_nonblocking(true)
            .map_err(|e| AppError::Other(e.to_string()))?;
        Ok((
            Self {
                listener: Mutex::new(Some(listener)),
                state,
            },
            port,
        ))
    }

    fn state(&self) -> &str {
        &self.state
    }

    fn cancel(&self) {
        if let Ok(mut lock) = self.listener.lock() {
            *lock = None;
        }
    }

    /// Waits for a single valid callback `GET /callback?code=…&state=…`.
    /// Invalid requests receive a 404 without terminating the listener.
    fn wait_cancellable(
        &self,
        timeout: Duration,
        cancel: &AtomicBool,
    ) -> Result<Zeroizing<String>, AppError> {
        let listener = self
            .listener
            .lock()
            .map_err(|_| AppError::Other("OAuth lock poisoned".into()))?
            .take()
            .ok_or_else(|| {
                AppError::Other("Alur login OAuth sudah ditutup atau dibatalkan".into())
            })?;

        let start = std::time::Instant::now();
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err(AppError::Other("Login OAuth dibatalkan".into()));
            }
            if start.elapsed() >= timeout {
                return Err(AppError::Other(
                    "Batas waktu login OAuth habis (timeout)".into(),
                ));
            }

            let (mut stream, _) = match listener.accept() {
                Ok(res) => res,
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50));
                    continue;
                }
                Err(e) => return Err(AppError::Other(format!("Kesalahan listener OAuth: {e}"))),
            };

            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut buf = Zeroizing::new([0u8; 4096]);
            let n = match stream.read(buf.as_mut()) {
                Ok(n) if n > 0 => n,
                _ => continue,
            };

            let request = Zeroizing::new(String::from_utf8_lossy(&buf[..n]).into_owned());
            let Some(first_line) = request.lines().next() else {
                send_404(&mut stream);
                continue;
            };

            let parts: Vec<&str> = first_line.split_whitespace().collect();
            if parts.len() < 2 || parts[0] != "GET" {
                send_404(&mut stream);
                continue;
            }

            let Some(result) = callback_code(parts[1], &self.state) else {
                send_404(&mut stream);
                continue;
            };
            let code = match result {
                Ok(code) => code,
                Err(error) => {
                    send_login_error(&mut stream);
                    return Err(error);
                }
            };
            send_success(&mut stream);
            drop(listener);

            return Ok(code);
        }
    }
}

impl OAuthFlow {
    pub fn authorize_url(&self) -> &str {
        &self.authorize_url
    }

    pub fn redirect_uri(&self) -> &str {
        &self.redirect_uri
    }

    pub fn cancel(&self) {
        self.loopback.cancel();
    }

    /// Waits for a single valid callback `GET /callback?code=…&state=…`.
    /// Invalid requests receive a 404 without terminating the listener.
    pub fn wait(&self, timeout: Duration) -> Result<Session, AppError> {
        self.wait_cancellable(timeout, &AtomicBool::new(false))
    }

    /// Like `wait`, but gives up as soon as `cancel` is set (checked about every 50 ms).
    pub fn wait_cancellable(
        &self,
        timeout: Duration,
        cancel: &AtomicBool,
    ) -> Result<Session, AppError> {
        if let Some(session) = &self.fake_session {
            return Ok(Session {
                user_id: session.user_id.clone(),
                email: session.email.clone(),
                access_token: session.access_token.clone(),
                refresh_token: session.refresh_token.clone(),
                expires_at: session.expires_at,
            });
        }

        let code = self.loopback.wait_cancellable(timeout, cancel)?;
        self.server.exchange_code(&code, &self.verifier)
    }
}

/// None means an unrelated or invalid request; a provider error is a valid
/// terminal callback only after the expected state has been checked.
fn callback_code(
    target: &str,
    expected_state: &str,
) -> Option<Result<Zeroizing<String>, AppError>> {
    let (path, query) = target.split_once('?')?;
    if path != "/callback" {
        return None;
    }
    let mut code = None;
    let mut state = None;
    let mut error = false;
    for param in query.split('&') {
        let Some((key, value)) = param.split_once('=') else {
            continue;
        };
        match key {
            "state" => {
                if state.is_some() {
                    return None;
                }
                state = Some(value);
            }
            "code" => {
                if code.is_some() || value.is_empty() {
                    return None;
                }
                code = Some(value);
            }
            "error" => error = true,
            _ => (),
        }
    }
    if state != Some(expected_state) {
        return None;
    }
    if error {
        return Some(Err(AppError::Invalid(
            "Login sync gagal atau dibatalkan oleh penyedia akun; coba lagi".into(),
        )));
    }
    Some(Ok(Zeroizing::new(code?.to_string())))
}

fn send_404(stream: &mut TcpStream) {
    let body = "Not Found";
    let response = format!(
        "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn send_success(stream: &mut TcpStream) {
    let body = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Login berhasil</title></head><body><p>Login berhasil, kembali ke Anchoa</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn send_login_error(stream: &mut TcpStream) {
    let body = "Login gagal, kembali ke Anchoa untuk mencoba lagi";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn default_opener(url: &str) -> Result<(), AppError> {
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|_| AppError::Other("Browser tidak dapat dibuka untuk login sync".into()))
}

// ---- Google Calendar ----
//
// The sync flow above goes through Supabase and carries only the sync scopes
// its Google provider was configured with. Calendar talks to Google directly
// with its own scope list, its own redirect and its own token exchange, so
// signing in to sync never grants Calendar access and vice versa.

pub const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

/// Two-way sync: Anchoa reads and writes calendar events.
pub const CALENDAR_SCOPES: &[&str] = &[
    "https://www.googleapis.com/auth/calendar.events",
    "openid",
    "email",
];

/// Returned when Google rejects the grant: the refresh token is gone, the
/// access token cannot be renewed, and the user has to sign in again.
pub const CALENDAR_SESSION_REVOKED: &str =
    "Sesi Google Kalender berakhir; sambungkan kembali";

/// Build-time Google OAuth client. Desktop installs are "TV and Limited Input"
/// clients, so the secret here is not a secret.
pub struct GoogleClient {
    pub id: String,
    pub secret: Option<Zeroizing<String>>,
}

pub fn google_client() -> Result<GoogleClient, AppError> {
    let id = option_env!("ANCHOA_GOOGLE_CLIENT_ID").unwrap_or("").to_string();
    let secret = option_env!("ANCHOA_GOOGLE_CLIENT_SECRET")
        .unwrap_or("")
        .to_string();
    #[cfg(debug_assertions)]
    let (id, secret) = (
        std::env::var("ANCHOA_GOOGLE_CLIENT_ID").unwrap_or(id),
        std::env::var("ANCHOA_GOOGLE_CLIENT_SECRET").unwrap_or(secret),
    );
    if id.is_empty() {
        return Err(AppError::Invalid(
            "Google Kalender belum dikonfigurasi di build ini".into(),
        ));
    }
    Ok(GoogleClient {
        id,
        secret: (!secret.is_empty()).then(|| Zeroizing::new(secret)),
    })
}

/// PKCE pair for the Calendar flow. `verifier` never leaves the process;
/// only its SHA-256 challenge goes to Google.
pub struct CalendarFlow {
    loopback: Loopback,
    verifier: Zeroizing<String>,
    client: GoogleClient,
    authorize_url: String,
    redirect_uri: String,
}

/// Pure so tests can assert the scope list without opening a browser.
pub fn calendar_authorize_url(
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> String {
    format!(
        "{GOOGLE_AUTH_URL}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        server::percent_encode(client_id),
        server::percent_encode(redirect_uri),
        server::percent_encode(&CALENDAR_SCOPES.join(" ")),
        server::percent_encode(state),
        server::percent_encode(challenge),
    )
}

pub fn begin_calendar(client: GoogleClient) -> Result<CalendarFlow, AppError> {
    begin_calendar_with_opener(client, default_opener)
}

pub fn begin_calendar_with_opener<F>(
    client: GoogleClient,
    opener: F,
) -> Result<CalendarFlow, AppError>
where
    F: FnOnce(&str) -> Result<(), AppError>,
{
    let (loopback, port) = Loopback::bind()?;

    let mut verifier_bytes = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(verifier_bytes.as_mut());
    let verifier = Zeroizing::new(server::base64_encode(verifier_bytes.as_ref(), true));
    let challenge_hash = Sha256::digest(verifier.as_bytes());
    let challenge = server::base64_encode(&challenge_hash, true);

    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let authorize_url =
        calendar_authorize_url(&client.id, &redirect_uri, loopback.state(), &challenge);

    opener(&authorize_url)?;

    Ok(CalendarFlow {
        loopback,
        verifier,
        client,
        authorize_url,
        redirect_uri,
    })
}

/// Tokens handed to the caller. Both secrets zeroize on drop.
pub struct GoogleTokens {
    pub access_token: Zeroizing<String>,
    /// Empty when Google rotates refresh tokens rarely; the caller keeps its own.
    pub refresh_token: Zeroizing<String>,
    pub expires_at: i64,
    pub scope: Option<String>,
}

impl CalendarFlow {
    pub fn authorize_url(&self) -> &str {
        &self.authorize_url
    }

    pub fn redirect_uri(&self) -> &str {
        &self.redirect_uri
    }

    pub fn cancel(&self) {
        self.loopback.cancel();
    }

    pub fn wait_cancellable(
        &self,
        timeout: Duration,
        cancel: &AtomicBool,
    ) -> Result<GoogleTokens, AppError> {
        let code = self.loopback.wait_cancellable(timeout, cancel)?;
        let mut body = Zeroizing::new(format!(
            "grant_type=authorization_code&code={}&code_verifier={}&redirect_uri={}&client_id={}",
            server::percent_encode(&code),
            server::percent_encode(&self.verifier),
            server::percent_encode(&self.redirect_uri),
            server::percent_encode(&self.client.id),
        ));
        with_secret(&mut body, self.client.secret.as_deref().map(|s| s.as_str()));
        google_token_request(&body, "Login Google Kalender gagal atau dibatalkan; coba lagi")
    }
}

/// Trades a refresh token for a new access token. Rejection means the grant is
/// gone (revoked, password change, or Calendar access removed).
pub fn refresh_google_token(
    client: &GoogleClient,
    refresh_token: &str,
) -> Result<GoogleTokens, AppError> {
    let mut body = Zeroizing::new(format!(
        "grant_type=refresh_token&refresh_token={}&client_id={}",
        server::percent_encode(refresh_token),
        server::percent_encode(&client.id),
    ));
    with_secret(&mut body, client.secret.as_deref().map(|s| s.as_str()));
    google_token_request(&body, CALENDAR_SESSION_REVOKED)
}

fn with_secret(body: &mut Zeroizing<String>, secret: Option<&str>) {
    if let Some(secret) = secret {
        body.push_str(&format!(
            "&client_secret={}",
            server::percent_encode(secret)
        ));
    }
}

fn google_token_request(body: &str, rejected: &str) -> Result<GoogleTokens, AppError> {
    #[derive(serde::Deserialize)]
    struct TokenResponse {
        access_token: String,
        refresh_token: Option<String>,
        expires_in: Option<i64>,
        #[serde(default)]
        scope: Option<String>,
    }

    let mut response = match ureq::post(GOOGLE_TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .send(body.as_bytes())
    {
        Ok(response) => response,
        Err(ureq::Error::StatusCode(400 | 401)) => return Err(AppError::Invalid(rejected.into())),
        Err(ureq::Error::StatusCode(429)) => {
            return Err(AppError::Other(
                "Google membatasi permintaan; coba lagi nanti".into(),
            ));
        }
        Err(error) => {
            return Err(AppError::Other(format!(
                "Tidak dapat menghubungi server Google: {error}"
            )));
        }
    };

    let parsed: TokenResponse = response
        .body_mut()
        .with_config()
        // A token response is small; anything larger is not a token response.
        .limit(64 * 1024)
        .read_json()
        .map_err(|_| AppError::Other("Respons Google tidak valid".into()))?;
    let expires_at = parsed
        .expires_in
        .and_then(|seconds| seconds.checked_mul(1_000))
        .and_then(|ms| crate::time::now_ms().checked_add(ms))
        .ok_or_else(|| AppError::Other("Respons Google tidak valid".into()))?;
    Ok(GoogleTokens {
        access_token: Zeroizing::new(parsed.access_token),
        refresh_token: Zeroizing::new(parsed.refresh_token.unwrap_or_default()),
        expires_at,
        scope: parsed.scope,
    })
}

pub fn begin(server: Arc<dyn SyncServer>, provider: Provider) -> Result<OAuthFlow, AppError> {
    begin_with_opener(server, provider, default_opener)
}

pub fn begin_with_opener<F>(
    server: Arc<dyn SyncServer>,
    provider: Provider,
    opener: F,
) -> Result<OAuthFlow, AppError>
where
    F: FnOnce(&str) -> Result<(), AppError>,
{
    if let Some(session) = server.fake_session() {
        return Ok(OAuthFlow {
            server,
            verifier: Zeroizing::new(String::new()),
            loopback: Loopback {
                listener: Mutex::new(None),
                state: String::new(),
            },
            authorize_url: String::new(),
            redirect_uri: String::new(),
            fake_session: Some(session),
        });
    }

    let (loopback, port) = Loopback::bind()?;

    let mut verifier_bytes = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(verifier_bytes.as_mut());
    let verifier = Zeroizing::new(server::base64_encode(verifier_bytes.as_ref(), true));

    let redirect_uri = format!(
        "http://127.0.0.1:{port}/callback?state={}",
        loopback.state()
    );

    let challenge_hash = Sha256::digest(verifier.as_bytes());
    let challenge = server::base64_encode(&challenge_hash, true);

    let authorize_url = server.authorize_url(provider, &redirect_uri, &challenge, loopback.state());

    opener(&authorize_url)?;

    Ok(OAuthFlow {
        server,
        verifier,
        loopback,
        authorize_url,
        redirect_uri,
        fake_session: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_parser_requires_exact_path_and_state_and_handles_provider_errors() {
        for target in [
            "/wrong?state=expected&code=abc",
            "/callback?state=wrong&code=abc",
            "/callback?state=expected",
            "/callback?state=expected&state=wrong&code=abc",
        ] {
            assert!(callback_code(target, "expected").is_none());
        }
        let err = callback_code(
            "/callback?state=expected&error=access_denied&error_description=secret",
            "expected",
        )
        .unwrap()
        .unwrap_err();
        assert!(matches!(&err, AppError::Invalid(m) if m.contains("Login sync gagal")));
        let code: Zeroizing<String> =
            callback_code("/callback?state=expected&code=abc", "expected")
                .unwrap()
                .unwrap();
        assert_eq!(code.as_str(), "abc");
    }

    #[test]
    fn calendar_scopes_grant_events_and_are_isolated_from_the_sync_flow() {
        let joined = CALENDAR_SCOPES.join(" ");
        assert!(joined.contains("https://www.googleapis.com/auth/calendar.events"));
        // Nothing that the Supabase sync provider would request.
        assert!(!joined.contains("supabase"));
        assert!(!joined.contains("sync"));
    }

    #[test]
    fn calendar_authorize_url_carries_pkce_state_and_events_scopes() {
        let url = calendar_authorize_url(
            "client-id",
            "http://127.0.0.1:1/callback",
            "st-ate_43chars-xxxxxxxxxxxxxxxxxxxxxxxxxx",
            "challenge",
        );
        assert!(url.starts_with(GOOGLE_AUTH_URL));
        assert!(url.contains("client_id=client-id"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A1%2Fcallback"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("access_type=offline"));
        assert!(url.contains("prompt=consent"));
        assert!(url.contains(
            "scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events%20openid%20email"
        ));
    }
    #[test]
    fn calendar_flow_binds_loopback_and_keeps_the_verifier_local() {
        let flow = begin_calendar_with_opener(
            GoogleClient {
                id: "client-id".into(),
                secret: Some(Zeroizing::new("not-a-secret-secret".into())),
            },
            |url| {
                assert!(!url.contains("verifier"));
                assert!(url.contains("code_challenge="));
                Ok(())
            },
        )
        .unwrap();
        assert!(flow
            .redirect_uri()
            .starts_with("http://127.0.0.1:"));
        assert!(flow.redirect_uri().ends_with("/callback"));
        assert!(flow.authorize_url().contains("client_id=client-id"));
        // A secret-bearing client must never leak it into the authorize URL.
        assert!(!flow.authorize_url().contains("not-a-secret-secret"));
    }

    #[test]
    fn oauth_verifier_and_received_code_use_zeroizing_strings() {
        let server = Arc::new(super::super::fake::MemoryServer::default());
        server.set_fake_session(true);
        let flow = begin_with_opener(server, Provider::Google, |_| Ok(())).unwrap();
        fn zeroizing(_: &Zeroizing<String>) {}
        zeroizing(&flow.verifier);
        let code = callback_code("/callback?state=expected&code=sensitive-code", "expected")
            .unwrap()
            .unwrap();
        zeroizing(&code);
    }
}
