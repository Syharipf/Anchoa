mod backup;
mod bills;
mod commands;
mod dashboard;
mod db;
mod error;
mod finance;
mod github;
mod gpu;
mod habits;
mod items;
pub mod journal;
mod overview;
mod projects;
mod schedule;
mod tasks;
mod time;

use tauri::Manager;

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
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            if let Some(node) = &gpu_node {
                log::info!("NVIDIA workaround: WEBKIT_WEB_RENDER_DEVICE_FILE={node}");
            }
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut db = db::Db::open_at(data_dir.join("anchoa.db"));
            match &db.open_error {
                Some(e) => log::error!("database open failed: {e}"),
                None => {
                    let result = backup::daily(&*db.conn()?, &data_dir.join("backups"), &time::today_stamp());
                    match result {
                        Ok(Some(path)) => log::info!("daily backup: {}", path.display()),
                        Ok(None) => {}
                        Err(e) => {
                            log::error!("daily backup failed: {e}");
                            db.backup_error = Some(e.to_string());
                        }
                    }
                }
            }
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            commands::schedule,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
