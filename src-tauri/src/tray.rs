/// 系统托盘模块
/// Windows / macOS / Linux 通用，Tauri v2 内置跨平台支持
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    eprintln!("[tray] setup_tray 开始创建系统托盘");

    eprintln!("[tray] 创建菜单项: show");
    let show = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
    eprintln!("[tray] 创建菜单项: separator1");
    let separator1 = PredefinedMenuItem::separator(app)?;
    eprintln!("[tray] 创建菜单项: gateway_start");
    let gateway_start = MenuItemBuilder::with_id("gateway_start", "启动 Gateway").build(app)?;
    eprintln!("[tray] 创建菜单项: gateway_stop");
    let gateway_stop = MenuItemBuilder::with_id("gateway_stop", "停止 Gateway").build(app)?;
    eprintln!("[tray] 创建菜单项: gateway_restart");
    let gateway_restart = MenuItemBuilder::with_id("gateway_restart", "重启 Gateway").build(app)?;
    eprintln!("[tray] 创建菜单项: separator2");
    let separator2 = PredefinedMenuItem::separator(app)?;
    eprintln!("[tray] 创建菜单项: quit");
    let quit = MenuItemBuilder::with_id("quit", "退出 ClawPanel").build(app)?;

    eprintln!("[tray] 组装菜单");
    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&separator1)
        .item(&gateway_start)
        .item(&gateway_stop)
        .item(&gateway_restart)
        .item(&separator2)
        .item(&quit)
        .build()?;
    eprintln!("[tray] 菜单组装完成");

    eprintln!("[tray] 加载托盘图标");
    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    eprintln!("[tray] 托盘图标加载完成");

    eprintln!("[tray] 构建 TrayIconBuilder");
    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("ClawPanel")
        .menu(&menu)
        .on_menu_event(move |app, event| {
            eprintln!("[tray] 菜单事件触发: id={}", event.id().as_ref());
            handle_menu_event(app, event.id().as_ref());
        })
        .on_tray_icon_event(|tray, event| {
            eprintln!("[tray] 托盘图标事件: {:?}", event);
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                eprintln!("[tray] 托盘双击，显示主窗口");
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    eprintln!("[tray] TrayIconBuilder 构建完成");

    eprintln!("[tray] setup_tray 完成");
    Ok(())
}
fn handle_menu_event(app: &AppHandle, id: &str) {
    eprintln!("[tray] handle_menu_event: id={id}");
    match id {
        "show" => {
            eprintln!("[tray] 执行: 显示主窗口");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        "gateway_start" => {
            eprintln!("[tray] 执行: 启动 Gateway");
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = crate::commands::service::start_service(app2, "ai.openclaw.gateway".into())
                    .await;
            });
        }
        "gateway_stop" => {
            eprintln!("[tray] 执行: 停止 Gateway");
            tauri::async_runtime::spawn(async move {
                let _ = crate::commands::service::stop_service("ai.openclaw.gateway".into()).await;
            });
        }
        "gateway_restart" => {
            eprintln!("[tray] 执行: 重启 Gateway");
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ =
                    crate::commands::service::restart_service(app2, "ai.openclaw.gateway".into())
                        .await;
            });
        }
        "quit" => {
            eprintln!("[tray] 执行: 退出应用");
            app.exit(0);
        }
        _ => {
            eprintln!("[tray] 未知菜单事件: {id}");
        }
    }
}
