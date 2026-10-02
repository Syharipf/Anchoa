pub mod account;
pub mod actions;
pub mod body;
pub mod client;
pub mod commands;
#[cfg(any(test, debug_assertions))]
pub mod fake;
pub mod send;
pub mod sync;

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use crate::{db::Db, error::AppError};

pub const INBOX: &str = "INBOX";
pub const SENT: &str = "[Gmail]/Sent Mail";
pub const ALL_MAIL: &str = "[Gmail]/All Mail";
pub const HEADER_LIMIT: usize = 200;

pub fn allows_log_target(target: &str) -> bool {
    // IMAP traces raw LOGIN commands; keyring's mock Debug includes the secret.
    !["async_imap", "lettre", "keyring", "secret_service"]
        .iter()
        .any(|name| {
            target == *name
                || target
                    .strip_prefix(name)
                    .is_some_and(|tail| tail.starts_with("::"))
        })
}

use std::sync::Arc;

pub struct EmailState {
    operation: Mutex<()>,
    keys: account::KeyringStore,
    #[cfg(debug_assertions)]
    fake: Option<Arc<fake::FakeMailClient>>,
    client: Mutex<Option<(String, Arc<client::GmailClient>)>>,
}

impl Default for EmailState {
    fn default() -> Self {
        #[cfg(debug_assertions)]
        if std::env::var("ANCHOA_FAKE_MAIL").is_ok_and(|value| value == "1") {
            return Self {
                operation: Mutex::new(()),
                keys: account::KeyringStore::with_builder(
                    keyring::mock::default_credential_builder(),
                ),
                fake: Some(Arc::new(fake::FakeMailClient::default())),
                client: Mutex::new(None),
            };
        }
        Self {
            operation: Mutex::new(()),
            keys: account::KeyringStore::default(),
            #[cfg(debug_assertions)]
            fake: None,
            client: Mutex::new(None),
        }
    }
}

impl EmailState {
    pub fn get_client(&self, credentials: account::Credentials) -> Arc<dyn client::MailClient> {
        #[cfg(debug_assertions)]
        if let Some(fake) = &self.fake {
            return fake.clone();
        }
        let mut guard = self.client.lock().unwrap();
        if let Some((addr, client)) = guard.as_ref()
            && addr == &credentials.address
        {
            return client.clone();
        }
        let addr = credentials.address.clone();
        let client = Arc::new(client::GmailClient::new(credentials));
        *guard = Some((addr, client.clone()));
        client
    }

    pub fn clear_client(&self) {
        if let Ok(mut guard) = self.client.lock() {
            *guard = None;
        }
    }

    fn with_client<T>(
        &self,
        credentials: account::Credentials,
        action: impl FnOnce(&dyn client::MailClient) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let client = self.get_client(credentials);
        action(&*client)
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Folder {
    Inbox,
    Starred,
    Sent,
}

impl Folder {
    pub fn mailbox(self) -> &'static str {
        match self {
            Self::Inbox => INBOX,
            Self::Starred => ALL_MAIL,
            Self::Sent => SENT,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Filter {
    All,
    Unread,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Flag {
    Seen,
    Starred,
}

impl Flag {
    pub fn imap(self) -> &'static str {
        match self {
            Self::Seen => "\\Seen",
            Self::Starred => "\\Flagged",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Email {
    pub id: String,
    pub folder: String,
    pub uid: u32,
    pub subject: String,
    pub body: String,
    pub message_id: Option<String>,
    pub from_name: String,
    pub from_addr: String,
    pub to_addrs: Vec<String>,
    pub sent_at: i64,
    pub unread: bool,
    pub starred: bool,
    pub has_html: bool,
    pub body_cached: bool,
    #[serde(skip)]
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub to: Vec<String>,
    pub subject: String,
    pub body: String,
    pub reply_to_id: Option<String>,
}

const COLUMNS: &str = "i.id, e.folder, e.uid, i.title, i.body, e.message_id, e.from_name, e.from_addr, e.to_addrs, e.sent_at, e.unread, e.starred, e.has_html, e.body_cached, e.refs";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Email> {
    fn strings(row: &Row<'_>, index: usize) -> rusqlite::Result<Vec<String>> {
        let value: String = row.get(index)?;
        serde_json::from_str(&value).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(
                index,
                rusqlite::types::Type::Text,
                Box::new(e),
            )
        })
    }
    Ok(Email {
        id: row.get(0)?,
        folder: row.get(1)?,
        uid: row.get(2)?,
        subject: row.get(3)?,
        body: row.get(4)?,
        message_id: row.get(5)?,
        from_name: row.get(6)?,
        from_addr: row.get(7)?,
        to_addrs: strings(row, 8)?,
        sent_at: row.get(9)?,
        unread: row.get(10)?,
        starred: row.get(11)?,
        has_html: row.get(12)?,
        body_cached: row.get(13)?,
        refs: strings(row, 14)?,
    })
}

pub fn get(conn: &Connection, id: &str) -> Result<Email, AppError> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM emails e JOIN items i ON i.id = e.item_id WHERE i.id = ?1 AND i.type = 'email' AND i.deleted_at IS NULL"), [id], from_row).optional()?.ok_or(AppError::NotFound)
}

pub fn list(db: &Db, folder: Folder, filter: Filter, limit: usize) -> Result<Vec<Email>, AppError> {
    let conn = db.conn()?;
    let query = match folder {
        Folder::Starred => format!(
            "WITH starred AS (
                SELECT e.item_id, ROW_NUMBER() OVER (
                    PARTITION BY e.message_id, e.from_addr, e.sent_at,
                        CASE WHEN e.message_id IS NULL THEN e.item_id END
                    ORDER BY CASE e.folder WHEN '{INBOX}' THEN 0 WHEN '{SENT}' THEN 1
                        WHEN ?1 THEN 2 ELSE 3 END, e.uid DESC
                ) AS rank
                FROM emails e JOIN items i ON i.id = e.item_id
                WHERE i.type = 'email' AND i.deleted_at IS NULL AND e.starred = 1
            )
            SELECT {COLUMNS} FROM emails e JOIN items i ON i.id = e.item_id
            JOIN starred s ON s.item_id = e.item_id
            WHERE s.rank = 1 AND (?2 = 0 OR e.unread = 1)
            ORDER BY e.sent_at DESC, e.uid DESC LIMIT ?3"
        ),
        _ => format!(
            "SELECT {COLUMNS} FROM emails e JOIN items i ON i.id = e.item_id WHERE i.type = 'email' AND i.deleted_at IS NULL AND e.folder = ?1 AND (?2 = 0 OR e.unread = 1) ORDER BY e.sent_at DESC, e.uid DESC LIMIT ?3"
        ),
    };
    let mut stmt = conn.prepare(&query)?;
    Ok(stmt
        .query_map(
            params![
                folder.mailbox(),
                matches!(filter, Filter::Unread),
                limit.min(HEADER_LIMIT) as i64
            ],
            from_row,
        )?
        .collect::<Result<_, _>>()?)
}

#[cfg(test)]
mod tests;
