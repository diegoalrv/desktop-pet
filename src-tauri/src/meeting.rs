//! Reuniones: durante la reunión escucha el micrófono ("Yo") y el audio del sistema ("Otros") por separado y
//! transcribe en local con whisper por fragmentos. Al terminar guarda la transcripción, la limpia (`condense`)
//! y la manda completa, en una sola llamada, a un LLM compatible con OpenAI (Gemini, Claude, Ollama) que
//! devuelve las tareas sugeridas.

use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{async_runtime::block_on, AppHandle, Emitter, Manager, State};

pub const RATE: usize = 16_000; // whisper trabaja a 16 kHz mono
const MIN_S: usize = 8; // fragmento mínimo antes de buscar un silencio para cortar
const MAX_S: usize = 20; // se corta sí o sí
const WIN: usize = RATE * 3 / 10; // ventana de 300 ms para buscar el silencio
/// ponytail: umbral de RMS fijo (~-40 dBFS); subirlo si el ruido de fondo se transcribe, bajarlo si un micrófono
/// muy bajo se toma como silencio.
const SILENCE: f32 = 0.01;

#[derive(Clone, Serialize)]
pub struct Line {
    pub who: &'static str, // "Yo" | "Otros"
    pub text: String,
}

/// Proveedor del LLM con sus modelos en orden de preferencia. `provider` es un nombre conocido (`base_url`), la
/// base URL de cualquier API compatible con OpenAI (termina en /v1) o "claude-code" (`claude -p` local, sin API).
/// `apikey` vacía para Ollama y claude-code.
#[derive(Clone, Deserialize)]
pub struct Llm {
    pub provider: String,
    #[serde(default)]
    pub apikey: String,
    pub models: Vec<String>,
}

fn base_url(provider: &str) -> &str {
    match provider.trim().to_lowercase().as_str() {
        "gemini" | "google" => "https://generativelanguage.googleapis.com/v1beta/openai",
        "claude" | "anthropic" => "https://api.anthropic.com/v1",
        "openai" => "https://api.openai.com/v1",
        "ollama" => "http://127.0.0.1:11434/v1",
        _ => provider.trim(),
    }
}

#[derive(Clone, Default, Serialize)]
pub struct Snapshot {
    active: bool,
    status: String,
    lines: Vec<Line>,
}

#[derive(Default)]
struct Inner {
    snap: Snapshot,
    stop: Option<Arc<AtomicBool>>,
}

#[derive(Default)]
pub struct MeetingState(Mutex<Inner>);

/// Cambia el estado y lo publica a las ventanas (`meeting://state`).
fn update(app: &AppHandle, f: impl FnOnce(&mut Inner)) {
    let st = app.state::<MeetingState>();
    let mut g = st.0.lock().unwrap();
    f(&mut g);
    let _ = app.emit("meeting://state", &g.snap);
}

#[tauri::command]
pub fn meeting_state(state: State<MeetingState>) -> Snapshot {
    state.0.lock().unwrap().snap.clone()
}

#[derive(Serialize)]
pub struct Saved {
    id: u64, // epoch s = nombre del .md
    text: String,
}

/// Transcripciones guardadas, la más reciente primero.
/// ponytail: lee todos los .md completos; paginar si algún día son cientos de reuniones largas.
#[tauri::command]
pub fn meetings_list(app: AppHandle) -> Vec<Saved> {
    let Some(dir) = meetings_dir(&app) else { return vec![] };
    let mut v: Vec<Saved> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let p = e.ok()?.path();
            let id = p.file_name()?.to_str()?.strip_suffix(".md")?.parse().ok()?;
            Some(Saved { id, text: std::fs::read_to_string(&p).ok()? })
        })
        .collect();
    v.sort_by(|a, b| b.id.cmp(&a.id));
    v
}

#[tauri::command]
pub fn meeting_stop(state: State<MeetingState>) {
    if let Some(stop) = &state.0.lock().unwrap().stop {
        stop.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn meeting_start(app: AppHandle, state: State<MeetingState>, llms: Vec<Llm>) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Escuchar reuniones solo funciona en macOS".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut g = state.0.lock().unwrap();
        if g.stop.is_some() {
            return Ok(());
        }
        g.stop = Some(stop.clone());
    }
    update(&app, |g| {
        g.snap = Snapshot { active: true, status: "Preparando…".into(), ..Default::default() };
    });
    std::thread::spawn(move || {
        #[cfg(target_os = "macos")]
        let res = mac::run(&app, &stop, &llms);
        #[cfg(not(target_os = "macos"))]
        let res: Result<(), String> = Ok(());
        update(&app, |g| {
            g.stop = None;
            g.snap.active = false;
            g.snap.status = match res {
                Ok(()) if g.snap.status.starts_with("Reunión revisada") => g.snap.status.clone(),
                Ok(()) => "Reunión terminada".into(),
                Err(e) => format!("Error: {e}"),
            };
        });
    });
    Ok(())
}

