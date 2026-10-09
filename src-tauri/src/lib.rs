mod timer;
mod windows;

use std::{sync::Mutex, thread, time::Duration};
use tauri::{Emitter, Manager, State};

/// Zona opaca (px lógicos, relativa a la ventana) donde la ventana captura el mouse.
#[derive(Default)]
struct HitRect(Mutex<[f64; 4]>); // x, y, w, h

#[tauri::command]
fn set_hit_rect(rect: [f64; 4], state: State<HitRect>) {
    *state.0.lock().unwrap() = rect;
}


// Cursor relativo a la ventana en px lógicos. En macOS se calcula con NSEvent/NSWindow (mismo espacio de
// puntos): `cursor_position()` de tao mezcla escalas y falla con monitores de distinto DPI (ver NOTES.md).
#[cfg(target_os = "macos")]
fn cursor_in_window(win: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSEvent, NSWindow};
    let ns: Retained<NSWindow> = unsafe { Retained::retain(win.ns_window().ok()?.cast())? };
    let m = NSEvent::mouseLocation();
    let f = ns.frame();
    Some((m.x - f.origin.x, f.origin.y + f.size.height - m.y))
}

#[cfg(not(target_os = "macos"))]
fn cursor_in_window(win: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    let (cur, pos, scale) = (win.cursor_position().ok()?, win.outer_position().ok()?, win.scale_factor().ok()?);
    Some(((cur.x - pos.x as f64) / scale, (cur.y - pos.y as f64) / scale))
}

// Click-through: polling del cursor (~60 ms). Fuera del rect -> ignora eventos.
fn spawn_cursor_poll(app: tauri::AppHandle) {
    thread::spawn(move || {
        let mut ignoring: Option<bool> = None;
        loop {
            thread::sleep(Duration::from_millis(60));
            let Some(win) = app.get_webview_window("pet") else { continue };
            let [x, y, w, h] = *app.state::<HitRect>().0.lock().unwrap();
            let Some((lx, ly)) = cursor_in_window(&win) else { continue };
            let inside = lx >= x && lx <= x + w && ly >= y && ly <= y + h;
            if ignoring != Some(!inside) {
                let _ = win.set_ignore_cursor_events(!inside);
                ignoring = Some(!inside);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:pet.db",
                    vec![tauri_plugin_sql::Migration {
                        version: 1,
                        description: "init",
                        sql: include_str!("../migrations/001_init.sql"),
                        kind: tauri_plugin_sql::MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["CommandOrControl+Shift+Space"])
                .expect("atajo global inválido")
                .with_handler(|app, _, ev| {
                    if ev.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        windows::show_panel(app);
                        let _ = app.emit_to("panel", "panel://quick-capture", ());
                    }
                })
                .build(),
        )
        .manage(HitRect::default())
        .manage(windows::LastBlur::default())
        .manage(timer::TimerState::new(timer::Timer::new()))
        .invoke_handler(tauri::generate_handler![
            set_hit_rect,
            windows::toggle_panel,
            timer::timer_get,
            timer::timer_start,
            timer::timer_pause,
            timer::timer_resume,
            timer::timer_reset,
            timer::timer_skip,
            timer::send_notification
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            spawn_cursor_poll(app.handle().clone());
            windows::hide_panel_on_blur(app.handle());
            timer::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
