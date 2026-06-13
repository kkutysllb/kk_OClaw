use std::sync::Arc;
use tokio::sync::Mutex;

use tauri::Manager;

mod app_menu;
mod backend;
mod commands;
mod shortcuts;
mod tray;
mod updater;

/// Application state shared across all commands.
pub struct AppState {
    pub backend: Arc<Mutex<backend::BackendManager>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            backend: Arc::new(Mutex::new(backend::BackendManager::new())),
        })
        .setup(|app| {
            // Set up Chinese-localized application menu bar
            app_menu::setup_app_menu(app)?;

            // Set up system tray
            tray::create_tray(app)?;

            // Register global shortcuts
            if let Err(e) = shortcuts::register_shortcuts(&app.handle().clone()) {
                log::warn!("Failed to register shortcuts: {}", e);
            }

            // Auto-start the backend on launch
            let _state = app.state::<AppState>();
            let handle = app.handle().clone();
            let project_root = find_project_root();

            tauri::async_runtime::spawn(async move {
                let state_inner = handle.state::<AppState>();
                let mut mgr = state_inner.backend.lock().await;
                if let Err(e) = mgr.start(&project_root).await {
                    log::error!("Failed to auto-start backend: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_backend,
            commands::stop_backend,
            commands::get_backend_status,
            commands::get_backend_logs,
            commands::restart_backend,
            updater::check_for_updates,
            updater::install_update,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Minimize to tray instead of closing
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "about" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_title("关于 OClaw");
                    }
                }
                "quit_app" => {
                    app.exit(0);
                }
                "reload" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval("location.reload()");
                    }
                }
                "zoom_in" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval("document.body.style.zoom = (parseFloat(document.body.style.zoom || 1) + 0.1)");
                    }
                }
                "zoom_out" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval("document.body.style.zoom = Math.max(0.5, parseFloat(document.body.style.zoom || 1) - 0.1)");
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Walk up from the executable's directory to find the project root
/// (the directory containing `.env` and `backend/`).
fn find_project_root() -> std::path::PathBuf {
    // In development, use the workspace root (3 levels up from desktop/src-tauri/)
    let exe_dir = std::env::current_exe().unwrap_or_default();
    let mut dir = exe_dir.parent();

    // Try walking up to find a directory with backend/ and .env
    while let Some(d) = dir {
        if d.join("backend").is_dir() && d.join(".env").is_file() {
            return d.to_path_buf();
        }
        dir = d.parent();
    }

    // Fallback: try current working directory
    if let Ok(cwd) = std::env::current_dir() {
        let mut d = cwd.as_path();
        loop {
            if d.join("backend").is_dir() && d.join(".env").is_file() {
                return d.to_path_buf();
            }
            match d.parent() {
                Some(p) => d = p,
                None => break,
            }
        }
    }

    // Ultimate fallback
    std::path::PathBuf::from(".")
}
