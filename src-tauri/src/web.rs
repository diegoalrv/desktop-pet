use std::sync::OnceLock;
use std::thread;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{async_runtime::block_on, AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use tiny_http::{Header, Method, Request, Response, Server};

use crate::db::{self, Db};
use crate::{meeting, music, timer};

/// Panel web local: http://127.0.0.1:4747 (mismo frontend que la app, misma pet.db).
/// En dev 4748, así `tauri dev` convive con la app instalada (vite.config.ts apunta su proxy ahí).
pub const PORT: u16 = if cfg!(debug_assertions) { 4748 } else { 4747 };

#[derive(Deserialize)]
struct Sql {
    sql: String,
    #[serde(default)]
    args: Vec<Value>,
}

#[derive(Deserialize)]
struct Cmd {
    cmd: String,
    #[serde(default)]
    args: Value,
}

/// Token por arranque, solo en memoria: la pestaña lo recibe en la URL al abrirla desde la app y lo manda en cada
/// POST. Sin él, otro proceso del Mac que llegue a loopback no puede ejecutar SQL ni arrancar una reunión.
/// También lo recibe el servidor MCP de la Candola (`mcp/pet-mcp.mjs`, vía `claude.rs`).
pub fn token() -> &'static str {
    static TOKEN: OnceLock<String> = OnceLock::new();
    TOKEN.get_or_init(|| {
        // ponytail: RandomState se siembra del RNG del SO (también en Windows, sin /dev/urandom); 2×64 bits
        use std::hash::{BuildHasher, RandomState};
        (0..2).map(|_| format!("{:016x}", RandomState::new().hash_one(0u8))).collect()
    })
}

/// Abre la web local en el navegador por defecto (macOS), en la vista `view` si viene (`routines` → `#routines`).
/// En dev, vite (1420) hace proxy de /api a PORT.
#[tauri::command]
pub fn open_web(view: Option<String>) {
    let origin = if cfg!(debug_assertions) { "http://localhost:1420".to_string() } else { format!("http://127.0.0.1:{PORT}") };
    let hash = view.filter(|v| v.chars().all(|c| c.is_ascii_alphanumeric())).map(|v| format!("#{v}")).unwrap_or_default();
    let url = format!("{origin}/?t={}{hash}", token());
    #[cfg(windows)]
    let _ = crate::cmd("cmd").args(["/C", "start", "", &url]).spawn();
    #[cfg(not(windows))]
    let _ = std::process::Command::new("open").arg(url).spawn();
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        // Solo loopback. Si el puerto está ocupado (otra instancia de la app), simplemente no hay web.
        let Ok(server) = Server::http(("127.0.0.1", PORT)) else { return };
        write_token_file(&app);
        #[cfg(debug_assertions)] // para probar /api y el servidor MCP con curl en `tauri dev`
        eprintln!("[web] http://127.0.0.1:{PORT} token {}", token());
        for mut req in server.incoming_requests() {
            // Un hilo por pedido: preguntarle a las reuniones espera al LLM y no debe congelar el resto de la web.
            let app = app.clone();
            thread::spawn(move || {
                let (status, mime, body) = handle(&app, &mut req);
                let res = Response::from_data(body)
                    .with_status_code(status)
                    .with_header(Header::from_bytes("Content-Type", mime).unwrap());
                let _ = req.respond(res);
            });
        }
    });
}

/// Deja el token en `<app_data>/web-<PORT>.token` (solo legible por el usuario) para que `mcp/pet-mcp.mjs` lanzado
/// desde fuera de la app (Claude Code, Claude Desktop/Cowork) lo encuentre sin PET_TOKEN. Se reescribe en cada arranque.
fn write_token_file(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else { return };
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
    if let Ok(mut f) = opts.open(dir.join(format!("web-{PORT}.token"))) {
        use std::io::Write;
        let _ = f.write_all(token().as_bytes());
    }
}

fn header<'a>(req: &'a Request, name: &'static str) -> Option<&'a str> {
    req.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str())
}

/// Defensa contra otras webs abiertas en el navegador: Host fijo (DNS rebinding), Origin propio
/// y JSON obligatorio en POST (fuerza preflight CORS, que nunca se responde).
fn trusted(req: &Request) -> bool {
    let hosts = [format!("127.0.0.1:{PORT}"), format!("localhost:{PORT}")];
    let host_ok = header(req, "Host").is_some_and(|h| hosts.iter().any(|x| x == h));
    let origin_ok = header(req, "Origin").is_none_or(|o| {
        hosts.iter().any(|x| o == format!("http://{x}")) || (cfg!(debug_assertions) && o == "http://localhost:1420")
    });
    host_ok && origin_ok
}

/// LLMs de Ajustes (settings.json): el navegador no tiene las prefs ni debe ver las API keys.
fn llms(app: &AppHandle) -> Vec<meeting::Llm> {
    let prefs = app.store("settings.json").ok().and_then(|s| s.get("prefs")).unwrap_or_default();
    serde_json::from_value(prefs["llms"].clone()).unwrap_or_default()
}