/// Vuelve a mandar al LLM una transcripción guardada (`id`; sin id, la última): si falló la llamada o se cerró la app.
#[tauri::command]
pub fn meeting_retry(app: AppHandle, state: State<MeetingState>, llms: Vec<Llm>, id: Option<u64>) -> Result<(), String> {
    if state.0.lock().unwrap().stop.is_some() {
        return Err("Hay una reunión en curso".into());
    }
    let saved = meetings_list(app.clone());
    let m = match id {
        Some(id) => saved.into_iter().find(|m| m.id == id),
        None => saved.into_iter().next(),
    }
    .ok_or("No hay reuniones guardadas")?;
    let (id, lines) = (m.id, parse_lines(&m.text));
    if lines.is_empty() {
        return Err("La transcripción está vacía".into());
    }
    update(&app, |g| {
        g.snap.lines = lines.clone();
        g.snap.status = "Buscando tareas en la reunión…".into();
    });
    std::thread::spawn(move || {
        let res = finalize(&app, &llms, id, &lines);
        update(&app, |g| {
            g.snap.status = match res {
                Ok(m) => m,
                Err(e) => format!("Error: {e}"),
            };
        });
    });
    Ok(())
}

fn meetings_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("meetings"))
}

/// Inverso de `fmt_lines`: "Yo: …" / "Otros: …" por línea.
pub fn parse_lines(s: &str) -> Vec<Line> {
    s.lines()
        .filter_map(|l| {
            let (who, text) = l.split_once(": ")?;
            let who = ["Yo", "Otros"].into_iter().find(|w| *w == who)?;
            Some(Line { who, text: text.to_string() })
        })
        .collect()
}

/// PCM little-endian → f32 en [-1, 1], tomando el primer canal de cada `step` muestras intercaladas.
/// Formatos sin soporte (p. ej. 24 bits) devuelven vacío en vez de ruido.
pub fn decode(data: &[u8], float: bool, bits: u32, step: usize) -> Vec<f32> {
    let n = (bits / 8) as usize;
    let one = |c: &[u8]| match (float, n) {
        (true, 4) => f32::from_le_bytes([c[0], c[1], c[2], c[3]]),
        (false, 2) => i16::from_le_bytes([c[0], c[1]]) as f32 / 32_768.0,
        (false, 4) => i32::from_le_bytes([c[0], c[1], c[2], c[3]]) as f32 / 2_147_483_648.0,
        _ => f32::NAN,
    };
    if n == 0 || one(&[0; 4]).is_nan() {
        return vec![];
    }
    data.chunks_exact(n).step_by(step.max(1)).map(one).collect()
}

