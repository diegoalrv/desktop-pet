mod apps;
mod claude;
mod db;
mod meeting;
mod music;
mod timer;
mod tray;
mod voice;
mod windows;
mod web;
mod worklog;

use std::{sync::Mutex, thread, time::Duration};
use tauri::{Emitter, Manager, State};

/// Carpeta del usuario: `HOME` en macOS, `USERPROFILE` en Windows.
pub fn home() -> String {
    std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default()
}

/// Proceso hijo sin consola: en Windows cada `git`/`curl`/`claude` lanzado desde la app abriría una ventana negra.
pub fn cmd(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut c, 0x0800_0000); // CREATE_NO_WINDOW
    c
}

/// Zona opaca (px lógicos, relativa a la ventana) donde la ventana captura el mouse.
#[derive(Default)]
struct HitRect(Mutex<[f64; 4]>); // x, y, w, h

/// Descarga el .ics del calendario (URL secreta iCal de Google). Desde el webview lo frena CORS;
/// ponytail: curl del sistema (macOS y Windows 10+ lo traen) en vez de sumar un cliente HTTP.
pub fn download_ical(url: &str) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("la URL debe empezar con https://".into());
    }
    let out = cmd("curl")
        .args(["-fsSL", "--max-time", "20", "--max-filesize", "20000000", url])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("no se pudo descargar ({})", String::from_utf8_lossy(&out.stderr).trim()));
    }
    String::from_utf8(out.stdout).map_err(|_| "respuesta no es texto".into())
}

#[tauri::command]
async fn fetch_ical(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || download_ical(&url)).await.map_err(|e| e.to_string())?
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
/// Al arrancar mira el latest.json de la última release de GitHub; si hay versión nueva pregunta y la instala.
/// Sin red, en dev o en macOS (la release solo trae Windows) no hace nada.
fn check_update(app: tauri::AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    use tauri_plugin_updater::UpdaterExt;
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let Ok(updater) = app.updater() else { return };
        let Ok(Some(update)) = updater.check().await else { return };
        let ok = app
            .dialog()
            .message(format!("Hay una versión nueva de Candola ({}). ¿Actualizar ahora?", update.version))
            .title("Actualización")
            .buttons(MessageDialogButtons::OkCancelCustom("Actualizar".into(), "Ahora no".into()))
            .blocking_show();
        if ok && update.download_and_install(|_, _| {}, || {}).await.is_ok() {
            app.restart();
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
                        tauri_plugin_sql::Migration {
                            version: 6,
                            description: "meeting_notes",
                            sql: include_str!("../migrations/006_meeting_notes.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 7,
                            description: "task_repeat",
                            sql: include_str!("../migrations/007_task_repeat.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 8,
                            description: "session_apps",
                            sql: include_str!("../migrations/008_session_apps.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 9,
                            description: "meeting_chunks",
                            sql: include_str!("../migrations/009_meeting_chunks.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 10,
                            description: "cam_samples",
                            sql: include_str!("../migrations/010_cam_samples.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 11,
                            description: "cam_segments",
                            sql: include_str!("../migrations/011_cam_segments.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 12,
                            description: "session_work",
                            sql: include_str!("../migrations/012_session_work.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 13,
                            description: "claude_hours",
                            sql: include_str!("../migrations/013_claude_hours.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 14,
                            description: "claude_projects",
                            sql: include_str!("../migrations/014_claude_projects.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, ev| {
                    let pressed = ev.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed;
                    match windows::shortcut_kind(app, shortcut) {
                        // Abre/cierra el panel tal como quedó (sin forzar una pestaña).
                        Some("panel") if pressed => {
                            let _ = windows::toggle_panel(app.clone(), app.state());
                        }
                        Some("focus") if pressed => timer::toggle_focus(app),
                        // Mantener para hablarle a la Candola; al soltar se transcribe.
                        Some("voice") if pressed => voice::start(app),
                        Some("voice") => voice::stop(app),
                        Some("center") if pressed => windows::center_pet(app),
                        _ => {}
                    }
                })
                .build(),
        )
        .manage(HitRect::default())
        .manage(claude::ClaudeChild::default())
        .manage(meeting::MeetingState::default())
        .manage(windows::LastBlur::default())
        .manage(windows::Shortcuts::default())
        .manage(voice::Voice::default())
        .manage(timer::TimerState::new(timer::Timer::new()))
        .invoke_handler(tauri::generate_handler![
            set_hit_rect,
            fetch_ical,
            claude::claude_ask,
            claude::claude_cancel,
            voice::voice_say,
            music::music_open,
            music::music_cmd,
            music::music_state,
            windows::toggle_panel,
            windows::hide_panel,
            windows::open_window,
            windows::open_panel_tab,
            windows::open_camview,
            web::open_web,
            meeting::meeting_start,
            meeting::meeting_stop,
            meeting::meeting_reset,
            meeting::meeting_state,
            meeting::meetings_list,
            meeting::meeting_retry,
            meeting::meetings_ask,
            windows::set_quick_shortcut,
            db::task_set_done,
            timer::timer_config,
            timer::timer_get,
            timer::timer_start,
            timer::timer_pause,
            timer::timer_resume,
            timer::timer_reset,
            timer::timer_restart,
            timer::timer_skip,
            timer::timer_set_task,
            timer::send_notification,
            timer::focus_phone,
            apps::running_apps,
            apps::focus_cam_ctx
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
            db::spawn_claude_hours(app.handle().clone());
            // Indexa para preguntarle a las reuniones lo que falte (sin Ollama no hace nada). Espera a que el
            // frontend corra las migraciones (tauri-plugin-sql), que crean meeting_chunks.
            let h = app.handle().clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_secs(20));
                let _ = meeting::index_missing(&h);
            });
            let _ = windows::set_quick_shortcut(
                "panel".into(),
                windows::DEFAULT_SHORTCUT.into(),
                app.handle().clone(),
                app.state::<windows::Shortcuts>(),
            );
            tray::build(app.handle())?;
            // YouTube Music listo desde el arranque (oculto, sin reproducir).
            let _ = music::ensure(app.handle());
            check_update(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, ev| {
            // Que `claude` no quede huérfano trabajando con la app cerrada.
            if let tauri::RunEvent::Exit = ev {
                app.state::<claude::ClaudeChild>().kill();
            }
        });
}