/// Los comandos de la app que la web puede usar (mismo nombre que el `invoke` de Tauri).
fn invoke(app: &AppHandle, c: Cmd) -> Result<Value, String> {
    let a = &c.args;
    let ok = |_| Ok(Value::Null);
    match c.cmd.as_str() {
        "timer_get" => Ok(json!(timer::timer_get(app.state()))),
        "timer_start" => {
            let mode: timer::Mode = serde_json::from_value(a["mode"].clone()).map_err(|e| e.to_string())?;
            // sin `seconds`, la duración configurada en Ajustes
            let secs = a["seconds"].as_u64().unwrap_or_else(|| app.state::<timer::TimerState>().lock().unwrap().secs_for(mode));
            ok(timer::timer_start(mode, secs, a["taskId"].as_i64(), app.clone(), app.state()))
        }
        "timer_pause" => ok(timer::timer_pause(app.clone(), app.state())),
        "timer_resume" => ok(timer::timer_resume(app.clone(), app.state())),
        "timer_reset" => ok(timer::timer_reset(app.clone(), app.state())),
        "timer_restart" => ok(timer::timer_restart(app.clone(), app.state())),
        "timer_skip" => ok(timer::timer_skip(app.clone(), app.state())),
        "timer_toggle" => ok(timer::timer_toggle(app.clone())),
        "timer_classic" => Ok(json!(timer::timer_classic(app.state()))),
        "timer_routine" => block_on(timer::timer_routine(app.clone())).map(Value::from),
        "meeting_state" => Ok(json!(meeting::meeting_state(app.state()))),
        "meetings_list" => Ok(json!(meeting::meetings_list(app.clone()))),
        "meeting_start" => {
            let ctx = serde_json::from_value(a["ctx"].clone()).unwrap_or(None);
            meeting::meeting_start(app.clone(), app.state(), llms(app), a["manage"].as_bool().unwrap_or(false), ctx).map(|_| Value::Null)
        }
        // La URL secreta del calendario sale de Ajustes, no del navegador (que no tiene las prefs).
        "fetch_ical" => {
            let prefs = app.store("settings.json").ok().and_then(|s| s.get("prefs")).unwrap_or_default();
            crate::download_ical(prefs["icalUrl"].as_str().unwrap_or("")).map(Value::from)
        }
        "meeting_stop" => ok(meeting::meeting_stop(app.state())),
        "meeting_reset" => ok(meeting::meeting_reset(app.clone(), app.state())),
        "meeting_retry" => meeting::meeting_retry(app.clone(), app.state(), llms(app), a["id"].as_u64()).map(|_| Value::Null),
        "task_set_done" => block_on(db::task_set_done(app.clone(), a["id"].as_i64().ok_or("id")?, a["done"].as_bool().unwrap_or(true))).map(|_| Value::Null),
        "meetings_ask" => meeting::ask_meetings(app, &llms(app), a["q"].as_str().unwrap_or_default()).map(|r| json!(r)),
        "music_state" => Ok(music::music_state()),
        "music_cmd" => ok(music::music_cmd(app.clone(), a["cmd"].as_str().unwrap_or_default().into(), a.get("arg").cloned())),
        _ => Err(format!("comando desconocido: {}", c.cmd)),
    }
}

fn handle(app: &AppHandle, req: &mut Request) -> (u16, String, Vec<u8>) {
    let json = |status: u16, v: Value| (status, "application/json".to_string(), v.to_string().into_bytes());
    if !trusted(req) {
        return json(403, "forbidden".into());
    }
    if *req.method() == Method::Post && header(req, "X-Pet-Token") != Some(token()) {
        return json(401, "token".into());
    }
    let path = req.url().split('?').next().unwrap_or("/").to_string();
    match (req.method(), path.as_str()) {
        (Method::Post, _) if !header(req, "Content-Type").is_some_and(|c| c.starts_with("application/json")) => {
            json(415, "json only".into())
        }
        (Method::Post, "/api/invoke") => {
            let mut body = String::new();
            let parsed = req.as_reader().read_to_string(&mut body).ok().and_then(|_| serde_json::from_str::<Cmd>(&body).ok());
            let Some(c) = parsed else { return json(400, "bad request".into()) };
            match invoke(app, c) {
                Ok(v) => json(200, v),
                Err(e) => json(400, e.into()),
            }
        }
        (Method::Post, "/api/select" | "/api/execute") => {
            let mut body = String::new();
            let parsed = req.as_reader().read_to_string(&mut body).ok().and_then(|_| serde_json::from_str::<Sql>(&body).ok());
            let Some(q) = parsed else { return json(400, "bad request".into()) };
            // ponytail: SQL arbitrario desde el propio frontend (mismo contrato que tauri-plugin-sql);
            // si algún día se expone fuera de loopback, cambiar por endpoints REST con permisos.
            let pool = &app.state::<Db>().0;
            let res = if path == "/api/select" {
                block_on(db::select(pool, &q.sql, &q.args)).map(|rows| Value::from(rows.into_iter().map(Value::Object).collect::<Vec<_>>()))
            } else {
                let r = block_on(db::execute(pool, &q.sql, &q.args));
                let _ = app.emit("db://changed", ()); // la mascota y las ventanas recargan
                r
            };
            match res {
                Ok(v) => json(200, v),
                Err(e) => json(400, e.to_string().into()),
            }
        }
        (Method::Get, _) => {
            let file = if path == "/" { "index.html" } else { path.trim_start_matches('/') };
            match app.asset_resolver().get(file.to_string()) {
                Some(a) => (200, a.mime_type, a.bytes),
                None => (404, "text/plain".into(), b"not found (en dev usa http://localhost:1420)".to_vec()),
            }
        }
        _ => json(405, "method not allowed".into()),
    }
}