pub fn rms(x: &[f32]) -> f32 {
    if x.is_empty() {
        return 0.0;
    }
    (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
}

/// Saca un fragmento listo para transcribir: con al menos MIN_S s, cortado en la ventana más silenciosa
/// (si es silencio de verdad o ya se llegó a MAX_S). `flush` entrega lo que quede.
pub fn take_chunk(buf: &mut Vec<f32>, flush: bool) -> Option<Vec<f32>> {
    if flush {
        return (!buf.is_empty()).then(|| std::mem::take(buf));
    }
    let (min, max) = (MIN_S * RATE, MAX_S * RATE);
    if buf.len() < min + WIN {
        return None;
    }
    let end = buf.len().min(max);
    let (i, r) = (min..=end - WIN)
        .step_by(WIN / 2)
        .map(|i| (i, rms(&buf[i..i + WIN])))
        .min_by(|a, b| a.1.total_cmp(&b.1))?;
    if r >= SILENCE && buf.len() < max {
        return None;
    }
    let rest = buf.split_off(i + WIN / 2);
    Some(std::mem::replace(buf, rest))
}

/// Texto de whisper limpio; None si es una alucinación típica (whisper inventa subtítulos con ruido o música).
pub fn clean(text: &str) -> Option<String> {
    const JUNK: [&str; 7] = ["amara.org", "subtítulos", "suscríbete", "gracias por ver", "[música", "(música", "♪"];
    let t = text.trim();
    let low = t.to_lowercase();
    let letters = t.chars().filter(|c| c.is_alphanumeric()).count();
    (letters >= 2 && !JUNK.iter().any(|j| low.contains(j))).then(|| t.to_string())
}

const PROMPT: &str = "Eres el asistente personal del usuario. Recibes la transcripción automática de una reunión que \
ya terminó (puede tener errores de reconocimiento), con líneas \"Yo:\" (el usuario, su micrófono) y \"Otros:\" (el \
resto de participantes).\n\
Extrae SOLO las tareas accionables que le tocan al usuario: compromisos que asumió, cosas que le pidieron y seguimientos \
que debe hacer a otros. Si otra persona dice \"yo lo hago\" o \"yo lo reviso\", esa tarea es de ella, no del usuario. \
No inventes ni incluyas ideas o temas solo conversados. Une las tareas repetidas.\n\
Responde únicamente JSON: {\"tareas\":[{\"titulo\":\"verbo en infinitivo + qué, máximo 80 caracteres\",\
\"detalle\":\"quién lo pidió y plazo si se mencionó; breve\"}]}. Si no hay tareas: {\"tareas\":[]}.";

/// Sin micrófono (ninguna línea "Yo") el prompt normal casi nunca encuentra tareas: no hay compromisos del usuario.
fn prompt(lines: &[Line]) -> String {
    if lines.iter().any(|l| l.who == "Yo") {
        return PROMPT.into();
    }
    format!(
        "{PROMPT}\nOJO: en esta reunión no se grabó el micrófono del usuario; todas las líneas son \"Otros\". Incluye \
         también lo que le piden o asignan a quien escucha y los acuerdos o pendientes de la reunión que no tengan \
         un responsable claro; el usuario revisará cada una."
    )
}

fn fmt_lines(lines: &[Line]) -> String {
    lines.iter().map(|l| format!("{}: {}", l.who, l.text)).collect::<Vec<_>>().join("\n")
}

fn words(t: &str) -> Vec<String> {
    t.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect()
}

/// Limpia la transcripción antes de mandarla: quita muletillas sueltas, repeticiones de whisper y el eco de la
/// llamada que el micrófono capta sin audífonos ("Yo" que repite a "Otros"), y une líneas seguidas de "Yo".
/// "Otros" son varias personas: unirlas borra los turnos (una reunión sin micrófono quedaba en una sola línea).
pub fn condense(lines: &[Line]) -> Vec<Line> {
    const FILLER: [&str; 16] =
        ["sí", "si", "ok", "okay", "ya", "dale", "perfecto", "gracias", "listo", "bueno", "claro", "exacto", "ah", "eh", "mm", "chao"];
    let mut out: Vec<Line> = vec![];
    for (i, l) in lines.iter().enumerate() {
        let w = words(&l.text);
        if w.iter().all(|x| FILLER.contains(&x.as_str())) {
            continue;
        }
        // Eco: casi todas sus palabras están en una línea de Otros cercana (ponytail: heurística de 80% de palabras).
        let echo = l.who == "Yo"
            && w.len() >= 3
            && lines[i.saturating_sub(3)..(i + 4).min(lines.len())].iter().any(|o| {
                let ow = words(&o.text);
                o.who == "Otros" && w.iter().filter(|x| ow.contains(x)).count() * 5 >= w.len() * 4
            });
        if echo {
            continue;
        }
        match out.last_mut() {
            Some(prev) if prev.who == l.who && words(&prev.text).ends_with(&w) => {} // whisper repitió la frase
            Some(prev) if prev.who == "Yo" && l.who == "Yo" => prev.text = format!("{} {}", prev.text, l.text),
            _ => out.push(l.clone()),
        }
    }
    out
}

/// (título, detalle) del JSON del modelo; tolera texto o `<think>…</think>` alrededor.
/// Respuesta sin `{"tareas":[…]}` = error (pasa al siguiente modelo), no "cero tareas".
pub fn parse_tasks(content: &str) -> Result<Vec<(String, String)>, String> {
    let c = content.rsplit("</think>").next().unwrap_or(content);
    let bad = || format!("respuesta sin JSON de tareas: {}", c.trim().chars().take(120).collect::<String>());
    let (Some(a), Some(b)) = (c.find('{'), c.rfind('}')) else { return Err(bad()) };
    let v: Value = c.get(a..=b).and_then(|j| serde_json::from_str(j).ok()).ok_or_else(bad)?;
    let tareas = v["tareas"].as_array().ok_or_else(bad)?;
    Ok(tareas
        .iter()
        .filter_map(|t| {
            let title = t["titulo"].as_str()?.trim();
            let detail = t["detalle"].as_str().unwrap_or("").trim();
            (!title.is_empty()).then(|| (title.chars().take(120).collect(), detail.to_string()))
        })
        .collect())
}

/// Prueba cada proveedor y, dentro de él, cada modelo en orden hasta que uno responda (sobrecarga, cuota, key
/// inválida… cualquier error pasa al siguiente). `on_try` avisa cuál se está probando.
fn ask_any(llms: &[Llm], lines: &[Line], mut on_try: impl FnMut(&str)) -> Result<Vec<(String, String)>, String> {
    let mut errs = vec![];
    for llm in llms {
        for model in &llm.models {
            on_try(model);
            match ask(llm, model, lines) {
                Ok(t) => return Ok(t),
                Err(e) => errs.push(format!("{model}: {e}")),
            }
        }
    }
    Err(if errs.is_empty() { "no hay modelos configurados (Ajustes → Reuniones)".into() } else { errs.join(" · ") })
}

/// `claude -p` (Claude Code instalado y con sesión): sin API key ni llamada propia a la API. Una app con
/// bundle no hereda el PATH del shell, por eso se prueban las rutas típicas del binario.
fn ask_claude_code(model: &str, lines: &[Line]) -> Result<Vec<(String, String)>, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let home = std::env::var("HOME").unwrap_or_default();
    let bins = ["claude".into(), "/opt/homebrew/bin/claude".into(), "/usr/local/bin/claude".into(), format!("{home}/.claude/local/claude")];
    let mut child = bins
        .iter()
        .find_map(|b| {
            Command::new(b)
                .args(["-p", "--model", model, "--tools", "", "--no-session-persistence", "--system-prompt", &prompt(lines)])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .ok()
        })
        .ok_or("no encuentro el comando `claude` (instala Claude Code)")?;
    child.stdin.take().unwrap().write_all(format!("Transcripción:\n{}", fmt_lines(lines)).as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("claude -p: {}", err.trim().chars().take(200).collect::<String>()));
    }
    parse_tasks(&String::from_utf8_lossy(&out.stdout)).map_err(|e| format!("claude -p: {e}"))
}

