//! Música en una ventana propia (WKWebView), controlada desde el panel: YouTube Music, Spotify (reproductor web)
//! o local (la propia app con label "music", ver src/music/LocalPlayer.tsx). Ajustes → `musicProvider`.
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const PREFIX: &str = "PETSTATE:";
/// Último estado publicado (JSON), para la web local que no recibe eventos. Vacío = ventana sin estado aún.
pub static LAST: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
/// Proveedor cargado en la ventana ahora mismo.
static CUR: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
// UA de Safari: con el UA por defecto del webview Google puede rechazar el login.
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

fn provider(app: &AppHandle) -> String {
    use tauri_plugin_store::StoreExt;
    let prefs = app.store("settings.json").ok().and_then(|s| s.get("prefs")).unwrap_or_default();
    prefs["musicProvider"].as_str().unwrap_or("ytm").to_string()
}

fn target(app: &AppHandle, p: &str) -> (Url, &'static str) {
    // Local = la app misma, con el origen de la mascota (dev server o tauri://localhost).
    let app_url = app.get_webview_window("pet").and_then(|w| w.url().ok()).map(|mut u| {
        u.set_path("/");
        u.set_query(None);
        u.set_fragment(None);
        u
    });
    match (p, app_url) {
        ("spotify", _) => ("https://open.spotify.com/".parse().unwrap(), "Spotify"),
        ("local", Some(u)) => (u, "Música local"),
        _ => ("https://music.youtube.com/".parse().unwrap(), "YouTube Music"),
    }
}

/// Crea la ventana o, si el proveedor cambió en Ajustes, la lleva al nuevo (navega, no la recrea).
pub fn ensure(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let p = provider(app);
    let (url, title) = target(app, &p);
    if let Some(w) = app.get_webview_window("music") {
        let mut cur = CUR.lock().unwrap();
        if *cur != p {
            *cur = p;
            LAST.lock().unwrap().clear();
            let _ = app.emit("music://state", "null");
            w.set_title(title)?;
            w.navigate(url)?;
        }
        return Ok(w);
    }
    *CUR.lock().unwrap() = p;
    let w = WebviewWindowBuilder::new(app, "music", WebviewUrl::External(url))
        .title(title)
        .inner_size(1100.0, 760.0)
        .center()
        .visible(false)
        .user_agent(UA)
        .initialization_script(include_str!("music_bridge.js"))
        .on_document_title_changed(|w, title| {
            if let Some(json) = title.strip_prefix(PREFIX) {
                *LAST.lock().unwrap() = json.to_string();
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

/// Crea (o cambia de proveedor) y opcionalmente muestra la ventana de música.
#[tauri::command]
pub fn music_open(app: AppHandle, show: bool) -> Result<(), String> {
    let w = ensure(&app).map_err(|e| e.to_string())?;
    if show {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Último estado del reproductor (null si la ventana todavía no publicó nada).
#[tauri::command]
pub fn music_state() -> serde_json::Value {
    serde_json::from_str(&LAST.lock().unwrap()).unwrap_or_default()
}

/// Comando al reproductor (toggle, next, prev, vol, seek, search, duck). No-op si la ventana no existe.
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
