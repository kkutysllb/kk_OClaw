use std::sync::Arc;
use std::time::Duration;
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

/// Spawn a background task that polls the gateway `/health` endpoint and
/// updates the `BackendManager` status accordingly.
///
/// HTTP probes happen **without** holding the mutex; the lock is re-acquired
/// only for brief status checks / updates between probes.  This keeps
/// `get_backend_status` (called every second by the frontend splash screen)
/// responsive at all times.
///
/// Used by:
/// - `setup()` initial auto-start (after `launch()`)
/// - `start_backend` / `restart_backend` commands
pub fn spawn_health_monitor(backend: Arc<Mutex<backend::BackendManager>>) {
    tauri::async_runtime::spawn(async move {
        let port = {
            let mgr = backend.lock().await;
            mgr.port()
        };

        let health_url = format!("http://127.0.0.1:{}/health", port);
        let client = reqwest::Client::new();
        let deadline =
            std::time::Instant::now() + Duration::from_secs(backend::HEALTH_CHECK_TIMEOUT_SECS);

        loop {
            tokio::time::sleep(Duration::from_millis(backend::HEALTH_CHECK_INTERVAL_MS)).await;

            // Brief lock: check if the child process crashed or if someone
            // else already finalised the status.
            let alive = {
                let mut mgr = backend.lock().await;
                if matches!(
                    mgr.status(),
                    backend::BackendStatus::Running | backend::BackendStatus::Error(_)
                ) {
                    return;
                }
                mgr.check_alive()
            };
            if !alive {
                log::error!("Backend process exited unexpectedly during startup");
                return;
            }

            // Timeout check (no lock needed).
            if std::time::Instant::now() > deadline {
                let mut mgr = backend.lock().await;
                mgr.mark_error(format!(
                    "Backend did not become healthy within {} seconds",
                    backend::HEALTH_CHECK_TIMEOUT_SECS
                ));
                log::error!("Backend health check timed out");
                return;
            }

            // HTTP health probe — NO lock held.
            let healthy = client
                .get(&health_url)
                .timeout(Duration::from_secs(2))
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false);

            if healthy {
                let mut mgr = backend.lock().await;
                mgr.mark_running();
                log::info!("Backend is healthy and ready");
                return;
            }
        }
    });
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

            // Auto-start the backend on launch (two-phase, non-blocking).
            //
            // Phase 1 — `launch()`: spawn the child process and set status to
            //   Starting.  Only a brief lock is held.
            //
            // Phase 2 — `spawn_health_monitor()`: poll /health in a background
            //   task.  HTTP probes happen *without* the lock; the lock is
            //   re-acquired only for brief status checks between probes.
            //
            // This is critical because the frontend calls `get_backend_status`
            // every second.  If the lock were held throughout `start()` (which
            // waits up to 120 s), those queries would block indefinitely and
            // the UI would be stuck on "Initializing backend services".
            let handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();

                // Phase 1: Launch the child process (short lock).
                {
                    let mut mgr = state.backend.lock().await;
                    match mgr.launch(&handle).await {
                        Ok(()) => {
                            // If launch() found an already-healthy gateway on
                            // the port, status is Running — nothing more to do.
                            if matches!(mgr.status(), backend::BackendStatus::Running) {
                                log::info!("Backend already running, reused existing process");
                                return;
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to launch backend: {}", e);
                            return;
                        }
                    }
                }
                // Mutex released — get_backend_status is now responsive.

                // Phase 2: Background health monitor (lock-free HTTP probes).
                spawn_health_monitor(state.backend.clone());
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
