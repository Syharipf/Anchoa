use lettre::{
    Message,
    message::{Mailbox, header::ContentType},
};

use super::{Draft, client::MailClient, get};
use crate::{db::Db, error::AppError};

fn invalid() -> AppError {
    AppError::Invalid("Alamat tujuan atau header email tidak valid".into())
}

fn message_id(value: &str) -> Result<String, AppError> {
    if value.is_empty()
        || !value.contains('@')
        || value
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || matches!(c, '<' | '>'))
    {
        return Err(invalid());
    }
    Ok(format!("<{value}>"))
}

pub fn send(
    db: &Db,
    client: &dyn MailClient,
    address: &str,
    draft: &Draft,
) -> Result<(), AppError> {
    if draft.to.is_empty()
        || draft
            .subject
            .chars()
            .any(|c| matches!(c, '\r' | '\n' | '\0'))
    {
        return Err(invalid());
    }
    if draft.body.trim().is_empty() {
        return Err(AppError::Empty);
    }
    let from = address.parse::<lettre::Address>().map_err(|_| invalid())?;
    let mut builder = Message::builder()
        .from(Mailbox::new(None, from))
        .subject(&draft.subject)
        .header(ContentType::TEXT_PLAIN);
    for recipient in &draft.to {
        if recipient.chars().any(char::is_control) {
            return Err(invalid());
        }
        builder = builder.to(recipient.parse::<Mailbox>().map_err(|_| invalid())?);
    }
    if let Some(id) = &draft.reply_to_id {
        let original = get(&*db.conn()?, id)?;
        if let Some(parent) = original.message_id {
            let parent = message_id(&parent)?;
            let mut refs = original
                .refs
                .iter()
                .map(|r| message_id(r))
                .collect::<Result<Vec<_>, _>>()?;
            if refs.last() != Some(&parent) {
                refs.push(parent.clone());
            }
            builder = builder.in_reply_to(parent).references(refs.join(" "));
        }
    }
    let raw = builder
        .body(draft.body.clone())
        .map_err(|_| invalid())?
        .formatted();
    client.send(&raw)?;
    Ok(())
}
