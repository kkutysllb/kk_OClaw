use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    App, Runtime,
};

/// Build a Chinese-localized macOS application menu bar.
///
/// Tauri auto-generates a default menu in English. This replaces it
/// with a Chinese version matching standard macOS conventions.
pub fn setup_app_menu<R: Runtime>(app: &App<R>) -> Result<(), Box<dyn std::error::Error>> {
    // ===== OClaw (app) menu =====
    let about = MenuItem::with_id(app, "about", "关于 OClaw", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let services = PredefinedMenuItem::services(app, Some("服务"))?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏 OClaw", true, None::<&str>)?;
    let hide_others = PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?;
    let show_all = PredefinedMenuItem::show_all(app, Some("显示全部"))?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit_app", "退出 OClaw", true, None::<&str>)?;

    let app_menu = Submenu::with_items(
        app,
        "OClaw",
        true,
        &[
            &about,
            &sep1,
            &services,
            &sep2,
            &hide,
            &hide_others,
            &show_all,
            &sep3,
            &quit,
        ],
    )?;

    // ===== Edit menu =====
    let undo = PredefinedMenuItem::undo(app, Some("撤销"))?;
    let redo = PredefinedMenuItem::redo(app, Some("重做"))?;
    let sep4 = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, Some("剪切"))?;
    let copy = PredefinedMenuItem::copy(app, Some("复制"))?;
    let paste = PredefinedMenuItem::paste(app, Some("粘贴"))?;
    let select_all = PredefinedMenuItem::select_all(app, Some("全选"))?;

    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[&undo, &redo, &sep4, &cut, &copy, &paste, &select_all],
    )?;

    // ===== View menu =====
    let reload = MenuItem::with_id(app, "reload", "重新加载页面", true, None::<&str>)?;
    let force_reload = MenuItem::with_id(app, "force_reload", "强制重新加载", true, None::<&str>)?;
    let sep5 = PredefinedMenuItem::separator(app)?;
    let zoom_in = MenuItem::with_id(app, "zoom_in", "放大", true, None::<&str>)?;
    let zoom_out = MenuItem::with_id(app, "zoom_out", "缩小", true, None::<&str>)?;
    let actual_size = MenuItem::with_id(app, "actual_size", "实际大小", true, None::<&str>)?;
    let sep6 = PredefinedMenuItem::separator(app)?;
    let fullscreen = MenuItem::with_id(app, "fullscreen", "进入全屏幕", true, None::<&str>)?;

    let view_menu = Submenu::with_items(
        app,
        "视图",
        true,
        &[
            &reload,
            &force_reload,
            &sep5,
            &zoom_in,
            &zoom_out,
            &actual_size,
            &sep6,
            &fullscreen,
        ],
    )?;

    // ===== Window menu =====
    let minimize = PredefinedMenuItem::minimize(app, Some("最小化"))?;
    let close_window = PredefinedMenuItem::close_window(app, Some("关闭窗口"))?;

    let window_menu = Submenu::with_items(app, "窗口", true, &[&minimize, &close_window])?;

    // ===== Help menu =====
    let docs = MenuItem::with_id(app, "docs", "OClaw 文档", true, None::<&str>)?;

    let help_menu = Submenu::with_items(app, "帮助", true, &[&docs])?;

    // ===== Assemble main menu =====
    let menu = Menu::with_items(
        app,
        &[&app_menu, &edit_menu, &view_menu, &window_menu, &help_menu],
    )?;

    app.set_menu(menu)?;

    Ok(())
}
