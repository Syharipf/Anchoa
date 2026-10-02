//! OAuth loopback flow with PKCE S256 (RFC 8252).
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    time::Duration,
};

use chacha20poly1305::aead::rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};

use super::server::{self, Provider, Session, SyncServer};
use crate::error::AppError;

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);

pub struct OAuthFlow {
    server: Arc<dyn SyncServer>,
    verifier: String,
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
            .ok_or_else(|| AppError::Other("Alur login OAuth sudah ditutup atau dibatalkan".into()))?;

        let start = std::time::Instant::now();
        loop {
            if start.elapsed() >= timeout {
                return Err(AppError::Other("Batas waktu login sync habis (timeout)".into()));
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
            let mut buf = [0u8; 4096];
            let n = match stream.read(&mut buf) {
                Ok(n) if n > 0 => n,
                _ => continue,
            };

            let request = String::from_utf8_lossy(&buf[..n]);
            let Some(first_line) = request.lines().next() else {
                send_404(&mut stream);
                continue;
            };

            let parts: Vec<&str> = first_line.split_whitespace().collect();
            if parts.len() < 2 || parts[0] != "GET" {
                send_404(&mut stream);
                continue;
            }

            let (path, query) = parts[1].split_once('?').unwrap_or((parts[1], ""));
            if path != "/callback" {
                send_404(&mut stream);
                continue;
            }

            let mut code: Option<String> = None;
            let mut state: Option<String> = None;
            for param in query.split('&') {
                if let Some((k, v)) = param.split_once('=') {
                    if k == "code" {
                        code = Some(v.to_string());
                    } else if k == "state" {
                        state = Some(v.to_string());
                    }
                }
            }

            if state.as_deref() != Some(&self.state) || code.is_none() {
                send_404(&mut stream);
                continue;
            }

            let code = code.unwrap();
            send_success(&mut stream);
            drop(listener);

            return self.server.exchange_code(&code, &self.verifier);
        }
    }
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

fn default_opener(url: &str) -> Result<(), AppError> {
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = url;
        Ok(())
    }
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
            verifier: String::new(),
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
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let mut verifier_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut verifier_bytes);
    let verifier = server::base64_encode(&verifier_bytes, true);

    let mut state_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut state_bytes);
    let state = server::base64_encode(&state_bytes, true);

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
