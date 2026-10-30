//! Errores de la app a GlitchTip (compatible con Sentry), solo con el opt-in de Ajustes (`prefs.errorReports`).
//! Interesa el error, no quién: sale tipo, mensaje, stack, versión, SO y un UUID opaco de la instalación. Las rutas
//! pierden el nombre de usuario y los textos se cortan. El front manda los suyos con lo mismo (lib/errors.ts).
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, LazyLock, Mutex,
};
use std::time::{Duration, Instant};

use sentry::protocol::{Event, User};
use sentry::Level;
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

/// Tope por ejecución: un error de captura que se repite no inunda GlitchTip.
const MAX_CHECKPOINTS: usize = 200;
static CHECKPOINTS: AtomicUsize = AtomicUsize::new(0);

/// El error de "respuesta sin JSON" trae lo que contestó el modelo, que es contenido de la reunión: se corta ahí.
fn sin_contenido(e: &str) -> &str {
    const MARCA: &str = "respuesta sin JSON";
    e.find(MARCA).map_or(e, |i| &e[..i + MARCA.len()])
}

/// Un evento por etapa, agrupado por etapa: en GlitchTip cada issue es un paso y su conteo dice cuántas sesiones
/// llegaron hasta ahí (filtrar por `environment` = windows). `sesion` une los pasos de una misma grabación.
fn checkpoint_event(stage: &str, level: Level, sesion: &str, secs: u64, tags: &[(&str, String)]) -> Event<'static> {
    let mut e = Event {
        level,
        message: Some(format!("reunion {stage}")),
        fingerprint: vec!["reunion".into(), stage.to_string().into()].into(),
        ..Default::default()
    };
    e.tags.insert("sesion".into(), sesion.into());
    e.tags.insert("seg".into(), secs.to_string());
    e.tags.extend(tags.iter().map(|(k, v)| (k.to_string(), scrub(v))));
    e
}

/// Checkpoints de una grabación. Solo números y estados, nunca texto de la reunión. Con el opt-in apagado no sale nada.
pub struct Trace {
    sesion: String,
    modo: &'static str,
    at: Instant,
}

impl Trace {
    pub fn new(modo: &'static str) -> Self {
        Self { sesion: uuid::Uuid::new_v4().simple().to_string()[..8].into(), modo, at: Instant::now() }
    }

    fn send(&self, stage: &str, level: Level, tags: &[(&str, String)]) {
        let hub = sentry::Hub::main();
        if hub.client().is_none() || CHECKPOINTS.fetch_add(1, Ordering::Relaxed) >= MAX_CHECKPOINTS {
            return;
        }
        let mut tags = tags.to_vec();
        tags.push(("modo", self.modo.into()));
        hub.capture_event(checkpoint_event(stage, level, &self.sesion, self.at.elapsed().as_secs(), &tags));
    }

    pub fn ok(&self, stage: &str, tags: &[(&str, String)]) {
        self.send(stage, Level::Info, tags);
    }

    pub fn warn(&self, stage: &str, tags: &[(&str, String)]) {
        self.send(stage, Level::Warning, tags);
    }

    /// Reporta el fallo y devuelve el error para seguirlo con `?`.
    pub fn fail(&self, stage: &str, e: String) -> String {
        self.send(stage, Level::Error, &[("error", sin_contenido(&e).to_string())]);
        e
    }

    /// Espera a que salga lo pendiente: antes de un paso que puede botar el proceso sin panic (cargar whisper).
    pub fn flush(&self) {
        if let Some(c) = sentry::Hub::main().client() {
            c.flush(Some(Duration::from_secs(2)));
        }
    }
}

/// Lista blanca: del evento solo pasan error, versión, SO, UUID y los tags de los checkpoints. Nada de hostname,
/// contextos, breadcrumbs ni extras.
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
        tags: e.tags,
        fingerprint: e.fingerprint,
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
    use super::{checkpoint_event, clean, scrub, sin_contenido};
    use sentry::Level;

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

    #[test]
    fn el_checkpoint_pasa_el_filtro_sin_ruta_ni_contenido() {
        let e = checkpoint_event("04 captura", Level::Error, "abc", 7, &[("error", r"falló C:\Users\Ana\x".to_string())]);
        let e = clean(e, "uuid");
        assert_eq!(e.message.as_deref(), Some("reunion 04 captura"));
        assert_eq!(e.tags["sesion"], "abc");
        assert_eq!(e.tags["seg"], "7");
        assert_eq!(e.tags["error"], r"falló ~\x");
        assert_eq!(e.fingerprint.len(), 2);
        assert!(e.server_name.is_none());

        let llm = "m1: respuesta sin JSON de tareas: Juan renuncia el lunes · m2: otra cosa";
        assert_eq!(sin_contenido(llm), "m1: respuesta sin JSON");
        assert_eq!(sin_contenido("LLM 500: caído"), "LLM 500: caído");
    }

    /// Manda checkpoints de verdad a GlitchTip, con environment `prueba`, como build de prueba del flujo completo:
    /// `cargo test --lib probar_checkpoints -- --ignored`
    #[test]
    #[ignore]
    fn probar_checkpoints() {
        let mut opts = sentry::ClientOptions::default();
        opts.dsn = super::DSN.parse().ok();
        opts.environment = Some("prueba".into());
        opts.release = Some(env!("CARGO_PKG_VERSION").into());
        opts.before_send = Some(std::sync::Arc::new(|e| Some(clean(e, "prueba"))));
        let c = std::sync::Arc::new(sentry::Client::from(sentry::apply_defaults(opts)));
        sentry::Hub::main().bind_client(Some(c));
        let t = super::Trace::new("reunion");
        t.ok("01 inicio", &[("cpus", "8".into())]);
        t.fail("04 captura", "prueba".into());
        t.flush();
    }
}