fn ask(llm: &Llm, model: &str, lines: &[Line]) -> Result<Vec<(String, String)>, String> {
    if llm.provider.trim().eq_ignore_ascii_case("claude-code") {
        return ask_claude_code(model, lines);
    }
    let url = base_url(&llm.provider);
    // ponytail: "remoto" = no es localhost; Ollama local no pide key.
    if llm.apikey.is_empty() && !url.contains("127.0.0.1") && !url.contains("localhost") {
        return Err("falta la API key".into());
    }
    let body = json!({
        "model": model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": prompt(lines)},
            {"role": "user", "content": format!("Transcripción:\n{}", fmt_lines(lines))},
        ],
    });
    let mut req = ureq::post(format!("{}/chat/completions", url.trim_end_matches('/')))
        .config()
        .timeout_global(Some(Duration::from_secs(900)))
        .http_status_as_error(false) // para leer el mensaje del proveedor en vez de solo "http status: 400"
        .build()
        .header("Content-Type", "application/json");
    if !llm.apikey.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", llm.apikey));
    }
    let mut res = req.send(body.to_string()).map_err(|e| format!("LLM: {e}"))?;
    let status = res.status();
    let text = res.body_mut().read_to_string().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let v: Value = serde_json::from_str(&text).unwrap_or_default();
        // Gemini a veces envuelve el error en un array: [{"error": …}]
        let msg = v["error"]["message"].as_str().or(v[0]["error"]["message"].as_str()).unwrap_or(&text);
        return Err(format!("LLM {}: {}", status.as_u16(), msg.chars().take(200).collect::<String>()));
    }
    let v: Value = serde_json::from_str(&text).map_err(|_| "LLM: respuesta no es JSON".to_string())?;
    parse_tasks(v["choices"][0]["message"]["content"].as_str().unwrap_or("")).map_err(|e| format!("LLM: {e}"))
}

