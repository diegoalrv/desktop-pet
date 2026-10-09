use std::{sync::Mutex, time::{Duration, Instant}};
use tauri::{AppHandle, Manager, PhysicalPosition, State, WindowEvent};

pub const PANEL_W: f64 = 360.0;
pub const PANEL_H: f64 = 520.0;

/// Momento en que el panel se ocultó por perder foco (evita que el clic en la mascota lo reabra al instante).
#[derive(Default)]
pub struct LastBlur(pub Mutex<Option<Instant>>);

pub fn hide_panel_on_blur(app: &AppHandle) {
    let Some(panel) = app.get_webview_window("panel") else { return };
    let handle = app.clone();
    let p = panel.clone();
    panel.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            let _ = p.hide();
            *handle.state::<LastBlur>().0.lock().unwrap() = Some(Instant::now());
        }
    });
}

#[tauri::command]
pub fn toggle_panel(app: AppHandle, blur: State<LastBlur>) -> Option<()> {
    let panel = app.get_webview_window("panel")?;
    if panel.is_visible().ok()? {
        panel.hide().ok()?;
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
    Some(())
}
