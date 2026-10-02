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

pub struct HeaderBatch {
    pub headers: Vec<Header>,
    // Full search result, so falling outside the 200-header window isn't deletion.
    pub all_uids: Vec<u32>,
    pub uid_validity: u32,
}

pub trait MailClient: Send + Sync {
    fn login(&self, credentials: &Credentials) -> Result<(), MailError>;
    fn list_headers(&self, folder: &str, limit: usize) -> Result<HeaderBatch, MailError>;
    fn fetch_body(&self, folder: &str, uid: u32) -> Result<Vec<u8>, MailError>;
    fn set_flag(&self, folder: &str, uid: u32, flag: Flag, on: bool) -> Result<(), MailError>;
    fn move_to(&self, folder: &str, uid: u32, destination: &str) -> Result<(), MailError>;
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
        Self { credentials }
    }

    fn run<T>(
        &self,
        operation: impl Future<Output = Result<T, MailError>>,
    ) -> Result<T, MailError> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| MailError::Network)?;
        runtime.block_on(async {
            tokio::time::timeout(TIMEOUT, operation)
                .await
                .map_err(|_| MailError::Network)?
        })
    }

    async fn session(&self) -> Result<Session, MailError> {
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
    fn login(&self, credentials: &Credentials) -> Result<(), MailError> {
        let candidate = Self::new(credentials.clone());
        candidate.run(async {
            let mut session = candidate.session().await?;
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

    fn list_headers(&self, folder: &str, limit: usize) -> Result<HeaderBatch, MailError> {
        mailbox(folder)?;
        self.run(async {
            let mut session = self.session().await?;
            let selected = session
                .select(folder)
                .await
                .map_err(|_| MailError::Protocol)?;
            let uid_validity = selected.uid_validity.ok_or(MailError::Protocol)?;
            let mut all_uids: Vec<_> = session
                .uid_search(if folder == ALL_MAIL { "FLAGGED" } else { "ALL" })
                .await
                .map_err(|_| MailError::Protocol)?
                .into_iter()
                .collect();
            all_uids.sort_unstable_by(|a, b| b.cmp(a));
            let selected: Vec<_> = all_uids
                .iter()
                .take(limit.min(super::HEADER_LIMIT))
                .map(u32::to_string)
                .collect();
            let mut headers = Vec::new();
            if !selected.is_empty() {
                let query = format!(
                    "UID FETCH {} (UID FLAGS BODY.PEEK[HEADER] BODYSTRUCTURE)",
                    selected.join(",")
                );
                for fetched in Self::fetch(&mut session, &query).await? {
                    // Unsolicited flag-only responses are not header results.
                    if let (Some(uid), Some(raw)) = (fetched.uid, fetched.raw) {
                        let flags = fetched.flags.ok_or(MailError::Protocol)?;
                        let unread = !flags.iter().any(|s| s.eq_ignore_ascii_case("\\Seen"));
                        let starred = flags.iter().any(|s| s.eq_ignore_ascii_case("\\Flagged"));
                        headers.push(parse_header(uid, &raw, unread, starred, fetched.has_html)?);
                    }
                }
            }
            session.logout().await.map_err(|_| MailError::Network)?;
            Ok(HeaderBatch {
                headers,
                all_uids,
                uid_validity,
            })
        })
    }

    fn fetch_body(&self, folder: &str, uid: u32) -> Result<Vec<u8>, MailError> {
        mailbox(folder)?;
        self.run(async {
            let mut session = self.session().await?;
            session
                .select(folder)
                .await
                .map_err(|_| MailError::Protocol)?;
            let rows =
                Self::fetch(&mut session, &format!("UID FETCH {uid} (UID BODY.PEEK[])")).await?;
            let raw = rows
                .into_iter()
                .find(|row| row.uid == Some(uid) && row.raw.is_some())
                .and_then(|row| row.raw)
                .ok_or(MailError::Missing)?;
            session.logout().await.map_err(|_| MailError::Network)?;
            Ok(raw)
        })
    }

    fn set_flag(&self, folder: &str, uid: u32, flag: Flag, on: bool) -> Result<(), MailError> {
        mailbox(folder)?;
        self.run(async {
            let mut session = self.session().await?;
            session
                .select(folder)
                .await
                .map_err(|_| MailError::Protocol)?;
            session
                .run_command_and_check_ok(format!(
                    "UID STORE {uid} {}FLAGS.SILENT ({})",
                    if on { "+" } else { "-" },
                    flag.imap()
                ))
                .await
                .map_err(|_| MailError::Protocol)?;
            session.logout().await.map_err(|_| MailError::Network)
        })
    }

    fn move_to(&self, folder: &str, uid: u32, destination: &str) -> Result<(), MailError> {
        mailbox(folder)?;
        mailbox(destination)?;
        self.run(async {
            let mut session = self.session().await?;
            session
                .select(folder)
                .await
                .map_err(|_| MailError::Protocol)?;
            if folder == ALL_MAIL && destination == ALL_MAIL {
                // Archiving from the Starred view removes only Gmail's Inbox label.
                session
                    .run_command_and_check_ok(format!("UID STORE {uid} -X-GM-LABELS (\\Inbox)"))
                    .await
                    .map_err(|_| MailError::Protocol)?;
            } else {
                session
                    .uid_mv(uid.to_string(), destination)
                    .await
                    .map_err(|_| MailError::Protocol)?;
            }
            session.logout().await.map_err(|_| MailError::Network)
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
