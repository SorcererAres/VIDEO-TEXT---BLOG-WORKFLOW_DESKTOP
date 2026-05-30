use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

/// 打开（或聚焦）独立的「设置」窗口 —— macOS 规范：设置是独立窗口，由 Cmd+, / 菜单 / 齿轮触发。
fn open_settings_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("设置")
    .inner_size(920.0, 680.0)
    .min_inner_size(780.0, 520.0)
    .resizable(true)
    .build();
}

#[tauri::command]
fn open_settings(app: tauri::AppHandle) {
    open_settings_window(&app);
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let settings = MenuItemBuilder::new("设置…")
        .id("settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let new_task = MenuItemBuilder::new("新建任务")
        .id("new")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;

    // App 菜单（macOS 第一个菜单）
    let app_menu = SubmenuBuilder::new(app, "Video2Blog")
        .about(None)
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // 文件
    let file_menu = SubmenuBuilder::new(app, "文件")
        .item(&new_task)
        .separator()
        .close_window()
        .build()?;

    // 编辑（关键：提供原生 撤销/重做/剪切/复制/粘贴/全选，否则 webview 里这些快捷键不生效）
    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // 窗口
    let window_menu = SubmenuBuilder::new(app, "窗口")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &window_menu])
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 记住窗口位置/尺寸，关闭再开恢复 frame（macOS 习惯）。
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![open_settings])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // 原生菜单栏 + 快捷键
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "settings" => open_settings_window(app),
                "new" => {
                    let _ = app.emit("menu:new", ());
                }
                _ => {}
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
