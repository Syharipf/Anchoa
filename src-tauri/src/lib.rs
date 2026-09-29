mod gpu;

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
        .setup(move |_app| {
            if let Some(node) = &gpu_node {
                log::info!("NVIDIA workaround: WEBKIT_WEB_RENDER_DEVICE_FILE={node}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
