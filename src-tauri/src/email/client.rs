use std::future::Future;
use std::time::Duration;

use async_imap::imap_proto::{
    Response, Status,
    types::{AttributeValue, BodyStructure},
};
use lettre::{
    SmtpTransport, Transport, address::Envelope,
    transport::smtp::authentication::Credentials as SmtpCredentials,
};
use mail_parser::{HeaderValue, MessageParser};
use tokio::net::TcpStream;
use tokio_rustls::{
    TlsConnector,
    client::TlsStream,
    rustls::{ClientConfig, RootCertStore, pki_types::ServerName},
};

use super::{ALL_MAIL, Flag, INBOX, SENT, account::Credentials};
use crate::error::AppError;

// Deliberately contains no underlying protocol errors or server responses.
#[derive(Debug, Clone, Copy, thiserror::Error)]
pub enum MailError {
    #[error("Login Gmail gagal; periksa alamat dan App Password")]
    Login,
    #[error("Koneksi Gmail gagal atau melewati batas waktu")]
    Network,
    #[error("Respons Gmail tidak dapat dibaca")]
    Protocol,
    #[error("Email tidak ditemukan di Gmail")]
    Missing,
    #[error("Email gagal dikirim")]
    Send,
}

impl From<MailError> for AppError {
    fn from(error: MailError) -> Self {
        AppError::Other(error.to_string())
    }
}

#[derive(Debug, Clone)]
pub struct Header {
    pub uid: u32,
    pub subject: String,
    pub message_id: Option<String>,
    pub from_name: String,
    pub from_addr: String,
    pub to_addrs: Vec<String>,
    pub sent_at: i64,
    pub unread: bool,
    pub starred: bool,
    pub has_html: bool,
    pub refs: Vec<String>,
}
/// Lightweight batch of UID + FLAGS for incremental sync.
#[derive(Debug, Clone)]
pub struct UidFlag {
    pub uid: u32,
    pub unread: bool,
    pub starred: bool,
}

#[derive(Debug)]
pub struct UidFlagBatch {
    pub entries: Vec<UidFlag>,
    pub uid_validity: u32,
}

pub trait MailClient: Send + Sync {
    fn address(&self) -> &str;
    fn login(&self, credentials: &Credentials) -> Result<(), MailError>;
    /// Fetches headers for specific UIDs in a folder.
    fn fetch_headers(&self, folder: &str, uids: &[u32]) -> Result<Vec<Header>, MailError>;
    /// Returns UIDs and FLAGS for a folder, cheaply (no header/body data).
    fn list_uids_flags(&self, folder: &str) -> Result<UidFlagBatch, MailError>;
    fn fetch_body(&self, folder: &str, uid: u32, uid_validity: u32) -> Result<Vec<u8>, MailError>;
    /// Fetch body without PEEK — sets \Seen on the server in the same command.
    fn fetch_body_and_mark_read(
        &self,
        folder: &str,
        uid: u32,
        uid_validity: u32,
    ) -> Result<Vec<u8>, MailError>;
    fn set_flag(
        &self,
        folder: &str,
        uid: u32,
        uid_validity: u32,
        flag: Flag,
        on: bool,
    ) -> Result<(), MailError>;
    fn move_to(
        &self,
        folder: &str,
        uid: u32,
        uid_validity: u32,
        destination: &str,
    ) -> Result<(), MailError>;
    fn send(&self, raw: &[u8]) -> Result<(), MailError>;
}

