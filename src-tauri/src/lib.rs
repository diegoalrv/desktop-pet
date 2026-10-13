mod timer;
mod tray;
mod windows;

use std::{sync::Mutex, thread, time::Duration};
use tauri::{Emitter, Manager, State};

/// Zona opaca (px lógicos, relativa a la ventana) donde la ventana captura el mouse.
#[derive(Default)]
struct HitRect(Mutex<[f64; 4]>); // x, y, w, h

/// Sube el volumen del sistema a 100 (y quita el mute) durante `secs` y luego lo restaura.
/// macOS vía osascript; otras plataformas: no-op. Si ya está subido, no vuelve a guardar el estado.
#[tauri::command]
fn boost_volume(secs: u64) {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        use std::sync::OnceLock;
        static SAVED: OnceLock<Mutex<Option<String>>> = OnceLock::new();
        let saved = SAVED.get_or_init(|| Mutex::new(None));
        let osa = |s: &str| Command::new("osascript").args(["-e", s]).output().ok();
        let mut g = saved.lock().unwrap();
        if g.is_none() {
            // "60,false" -> volumen y mute previos
            let out = osa("set v to (get volume settings)\n(output volume of v as text) & \",\" & (output muted of v as text)");
            let prev = out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
            if prev.is_empty() {
                return;
            }
            *g = Some(prev);
        }
        drop(g);
        osa("set volume output volume 100 without output muted");
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(secs));
            let Some(prev) = saved.lock().unwrap().take() else { return };
            let (vol, muted) = prev.split_once(',').unwrap_or((&prev, "false"));
            let m = if muted == "true" { "with" } else { "without" };
            osa(&format!("set volume output volume {vol} {m} output muted"));
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = secs;
}

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
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
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
        .manage(windows::QuickShortcut(Mutex::new(String::new())))
        .manage(timer::TimerState::new(timer::Timer::new()))
        .invoke_handler(tauri::generate_handler![
            set_hit_rect,
            boost_volume,
            windows::toggle_panel,
            windows::open_settings,
            windows::set_quick_shortcut,
            timer::timer_config,
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
            windows::hide_settings_on_close(app.handle());
            timer::spawn(app.handle().clone());
            let _ = windows::set_quick_shortcut(
                windows::DEFAULT_SHORTCUT.into(),
                app.handle().clone(),
                app.state::<windows::QuickShortcut>(),
            );
            tray::build(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
