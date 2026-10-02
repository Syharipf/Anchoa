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
    state: String,
    listener: Mutex<Option<TcpListener>>,
    authorize_url: String,
    redirect_uri: String,
    fake_session: Option<Session>,
}

impl OAuthFlow {
    pub fn authorize_url(&self) -> &str {
        &self.authorize_url
    }

    pub fn redirect_uri(&self) -> &str {
        &self.redirect_uri
    }

    pub fn cancel(&self) {
        if let Ok(mut lock) = self.listener.lock() {
            *lock = None;
        }
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
                return Err(AppError::Other("Login sync dibatalkan".into()));
            }
            if start.elapsed() >= timeout {
                return Err(AppError::Other(
                    "Batas waktu login sync habis (timeout)".into(),
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

            return self.server.exchange_code(&code, &self.verifier);
        }
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
    let body = "Login sync gagal, kembali ke Anchoa untuk mencoba lagi";
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
            state: String::new(),
            listener: Mutex::new(None),
            authorize_url: String::new(),
            redirect_uri: String::new(),
            fake_session: Some(session),
        });
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| AppError::Other(format!("Gagal membuka port listener OAuth: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::Other(e.to_string()))?
        .port();

    let mut verifier_bytes = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(verifier_bytes.as_mut());
    let verifier = Zeroizing::new(server::base64_encode(verifier_bytes.as_ref(), true));

    let mut state_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut state_bytes);
    let state = server::base64_encode(&state_bytes, true);
    let redirect_uri = format!("http://127.0.0.1:{port}/callback?state={state}");

    let challenge_hash = Sha256::digest(verifier.as_bytes());
    let challenge = server::base64_encode(&challenge_hash, true);

    let authorize_url = server.authorize_url(provider, &redirect_uri, &challenge, &state);

    opener(&authorize_url)?;

    listener
        .set_nonblocking(true)
        .map_err(|e| AppError::Other(e.to_string()))?;

    Ok(OAuthFlow {
        server,
        verifier,
        state,
        listener: Mutex::new(Some(listener)),
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
        assert!(matches!(err,AppError::Invalid(ref m) if m.contains("Login sync gagal")));
        assert!(!err.to_string().contains("secret"));
        let code: Zeroizing<String> =
            callback_code("/callback?state=expected&code=abc", "expected")
                .unwrap()
                .unwrap();
        assert_eq!(code.as_str(), "abc");
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
