use std::sync::Arc;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager, RunEvent,
};

mod sidecar;
use sidecar::BackendState;

/// 打开设置 —— 改为 in-app modal（Claude Desktop 风格），不再开独立窗口。
/// Cmd+, / 菜单 / 齿轮统一 emit「menu:settings」，前端监听后弹出居中 modal。
#[tauri::command]
fn open_settings(app: tauri::AppHandle) {
    let _ = app.emit("menu:settings", ());
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
    let backend_state: Arc<BackendState> = Arc::new(BackendState::default());

    let app = tauri::Builder::default()
        // 记住窗口位置/尺寸，关闭再开恢复 frame（macOS 习惯）。
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        // 注意：故意 **不** 调用 `.plugin(tauri_plugin_decorum::init())`。
        // decorum 1.1 的 init() 会在 on_window_ready 自动把交通灯位置硬编码到 (12,16)，
        // 并装一个 NSWindowDelegate，windowDidResize/退出全屏时也都用硬编码值——
        // 任何我们在 setup() 里调 set_traffic_lights_inset 的努力都会被这个钩子覆盖。
        // 我们只用 crate 提供的 WebviewWindowExt::set_traffic_lights_inset 这个 trait
        // 方法（它不依赖 plugin 初始化），并自己监听 Resized 事件维持位置（见下方 setup）。
        .manage(backend_state.clone())
        .invoke_handler(tauri::generate_handler![
            open_settings,
            sidecar::get_backend_url
        ])
        .setup({
            let backend_state = backend_state.clone();
            move |app| {
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

                // 自绘交通灯：隐藏系统的三个标准窗口按钮（关闭/最小化/缩放），
                // 由前端 TrafficLights 组件自己画三个圆点——这样聚焦/失焦的颜色完全可控
                // （聚焦红黄绿、失焦统一灰 #DADAD9），不再受系统失焦灰在浅底上隐形的限制。
                // standardWindowButton: 是公开 AppKit API（NSWindowButton: 0=close 1=min 2=zoom），
                // setHidden: 只隐藏按钮、保留窗口圆角/阴影/拖拽等原生行为。
                #[cfg(target_os = "macos")]
                {
                    use objc::{msg_send, sel, sel_impl};
                    use objc::runtime::Object;
                    if let Some(win) = app.get_webview_window("main") {
                        if let Ok(nsw) = win.ns_window() {
                            let nsw = nsw as *mut Object;
                            unsafe {
                                for i in 0u64..3 {
                                    let btn: *mut Object = msg_send![nsw, standardWindowButton: i];
                                    if !btn.is_null() {
                                        let _: () = msg_send![btn, setHidden: true];
                                    }
                                }
                            }
                        }
                    }
                }

                app.on_menu_event(|app, event| match event.id().as_ref() {
                    "settings" => {
                        let _ = app.emit("menu:settings", ());
                    }
                    "new" => {
                        let _ = app.emit("menu:new", ());
                    }
                    _ => {}
                });
                // 拉起后端 sidecar，ready 后 emit backend:ready 给前端
                sidecar::spawn(app.handle(), backend_state.clone());
                Ok(())
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // App 退出时 kill 子进程，防止变孤儿
    app.run(move |_app, event| {
        if let RunEvent::Exit = event {
            sidecar::shutdown(&backend_state);
        }
    });
}
