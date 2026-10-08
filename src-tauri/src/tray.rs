//! System tray integration, menu, and window close-to-tray decisions.

use rusqlite::{Connection, OptionalExtension, params};
use tauri::Manager;

use crate::error::AppError;

pub const SETTING_KEY: &str = "tray.close_to_tray";

/// Action taken when the main window close request is intercepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    /// Hide the window; app continues running in the system tray.
    Hide,
    /// Allow the window to close and exit the process.
    Exit,
}

/// Pure decision function: determines whether closing the window hides it
/// or exits the application, given user preference and system tray availability.
///
/// If the system tray could not be initialized (for example, GNOME without
/// the AppIndicator extension), always falls back to [`CloseAction::Exit`]
/// so that users never end up with an unreachable hidden window.
pub fn decide_close_action(close_to_tray: bool, tray_available: bool) -> CloseAction {
    if close_to_tray && tray_available {
        CloseAction::Hide
    } else {
        CloseAction::Exit
    }
}

/// Managed state recording whether the system tray is active on this system.
#[derive(Debug, Default)]
pub struct TrayState {
    pub available: bool,
}

/// Reads the `tray.close_to_tray` preference from the settings table.
/// Defaults to `true` when unconfigured.
pub fn close_to_tray_setting(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [SETTING_KEY],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
    .map(|val| val == "1" || val == "true")
    .unwrap_or(true)
}

/// Persists the `tray.close_to_tray` preference into the settings table.
pub fn set_close_to_tray(conn: &Connection, enabled: bool) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SETTING_KEY, if enabled { "1" } else { "0" }],
    )?;
    Ok(())
}

/// Shows, unminimizes, and focuses the main application window.
pub fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Initializes the system tray icon with "Buka Anchoa" and "Keluar" menu items.
///
/// Returns `true` if tray icon was created successfully, `false` otherwise.
#[cfg(desktop)]
pub fn init_tray<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    let show_item = match tauri::menu::MenuItem::with_id(app, "show", "Buka Anchoa", true, None::<&str>) {
        Ok(item) => item,
        Err(e) => {
            log::warn!("Failed to create tray show item: {e}");
            return false;
        }
    };
    let quit_item = match tauri::menu::MenuItem::with_id(app, "quit", "Keluar", true, None::<&str>) {
        Ok(item) => item,
        Err(e) => {
            log::warn!("Failed to create tray quit item: {e}");
            return false;
        }
    };
    let menu = match tauri::menu::Menu::with_items(app, &[&show_item, &quit_item]) {
        Ok(menu) => menu,
        Err(e) => {
            log::warn!("Failed to create tray menu: {e}");
            return false;
        }
    };

    let mut builder = tauri::tray::TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("Anchoa")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                show_main_window(app);
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    match builder.build(app) {
        Ok(_tray) => {
            log::info!("System tray icon created successfully");
            true
        }
        Err(e) => {
            log::warn!("Failed to create system tray icon: {e}. Falling back to exit-on-close.");
            false
        }
    }
}

#[cfg(not(desktop))]
pub fn init_tray<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decide_close_action_returns_hide_only_when_setting_on_and_tray_available() {
        // Setting on, tray available -> Hide
        assert_eq!(decide_close_action(true, true), CloseAction::Hide);

        // Setting off, tray available -> Exit
        assert_eq!(decide_close_action(false, true), CloseAction::Exit);

        // Setting on, tray unavailable -> Exit (never leave unreachable hidden window)
        assert_eq!(decide_close_action(true, false), CloseAction::Exit);

        // Setting off, tray unavailable -> Exit
        assert_eq!(decide_close_action(false, false), CloseAction::Exit);
    }

    #[test]
    fn setting_defaults_to_true_and_persists() {
        let conn = crate::db::open_in_memory();

        // Default is true when key does not exist
        assert!(close_to_tray_setting(&conn));

        // Save false
        set_close_to_tray(&conn, false).unwrap();
        assert!(!close_to_tray_setting(&conn));

        // Save true
        set_close_to_tray(&conn, true).unwrap();
        assert!(close_to_tray_setting(&conn));
    }
}