pub fn parse_header(
    uid: u32,
    raw: &[u8],
    unread: bool,
    starred: bool,
    has_html: bool,
) -> Result<Header, MailError> {
    let message = MessageParser::default()
        .parse(raw)
        .ok_or(MailError::Protocol)?;
    let from = message.from().and_then(|a| a.first());
    let refs = match message.references() {
        HeaderValue::Text(value) => vec![value.to_string()],
        HeaderValue::TextList(values) => values.iter().map(ToString::to_string).collect(),
        _ => Vec::new(),
    };
    Ok(Header {
        uid,
        subject: message.subject().unwrap_or("(Tanpa subjek)").into(),
        message_id: message.message_id().map(str::to_owned),
        from_name: from.and_then(|a| a.name()).unwrap_or("").into(),
        from_addr: from.and_then(|a| a.address()).unwrap_or("").into(),
        to_addrs: message
            .to()
            .map(|a| {
                a.iter()
                    .filter_map(|a| a.address().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default(),
        sent_at: message
            .date()
            .map(|d| d.to_timestamp().saturating_mul(1000))
            .unwrap_or(0),
        unread,
        starred,
        has_html,
        refs,
    })
}

// No Debug implementation: even transport objects can contain login details.
pub struct GmailClient {
    credentials: Credentials,
    // Built on first use so a failure is an error, not a panic in the constructor.
    runtime: std::sync::OnceLock<tokio::runtime::Runtime>,
    session: tokio::sync::Mutex<Option<Session>>,
    timeout: Duration,
}

type Session = async_imap::Session<TlsStream<TcpStream>>;
const TIMEOUT: Duration = Duration::from_secs(45);

struct Fetched {
    uid: Option<u32>,
    raw: Option<Vec<u8>>,
    flags: Option<Vec<String>>,
    has_html: bool,
}

fn mailbox(folder: &str) -> Result<(), MailError> {
    if matches!(folder, INBOX | SENT | ALL_MAIL) {
        Ok(())
    } else {
        Err(MailError::Protocol)
    }
}

fn html_structure(body: &BodyStructure<'_>) -> bool {
    match body {
        BodyStructure::Text { common, .. } | BodyStructure::Basic { common, .. } => {
            common.ty.ty.eq_ignore_ascii_case("text")
                && common.ty.subtype.eq_ignore_ascii_case("html")
        }
        BodyStructure::Multipart { bodies, .. } => bodies.iter().any(html_structure),
        BodyStructure::Message { body, .. } => html_structure(body),
    }
}

impl GmailClient {
    pub fn new(credentials: Credentials) -> Self {
        Self::with_timeout(credentials, TIMEOUT)
    }

    pub fn with_timeout(credentials: Credentials, timeout: Duration) -> Self {
        Self {
            credentials,
            runtime: std::sync::OnceLock::new(),
            session: tokio::sync::Mutex::new(None),
            timeout,
        }
    }

    fn runtime(&self) -> Result<&tokio::runtime::Runtime, MailError> {
        if let Some(rt) = self.runtime.get() {
            return Ok(rt);
        }
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|_| MailError::Network)?;
        let _ = self.runtime.set(rt);
        self.runtime.get().ok_or(MailError::Network)
    }

    /// Run an async operation with timeout, reusing the persistent runtime without holding a std Mutex across block_on.
    fn run<T>(
        &self,
        operation: impl Future<Output = Result<T, MailError>>,
    ) -> Result<T, MailError> {
        let rt = self.runtime()?;
        let timeout = self.timeout;
        rt.block_on(async {
            tokio::time::timeout(timeout, operation)
                .await
                .map_err(|_| MailError::Network)?
        })
    }

    /// Execute an operation on the persistent session. Lock waiting is inside the timeout.
    /// Uses guard.take() so that on timeout or any error, the broken session is dropped and never left cached.
    async fn execute_with_session<T>(
        &self,
        operation: &(impl for<'a> Fn(&'a mut Session) -> std::pin::Pin<Box<dyn Future<Output = Result<T, MailError>> + 'a>> + ?Sized),
    ) -> Result<T, MailError> {
        let mut guard = self.session.lock().await;
        if guard.is_none() {
            *guard = Some(self.connect().await?);
        }
        let mut session = guard.take().ok_or(MailError::Network)?;
        match operation(&mut session).await {
            Ok(value) => {
                *guard = Some(session);
                Ok(value)
            }
            Err(err) => {
                drop(session);
                Err(err)
            }
        }
    }

    /// Run an operation using the persistent session.
    /// If retry is true, on error/timeout it drops the session and retries once with a fresh login.
    fn with_session<T>(
        &self,
        retry: bool,
        operation: impl for<'a> Fn(&'a mut Session) -> std::pin::Pin<Box<dyn Future<Output = Result<T, MailError>> + 'a>>,
    ) -> Result<T, MailError> {
        let first_attempt = self.run(self.execute_with_session(&operation));
        match first_attempt {
            Ok(value) => Ok(value),
            Err(first_error) => {
                if !retry {
                    return Err(first_error);
                }
                self.run(self.execute_with_session(&operation))
            }
        }
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub fn has_session(&self) -> bool {
        if let Ok(rt) = self.runtime() {
            rt.block_on(async { self.session.lock().await.is_some() })
        } else {
            false
        }
    }

    async fn connect(&self) -> Result<Session, MailError> {
        let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let provider =
            std::sync::Arc::new(tokio_rustls::rustls::crypto::aws_lc_rs::default_provider());
        let config = ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|_| MailError::Network)?
            .with_root_certificates(roots)
            .with_no_client_auth();
        let connector = TlsConnector::from(std::sync::Arc::new(config));
        let tcp = TcpStream::connect(("imap.gmail.com", 993))
            .await
            .map_err(|_| MailError::Network)?;
        let server = ServerName::try_from("imap.gmail.com").map_err(|_| MailError::Network)?;
        let tls = connector
            .connect(server, tcp)
            .await
            .map_err(|_| MailError::Network)?;
        let mut client = async_imap::Client::new(tls);
        let greeting = client
            .read_response()
            .await
            .ok_or(MailError::Network)?
            .map_err(|_| MailError::Network)?;
        if !matches!(
            greeting.parsed(),
            Response::Data {
                status: Status::Ok,
                ..
            }
        ) {
            return Err(MailError::Protocol);
        }
        client
            .login(
                &self.credentials.address,
                self.credentials.password.as_str(),
            )
            .await
            .map_err(|_| MailError::Login)
    }

    fn smtp(&self) -> Result<SmtpTransport, MailError> {
        Ok(SmtpTransport::relay("smtp.gmail.com")
            .map_err(|_| MailError::Network)?
            .port(465)
            .timeout(Some(TIMEOUT))
            .credentials(SmtpCredentials::new(
                self.credentials.address.clone(),
                self.credentials.password.as_str().to_owned(),
            ))
            .build())
    }

    async fn select_mailbox(
        session: &mut Session,
        folder: &str,
        uid_validity: u32,
    ) -> Result<(), MailError> {
        let selected = session
            .select(folder)
            .await
            .map_err(|_| MailError::Protocol)?;
        if selected.uid_validity != Some(uid_validity) {
            return Err(MailError::Missing);
        }
        Ok(())
    }

    // Use async-imap's tagged response API, avoiding an additional stream crate.
    async fn fetch(session: &mut Session, query: &str) -> Result<Vec<Fetched>, MailError> {
        let id = session
            .run_command(query)
            .await
            .map_err(|_| MailError::Network)?;
        let mut rows = Vec::new();
        loop {
            let response = session
                .read_response()
                .await
                .ok_or(MailError::Network)?
                .map_err(|_| MailError::Network)?;
            match response.parsed() {
                Response::Done { tag, status, .. } if *tag == id => {
                    return if *status == Status::Ok {
                        Ok(rows)
                    } else {
                        Err(MailError::Protocol)
                    };
                }
                Response::Data {
                    status: Status::Bye,
                    ..
                } => return Err(MailError::Network),
                Response::Fetch(_, values) => rows.push(Fetched {
                    uid: values.iter().find_map(|a| {
                        if let AttributeValue::Uid(uid) = a {
                            Some(*uid)
                        } else {
                            None
                        }
                    }),
                    raw: values.iter().find_map(|a| {
                        if let AttributeValue::BodySection {
                            data: Some(raw), ..
                        } = a
                        {
                            Some(raw.to_vec())
                        } else {
                            None
                        }
                    }),
                    flags: values.iter().find_map(|a| {
                        if let AttributeValue::Flags(flags) = a {
                            Some(flags.iter().map(ToString::to_string).collect())
                        } else {
                            None
                        }
                    }),
                    has_html: values.iter().any(
                        |a| matches!(a, AttributeValue::BodyStructure(b) if html_structure(b)),
                    ),
                }),
                _ => {}
            }
        }
    }
}

impl MailClient for GmailClient {
    fn address(&self) -> &str {
        &self.credentials.address
    }

    fn login(&self, credentials: &Credentials) -> Result<(), MailError> {
        let candidate = Self::new(credentials.clone());
        candidate.run(async {
            let mut session = candidate.connect().await?;
            session.logout().await.map_err(|_| MailError::Network)
        })?;
        if candidate
            .smtp()?
            .test_connection()
            .map_err(|_| MailError::Login)?
        {
            Ok(())
        } else {
            Err(MailError::Login)
        }
    }

    fn fetch_headers(&self, folder: &str, uids: &[u32]) -> Result<Vec<Header>, MailError> {
        if uids.is_empty() {
            return Ok(Vec::new());
        }
        mailbox(folder)?;
        self.with_session(true, |session| {
            let folder = folder.to_owned();
            let uids = uids.to_vec();
            Box::pin(async move {
                let _selected = session
                    .select(&folder)
                    .await
                    .map_err(|_| MailError::Protocol)?;
                let uid_strings: Vec<String> = uids.iter().map(ToString::to_string).collect();
                let query = format!(
                    "UID FETCH {} (UID FLAGS BODY.PEEK[HEADER] BODYSTRUCTURE)",
                    uid_strings.join(",")
                );
                let mut headers = Vec::new();
                for fetched in Self::fetch(session, &query).await? {
                    if let (Some(uid), Some(raw)) = (fetched.uid, fetched.raw) {
                        let flags = fetched.flags.ok_or(MailError::Protocol)?;
                        let unread = !flags.iter().any(|s| s.eq_ignore_ascii_case("\\Seen"));
                        let starred = flags.iter().any(|s| s.eq_ignore_ascii_case("\\Flagged"));
                        headers.push(parse_header(
                            uid,
                            &raw,
                            unread,
                            starred,
                            fetched.has_html,
                        )?);
                    }
                }
                Ok(headers)
            })
        })
    }

    fn list_uids_flags(&self, folder: &str) -> Result<UidFlagBatch, MailError> {
        mailbox(folder)?;
        self.with_session(true, |session| {
            let folder = folder.to_owned();
            Box::pin(async move {
                let selected = session
                    .select(&folder)
                    .await
                    .map_err(|_| MailError::Protocol)?;
                let uid_validity = selected.uid_validity.ok_or(MailError::Protocol)?;
                // Check if mailbox has messages at all.
                let exists = selected.exists;
                if exists == 0 {
                    return Ok(UidFlagBatch {
                        entries: Vec::new(),
                        uid_validity,
                    });
                }
                if folder == ALL_MAIL {
                    let flagged_uids = session
                        .uid_search("FLAGGED")
                        .await
                        .map_err(|_| MailError::Protocol)?;
                    if flagged_uids.is_empty() {
                        return Ok(UidFlagBatch {
                            entries: Vec::new(),
                            uid_validity,
                        });
                    }
                    let uid_strs: Vec<_> = flagged_uids.iter().map(ToString::to_string).collect();
                    let rows = Self::fetch(session, &format!("UID FETCH {} (UID FLAGS)", uid_strs.join(","))).await?;
                    let mut entries = Vec::new();
                    for row in rows {
                        if let (Some(uid), Some(flags)) = (row.uid, row.flags) {
                            entries.push(UidFlag {
                                uid,
                                unread: !flags.iter().any(|s| s.eq_ignore_ascii_case("\\Seen")),
                                starred: flags.iter().any(|s| s.eq_ignore_ascii_case("\\Flagged")),
                            });
                        }
                    }
                    return Ok(UidFlagBatch {
                        entries,
                        uid_validity,
                    });
                }
                let rows = Self::fetch(session, "UID FETCH 1:* (UID FLAGS)").await?;
                let mut entries = Vec::new();
                for row in rows {
                    if let (Some(uid), Some(flags)) = (row.uid, row.flags) {
                        entries.push(UidFlag {
                            uid,
                            unread: !flags.iter().any(|s| s.eq_ignore_ascii_case("\\Seen")),
                            starred: flags.iter().any(|s| s.eq_ignore_ascii_case("\\Flagged")),
                        });
                    }
                }
                Ok(UidFlagBatch {
                    entries,
                    uid_validity,
                })
            })
        })
    }

    fn fetch_body(&self, folder: &str, uid: u32, uid_validity: u32) -> Result<Vec<u8>, MailError> {
        mailbox(folder)?;
        self.with_session(true, |session| {
            let folder = folder.to_owned();
            Box::pin(async move {
                Self::select_mailbox(session, &folder, uid_validity).await?;
                let rows =
                    Self::fetch(session, &format!("UID FETCH {uid} (UID BODY.PEEK[])")).await?;
                let raw = rows
                    .into_iter()
                    .find(|row| row.uid == Some(uid) && row.raw.is_some())
                    .and_then(|row| row.raw)
                    .ok_or(MailError::Missing)?;
                Ok(raw)
            })
        })
    }

    fn fetch_body_and_mark_read(
        &self,
        folder: &str,
        uid: u32,
        uid_validity: u32,
    ) -> Result<Vec<u8>, MailError> {
        mailbox(folder)?;
        self.with_session(true, |session| {
            let folder = folder.to_owned();
            Box::pin(async move {
                Self::select_mailbox(session, &folder, uid_validity).await?;
                // BODY[] without PEEK sets \Seen on the server.
                let rows =
                    Self::fetch(session, &format!("UID FETCH {uid} (UID BODY[])")).await?;
                let raw = rows
                    .into_iter()
                    .find(|row| row.uid == Some(uid) && row.raw.is_some())
                    .and_then(|row| row.raw)
                    .ok_or(MailError::Missing)?;
                Ok(raw)
            })
        })
    }

    fn set_flag(
        &self,
        folder: &str,
        uid: u32,
        uid_validity: u32,
        flag: Flag,
        on: bool,
    ) -> Result<(), MailError> {
        mailbox(folder)?;
        self.with_session(true, |session| {
            let folder = folder.to_owned();
            Box::pin(async move {
                Self::select_mailbox(session, &folder, uid_validity).await?;
                session
                    .run_command_and_check_ok(format!(
                        "UID STORE {uid} {}FLAGS.SILENT ({})",
                        if on { "+" } else { "-" },
                        flag.imap()
                    ))
                    .await
                    .map_err(|_| MailError::Protocol)?;
                Ok(())
            })
        })
    }

    fn move_to(
        &self,
        folder: &str,
        uid: u32,
        uid_validity: u32,
        destination: &str,
    ) -> Result<(), MailError> {
        mailbox(folder)?;
        mailbox(destination)?;
        self.with_session(false, |session| {
            let folder = folder.to_owned();
            let destination = destination.to_owned();
            Box::pin(async move {
                Self::select_mailbox(session, &folder, uid_validity).await?;
                if folder == ALL_MAIL && destination == ALL_MAIL {
                    // Archiving from the Starred view removes only Gmail's Inbox label.
                    session
                        .run_command_and_check_ok(format!(
                            "UID STORE {uid} -X-GM-LABELS (\\Inbox)"
                        ))
                        .await
                        .map_err(|_| MailError::Protocol)?;
                } else {
                    session
                        .uid_mv(uid.to_string(), &destination)
                        .await
                        .map_err(|_| MailError::Protocol)?;
                }
                Ok(())
            })
        })
    }

    fn send(&self, raw: &[u8]) -> Result<(), MailError> {
        let message = MessageParser::default().parse(raw).ok_or(MailError::Send)?;
        let to = message
            .to()
            .ok_or(MailError::Send)?
            .iter()
            .map(|a| {
                a.address()
                    .ok_or(MailError::Send)?
                    .parse::<lettre::Address>()
                    .map_err(|_| MailError::Send)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let from = self
            .credentials
            .address
            .parse()
            .map_err(|_| MailError::Send)?;
        let envelope = Envelope::new(Some(from), to).map_err(|_| MailError::Send)?;
        self.smtp()?
            .send_raw(&envelope, raw)
            .map_err(|_| MailError::Send)?;
        Ok(())
    }
}
