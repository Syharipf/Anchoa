use tauri::{AppHandle, Manager};

use super::{Draft, Email, EmailState, Filter, Flag, Folder, account, actions, list, send, sync};
use crate::{db::Db, error::AppError};

// Serialize account changes and mail operations, without holding the DB mutex.
// Network and Secret Service work run on Tauri's blocking pool.
async fn run<T: Send + 'static>(
    app: AppHandle,
    action: impl FnOnce(&Db, &EmailState) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app
            .try_state::<EmailState>()
            .ok_or_else(|| AppError::Other("Layanan email tidak tersedia".into()))?;
        let db = app.try_state::<Db>().ok_or(AppError::DbUnavailable)?;
        let _operation = state
            .operation
            .lock()
            .map_err(|_| AppError::Other("Layanan email tidak tersedia".into()))?;
        action(&db, &state)
    })
    .await
    .map_err(|_| AppError::Other("Operasi email tidak dapat diselesaikan".into()))?
}

#[tauri::command]
pub async fn email_status(app: AppHandle) -> Result<account::Status, AppError> {
    run(app, |db, _| account::status(db)).await
}

#[tauri::command]
pub async fn email_connect(
    app: AppHandle,
    address: String,
    app_password: String,
) -> Result<account::Status, AppError> {
    run(app, move |db, state| {
        state.clear_client();
        let credentials = account::Credentials::new(&address, &app_password)?;
        state.with_client(credentials, |client| {
            account::connect(db, &state.keys, &address, &app_password, client)
        })
    })
    .await
}

#[tauri::command]
pub async fn email_disconnect(app: AppHandle) -> Result<(), AppError> {
    run(app, |db, state| {
        state.clear_client();
        account::disconnect(db, &state.keys)
    })
    .await
}

#[tauri::command]
pub async fn email_sync(app: AppHandle) -> Result<sync::SyncResult, AppError> {
    let (result, client) = run(app.clone(), |db, state| {
        let credentials = account::credentials(db, &state.keys)?;
        let client = state.get_client(credentials);
        let res = sync::sync(db, &*client)?;
        Ok((res, client))
    })
    .await?;

    let app_bg = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(db) = app_bg.try_state::<Db>() else { return };
        sync::prefetch(&db, &*client, 20);
    });

    Ok(result)
}

#[tauri::command]
pub async fn email_list(
    app: AppHandle,
    folder: Folder,
    filter: Option<Filter>,
    limit: Option<usize>,
) -> Result<Vec<Email>, AppError> {
    run(app, move |db, _| {
        list(
            db,
            folder,
            filter.unwrap_or(Filter::All),
            limit.unwrap_or(super::HEADER_LIMIT),
        )
    })
    .await
}

#[tauri::command]
pub async fn email_open(app: AppHandle, id: String) -> Result<Email, AppError> {
    let (email, bg_seen) = run(app.clone(), {
        let id = id.clone();
        move |db, state| {
            let (orig, uid_validity) = actions::get_with_uid_validity(db, &id)?;
            let was_cached = orig.body_cached;
            let was_unread = orig.unread;
            let folder = orig.folder.clone();
            let uid = orig.uid;

            let credentials = account::credentials(db, &state.keys)?;
            let client = state.get_client(credentials);
            let opened = actions::open(db, &*client, &id)?;
            let bg_seen = if was_cached && was_unread {
                Some((client, folder, uid, uid_validity))
            } else {
                None
            };
            Ok((opened, bg_seen))
        }
    })
    .await?;

    if let Some((client, folder, uid, uid_validity)) = bg_seen {
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(e) = client.set_flag(&folder, uid, uid_validity, Flag::Seen, true) {
                log::warn!("Background set_flag Seen UID {uid} gagal: {e}");
            }
        });
    }

    Ok(email)
}

#[tauri::command]
pub async fn email_set_flag(
    app: AppHandle,
    id: String,
    flag: Flag,
    on: bool,
) -> Result<(), AppError> {
    run(app, move |db, state| {
        state.with_client(account::credentials(db, &state.keys)?, |client| {
            actions::set_flag(db, client, &id, flag, on)
        })
    })
    .await
}

#[tauri::command]
pub async fn email_archive(app: AppHandle, id: String) -> Result<(), AppError> {
    run(app, move |db, state| {
        state.with_client(account::credentials(db, &state.keys)?, |client| {
            actions::archive(db, client, &id)
        })
    })
    .await
}

#[tauri::command]
pub async fn email_send(app: AppHandle, draft: Draft) -> Result<(), AppError> {
    run(app, move |db, state| {
        let credentials = account::credentials(db, &state.keys)?;
        let address = credentials.address.clone();
        state.with_client(credentials, |client| {
            send::send(db, client, &address, &draft)
        })
    })
    .await
}
