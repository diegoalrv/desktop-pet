use std::{collections::HashMap, sync::Mutex, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WindowEvent};

pub const PANEL_W: f64 = 360.0;
pub const PANEL_H: f64 = 640.0;

/// Momento en que el panel se ocultó por perder foco (evita que el clic en la mascota lo reabra al instante).
#[derive(Default)]
pub struct LastBlur(pub Mutex<Option<Instant>>);

/// Avisa a la mascota (y a quien escuche) de que el panel se abrió o cerró.
fn emit_visible(app: &AppHandle, visible: bool) {
    let _ = app.emit("panel://visible", visible);
}

/// Oculta el panel (botón ✕).
#[tauri::command]
pub fn hide_panel(app: AppHandle) {
    if let Some(p) = app.get_webview_window("panel") {
        let _ = p.hide();
    }
    emit_visible(&app, false);
}

pub fn hide_panel_on_blur(app: &AppHandle) {
    let Some(panel) = app.get_webview_window("panel") else { return };
    let handle = app.clone();
    let p = panel.clone();
    panel.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            let _ = p.hide();
            *handle.state::<LastBlur>().0.lock().unwrap() = Some(Instant::now());
            emit_visible(&handle, false);
        }
    });
}

#[tauri::command]
pub fn toggle_panel(app: AppHandle, blur: State<LastBlur>) -> Option<()> {
    let panel = app.get_webview_window("panel")?;
    if panel.is_visible().ok()? {
        panel.hide().ok()?;
        emit_visible(&app, false);
        return Some(());
    }
    if blur.0.lock().unwrap().is_some_and(|t| t.elapsed() < Duration::from_millis(300)) {
        return Some(());
    }
    show_panel(&app)
}

/// Muestra el panel anclado sobre la mascota (también lo usa el atajo global).
pub fn show_panel(app: &AppHandle) -> Option<()> {
    let panel = app.get_webview_window("panel")?;
    let pet = app.get_webview_window("pet")?;
    // Anclado sobre la mascota, dentro del work area de su monitor.
    let (pos, size, scale) = (pet.outer_position().ok()?, pet.outer_size().ok()?, pet.scale_factor().ok()?);
    let (pw, ph) = (PANEL_W * scale, PANEL_H * scale);
    let mut x = pos.x as f64 + size.width as f64 / 2.0 - pw / 2.0;
    let mut y = pos.y as f64 + 40.0 * scale - ph;
    if let Some(m) = pet.current_monitor().ok().flatten() {
        let wa = m.work_area();
        x = x.clamp(wa.position.x as f64, (wa.position.x as f64 + wa.size.width as f64 - pw).max(wa.position.x as f64));
        y = y.max(wa.position.y as f64);
    }
    panel.set_position(PhysicalPosition::new(x.round(), y.round())).ok()?;
    panel.show().ok()?;
    panel.set_focus().ok()?;
    emit_visible(app, true);
    Some(())
}

/// Abre el panel en una pestaña (`panel://tab`): el aviso de reunión lo deja en "Reunión", a un clic de escuchar.
#[tauri::command]
pub fn open_panel_tab(app: AppHandle, tab: String) {
    show_panel(&app);
    let _ = app.emit_to("panel", "panel://tab", tab);
}

/// Ventanas normales (ajustes, gestor de tareas): se ocultan al cerrar (no se destruyen).
pub fn hide_on_close(app: &AppHandle, label: &str) {
    let Some(w) = app.get_webview_window(label) else { return };
    let win = w.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            let _ = win.hide();
        }
    });
}

#[tauri::command]
pub fn open_window(app: AppHandle, label: String) -> Option<()> {
    let w = app.get_webview_window(&label)?;
    w.show().ok()?;
    w.set_focus().ok()
}

/// Atajos globales registrados, por tipo ("panel", "focus"…): para reemplazar el de un tipo sin tocar los demás.
#[derive(Default)]
pub struct Shortcuts(pub Mutex<HashMap<&'static str, String>>);
pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";
/// Tipos de atajo conocidos (el handler de `lib.rs` los despacha con `shortcut_kind`).
const KINDS: [&str; 3] = ["panel", "focus", "voice"];

/// Tipo del atajo que se acaba de pulsar.
pub fn shortcut_kind(app: &AppHandle, pressed: &tauri_plugin_global_shortcut::Shortcut) -> Option<&'static str> {
    let map = app.state::<Shortcuts>();
    let map = map.0.lock().unwrap();
    map.iter().find(|(_, accel)| accel.parse().is_ok_and(|s: tauri_plugin_global_shortcut::Shortcut| &s == pressed)).map(|(k, _)| *k)
}

/// Registra `accel` como atajo de `kind`, reemplazando el anterior de ese tipo. Rechaza uno ya usado por otro tipo
/// (si no, al reemplazar se desregistraría el atajo del otro). Devuelve error legible si es inválido.
#[tauri::command]
pub fn set_quick_shortcut(kind: String, accel: String, app: AppHandle, cur: State<Shortcuts>) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let kind = KINDS.into_iter().find(|k| *k == kind).ok_or("Tipo de atajo desconocido")?;
    let new: Shortcut = accel.parse().map_err(|e| format!("Atajo inválido: {e}"))?;
    let gs = app.global_shortcut();
    let mut map = cur.0.lock().unwrap();
    if let Some((other, _)) = map.iter().find(|(k, a)| **k != kind && a.parse::<Shortcut>().is_ok_and(|s| s == new)) {
        return Err(format!("Ese atajo ya está asignado a {}", if *other == "focus" { "iniciar/pausar el foco" } else { "abrir el panel" }));
    }
    let old = map.get(kind).and_then(|a| a.parse::<Shortcut>().ok());
    if old == Some(new) && gs.is_registered(new) {
        return Ok(());
    }
    gs.register(new).map_err(|e| format!("No se pudo registrar (¿en uso?): {e}"))?;
    if let Some(old) = old.filter(|o| *o != new) {
        let _ = gs.unregister(old);
    }
    map.insert(kind, accel);
    Ok(())
}