/// Postproceso: transcripción limpia → LLM → tareas sugeridas (tabla meeting_tasks), con notificación.
/// Reintentar reemplaza las pendientes de esa reunión; las aceptadas o descartadas se quedan.
fn finalize(app: &AppHandle, llms: &[Llm], id: u64, lines: &[Line]) -> Result<String, String> {
    let mut model = String::new();
    let tasks = ask_any(llms, &condense(lines), |m| {
        model = m.to_string();
        update(app, |g| g.snap.status = format!("Buscando tareas en la reunión ({m})…"));
    })?;
    let n = tasks.len();
    let pool = &app.state::<crate::db::Db>().0;
    let id = json!(id);
    let run = |sql: &str, args: &[Value]| block_on(crate::db::execute(pool, sql, args)).map_err(|e| e.to_string());
    run("DELETE FROM meeting_tasks WHERE meeting = $1 AND status = 'pending'", &[id.clone()])?;
    for (title, detail) in tasks {
        run("INSERT INTO meeting_tasks (meeting, title, detail) VALUES ($1, $2, $3)", &[id.clone(), json!(title), json!(detail)])?;
    }
    let _ = app.emit("db://changed", ());
    let msg = match n {
        0 => "No encontré tareas para ti".to_string(),
        1 => "1 tarea sugerida".to_string(),
        n => format!("{n} tareas sugeridas"),
    };
    crate::timer::send_notification(app.clone(), "Reunión revisada".into(), format!("{msg}. Revísalas en el panel."));
    Ok(format!("Reunión revisada con {model}: {}", msg.to_lowercase()))
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use screencapturekit::prelude::*;
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    const MODEL: &str = "ggml-large-v3-turbo-q5_0.bin";
    const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";
    /// ponytail: idioma fijo; "auto" en fragmentos de 15 s confunde idiomas a veces. Pref si hay reuniones en inglés.
    const LANG: &str = "es";
    const WHO: [&str; 2] = ["Yo", "Otros"];

    type Bufs = Arc<Mutex<[Vec<f32>; 2]>>; // 0 = micrófono, 1 = audio del sistema

    /// Para el estado en vivo: muestras recibidas y pico desde la última lectura (bits de f32 >= 0, así
    /// `fetch_max` sobre los bits ordena igual que sobre los f32).
    #[derive(Default)]
    struct Meter {
        got: [AtomicUsize; 2],
        peak: [AtomicU32; 2],
    }

    struct Capture(Bufs, Arc<Meter>);

    impl SCStreamOutputTrait for Capture {
        fn did_output_sample_buffer(&self, sample: CMSampleBuffer, kind: SCStreamOutputType) {
            let src = match kind {
                SCStreamOutputType::Microphone => 0,
                SCStreamOutputType::Audio => 1,
                SCStreamOutputType::Screen => return,
            };
            let fd = sample.format_description();
            let rate = fd.as_ref().and_then(|f| f.audio_sample_rate()).unwrap_or(RATE as f64);
            // El audio del sistema llega en float32, pero el micrófono puede llegar en enteros (16 bits): leerlo
            // como float lo dejaba a media velocidad y "en silencio".
            let float = fd.as_ref().is_none_or(|f| f.audio_is_float());
            let bits = fd.as_ref().and_then(|f| f.audio_bits_per_channel()).unwrap_or(32);
            let Ok(list) = sample.audio_buffer_list() else { return };
            // ponytail: solo el primer canal (un buffer por canal, o intercalados en uno: `step` los salta).
            let Some(b) = list.get(0) else { return };
            let mono = super::decode(b.data(), float, bits, b.number_channels.max(1) as usize);
            let out = resample(&mono, rate);
            let peak = out.iter().fold(0f32, |a, v| a.max(v.abs()));
            self.1.got[src].fetch_add(out.len(), Ordering::Relaxed);
            self.1.peak[src].fetch_max(peak.to_bits(), Ordering::Relaxed);
            self.0.lock().unwrap()[src].extend_from_slice(&out);
        }
    }

    /// Lineal a 16 kHz (el micrófono puede llegar a la tasa del dispositivo aunque se pidan 16 kHz).
    fn resample(x: &[f32], rate: f64) -> Vec<f32> {
        if (rate - RATE as f64).abs() < 1.0 || x.is_empty() {
            return x.to_vec();
        }
        let ratio = rate / RATE as f64;
        let n = (x.len() as f64 / ratio) as usize;
        (0..n)
            .map(|i| {
                let p = i as f64 * ratio;
                let (j, f) = (p as usize, (p.fract()) as f32);
                let a = x[j];
                let b = *x.get(j + 1).unwrap_or(&a);
                a + (b - a) * f
            })
            .collect()
    }

    fn model_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
        let path = dir.join(MODEL);
        if path.exists() {
            return Ok(path);
        }
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        update(app, |g| g.snap.status = "Descargando el modelo de voz (~550 MB, solo la primera vez)…".into());
        let tmp = dir.join(format!("{MODEL}.part"));
        let ok = std::process::Command::new("curl")
            .args(["-fsSL", "--retry", "3", "-o"])
            .arg(&tmp)
            .arg(MODEL_URL)
            .status()
            .map_err(|e| e.to_string())?
            .success();
        if !ok {
            return Err("no se pudo descargar el modelo de voz".into());
        }
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        Ok(path)
    }

    /// Permiso de Micrófono. ScreenCaptureKit no lo pide solo: sin él entrega el micrófono vacío y toda la
    /// reunión queda como "Otros". Pide el permiso la primera vez (bloquea hasta que el usuario responda).
    fn mic_permission() -> Result<(), String> {
        use objc2::{class, msg_send, runtime::Bool};
        use objc2_foundation::NSString;
        #[link(name = "AVFoundation", kind = "framework")]
        extern "C" {}
        let audio = NSString::from_str("soun"); // AVMediaTypeAudio
        // AVAuthorizationStatus: 0 notDetermined, 1 restricted, 2 denied, 3 authorized
        let status: isize = unsafe { msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: &*audio] };
        let granted = match status {
            3 => true,
            0 => {
                let (tx, rx) = std::sync::mpsc::channel();
                let block = block2::RcBlock::new(move |ok: Bool| {
                    let _ = tx.send(ok.as_bool());
                });
                let _: () = unsafe {
                    msg_send![class!(AVCaptureDevice), requestAccessForMediaType: &*audio, completionHandler: &*block]
                };
                rx.recv().unwrap_or(false)
            }
            _ => false,
        };
        granted
            .then_some(())
            .ok_or_else(|| "falta el permiso de Micrófono (Ajustes del Sistema → Privacidad → Micrófono)".to_string())
    }

    fn start_capture(bufs: Bufs, meter: Arc<Meter>) -> Result<SCStream, String> {
        mic_permission()?;
        // Apple fija el micrófono explícitamente (uniqueID del dispositivo por defecto); sin id no llega audio.
        let mic = screencapturekit::audio_devices::AudioInputDevice::default_device().ok_or("no hay micrófono")?;
        let content = SCShareableContent::get().map_err(|_| {
            "falta el permiso de Grabación de pantalla y audio del sistema (Ajustes del Sistema → Privacidad)".to_string()
        })?;
        let display = content.displays().into_iter().next().ok_or("no hay pantalla")?;
        let filter = SCContentFilter::create().with_display(&display).with_excluding_windows(&[]).build().map_err(|e| e.to_string())?;
        // Solo interesa el audio: video mínimo (2x2 a 1 fps) porque ScreenCaptureKit exige una pantalla.
        let config = SCStreamConfiguration::new()
            .with_width(2)
            .with_height(2)
            .with_minimum_frame_interval(&CMTime::new(1, 1))
            .with_captures_audio(true)
            .with_excludes_current_process_audio(true)
            .with_sample_rate(RATE as i32)
            .with_channel_count(1)
            .with_captures_microphone(true)
            .map_err(|e| e.to_string())?
            .with_microphone_capture_device_id(&mic.id)
            .map_err(|e| e.to_string())?;
        let mut stream = SCStream::new(&filter, &config).map_err(|e| e.to_string())?;
        stream.add_output_handler(Capture(bufs.clone(), meter.clone()), SCStreamOutputType::Audio).map_err(|e| e.to_string())?;
        stream.add_output_handler(Capture(bufs, meter), SCStreamOutputType::Microphone).map_err(|e| e.to_string())?;
        stream.start_capture().map_err(|e| e.to_string())?;
        Ok(stream)
    }

    pub fn transcribe(ws: &mut whisper_rs::WhisperState, audio: &[f32]) -> String {
        let mut p = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        p.set_language(Some(LANG));
        p.set_no_context(true); // sin arrastrar texto: evita bucles de repetición entre fragmentos
        p.set_suppress_blank(true);
        p.set_n_threads(4);
        p.set_print_progress(false);
        p.set_print_realtime(false);
        p.set_print_special(false);
        p.set_print_timestamps(false);
        if ws.full(p, audio).is_err() {
            return String::new();
        }
        ws.as_iter().filter(|s| s.no_speech_probability() < 0.6).map(|s| s.to_string()).collect::<Vec<_>>().join(" ")
    }

    /// `WHISPER_MODEL=…/ggml-large-v3-turbo-q5_0.bin AUDIO_F32=voz.f32 cargo test --lib probar_whisper -- --ignored --nocapture`
    /// (audio crudo f32 16 kHz mono: `ffmpeg -i x.wav -ar 16000 -ac 1 -f f32le voz.f32`).
    #[test]
    #[ignore]
    fn probar_whisper() {
        let env = |k: &str| std::env::var(k).unwrap();
        let bytes = std::fs::read(env("AUDIO_F32")).unwrap();
        let audio: Vec<f32> = bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        let ctx = WhisperContext::new_with_params(env("WHISPER_MODEL"), WhisperContextParameters::default()).unwrap();
        let mut ws = ctx.create_state().unwrap();
        let mut buf = audio.clone();
        let t = std::time::Instant::now();
        while let Some(chunk) = take_chunk(&mut buf, false).or_else(|| take_chunk(&mut buf, true)) {
            println!("[{:.1}s audio] {}", chunk.len() as f32 / RATE as f32, transcribe(&mut ws, &chunk));
        }
        println!("{:.2}s para {:.1}s de audio", t.elapsed().as_secs_f32(), audio.len() as f32 / RATE as f32);
    }

    pub fn run(app: &AppHandle, stop: &AtomicBool, llms: &[Llm]) -> Result<(), String> {
        let path = model_path(app)?;
        update(app, |g| g.snap.status = "Cargando el modelo de voz…".into());
        whisper_rs::install_logging_hooks(); // sin logger, silencia el log de whisper.cpp en la consola
        let ctx = WhisperContext::new_with_params(&path, WhisperContextParameters::default())
            .map_err(|e| format!("whisper: {e}"))?;
        let mut ws = ctx.create_state().map_err(|e| format!("whisper: {e}"))?;
        let mut transcribe = |audio: &[f32]| transcribe(&mut ws, audio);

        let bufs: Bufs = Arc::default();
        let meter: Arc<Meter> = Arc::default();
        let stream = start_capture(bufs.clone(), meter.clone())?;
        update(app, |g| g.snap.status = "Escuchando…".into());
        // "Escuchando · Yo 0:42 con voz · Otros 0:10 en silencio": muestra si de verdad llega audio de cada fuente.
        let listening = || {
            let src = |i: usize| {
                let secs = meter.got[i].load(Ordering::Relaxed) / RATE;
                let peak = f32::from_bits(meter.peak[i].swap(0, Ordering::Relaxed));
                let how = if secs == 0 { "sin audio" } else if peak < SILENCE { "en silencio" } else { "con voz" };
                format!("{} {}:{:02} {how}", WHO[i], secs / 60, secs % 60)
            };
            format!("Escuchando · {} · {}", src(0), src(1))
        };

        let mut lines: Vec<Line> = vec![];
        let mut push = |app: &AppHandle, lines: &mut Vec<Line>, flush: bool| {
            for src in 0..2 {
                while let Some(chunk) = take_chunk(&mut bufs.lock().unwrap()[src], flush) {
                    if rms(&chunk) < SILENCE / 2.0 {
                        continue; // todo silencio: whisper alucinaría
                    }
                    let secs = chunk.len() / RATE;
                    update(app, |g| g.snap.status = format!("Transcribiendo {secs} s de {}…", WHO[src]));
                    if let Some(text) = clean(&transcribe(&chunk)) {
                        let line = Line { who: WHO[src], text };
                        lines.push(line.clone());
                        update(app, |g| g.snap.lines.push(line));
                    }
                }
            }
        };

        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(300));
            push(app, &mut lines, false);
            let st = listening();
            update(app, |g| g.snap.status = st);
        }

        let _ = stream.stop_capture();
        update(app, |g| g.snap.status = "Transcribiendo lo último…".into());
        push(app, &mut lines, true);
        if !lines.is_empty() {
            let id = save(app, &lines);
            update(app, |g| g.snap.status = "Buscando tareas en la reunión…".into());
            let msg = finalize(app, llms, id, &lines)?;
            update(app, |g| g.snap.status = msg);
        }
        Ok(())
    }

    /// Guarda la transcripción en $APPDATA/meetings/<epoch>.md y devuelve el epoch (id de la reunión).
    fn save(app: &AppHandle, lines: &[Line]) -> u64 {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        if let Some(dir) = meetings_dir(app) {
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(dir.join(format!("{secs}.md")), fmt_lines(lines));
        }
        secs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(secs: f32, amp: f32) -> Vec<f32> {
        (0..(secs * RATE as f32) as usize).map(|i| amp * (i as f32 * 0.05).sin()).collect()
    }

    #[test]
    fn corta_en_el_silencio() {
        // 9 s de voz + 0,5 s de silencio + 3 s de voz: corta dentro del silencio y deja el resto.
        let mut buf = [tone(9.0, 0.3), vec![0.0; RATE / 2], tone(3.0, 0.3)].concat();
        let total = buf.len();
        let chunk = take_chunk(&mut buf, false).expect("debe cortar");
        assert!(chunk.len() > 9 * RATE && chunk.len() < 9 * RATE + RATE / 2);
        assert_eq!(chunk.len() + buf.len(), total);
    }

    #[test]
    fn espera_sin_silencio_y_corta_al_maximo() {
        let mut buf = tone(12.0, 0.3);
        assert!(take_chunk(&mut buf, false).is_none());
        let mut buf = tone(25.0, 0.3);
        assert!(take_chunk(&mut buf, false).unwrap().len() <= MAX_S * RATE);
        let mut buf = tone(2.0, 0.3);
        assert_eq!(take_chunk(&mut buf, true).unwrap().len(), 2 * RATE);
        assert!(take_chunk(&mut buf, true).is_none());
    }

    #[test]
    fn decodifica_pcm() {
        let f: Vec<u8> = [0.5f32, -0.25].iter().flat_map(|v| v.to_le_bytes()).collect();
        assert_eq!(decode(&f, true, 32, 1), vec![0.5, -0.25]);
        let i: Vec<u8> = [16_384i16, -32_768, 1, 2].iter().flat_map(|v| v.to_le_bytes()).collect();
        assert_eq!(decode(&i, false, 16, 1), vec![0.5, -1.0, 1.0 / 32_768.0, 2.0 / 32_768.0]);
        assert_eq!(decode(&i, false, 16, 2), vec![0.5, 1.0 / 32_768.0]); // estéreo intercalado: primer canal
        assert!(decode(&i, false, 24, 1).is_empty());
    }

    #[test]
    fn filtra_alucinaciones() {
        assert_eq!(clean("  Mándame el informe el lunes. "), Some("Mándame el informe el lunes.".into()));
        assert_eq!(clean("Subtítulos realizados por la comunidad de Amara.org"), None);
        assert_eq!(clean("[Música]"), None);
        assert_eq!(clean(" . "), None);
    }

    #[test]
    fn limpia_la_transcripcion() {
        let l = |who, text: &str| Line { who, text: text.into() };
        let out = condense(&[
            l("Otros", "Necesito que me mandes la propuesta antes del jueves."),
            l("Yo", "necesito que me mandes la propuesta antes del jueves"), // eco sin audífonos
            l("Yo", "Ya, perfecto."),                                         // muletilla
            l("Yo", "Te la mando el miércoles."),
            l("Yo", "Te la mando el miércoles."), // whisper repitió
            l("Yo", "En la tarde."),
            l("Otros", "Genial, gracias."),
            l("Otros", "¿Y tú, Ana, revisas el contrato?"), // otra persona: no se une
        ]);
        let got: Vec<_> = out.iter().map(|l| format!("{}: {}", l.who, l.text)).collect();
        assert_eq!(
            got,
            [
                "Otros: Necesito que me mandes la propuesta antes del jueves.",
                "Yo: Te la mando el miércoles. En la tarde.",
                "Otros: Genial, gracias.",
                "Otros: ¿Y tú, Ana, revisas el contrato?",
            ]
        );
    }

    #[test]
    fn lee_el_json_del_modelo() {
        let out = "<think>{no}</think>Claro: {\"tareas\":[{\"titulo\":\"Enviar informe\",\"detalle\":\"Ana, lunes\"},{\"titulo\":\" \"}]}";
        assert_eq!(parse_tasks(out), Ok(vec![("Enviar informe".into(), "Ana, lunes".into())]));
        assert_eq!(parse_tasks("{\"tareas\":[]}"), Ok(vec![]));
        assert!(parse_tasks("sin json").is_err());
        assert!(parse_tasks("} {").is_err());
        assert!(parse_tasks("{\"tasks\":[]}").is_err()); // clave equivocada ≠ cero tareas
    }

    #[test]
    fn prueba_todos_los_modelos_en_orden() {
        // Sin key ninguno llega a la red: cada uno falla y pasa al siguiente.
        let llm = |p: &str, m: &[&str]| Llm { provider: p.into(), apikey: "".into(), models: m.iter().map(|s| s.to_string()).collect() };
        let mut tried = vec![];
        let err = ask_any(&[llm("gemini", &["a", "b"]), llm("https://x.dev/v1", &["c"])], &[], |m| tried.push(m.to_string()));
        assert_eq!(tried, ["a", "b", "c"]);
        assert_eq!(err.unwrap_err(), "a: falta la API key · b: falta la API key · c: falta la API key");
        assert!(ask_any(&[], &[], |_| {}).is_err());
        assert_eq!(base_url("Gemini"), "https://generativelanguage.googleapis.com/v1beta/openai");
    }

    #[test]
    fn relee_la_transcripcion_guardada() {
        let lines = vec![Line { who: "Yo", text: "Hora: 10:30".into() }, Line { who: "Otros", text: "ok".into() }];
        let back = parse_lines(&format!("{}\nbasura sin hablante", fmt_lines(&lines)));
        assert_eq!(fmt_lines(&back), fmt_lines(&lines));
    }
}

