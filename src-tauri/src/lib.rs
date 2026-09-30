mod backup;
mod commands;
mod dashboard;
mod db;
mod error;
mod finance;
mod github;
mod gpu;
mod items;
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
            commands::complete_item,
            commands::delete_item,
            commands::list_inbox,
            commands::get_dashboard,
            commands::github_status,
            commands::connect_github,
            commands::disconnect_github,
            commands::get_contributions,
            commands::backup_now,
            commands::data_paths,
            commands::open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
