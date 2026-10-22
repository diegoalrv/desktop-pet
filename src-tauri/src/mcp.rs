//! Servidor MCP de la app para la Candola (chat con `claude -p`): tareas, timer, reuniones y sugerencias.
//! Vive en la web local como `POST /mcp` (transporte HTTP de MCP, respuestas JSON sin SSE), con el mismo token que la
//! web. ponytail: dentro de la app y no un `node mcp/pet-mcp.mjs` aparte: sin node ni SDK que empaquetar, y cada
//! herramienta llama directo a lo que ya existe (timer, db.rs, meeting.rs).

use chrono::{Local, NaiveDate, NaiveDateTime, TimeZone};
use serde_json::{json, Value};
use tauri::{async_runtime::block_on, AppHandle, Emitter, Manager};

use crate::db::{self, Db};
use crate::{meeting, timer};

const PROTOCOL: &str = "2025-06-18";

fn tools() -> Value {
    let id = json!({"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]});
    let none = json!({"type": "object", "properties": {}});
    json!([
        {"name": "list_tasks", "description": "Tareas del usuario. filter: today (pendientes que vencen hoy o antes), pending (todas las pendientes, por defecto) o all (incluye hechas). priority: 0 baja, 1 media, 2 alta; due en hora local.",
         "inputSchema": {"type": "object", "properties": {"filter": {"type": "string", "enum": ["today", "pending", "all"]}}}},
        {"name": "add_task", "description": "Crea una tarea. due: fecha local \"AAAA-MM-DD\" o \"AAAA-MM-DD HH:MM\" (sin hora = 09:00). priority: 0 baja, 1 media, 2 alta. repeat: none, daily, weekdays, weekly o monthly.",
         "inputSchema": {"type": "object", "properties": {
             "title": {"type": "string"}, "due": {"type": "string"}, "project": {"type": "string"},
             "priority": {"type": "integer", "minimum": 0, "maximum": 2}, "est_pomodoros": {"type": "integer", "minimum": 1},
             "repeat": {"type": "string", "enum": ["none", "daily", "weekdays", "weekly", "monthly"]}},
             "required": ["title"]}},
        {"name": "complete_task", "description": "Marca una tarea como hecha (si se repite, crea la siguiente).", "inputSchema": id.clone()},
        {"name": "timer_get", "description": "Estado del timer pomodoro: modo (focus, short, long), estado (idle, running, paused), segundos restantes y tarea.", "inputSchema": none.clone()},
        {"name": "timer_start", "description": "Arranca el timer. mode: focus (por defecto), short o long (pausas). minutes: opcional, si no la duración de Ajustes. task_id: la tarea en la que se enfoca.",
         "inputSchema": {"type": "object", "properties": {
             "mode": {"type": "string", "enum": ["focus", "short", "long"]}, "minutes": {"type": "integer", "minimum": 1},
             "task_id": {"type": "integer"}}}},
        {"name": "timer_pause", "description": "Pausa el timer en curso.", "inputSchema": none.clone()},
        {"name": "timer_resume", "description": "Reanuda el timer pausado.", "inputSchema": none.clone()},
        {"name": "timer_stop", "description": "Termina el bloque actual (lo trabajado en un foco queda registrado).", "inputSchema": none.clone()},
        {"name": "meetings_list", "description": "Reuniones grabadas, la más reciente primero: id, fecha, título, participantes y resumen.",
         "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1}}}},
        {"name": "meeting_get", "description": "Una reunión completa: transcripción (Yo = el usuario, Otros = el resto), resumen, decisiones y tareas sugeridas.", "inputSchema": id.clone()},
        {"name": "meeting_search", "description": "Busca un texto (sin distinguir mayúsculas) en todas las transcripciones; devuelve las líneas que calzan con su reunión.",
         "inputSchema": {"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]}},
        {"name": "suggestions_list", "description": "Tareas sugeridas por las reuniones, pendientes de revisar. action (si no es null) es lo que propone el modo Gestión: crear, editar o completar.", "inputSchema": none.clone()},
        {"name": "suggestion_set", "description": "Marca una sugerencia como accepted o dismissed. Aceptar NO crea ni cambia la tarea: hazlo antes con add_task o complete_task.",
         "inputSchema": {"type": "object", "properties": {"id": {"type": "integer"}, "status": {"type": "string", "enum": ["accepted", "dismissed"]}}, "required": ["id", "status"]}},
    ])
}

/// Una petición JSON-RPC → su respuesta (`None` para notificaciones). `call` ejecuta las herramientas.
pub fn rpc(req: &Value, call: impl FnOnce(&str, &Value) -> Result<String, String>) -> Option<Value> {
    let id = req.get("id")?.clone(); // sin id es una notificación: no se responde
    let result = match req["method"].as_str().unwrap_or("") {
        "initialize" => json!({
            "protocolVersion": req["params"]["protocolVersion"].as_str().unwrap_or(PROTOCOL),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "pet", "version": env!("CARGO_PKG_VERSION")},
        }),
        "ping" => json!({}),
        "tools/list" => json!({"tools": tools()}),
        "tools/call" => {
            let p = &req["params"];
            let (text, err) = match call(p["name"].as_str().unwrap_or(""), &p["arguments"]) {
                Ok(t) => (t, false),
                Err(e) => (e, true),
            };
            json!({"content": [{"type": "text", "text": text}], "isError": err})
        }
        m => return Some(json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": format!("método desconocido: {m}")}})),
    };
    Some(json!({"jsonrpc": "2.0", "id": id, "result": result}))
}

/// "AAAA-MM-DD" o "AAAA-MM-DD HH:MM" en hora local → epoch ms. Sin hora, 09:00 (como las fechas del modo Gestión).
fn parse_due(s: &str) -> Result<i64, String> {
    let s = s.trim();
    let dt = NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M")
        .or_else(|_| NaiveDate::parse_from_str(s, "%Y-%m-%d").map(|d| d.and_hms_opt(9, 0, 0).unwrap()))
        .map_err(|_| format!("fecha inválida: {s} (usa AAAA-MM-DD o AAAA-MM-DD HH:MM)"))?;
    Local.from_local_datetime(&dt).earliest().map(|d| d.timestamp_millis()).ok_or(format!("fecha inexistente: {s}"))
}

fn fmt_ms(ms: i64) -> String {
    Local.timestamp_millis_opt(ms).single().map(|d| d.format("%Y-%m-%d %H:%M").to_string()).unwrap_or_default()
}

/// Líneas de las transcripciones que contienen `q` (sin distinguir mayúsculas), como "id · línea". Máximo `max`.
fn search(meetings: &[Value], q: &str, max: usize) -> Vec<String> {
    let q = q.trim().to_lowercase();
    if q.is_empty() {
        return vec![];
    }
    meetings
        .iter()
        .flat_map(|m| {
            let id = m["id"].as_u64().unwrap_or(0);
            let lines: Vec<String> = m["text"].as_str().unwrap_or("").lines().filter(|l| l.to_lowercase().contains(&q)).map(|l| format!("{id} · {l}")).collect();
            lines
        })
        .take(max)
        .collect()
}

fn sql(app: &AppHandle, q: &str, args: &[Value]) -> Result<Vec<Value>, String> {
    block_on(db::select(&app.state::<Db>().0, q, args)).map(|r| r.into_iter().map(Value::Object).collect()).map_err(|e| e.to_string())
}

fn exec(app: &AppHandle, q: &str, args: &[Value]) -> Result<Value, String> {
    let r = block_on(db::execute(&app.state::<Db>().0, q, args)).map_err(|e| e.to_string())?;
    let _ = app.emit("db://changed", ()); // el panel y la web recargan
    Ok(r)
}

fn arg_id(a: &Value) -> Result<i64, String> {
    a["id"].as_i64().ok_or("falta id".into())
}

/// Las reuniones con fecha legible; `notes` agrega resumen y decisiones de `meeting_notes`.
fn meetings(app: &AppHandle) -> Vec<Value> {
    serde_json::to_value(meeting::meetings_list(app.clone())).ok().and_then(|v| v.as_array().cloned()).unwrap_or_default()
}

fn notes(app: &AppHandle, id: u64) -> Value {
    sql(app, "SELECT summary, decisions FROM meeting_notes WHERE meeting = $1", &[id.into()])
        .ok()
        .and_then(|r| r.into_iter().next())
        .map(|n| json!({"summary": n["summary"], "decisions": serde_json::from_str::<Value>(n["decisions"].as_str().unwrap_or("[]")).unwrap_or_default()}))
        .unwrap_or(json!({"summary": "", "decisions": []}))
}

/// Ejecuta una herramienta; el resultado va como texto JSON para que la Candola lo lea.
pub fn call(app: &AppHandle, name: &str, a: &Value) -> Result<String, String> {
    let out: Value = match name {
        "list_tasks" => {
            let mut rows = sql(app, "SELECT id, title, project, priority, done, due_at, est_pomodoros, done_pomodoros, repeat FROM tasks ORDER BY done, due_at IS NULL, due_at, priority DESC", &[])?;
            let end_of_day = Local::now().date_naive().and_hms_opt(23, 59, 59).and_then(|d| Local.from_local_datetime(&d).earliest()).map(|d| d.timestamp_millis()).unwrap_or(i64::MAX);
            rows.retain(|t| match a["filter"].as_str().unwrap_or("pending") {
                "all" => true,
                "today" => t["done"] == 0 && t["due_at"].as_i64().is_some_and(|d| d <= end_of_day),
                _ => t["done"] == 0,
            });
            for t in &mut rows {
                let due = t["due_at"].as_i64().map(fmt_ms);
                t["due"] = due.into();
                t["done"] = (t["done"] != 0).into();
                t.as_object_mut().unwrap().remove("due_at");
            }
            rows.into()
        }
        "add_task" => {
            let title = a["title"].as_str().map(str::trim).filter(|t| !t.is_empty()).ok_or("falta title")?;
            let due = a["due"].as_str().filter(|d| !d.trim().is_empty()).map(parse_due).transpose()?;
            let repeat = a["repeat"].as_str().unwrap_or("none");
            if repeat != "none" && due.is_none() {
                return Err("una tarea que se repite necesita due".into());
            }
            let r = exec(app, "INSERT INTO tasks (title, category_id, project, priority, due_at, est_pomodoros, repeat, created_at) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)", &[
                title.into(), a["project"].as_str().filter(|p| !p.trim().is_empty()).into(), a["priority"].as_i64().unwrap_or(1).clamp(0, 2).into(),
                due.into(), a["est_pomodoros"].as_i64().unwrap_or(1).max(1).into(), repeat.into(), Local::now().timestamp_millis().into(),
            ])?;
            json!({"id": r["lastInsertId"], "title": title, "due": due.map(fmt_ms)})
        }
        "complete_task" => {
            let id = arg_id(a)?;
            if sql(app, "SELECT id FROM tasks WHERE id = $1", &[id.into()])?.is_empty() {
                return Err(format!("no existe la tarea {id}"));
            }
            block_on(db::task_set_done(app.clone(), id, true))?;
            json!({"done": id})
        }
        "timer_get" => json!(timer::timer_get(app.state())),
        "timer_start" => {
            let mode: timer::Mode = serde_json::from_value(a.get("mode").cloned().unwrap_or("focus".into())).map_err(|e| e.to_string())?;
            let secs = match a["minutes"].as_u64() {
                Some(m) => m.max(1) * 60,
                None => app.state::<timer::TimerState>().lock().unwrap().secs_for(mode),
            };
            timer::timer_start(mode, secs, a["task_id"].as_i64(), app.clone(), app.state());
            json!(timer::timer_get(app.state()))
        }
        "timer_pause" => {
            timer::timer_pause(app.clone(), app.state());
            json!(timer::timer_get(app.state()))
        }
        "timer_resume" => {
            timer::timer_resume(app.clone(), app.state());
            json!(timer::timer_get(app.state()))
        }
        "timer_stop" => {
            timer::timer_reset(app.clone(), app.state());
            json!(timer::timer_get(app.state()))
        }
        "meetings_list" => {
            let limit = a["limit"].as_u64().unwrap_or(10) as usize;
            meetings(app)
                .into_iter()
                .take(limit)
                .map(|m| {
                    let id = m["id"].as_u64().unwrap_or(0);
                    json!({"id": id, "date": fmt_ms(id as i64 * 1000), "title": m["title"], "attendees": m["attendees"], "summary": notes(app, id)["summary"]})
                })
                .collect::<Vec<_>>()
                .into()
        }
        "meeting_get" => {
            let id = arg_id(a)? as u64;
            let m = meetings(app).into_iter().find(|m| m["id"] == id).ok_or(format!("no existe la reunión {id}"))?;
            let n = notes(app, id);
            let sugg = sql(app, "SELECT id, title, detail, status FROM meeting_tasks WHERE meeting = $1", &[id.into()])?;
            json!({"id": id, "date": fmt_ms(id as i64 * 1000), "title": m["title"], "attendees": m["attendees"],
                   "summary": n["summary"], "decisions": n["decisions"], "suggestions": sugg, "transcript": m["text"]})
        }
        "meeting_search" => {
            let hits = search(&meetings(app), a["q"].as_str().unwrap_or(""), 40);
            if hits.is_empty() { "sin coincidencias".into() } else { hits.join("\n").into() }
        }
        "suggestions_list" => sql(app, "SELECT id, meeting, title, detail, action FROM meeting_tasks WHERE status = 'pending' ORDER BY id", &[])?.into(),
        "suggestion_set" => {
            let status = a["status"].as_str().filter(|s| matches!(*s, "accepted" | "dismissed")).ok_or("status debe ser accepted o dismissed")?;
            let r = exec(app, "UPDATE meeting_tasks SET status = $1 WHERE id = $2", &[status.into(), arg_id(a)?.into()])?;
            if r["rowsAffected"] == 0 {
                return Err("no existe esa sugerencia".into());
            }
            json!({"id": a["id"], "status": status})
        }
        _ => return Err(format!("herramienta desconocida: {name}")),
    };
    Ok(match out {
        Value::String(s) => s,
        v => v.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rpc_basico() {
        let init = rpc(&json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}}), |_, _| unreachable!()).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(init["id"], 1);
        assert!(rpc(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}), |_, _| unreachable!()).is_none());
        let list = rpc(&json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}), |_, _| unreachable!()).unwrap();
        assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 13);
        let bad = rpc(&json!({"jsonrpc": "2.0", "id": 3, "method": "resources/list"}), |_, _| unreachable!()).unwrap();
        assert_eq!(bad["error"]["code"], -32601);
    }

    #[test]
    fn rpc_tools_call() {
        let req = json!({"jsonrpc": "2.0", "id": "a", "method": "tools/call", "params": {"name": "x", "arguments": {"k": 1}}});
        let ok = rpc(&req, |n, a| Ok(format!("{n}:{}", a["k"]))).unwrap();
        assert_eq!(ok["result"]["content"][0]["text"], "x:1");
        assert_eq!(ok["result"]["isError"], false);
        let err = rpc(&req, |_, _| Err("no".into())).unwrap();
        assert_eq!(err["result"]["isError"], true);
    }

    #[test]
    fn fechas() {
        let d = parse_due("2026-10-24").unwrap();
        assert_eq!(fmt_ms(d), "2026-10-24 09:00");
        assert_eq!(fmt_ms(parse_due(" 2026-10-24 17:30 ").unwrap()), "2026-10-24 17:30");
        assert!(parse_due("viernes").is_err());
        assert!(parse_due("2026-02-30").is_err());
    }

    #[test]
    fn busca_en_transcripciones() {
        let ms = [json!({"id": 1, "text": "Yo: el plazo de SIMBIO\nOtros: ok"}), json!({"id": 2, "text": "Otros: Simbio se atrasa"})];
        assert_eq!(search(&ms, "simbio", 10), vec!["1 · Yo: el plazo de SIMBIO", "2 · Otros: Simbio se atrasa"]);
        assert_eq!(search(&ms, "simbio", 1).len(), 1);
        assert!(search(&ms, "  ", 10).is_empty());
    }
}
