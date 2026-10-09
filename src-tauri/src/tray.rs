use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

use crate::{timer, windows};

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, label: &str| MenuItem::with_id(app, id, label, true, None::<&str>);
    let menu = Menu::with_items(
        app,
        &[
            &item("toggle", "Mostrar/ocultar mascota")?,
            &item("focus", "Iniciar foco")?,
            &item("tasks", "Abrir tareas")?,
            &item("settings", "Ajustes…")?,
            &PredefinedMenuItem::separator(app)?,
            &item("quit", "Salir")?,
        ],
    )?;
    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Desktop Pet")
        .menu(&menu)
        .on_menu_event(|app, ev| match ev.id.as_ref() {
            "toggle" => {
                if let Some(w) = app.get_webview_window("pet") {
                    if w.is_visible().unwrap_or(true) { let _ = w.hide(); } else { let _ = w.show(); }
                }
            }
            "focus" => timer::start_focus(app),
            "tasks" => {
                windows::show_panel(app);
                let _ = app.emit_to("panel", "panel://quick-capture", ());
            }
            "settings" => { windows::open_settings(app.clone()); }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
