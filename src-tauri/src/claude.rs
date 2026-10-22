//! Chat con Claude Code en modo headless (`claude -p`): cada línea de stream-json se reenvía al panel,
//! la mascota reacciona (`claude://start` / `claude://exit`) y cada orden queda en `chat_log`.

use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::Db;

/// Lectura del Mac sin riesgo: lo que no esté aquí lo deniega Claude Code y vuelve como
/// `permission_denials` en el resultado, que el panel muestra para confirmar.
const READ_ONLY: &[&str] = &[
    "Read", "Glob", "Grep",
    "Bash(docker ps:*)", "Bash(docker stats:*)", "Bash(docker inspect:*)", "Bash(docker images:*)",
    "Bash(docker system df:*)", "Bash(docker compose ls:*)", "Bash(docker logs:*)",
    "Bash(ps:*)", "Bash(top -l:*)", "Bash(vm_stat:*)", "Bash(memory_pressure:*)", "Bash(df:*)",
];

/// El `claude` en curso (uno a la vez): para cancelarlo desde el panel y matarlo al salir de la app.
/// Con `exec` en zsh el pid del hijo es el de `claude` mismo, así que `kill()` le llega directo.
#[derive(Default)]
pub struct ClaudeChild {
    child: Mutex<Option<Child>>,
    cancelled: AtomicBool,
}

impl ClaudeChild {
    pub fn kill(&self) {
        if let Some(c) = self.child.lock().unwrap().as_mut() {
            self.cancelled.store(true, Ordering::Relaxed);
            let _ = c.kill();
        }
    }
}

/// Cancela la orden en curso: el hilo lector ve EOF y emite `claude://exit` con "cancelado".
#[tauri::command]
pub fn claude_cancel(state: tauri::State<ClaudeChild>) {
    state.kill();
}

/// Personalidad y forma de trabajar de la Candola (editable en candola.md).
const SYSTEM: &str = include_str!("candola.md");

/// Cómo terminó: la mascota lo anima y queda en el historial.
fn outcome(result: Option<&Value>) -> &'static str {
    match result {
        Some(r) if r["is_error"] == true => "oops",
        Some(r) if r["permission_denials"].as_array().is_some_and(|d| !d.is_empty()) => "ask",
        Some(_) => "mission",
        None => "oops",
    }
}

/// Lo que se muestra de una herramienta: el comando, el archivo o el patrón.
fn tool_label(t: &Value) -> String {
    let i = &t["input"];
    i["command"].as_str().or(i["file_path"].as_str()).or(i["pattern"].as_str())
        .unwrap_or(t["name"].as_str().unwrap_or("?")).to_string()
}

/// `cwd`: carpeta base (Ajustes; vacía = home). `allow`: reglas aprobadas por el usuario
/// (p. ej. `Bash(docker stop abc)`). `god`: sin permisos.
#[tauri::command]
pub fn claude_ask(app: AppHandle, prompt: String, session: Option<String>, allow: Vec<String>, god: bool, cwd: String) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or("/".into());
    let dir = match cwd.trim() {
        "" => PathBuf::from(&home),
        c => PathBuf::from(c.strip_prefix("~").map(|r| format!("{home}{r}")).unwrap_or(c.into())),
    };
    if !dir.is_dir() {
        return Err(format!("la carpeta base no existe: {}", dir.display()));
    }
    let mut args: Vec<String> = vec!["-p".into(), "--output-format".into(), "stream-json".into(), "--verbose".into(),
        "--append-system-prompt".into(), SYSTEM.into()];
    if let Some(s) = session {
        args.extend(["--resume".into(), s]);
    }
    if god {
        args.push("--dangerously-skip-permissions".into());
    } else {
        args.push("--allowedTools".into());
        args.extend(READ_ONLY.iter().map(|s| s.to_string()).chain(allow));
    }
    // ponytail: zsh de login para heredar el PATH del usuario (una app GUI no lo trae); "$@" evita quoting.
    let mut child = Command::new("/bin/zsh")
        .args(["-lc", "exec claude \"$@\"", "claude"])
        .args(&args)
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    // El prompt va por stdin: así un texto que empiece con "-" no se confunde con un flag.
    child.stdin.take().unwrap().write_all(prompt.as_bytes()).map_err(|e| e.to_string())?;
    let out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let state = app.state::<ClaudeChild>();
    state.cancelled.store(false, Ordering::Relaxed);
    *state.child.lock().unwrap() = Some(child);
    let _ = app.emit("claude://start", ());
    std::thread::spawn(move || {
        let (mut result, mut tools) = (None, Vec::new());
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            if v["type"] == "assistant" {
                let content = v["message"]["content"].as_array().cloned().unwrap_or_default();
                tools.extend(content.iter().filter(|c| c["type"] == "tool_use").map(tool_label));
            }
            let _ = app.emit("claude://event", &v);
            if v["type"] == "result" {
                result = Some(v);
            }
        }
        let mut stderr = String::new();
        let _ = err.read_to_string(&mut stderr);
        let state = app.state::<ClaudeChild>();
        let ok = state.child.lock().unwrap().take().and_then(|mut c| c.wait().ok()).is_some_and(|s| s.success());
        if state.cancelled.load(Ordering::Relaxed) {
            stderr = "cancelado".into();
        }
        let mut outcome = outcome(result.as_ref());
        if !ok && outcome != "ask" {
            outcome = "oops";
        }
        let r = result.unwrap_or_default();
        let reply = r["result"].as_str().map(str::to_string).or((!stderr.trim().is_empty()).then(|| stderr.trim().to_string()));
        let _ = app.emit("claude://exit", serde_json::json!({
            "outcome": outcome,
            "error": if ok { String::new() } else { stderr.trim().to_string() },
        }));
        let pool = app.state::<Db>().0.clone();
        let session = r["session_id"].as_str().map(str::to_string);
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        tauri::async_runtime::spawn(async move {
            let _ = sqlx::query("INSERT INTO chat_log (at, session, prompt, reply, tools, outcome, god) VALUES (?, ?, ?, ?, ?, ?, ?)")
                .bind(at).bind(session).bind(prompt).bind(reply).bind(tools.join("\n")).bind(outcome).bind(god)
                .execute(&pool)
                .await;
        });
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn outcomes() {
        assert_eq!(outcome(None), "oops");
        assert_eq!(outcome(Some(&json!({"is_error": true}))), "oops");
        assert_eq!(outcome(Some(&json!({"is_error": false, "permission_denials": [{"tool_name": "Bash"}]}))), "ask");
        assert_eq!(outcome(Some(&json!({"is_error": false, "permission_denials": []}))), "mission");
    }
}
