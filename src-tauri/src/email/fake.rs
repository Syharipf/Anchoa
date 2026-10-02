//! In-memory mailbox; compiled only for tests and debug builds.
use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, MutexGuard};
use std::sync::atomic::{AtomicUsize, Ordering};

use super::{
    ALL_MAIL, Flag, INBOX, SENT,
    account::Credentials,
    client::{Header, MailClient, MailError, UidFlag, UidFlagBatch, parse_header},
};

#[derive(Clone)]
struct Message {
    header: Header,
    raw: Vec<u8>,
}

impl Message {
    fn same_message(&self, other: &Self) -> bool {
        self.header.message_id.is_some()
            && self.header.message_id == other.header.message_id
            && self.header.from_addr == other.header.from_addr
            && self.header.sent_at == other.header.sent_at
    }
}

#[derive(Default)]
struct Data {
    messages: HashMap<String, BTreeMap<u32, Message>>,
    validity: HashMap<String, u32>,
    reject_login: bool,
    sent: Vec<Vec<u8>>,
    body_fetches: usize,
    #[cfg(test)]
    hook: Option<std::sync::Arc<dyn Fn() + Send + Sync>>,
}

impl Data {
    fn check_uid_validity(&self, folder: &str, uid_validity: u32) -> Result<(), MailError> {
        if self.validity.get(folder).copied().unwrap_or(1) != uid_validity {
            return Err(MailError::Missing);
        }
        Ok(())
    }
}

pub struct FakeMailClient {
    data: Mutex<Data>,
    /// Counts of login calls for retry testing.
    pub login_count: AtomicUsize,
    /// Counts of fetched headers.
    pub fetched_headers_count: AtomicUsize,
    /// Counts of set_flag calls.
    pub set_flag_count: AtomicUsize,
    /// Counts of fetch_body calls (PEEK, no mark read).
    pub fetch_body_peek_count: AtomicUsize,
    /// Counts of fetch_body_and_mark_read calls (non-PEEK).
    pub fetch_body_mark_read_count: AtomicUsize,
    /// Flag indicating whether the simulated session was dropped.
    pub session_dropped: std::sync::atomic::AtomicBool,
}

impl Default for FakeMailClient {
    fn default() -> Self {
        let client = Self::empty();
        let raw = "From: Siti <siti@example.com>\r\nTo: anchoa@gmail.com\r\nSubject: Selamat datang di Email Anchoa\r\nDate: Fri, 02 Oct 2026 09:00:00 +0700\r\nMessage-ID: <welcome@anchoa.local>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHalo! Ini email contoh. Terima kasih sudah mencoba Anchoa.";
        if let Ok(header) = parse_header(1, raw.as_bytes(), true, false, false) {
            let _ = client.insert(INBOX, header, raw.as_bytes().to_vec());
        }
        client
    }
}

/// Test helper result: what the fake server holds for a folder.
#[cfg(test)]
pub struct ServerFolder {
    pub headers: Vec<Header>,
}

impl FakeMailClient {
    /// Test helper: the server-side view of a folder.
    #[cfg(test)]
    pub fn list_headers(&self, folder: &str, limit: usize) -> Result<ServerFolder, MailError> {
        self.call()?;
        let data = self.data()?;
        let headers: Vec<_> = data
            .messages
            .get(folder)
            .into_iter()
            .flat_map(|m| m.values().rev())
            .filter(|m| folder != ALL_MAIL || m.header.starred)
            .map(|m| m.header.clone())
            .collect();
        Ok(ServerFolder { headers: headers.into_iter().take(limit).collect() })
    }

