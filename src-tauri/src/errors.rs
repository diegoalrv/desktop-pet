//! Errores de la app a GlitchTip (compatible con Sentry), solo con el opt-in de Ajustes (`prefs.errorReports`).
//! Interesa el error, no quién: sale tipo, mensaje, stack, versión, SO y un UUID opaco de la instalación. Las rutas
//! pierden el nombre de usuario y los textos se cortan. El front manda los suyos con lo mismo (lib/errors.ts).
use std::sync::{Arc, LazyLock, Mutex};

use sentry::protocol::{Event, User};
use tauri::{AppHandle, Listener, Manager};
use tauri_plugin_store::StoreExt;

/// DSN del proyecto `candola` en glitchtip.spadelab.xyz. Es público por diseño: solo sirve para enviar eventos.
pub const DSN: &str = "https://4434a0f3412c4f1d96a7dc5aaed0078e@glitchtip.spadelab.xyz/2";

/// Cliente activo; `None` con el opt-in apagado (no sale ninguna petición).
#[derive(Default)]
pub struct Reporter(Mutex<Option<Arc<sentry::Client>>>);

#[derive(serde::Serialize)]
pub struct Info {
    id: String,
    release: String,
    environment: &'static str,
}

/// UUID de la instalación: se genera una vez y queda en settings.json, fuera de `prefs` (el front las guarda enteras
/// y pisaría un valor escrito desde acá).
fn install_id(app: &AppHandle) -> String {
    let Ok(store) = app.store("settings.json") else { return String::new() };
    if let Some(id) = store.get("installId").and_then(|v| v.as_str().map(String::from)) {
        return id;
    }
    let id = uuid::Uuid::new_v4().to_string();
    store.set("installId", id.clone());
    let _ = store.save();
    id
}

fn info(app: &AppHandle) -> Info {
    Info { id: install_id(app), release: app.package_info().version.to_string(), environment: std::env::consts::OS }
}

/// Lo que el front pone en sus eventos (mismo UUID, versión y SO). Solo lo pide con el opt-in activo.
#[tauri::command]
pub fn error_reports_info(app: AppHandle) -> Info {
    info(&app)
}

/// Solo en desarrollo (Ajustes → "Probar errores"): un panic en un hilo aparte, con la home en el mensaje para ver
/// que se limpia. En release no hace nada.
#[tauri::command]
pub fn error_reports_test() {
    #[cfg(debug_assertions)]
    std::thread::spawn(|| panic!("prueba de errores de Candola (home: {})", crate::home()));
}

static USER_PATH: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?i)([a-z]:)?[\\/](users|home)[\\/][^\\/\n:()'\x22]+").unwrap());
// El nombre puede tener espacios ("Ana Pérez"): se corta hasta el siguiente separador, aunque se lleve texto de más.

/// Saca el nombre de usuario de las rutas (`/Users/x/…`, `C:\Users\x\…` → `~/…`) y corta textos largos.
pub fn scrub(s: &str) -> String {
    let s = USER_PATH.replace_all(s, "~");
    let home = crate::home();
    let s = if home.len() > 3 { s.replace(&home, "~") } else { s.into_owned() };
    s.chars().take(300).collect()
}

/// Lista blanca: del evento solo pasan error, versión, SO y UUID. Nada de hostname, contextos, breadcrumbs ni extras.
fn clean(e: Event<'static>, id: &str) -> Event<'static> {
    let mut exception = e.exception;
    for ex in exception.values.iter_mut() {
        ex.value = ex.value.as_deref().map(scrub);
        for f in ex.stacktrace.iter_mut().flat_map(|st| st.frames.iter_mut()) {
            f.abs_path = f.abs_path.as_deref().map(scrub);
            f.filename = f.filename.as_deref().map(scrub);
            f.pre_context.clear();
            f.context_line = None;
            f.post_context.clear();
            f.vars.clear();
        }
    }
    Event {
        event_id: e.event_id,
        timestamp: e.timestamp,
        level: e.level,
        platform: e.platform,
        release: e.release,
        environment: e.environment,
        message: e.message.as_deref().map(scrub),
        exception,
        user: Some(User { id: Some(id.into()), ..Default::default() }),
        ..Default::default()
    }
}

/// Prende o apaga el envío sin reiniciar. Apagar cierra el cliente: los hilos que lo tenían ya no mandan nada.
fn set_enabled(app: &AppHandle, on: bool) {
    let state = app.state::<Reporter>();
    let mut cur = state.0.lock().unwrap();
    if on == cur.is_some() {
        return;
    }
    let hub = sentry::Hub::main();
    if let Some(c) = cur.take() {
        hub.bind_client(None);
        c.close(None);
        return;
    }
    let Info { id, release, environment } = info(app);
    let mut opts = sentry::ClientOptions::default();
    opts.dsn = DSN.parse().ok();
    opts.release = Some(release.into());
    opts.environment = Some(environment.into());
    opts.max_breadcrumbs = 0;
    opts.before_send = Some(Arc::new(move |e| Some(clean(e, &id))));
    let c = Arc::new(sentry::Client::from(sentry::apply_defaults(opts)));
    hub.bind_client(Some(c.clone()));
    *cur = Some(c);
}

/// Al arrancar lee el opt-in y sigue sus cambios (Ajustes emite `settings://prefs` con las prefs enteras).
pub fn init(app: &AppHandle) {
    let on = |p: &serde_json::Value| p.get("errorReports").and_then(|v| v.as_bool()).unwrap_or(false);
    let prefs = app.store("settings.json").ok().and_then(|s| s.get("prefs")).unwrap_or_default();
    set_enabled(app, on(&prefs));
    let h = app.clone();
    app.listen("settings://prefs", move |e| {
        if let Ok(p) = serde_json::from_str(e.payload()) {
            set_enabled(&h, on(&p));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::scrub;

    #[test]
    fn scrub_quita_usuario_y_corta() {
        assert_eq!(scrub("no existe /Users/ana/lab/x.rs"), "no existe ~/lab/x.rs");
        assert_eq!(scrub(r"falló C:\Users\Ana Pérez\AppData\x"), r"falló ~\AppData\x");
        assert_eq!(scrub("en /home/bob: sin permiso"), "en ~: sin permiso");
        assert_eq!(scrub("abre /Users/bob sin nada"), "abre ~");
        assert_eq!(scrub("(home: /Users/bob)"), "(home: ~)");
        assert_eq!(scrub("src/lib.rs:12"), "src/lib.rs:12");
        assert_eq!(scrub(&"a".repeat(1000)).len(), 300);
    }
}