/// Prueba el postproceso con una transcripción de ejemplo:
/// `MEETING_TXT=reunion.txt LLM_MODEL=qwen3.5:9b cargo test --lib probar_llm -- --ignored --nocapture`
/// (líneas "Yo: …" / "Otros: …"; LLM_PROVIDER y LLM_KEY opcionales, por defecto Ollama local).
#[cfg(test)]
#[test]
#[ignore]
fn probar_llm() {
    let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.into());
    let llm = Llm { provider: env("LLM_PROVIDER", "ollama"), apikey: env("LLM_KEY", ""), models: vec![env("LLM_MODEL", "qwen3.5:9b")] };
    let text = std::fs::read_to_string(env("MEETING_TXT", "reunion.txt")).unwrap();
    let lines: Vec<Line> = text
        .lines()
        .filter_map(|l| l.split_once(": "))
        .map(|(w, t)| Line { who: if w == "Yo" { "Yo" } else { "Otros" }, text: t.into() })
        .collect();
    let clean = condense(&lines);
    println!("{} líneas → {} tras limpiar", lines.len(), clean.len());
    let t = std::time::Instant::now();
    let tasks = ask_any(&[llm], &clean, |m| println!("probando {m}")).unwrap();
    println!("{:.1}s", t.elapsed().as_secs_f32());
    for (title, detail) in tasks {
        println!("  + {title} — {detail}");
    }
}
