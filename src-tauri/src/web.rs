use std::thread;

use serde::Deserialize;
use serde_json::Value;
use tauri::{async_runtime::block_on, AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Request, Response, Server};

use crate::db::{self, Db};

/// Web local de tareas y tracking: http://127.0.0.1:4747 (mismo frontend que la app, misma pet.db).
pub const PORT: u16 = 4747;

#[derive(Deserialize)]
struct Sql {
    sql: String,
    #[serde(default)]
    args: Vec<Value>,
}

/// Abre la web local en el navegador por defecto (macOS).
#[tauri::command]
pub fn open_web() {
    let _ = std::process::Command::new("open").arg(format!("http://127.0.0.1:{PORT}")).spawn();
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        // Solo loopback. Si el puerto está ocupado (otra instancia de la app), simplemente no hay web.
        let Ok(server) = Server::http(("127.0.0.1", PORT)) else { return };
        for mut req in server.incoming_requests() {
            let (status, mime, body) = handle(&app, &mut req);
            let res = Response::from_data(body)
                .with_status_code(status)
                .with_header(Header::from_bytes("Content-Type", mime).unwrap());
            let _ = req.respond(res);
        }
    });
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

fn handle(app: &AppHandle, req: &mut Request) -> (u16, String, Vec<u8>) {
    let json = |status: u16, v: Value| (status, "application/json".to_string(), v.to_string().into_bytes());
    if !trusted(req) {
        return json(403, "forbidden".into());
    }
    let path = req.url().split('?').next().unwrap_or("/").to_string();
    match (req.method(), path.as_str()) {
        (Method::Post, "/api/select" | "/api/execute") => {
            if !header(req, "Content-Type").is_some_and(|c| c.starts_with("application/json")) {
                return json(415, "json only".into());
            }
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
