use crate::AppState;
use crate::backend::BackendStatus;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, Manager, Runtime,
};

pub fn create_tray<R: Runtime>(app: &App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "显示 OClaw", true, None::<&str>)?;
    let status_item = MenuItem::with_id(app, "status", "后端状态：未知", false, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "重启后端", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 OClaw", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &status_item, &restart, &sep, &quit])?;

    let _tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .icon_as_template(false)
        .menu(&menu)
        .tooltip("OClaw")
        .on_menu_event(move |app, event| {
            match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "restart" => {
                    let app_handle = app.clone();
                    let state = app.state::<AppState>();
                    let backend = std::sync::Arc::clone(&state.backend);
                    tauri::async_runtime::spawn(async move {
                        let mut mgr = backend.lock().await;
                        if let Err(e) = mgr.restart(&app_handle).await {
                            log::error!("Backend restart failed: {}", e);
                        }
                    });
                }
                "quit" => {
                    // Stop backend before quitting
                    let state = app.state::<AppState>();
                    let backend = std::sync::Arc::clone(&state.backend);
                    tauri::async_runtime::block_on(async {
                        let mut mgr = backend.lock().await;
                        mgr.stop().ok();
                    });
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    // Update status menu item periodically
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;

            let state = handle.state::<AppState>();
            let mgr = state.backend.lock().await;
            let label = match mgr.status() {
                BackendStatus::Stopped => "后端状态：已停止".to_string(),
                BackendStatus::Starting => "后端状态：启动中…".to_string(),
                BackendStatus::Running => "后端状态：运行中".to_string(),
                BackendStatus::Error(e) => format!("后端状态：错误 ({})", truncate(e, 30)),
            };
            drop(mgr);

            if let Some(tray) = handle.tray_by_id("main") {
                let _ = tray.set_tooltip(Some(&label));
            }
        }
    });

    Ok(())
}

fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len])
    }
}
