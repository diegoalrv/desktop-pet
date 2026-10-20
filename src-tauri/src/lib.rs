mod claude;
mod db;
mod meeting;
mod music;
mod timer;
mod tray;
mod windows;
mod web;

use std::{sync::Mutex, thread, time::Duration};
use tauri::{Emitter, Manager, State};

/// Zona opaca (px lógicos, relativa a la ventana) donde la ventana captura el mouse.
#[derive(Default)]
struct HitRect(Mutex<[f64; 4]>); // x, y, w, h

/// Descarga el .ics del calendario (URL secreta iCal de Google). Desde el webview lo frena CORS;
/// ponytail: curl del sistema (macOS y Windows 10+ lo traen) en vez de sumar un cliente HTTP.
#[tauri::command]
async fn fetch_ical(url: String) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("la URL debe empezar con https://".into());
    }
    let out = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new("curl")
            .args(["-fsSL", "--max-time", "20", "--max-filesize", "20000000", &url])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("no se pudo descargar ({})", String::from_utf8_lossy(&out.stderr).trim()));
    }
    String::from_utf8(out.stdout).map_err(|_| "respuesta no es texto".into())
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
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "init",
                            sql: include_str!("../migrations/001_init.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 2,
                            description: "project",
                            sql: include_str!("../migrations/002_project.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 3,
                            description: "chat",
                            sql: include_str!("../migrations/003_chat.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 4,
                            description: "meeting_tasks",
                            sql: include_str!("../migrations/004_meeting_tasks.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 5,
                            description: "meeting_actions",
                            sql: include_str!("../migrations/005_meeting_actions.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, ev| {
                    // Atajo global: abre/cierra el panel tal como quedó (sin forzar una pestaña).
                    if ev.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = windows::toggle_panel(app.clone(), app.state());
                    }
                })
                .build(),
        )
        .manage(HitRect::default())
        .manage(meeting::MeetingState::default())
        .manage(windows::LastBlur::default())
        .manage(windows::QuickShortcut(Mutex::new(String::new())))
        .manage(timer::TimerState::new(timer::Timer::new()))
        .invoke_handler(tauri::generate_handler![
            set_hit_rect,
            fetch_ical,
            claude::claude_ask,
            music::music_open,
            music::music_cmd,
            music::music_state,
            windows::toggle_panel,
            windows::hide_panel,
            windows::open_window,
            web::open_web,
            meeting::meeting_start,
            meeting::meeting_stop,
            meeting::meeting_reset,
            meeting::meeting_state,
            meeting::meetings_list,
            meeting::meeting_retry,
            windows::set_quick_shortcut,
            timer::timer_config,
            timer::timer_get,
            timer::timer_start,
            timer::timer_pause,
            timer::timer_resume,
            timer::timer_reset,
            timer::timer_restart,
            timer::timer_skip,
            timer::timer_set_task,
            timer::send_notification
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            spawn_cursor_poll(app.handle().clone());
            windows::hide_panel_on_blur(app.handle());
            windows::hide_on_close(app.handle(), "settings");
            windows::hide_on_close(app.handle(), "tasks");
            db::init(app.handle())?;
            timer::restore(app.handle());
            timer::spawn(app.handle().clone());
            web::spawn(app.handle().clone());
            let _ = windows::set_quick_shortcut(
                windows::DEFAULT_SHORTCUT.into(),
                app.handle().clone(),
                app.state::<windows::QuickShortcut>(),
            );
            tray::build(app.handle())?;
            // YouTube Music listo desde el arranque (oculto, sin reproducir).
            let _ = music::ensure(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
