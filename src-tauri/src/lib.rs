pub mod activities;
mod assistant;
mod agent_runner;
mod backup;
mod bills;
pub mod cli;
mod commands;
mod dashboard;
mod db;
pub mod downloads;
pub mod downloader;
mod error;
mod email;
pub mod files;
mod finance;
mod github;
mod gpu;
mod habits;
mod items;
pub mod journal;
pub mod keystore;
pub mod links;
pub mod notes;
pub mod search;
mod overview;
mod profile;
mod projects;
mod schedule;
pub mod security;
mod settings;
pub mod sync;
mod tasks;
mod time;

use tauri::Manager;

fn initial_locked(pin_status: Result<bool, error::AppError>) -> bool {
    pin_status.unwrap_or(true)
}

fn check_command_access(command: &str, locked: Option<bool>) -> Result<(), error::AppError> {
    match locked {
        Some(false) => Ok(()),
        Some(true) if security::is_allowed_while_locked(command) => Ok(()),
        _ => Err(error::AppError::Locked),
    }
}

pub fn wrap_invoke_handler<R: tauri::Runtime>(
    handler: impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke| {
        let cmd = invoke.message.command();
        let webview = invoke.message.webview();
        let locked = webview
            .app_handle()
            .try_state::<security::SecurityState>()
            .map(|sec| sec.is_locked());
        if let Err(error) = check_command_access(cmd, locked) {
            invoke.resolver.reject(error);
            return true;
        }
        handler(invoke)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must stay first: it may call set_var, which is only sound before other threads start.
    let gpu_node = gpu::apply_linux_workaround();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .filter(|metadata| email::allows_log_target(metadata.target()))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            if let Some(node) = &gpu_node {
                log::info!("NVIDIA workaround: WEBKIT_WEB_RENDER_DEVICE_FILE={node}");
            }
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut db = db::Db::open_at(data_dir.join("anchoa.db"));
            let locked = initial_locked(db.conn().and_then(|conn| security::has_pin(&conn)));
            match &db.open_error {
                Some(e) => log::error!("database open failed: {e}"),
                None => {
                    let result = backup::daily(
                        &*db.conn()?,
                        &data_dir.join("backups"),
                        &time::today_stamp(),
                    );
                    match result {
                        Ok(Some(path)) => log::info!("daily backup: {}", path.display()),
                        Ok(None) => {}
                        Err(e) => {
                            log::error!("daily backup failed: {e}");
                            db.backup_error = Some(e.to_string());
                        }
                    }
                    if let Ok(conn) = db.conn() {
                        let _ = downloads::mark_interrupted(&conn, time::now_ms());
                    }
                }
            }
            app.manage(security::SecurityState::new(locked));
            app.manage(db);
            app.manage(downloader::Downloader::default());
            app.manage(agent_runner::AgentRunner::default());
            app.manage(assistant::AssistantState::default());
            app.manage(email::EmailState::default());
            app.manage(assistant::voice::VoiceState::new(data_dir.clone()));
            let sync_server = sync::server::configured_server().unwrap_or_else(|e| {
                log::error!("sync disabled: {e}");
                None
            });
            #[cfg(debug_assertions)]
            let sync_keys = if std::env::var_os("ANCHOA_FAKE_SYNC").is_some() {
                keystore::KeyringStore::with_builder(Box::new(keystore::FileCredentialBuilder::new(
                    data_dir.join("fake_keyring.json"),
                )))
            } else {
                keystore::KeyringStore::default()
            };
            #[cfg(not(debug_assertions))]
            let sync_keys = keystore::KeyringStore::default();
            app.manage(sync::commands::SyncState::new(
                sync_server,
                sync_keys,
            ));
            sync::commands::spawn_scheduler(app.handle().clone());
            downloader::spawn_scheduler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(wrap_invoke_handler(tauri::generate_handler![
            email::commands::email_status,
            email::commands::email_connect,
            email::commands::email_disconnect,
            email::commands::email_sync,
            email::commands::email_list,
            email::commands::email_open,
            email::commands::email_set_flag,
            email::commands::email_archive,
            email::commands::email_send,
            assistant::email::email_assist,
            security::security_status,
            security::unlock,
            security::set_pin,
            security::disable_pin,
            assistant::assistant_send,
            assistant::assistant_stop,
            assistant::assistant_decide,
            assistant::assistant_pending,
            assistant::assistant_reset,
            assistant::ai_status,
            assistant::ai_roles,
            assistant::set_ai_role,
            assistant::voice::voice_status,
            assistant::voice::voice_install,
            assistant::voice::voice_record_start,
            assistant::voice::voice_record_stop,
            assistant::voice::voice_voices,
            assistant::voice::voice_import,
            assistant::voice::set_voice,
            assistant::voice::voice_speak,
            assistant::voice::voice_stop,
            commands::db_status,
            commands::capture_note,
            commands::open_item,
            commands::update_item,
            commands::delete_item,
            commands::projects_overview,
            commands::project_board,
            commands::save_project,
            commands::delete_project,
            commands::open_repo,
            commands::agent_request,
            commands::agent_stop,
            commands::agent_running,
            commands::agent_last_actors,
            commands::task_activities,
            commands::project_activities,
            commands::add_activity,
            commands::agent_log,
            commands::create_task,
            commands::get_task,
            commands::update_task,
            commands::delete_task,
            commands::convert_to_task,
            commands::list_inbox,
            commands::get_dashboard,
            commands::list_accounts,
            commands::save_account,
            commands::delete_account,
            commands::list_transactions,
            commands::save_transaction,
            commands::save_transfer,
            commands::delete_transaction,
            commands::finance_categories,
            commands::finance_overview,
            commands::set_budget,
            commands::list_bills,
            commands::save_bill,
            commands::pay_bill,
            commands::delete_bill,
            commands::github_status,
            commands::connect_github,
            commands::disconnect_github,
            commands::get_contributions,
            commands::backup_now,
            commands::data_overview,
            commands::check_update,
            commands::schedule,
            commands::get_profile,
            commands::set_profile_name,
            commands::get_notify_prefs,
            commands::set_notify_prefs,
            commands::habits_overview,
            commands::habit_history,
            commands::save_habit,
            commands::delete_habit,
            commands::check_habit,
            commands::journal_list,
            commands::journal_entry,
            commands::create_entry,
            commands::update_entry,
            commands::entry_to_task,
            commands::delete_entry,
            commands::restore_entry,
            commands::journal_side,
            commands::data_paths,
            commands::open_folder,
            commands::file_places,
            commands::list_dir,
            commands::read_text,
            commands::paste_items,
            commands::trash_items,
            commands::open_file,
            commands::downloads_list,
            commands::add_download,
            commands::pause_download,
            commands::resume_download,
            commands::retry_download,
            commands::remove_download,
            commands::open_download,
            commands::reveal_download,
            commands::download_engines,
            commands::download_settings,
            commands::save_download_settings,
            commands::install_native_host,
            commands::uninstall_native_host,
            commands::native_host_status,
            commands::save_browser_integration,
            commands::pages_tree,
            commands::create_page,
            commands::rename_page,
            commands::move_page,
            commands::save_page_body,
            commands::delete_page,
            commands::pages_trash,
            commands::restore_page,
            commands::page_backlinks,
            commands::resolve_link,
            commands::search_items,
            commands::export_pages,
            commands::open_link,
            sync::commands::sync_status,
            sync::commands::sync_sign_in,
            sync::commands::sync_cancel_sign_in,
            sync::commands::sync_create_key,
            sync::commands::sync_unlock_key,
            sync::commands::sync_change_passphrase,
            sync::commands::sync_now,
            sync::commands::sync_sign_out,
        ]))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(focused) = event
                && let Some(sync) = window.app_handle().try_state::<sync::commands::SyncState>()
            {
                sync.set_focused(*focused);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<downloader::Downloader>().stop_all();
                app.state::<agent_runner::AgentRunner>().stop_all();
                app.state::<assistant::voice::VoiceState>().stop_all();
                if let Some(db) = app.try_state::<db::Db>() {
                    if let Ok(conn) = db.conn() {
                        let _ = downloads::mark_interrupted(&conn, time::now_ms());
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use error::AppError;

    #[test]
    fn startup_locks_when_pin_status_is_unavailable() {
        assert!(!initial_locked(Ok(false)));
        assert!(initial_locked(Ok(true)));
        assert!(initial_locked(Err(AppError::DbUnavailable)));
        assert!(initial_locked(Err(AppError::Db(
            rusqlite::Error::InvalidQuery
        ))));
    }

    #[test]
    fn invoke_guard_fails_closed_without_security_state() {
        for command in [
            "get_dashboard",
            "set_pin",
            "disable_pin",
            "unlock",
            "security_status",
            "app_status",
            "db_status",
        ] {
            assert!(matches!(
                check_command_access(command, None),
                Err(AppError::Locked)
            ));
            assert!(check_command_access(command, Some(false)).is_ok());
            if security::is_allowed_while_locked(command) {
                assert!(check_command_access(command, Some(true)).is_ok());
            } else {
                assert!(matches!(
                    check_command_access(command, Some(true)),
                    Err(AppError::Locked)
                ));
            }
        }
    }

    #[test]
    fn invoke_guard_serializes_the_locked_app_error() {
        let error = check_command_access("get_dashboard", Some(true)).unwrap_err();
        let rejected = tauri::ipc::InvokeError::from(error);
        assert_eq!(
            rejected.0,
            serde_json::json!({
                "code": "locked",
                "message": "Anchoa terkunci",
            })
        );
    }

    #[test]
    fn every_registered_command_obeys_the_lock_guard() {
        // Read the actual registration so adding a command cannot silently escape this check.
        let source = include_str!("lib.rs");
        let registered = source.split("tauri::generate_handler![").nth(1).unwrap()
            .split("]))").next().unwrap();
        let allowed = ["security_status", "unlock", "db_status"];
        let commands: Vec<&str> = registered.split(',').map(str::trim)
            .filter(|command| !command.is_empty())
            .map(|command| command.rsplit("::").next().unwrap()).collect();
        assert!(commands.len() > 100);
        for command in commands {
            assert!(check_command_access(command, Some(false)).is_ok(), "{command}");
            assert!(matches!(check_command_access(command, None), Err(AppError::Locked)), "{command}");
            assert_eq!(check_command_access(command, Some(true)).is_ok(), allowed.contains(&command), "{command}");
        }
    }

    #[test]
    fn lock_allowlist_requires_exact_command_names() {
        for command in ["security_status", "unlock", "app_status", "db_status"] {
            assert!(check_command_access(command, Some(true)).is_ok());
            for altered in [format!(" {command}"), format!("{command} "), command.to_uppercase(), format!("plugin:security|{command}")] {
                assert!(matches!(check_command_access(&altered, Some(true)), Err(AppError::Locked)), "{altered}");
            }
        }
        for command in ["", "plugin:dialog|open", "plugin:opener|open_url", "plugin:fs|read_file", "unknown"] {
            assert!(matches!(check_command_access(command, Some(true)), Err(AppError::Locked)), "{command}");
        }
    }
}
