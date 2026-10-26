use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

use crate::{timer, web, windows};

const ID: &str = "tray";

/// Texto junto al ícono (solo macOS; en otros SO no hace nada). Devuelve false si el tray aún no existe.
/// NO llamar con el candado del timer tomado ni desde un comando síncrono: espera al hilo principal (ver `timer::spawn`).
pub fn set_title(app: &AppHandle, title: Option<String>) -> bool {
    #[cfg(target_os = "macos")]
    {
        let Some(tray) = app.tray_by_id(ID) else { return false };
        let _ = tray.set_title(title);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, title);
    true
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, label: &str| MenuItem::with_id(app, id, label, true, None::<&str>);
    let menu = Menu::with_items(
        app,
        &[
            &item("toggle", "Mostrar/ocultar mascota")?,
            &item("center", "Traer a Candolita al centro")?,
            &item("focus", "Iniciar foco")?,
            &item("tasks", "Abrir tareas")?,
            &item("manager", "Gestor de tareas…")?,
            &item("web", "Abrir web de tareas")?,
            &item("settings", "Ajustes…")?,
            &PredefinedMenuItem::separator(app)?,
            &item("quit", "Salir")?,
        ],
    )?;
    TrayIconBuilder::with_id(ID)
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Desktop Pet")
        .menu(&menu)
        .on_menu_event(|app, ev| match ev.id.as_ref() {
            "toggle" => {
                if let Some(w) = app.get_webview_window("pet") {
                    if w.is_visible().unwrap_or(true) { let _ = w.hide(); } else { let _ = w.show(); }
                }
            }
            "center" => windows::center_pet(app),
            "focus" => timer::start_focus(app),
            "tasks" => {
                windows::show_panel(app);
                let _ = app.emit_to("panel", "panel://quick-capture", ());
            }
            "web" => web::open_web(None),
            "manager" => { windows::open_window(app.clone(), "tasks".into()); }
            "settings" => { windows::open_window(app.clone(), "settings".into()); }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
