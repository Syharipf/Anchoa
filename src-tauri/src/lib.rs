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
pub mod files;
mod finance;
mod github;
mod gpu;
mod habits;
mod items;
pub mod journal;
pub mod links;
pub mod notes;
pub mod search;
mod overview;
mod profile;
mod projects;
mod schedule;
pub mod security;
mod settings;
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
                        let _ = downloads::pause_interrupted(&conn);
                    }
                }
            }
            app.manage(security::SecurityState::new(locked));
            app.manage(db);
            app.manage(downloader::Downloader::default());
            app.manage(agent_runner::AgentRunner::default());
            app.manage(assistant::AssistantState::default());
            app.manage(assistant::voice::VoiceState::new(data_dir));
            Ok(())
        })
        .invoke_handler(wrap_invoke_handler(tauri::generate_handler![
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
        ]))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<downloader::Downloader>().stop_all();
                app.state::<agent_runner::AgentRunner>().stop_all();
                app.state::<assistant::voice::VoiceState>().stop_all();
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
}