    pub fn empty() -> Self {
        Self {
            data: Mutex::new(Data::default()),
            login_count: AtomicUsize::new(0),
            fetched_headers_count: AtomicUsize::new(0),
            set_flag_count: AtomicUsize::new(0),
            fetch_body_peek_count: AtomicUsize::new(0),
            fetch_body_mark_read_count: AtomicUsize::new(0),
            session_dropped: std::sync::atomic::AtomicBool::new(false),
        }
    }
    fn data(&self) -> Result<MutexGuard<'_, Data>, MailError> {
        self.data.lock().map_err(|_| MailError::Protocol)
    }
    #[cfg(test)]
    pub fn drop_session(&self) {
        self.session_dropped.store(true, Ordering::SeqCst);
    }

    fn call(&self) -> Result<(), MailError> {
        #[cfg(test)]
        {
            let hook = self.data()?.hook.clone();
            if let Some(hook) = hook {
                hook();
            }
        }
        if self.session_dropped.swap(false, Ordering::SeqCst) {
            self.login_count.fetch_add(1, Ordering::SeqCst);
        }
        Ok(())
    }

    pub fn insert(&self, folder: &str, header: Header, raw: Vec<u8>) -> Result<(), MailError> {
        let mut data = self.data()?;
        let message = Message { header, raw };
        data.messages
            .entry(folder.into())
            .or_default()
            .insert(message.header.uid, message.clone());
        if folder == INBOX {
            data.messages
                .entry(ALL_MAIL.into())
                .or_default()
                .insert(message.header.uid, message);
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn reject_login(&self, reject: bool) -> Result<(), MailError> {
        self.data()?.reject_login = reject;
        Ok(())
    }
    #[cfg(test)]
    pub fn remove(&self, folder: &str, uid: u32) -> Result<(), MailError> {
        self.data()?
            .messages
            .entry(folder.into())
            .or_default()
            .remove(&uid);
        Ok(())
    }
    #[cfg(test)]
    pub fn reset_mailbox(&self, folder: &str, validity: u32) -> Result<(), MailError> {
        let mut data = self.data()?;
        data.messages.remove(folder);
        data.validity.insert(folder.into(), validity);
        Ok(())
    }
    #[cfg(test)]
    pub fn body_fetches(&self) -> Result<usize, MailError> {
        Ok(self.data()?.body_fetches)
    }
    #[cfg(test)]
    pub fn sent(&self) -> Result<Vec<Vec<u8>>, MailError> {
        Ok(self.data()?.sent.clone())
    }
    #[cfg(test)]
    pub fn set_hook(&self, hook: std::sync::Arc<dyn Fn() + Send + Sync>) -> Result<(), MailError> {
        self.data()?.hook = Some(hook);
        Ok(())
    }
}

impl MailClient for FakeMailClient {
    fn login(&self, _credentials: &Credentials) -> Result<(), MailError> {
        self.login_count.fetch_add(1, Ordering::SeqCst);
        self.call()?;
        if self.data()?.reject_login {
            Err(MailError::Login)
        } else {
            Ok(())
        }
    }

    fn fetch_headers(&self, folder: &str, uids: &[u32]) -> Result<Vec<Header>, MailError> {
        self.call()?;
        let data = self.data()?;
        let mut headers = Vec::new();
        if let Some(folder_msgs) = data.messages.get(folder) {
            for uid in uids {
                if let Some(m) = folder_msgs.get(uid)
                    && (folder != ALL_MAIL || m.header.starred)
                {
                    headers.push(m.header.clone());
                }
            }
        }
        self.fetched_headers_count.fetch_add(headers.len(), Ordering::SeqCst);
        Ok(headers)
    }

    fn list_uids_flags(&self, folder: &str) -> Result<UidFlagBatch, MailError> {
        self.call()?;
        let data = self.data()?;
        let entries: Vec<_> = data
            .messages
            .get(folder)
            .into_iter()
            .flat_map(|m| m.values())
            .filter(|m| folder != ALL_MAIL || m.header.starred)
            .map(|m| UidFlag {
                uid: m.header.uid,
                unread: m.header.unread,
                starred: m.header.starred,
            })
            .collect();
        Ok(UidFlagBatch {
            entries,
            uid_validity: data.validity.get(folder).copied().unwrap_or(1),
        })
    }

    fn fetch_body(&self, folder: &str, uid: u32, uid_validity: u32) -> Result<Vec<u8>, MailError> {
        self.fetch_body_peek_count.fetch_add(1, Ordering::SeqCst);
        self.call()?;
        let mut data = self.data()?;
        data.check_uid_validity(folder, uid_validity)?;
        let raw = data
            .messages
            .get(folder)
            .and_then(|m| m.get(&uid))
            .ok_or(MailError::Missing)?
            .raw
            .clone();
        data.body_fetches += 1;
        Ok(raw)
    }

    fn fetch_body_and_mark_read(
        &self,
        folder: &str,
        uid: u32,
        uid_validity: u32,
    ) -> Result<Vec<u8>, MailError> {
        self.fetch_body_mark_read_count.fetch_add(1, Ordering::SeqCst);
        self.call()?;
        let mut data = self.data()?;
        data.check_uid_validity(folder, uid_validity)?;
        let selected = data
            .messages
            .get(folder)
            .and_then(|m| m.get(&uid))
            .ok_or(MailError::Missing)?
            .clone();
        let raw = selected.raw.clone();
        // Mark as read (non-PEEK sets \Seen)
        for messages in data.messages.values_mut() {
            for message in messages.values_mut() {
                if message.same_message(&selected) || (message.header.uid == uid) {
                    message.header.unread = false;
                }
            }
        }
        data.body_fetches += 1;
        Ok(raw)
    }

    fn set_flag(
        &self,
        folder: &str,
        uid: u32,
        uid_validity: u32,
        flag: Flag,
        on: bool,
    ) -> Result<(), MailError> {
        self.set_flag_count.fetch_add(1, Ordering::SeqCst);
        self.call()?;
        let mut data = self.data()?;
        data.check_uid_validity(folder, uid_validity)?;
        let selected = data
            .messages
            .get(folder)
            .and_then(|m| m.get(&uid))
            .ok_or(MailError::Missing)?
            .clone();
        for (mailbox, messages) in &mut data.messages {
            for (message_uid, message) in messages {
                if (mailbox == folder && *message_uid == uid) || message.same_message(&selected) {
                    match flag {
                        Flag::Seen => message.header.unread = !on,
                        Flag::Starred => message.header.starred = on,
                    }
                }
            }
        }
        Ok(())
    }

    fn move_to(
        &self,
        folder: &str,
        uid: u32,
        uid_validity: u32,
        destination: &str,
    ) -> Result<(), MailError> {
        self.call()?;
        let mut data = self.data()?;
        data.check_uid_validity(folder, uid_validity)?;
        if folder == destination {
            let message = data
                .messages
                .get(folder)
                .and_then(|m| m.get(&uid))
                .ok_or(MailError::Missing)?
                .clone();
            if folder == ALL_MAIL
                && let Some(inbox) = data.messages.get_mut(INBOX)
            {
                inbox.retain(|_, m| {
                    if message.header.message_id.is_some() {
                        !m.same_message(&message)
                    } else {
                        m.raw != message.raw
                    }
                });
            }
            return Ok(());
        }
        let mut message = data
            .messages
            .get_mut(folder)
            .and_then(|m| m.remove(&uid))
            .ok_or(MailError::Missing)?;
        let dest = data.messages.entry(destination.into()).or_default();
        if dest.values().any(|m| m.same_message(&message)) {
            return Ok(());
        }
        let next_uid = dest
            .keys()
            .next_back()
            .copied()
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(MailError::Protocol)?;
        message.header.uid = next_uid;
        dest.insert(next_uid, message);
        Ok(())
    }

    fn send(&self, raw: &[u8]) -> Result<(), MailError> {
        self.call()?;
        let mut data = self.data()?;
        let sent = data.messages.entry(SENT.into()).or_default();
        let uid = sent
            .keys()
            .next_back()
            .copied()
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(MailError::Protocol)?;
        let header = parse_header(uid, raw, false, false, false)?;
        sent.insert(
            uid,
            Message {
                header,
                raw: raw.to_vec(),
            },
        );
        data.sent.push(raw.to_vec());
        Ok(())
    }
}
