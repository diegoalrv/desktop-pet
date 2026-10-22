//! Hablarle a la Candola: mientras se mantiene el atajo graba el micrófono (máx. `MAX`), lo transcribe con el mismo
//! whisper de las reuniones y la orden entra al chat del panel (`voice://text`). La respuesta se lee con `say`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

const MAX: Duration = Duration::from_secs(10);
/// Menos que esto es un toque al atajo sin hablar.
const MIN_SAMPLES: usize = crate::meeting::RATE * 2 / 5;

/// Grabación en curso (para soltarla con el atajo) y el `say` que está hablando (para callarlo).
#[derive(Default)]
pub struct Voice {
    stop: Mutex<Option<Arc<AtomicBool>>>,
    say: Mutex<Option<std::process::Child>>,
}

fn notify(app: &AppHandle, body: &str) {
    let _ = app.notification().builder().title("Candola").body(body).show();
}

/// Atajo presionado: empieza a grabar. La mascota escucha (`voice://listening`).
pub fn start(app: &AppHandle) {
    if !cfg!(target_os = "macos") {
        return notify(app, "Hablarle a la Candola solo funciona en macOS");
    }
    if crate::meeting::recording(app) {
        return notify(app, "Estoy escuchando una reunión: no puedo grabarte ahora");
    }
    let stop = Arc::new(AtomicBool::new(false));
    {
        let v = app.state::<Voice>();
        let mut g = v.stop.lock().unwrap();
        if g.is_some() {
            return; // autorepetición de la tecla
        }
        *g = Some(stop.clone());
        hush(&v);
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let _ = app.emit("voice://listening", true);
        let res = listen(&app, &stop);
        *app.state::<Voice>().stop.lock().unwrap() = None;
        let _ = app.emit("voice://listening", false);
        match res {
            Ok(Some(text)) => {
                crate::windows::open_panel_tab(app.clone(), "chat".into());
                let _ = app.emit_to("panel", "voice://text", text);
            }
            Ok(None) => {}
            Err(e) => notify(&app, &format!("No pude escucharte: {e}")),
        }
    });
}

/// Atajo soltado: termina la grabación (el hilo transcribe y manda la orden).
pub fn stop(app: &AppHandle) {
    if let Some(s) = app.state::<Voice>().stop.lock().unwrap().as_ref() {
        s.store(true, Ordering::Relaxed);
    }
}

#[cfg(target_os = "macos")]
fn listen(app: &AppHandle, stop: &AtomicBool) -> Result<Option<String>, String> {
    use crate::meeting::mac;
    let audio = mac::record_mic(stop, MAX)?;
    if audio.len() < MIN_SAMPLES {
        return Ok(None);
    }
    let text = mac::transcribe_once(app, &audio)?;
    if text.is_none() {
        notify(app, "No te entendí, ¿me lo repites?");
    }
    Ok(text)
}

#[cfg(not(target_os = "macos"))]
fn listen(_: &AppHandle, _: &AtomicBool) -> Result<Option<String>, String> {
    Ok(None)
}

fn hush(v: &Voice) {
    if let Some(mut c) = v.say.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

/// Lee la respuesta en voz alta con `say` (la voz del sistema). Una nueva orden o grabación la calla.
#[tauri::command]
pub fn voice_say(text: String, state: State<Voice>) -> Result<(), String> {
    use std::io::Write;
    hush(&state);
    // Por stdin: un texto que empiece con "-" no se confunde con un flag de `say`.
    let mut child = std::process::Command::new("say").stdin(std::process::Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    child.stdin.take().unwrap().write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    *state.say.lock().unwrap() = Some(child);
    Ok(())
}
