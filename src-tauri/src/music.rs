//! YouTube Music en una ventana propia (WKWebView), controlada desde el panel.
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const URL: &str = "https://music.youtube.com/";
const PREFIX: &str = "PETSTATE:";
// UA de Safari: con el UA por defecto del webview Google puede rechazar el login.
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

pub fn ensure(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("music") {
        return Ok(w);
    }
    let w = WebviewWindowBuilder::new(app, "music", WebviewUrl::External(URL.parse().unwrap()))
        .title("YouTube Music")
        .inner_size(1100.0, 760.0)
        .center()
        .visible(false)
        .user_agent(UA)
        .initialization_script(include_str!("music_bridge.js"))
        .on_document_title_changed(|w, title| {
            if let Some(json) = title.strip_prefix(PREFIX) {
                let _ = w.app_handle().emit("music://state", json);
            }
        })
        .build()?;
    // Cerrar = ocultar: la música sigue sonando.
    let win = w.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            let _ = win.hide();
        }
    });
    Ok(w)
}

/// Crea (si hace falta) y opcionalmente muestra la ventana de YouTube Music.
#[tauri::command]
pub fn music_open(app: AppHandle, show: bool) -> Result<(), String> {
    let w = ensure(&app).map_err(|e| e.to_string())?;
    if show {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Comando al reproductor (toggle, next, prev, vol, seek, search). No-op si la ventana no existe.
#[tauri::command]
pub fn music_cmd(app: AppHandle, cmd: String, arg: Option<serde_json::Value>) {
    let Some(w) = app.get_webview_window("music") else { return };
    let js = format!(
        "window.__pet && window.__pet({}, {})",
        serde_json::Value::String(cmd),
        arg.unwrap_or_default()
    );
    let _ = w.eval(js);
}
