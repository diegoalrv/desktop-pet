//! Reuniones: durante la reunión escucha el micrófono ("Yo") y el audio del sistema ("Otros") por separado y
//! transcribe en local con whisper por fragmentos. Al terminar guarda la transcripción, la limpia (`condense`)
//! y la manda completa, en una sola llamada, a un LLM compatible con OpenAI (Gemini, Claude, Ollama) que
//! devuelve las tareas sugeridas, un resumen y las decisiones.
//!
//! Modo gestión (`manage`): solo el micrófono, para dictar cómo ordenar las tareas. Al terminar el LLM recibe
//! además las tareas pendientes y devuelve acciones (crear, editar, completar) que el usuario aprueba una a una.

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
        "candola" => "https://ai.spadelab.xyz/v1", // proxy propio (LiteLLM → Bedrock), key por tester
        _ => provider.trim(),
    }
}

#[derive(Clone, Default, Serialize)]
pub struct Snapshot {
    active: bool,
    manage: bool, // modo gestión: solo micrófono, el LLM devuelve acciones sobre las tareas
    status: String,
    lines: Vec<Line>,
    summary: String, // de la última reunión revisada (meeting_notes)
    decisions: Vec<String>,
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

/// Hay una reunión (o un dictado de Gestión) grabando: el micrófono está ocupado.
pub fn recording(app: &AppHandle) -> bool {
    app.state::<MeetingState>().0.lock().unwrap().stop.is_some()
}

#[tauri::command]
pub fn meeting_state(state: State<MeetingState>) -> Snapshot {
    state.0.lock().unwrap().snap.clone()
}

/// Evento del calendario que estaba ocurriendo al empezar (lo manda el panel o la web). Se guarda como cabecera
/// YAML del .md y el LLM lo recibe para saber de qué era la reunión y quién estaba.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Ctx {
    pub title: String,
    #[serde(default)]
    pub attendees: Vec<String>,
}

#[derive(Serialize)]
pub struct Saved {
    id: u64, // epoch s = nombre del .md
    text: String, // sin la cabecera
    #[serde(flatten)]
    ctx: Option<Ctx>, // title, attendees
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
            let raw = std::fs::read_to_string(&p).ok()?;
            let (ctx, text) = parse_head(&raw);
            Some(Saved { id, text: text.to_string(), ctx })
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

/// Deja el panel en blanco tras una reunión (estado y transcripción en vivo). La transcripción guardada y las
/// tareas sugeridas no se tocan. Con una reunión en curso no hace nada.
#[tauri::command]
pub fn meeting_reset(app: AppHandle, state: State<MeetingState>) {
    let idle = state.0.lock().unwrap().stop.is_none();
    if idle {
        update(&app, |g| g.snap = Snapshot::default());
    }
}

#[tauri::command]
pub fn meeting_start(app: AppHandle, state: State<MeetingState>, llms: Vec<Llm>, manage: bool, ctx: Option<Ctx>) -> Result<(), String> {
    if !cfg!(any(target_os = "macos", target_os = "windows")) {
        return Err("Escuchar reuniones no está disponible en este sistema".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut g = state.0.lock().unwrap();
        if g.stop.is_some() {
            return Ok(());
        }
        g.stop = Some(stop.clone());
    }
    let llms = crate::ai::llms(&app, llms);
    let ctx = ctx.filter(|_| !manage); // el dictado de gestión no es una reunión del calendario
    update(&app, |g| {
        g.snap = Snapshot { active: true, manage, status: "Preparando…".into(), ..Default::default() };
    });
    std::thread::spawn(move || {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let res = local::run(&app, &stop, &llms, manage, ctx);
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let res: Result<(), String> = Ok(());
        update(&app, |g| {
            g.stop = None;
            g.snap.active = false;
            g.snap.status = match res {
                Ok(()) if g.snap.status.contains(" revisada con ") => g.snap.status.clone(),
                Ok(()) if manage => "Gestión terminada".into(),
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
    let llms = crate::ai::llms(&app, llms);
    let saved = meetings_list(app.clone());
    let m = match id {
        Some(id) => saved.into_iter().find(|m| m.id == id),
        None => saved.into_iter().next(),
    }
    .ok_or("No hay reuniones guardadas")?;
    let (id, lines, manage, ctx) = (m.id, parse_lines(&m.text), m.text.starts_with(MANAGE_HEADER), m.ctx);
    if lines.is_empty() {
        return Err("La transcripción está vacía".into());
    }
    update(&app, |g| {
        g.snap.lines = lines.clone();
        g.snap.manage = manage;
        (g.snap.summary, g.snap.decisions) = Default::default();
        g.snap.status = "Buscando tareas en la reunión…".into();
    });
    std::thread::spawn(move || {
        let res = finalize(&app, &llms, id, &lines, manage, ctx.as_ref());
        update(&app, |g| {
            g.snap.status = match res {
                Ok(m) => m,
                Err(e) => format!("Error: {e}"),
            };
        });
    });
    Ok(())
}

/// Primera línea del .md de una sesión de gestión (`parse_lines` la ignora: no empieza por "Yo: ").
const MANAGE_HEADER: &str = "# gestión\n";

fn meetings_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("meetings"))
}

/// Cabecera YAML del .md (los valores van en JSON, que también es YAML válido: títulos con ":" no la rompen).
fn fmt_head(c: &Ctx) -> String {
    format!("---\ntitle: {}\nattendees: {}\n---\n", json!(c.title), json!(c.attendees))
}

/// Inverso de `fmt_head`: (contexto, resto del .md). Sin cabecera devuelve el texto tal cual.
pub fn parse_head(s: &str) -> (Option<Ctx>, &str) {
    let Some((head, body)) = s.strip_prefix("---\n").and_then(|r| r.split_once("\n---\n")) else { return (None, s) };
    let field = |k: &str| head.lines().find_map(|l| l.strip_prefix(k)?.strip_prefix(": ")).and_then(|v| serde_json::from_str::<Value>(v).ok());
    let ctx = Ctx {
        title: field("title").and_then(|v| v.as_str().map(String::from)).unwrap_or_default(),
        attendees: field("attendees").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default(),
    };
    (Some(ctx), body)
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

/// Saca un fragmento listo para transcribir: con al menos MIN_S s, cortado donde `cut` encuentre una pausa (recibe
/// hasta MAX_S s del búfer y devuelve la posición) o, si no la hay y ya se llegó a MAX_S, en la ventana más
/// silenciosa. `flush` entrega lo que quede.
pub fn take_chunk_with(buf: &mut Vec<f32>, flush: bool, cut: impl FnOnce(&[f32]) -> Option<usize>) -> Option<Vec<f32>> {
    if flush {
        return (!buf.is_empty()).then(|| std::mem::take(buf));
    }
    let (min, max) = (MIN_S * RATE, MAX_S * RATE);
    if buf.len() < min + WIN {
        return None;
    }
    let x = &buf[..buf.len().min(max)];
    let at = cut(x).filter(|i| (min..=x.len()).contains(i)).or_else(|| (buf.len() >= max).then(|| quietest(x).0))?;
    let rest = buf.split_off(at);
    Some(std::mem::replace(buf, rest))
}

/// Con el umbral de RMS, como corta la app si no hay modelo de VAD.
#[cfg(test)]
pub fn take_chunk(buf: &mut Vec<f32>, flush: bool) -> Option<Vec<f32>> {
    take_chunk_with(buf, flush, rms_cut)
}

/// Centro de la ventana más silenciosa después de MIN_S, con su RMS.
fn quietest(x: &[f32]) -> (usize, f32) {
    (MIN_S * RATE..=x.len() - WIN)
        .step_by(WIN / 2)
        .map(|i| (i + WIN / 2, rms(&x[i..i + WIN])))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .unwrap_or((x.len(), 0.0))
}

/// Corte por RMS: la ventana más silenciosa, si de verdad es silencio. Con ruido de fondo sobre SILENCE no
/// encuentra nada y el fragmento espera hasta MAX_S.
fn rms_cut(x: &[f32]) -> Option<usize> {
    let (i, r) = quietest(x);
    (r < SILENCE).then_some(i)
}

/// Corte con VAD (segmentos con voz `(ini, fin)` en muestras): el centro de la última pausa que deje al menos MIN_S
/// antes y no quede pegada al final (ahí la voz puede seguir). Sin voz en todo el búfer, se corta ya (y se descarta).
pub fn last_pause(speech: &[(usize, usize)], len: usize) -> Option<usize> {
    if speech.is_empty() {
        return Some(len - WIN / 2);
    }
    let mut gaps: Vec<(usize, usize)> = speech.windows(2).map(|w| (w[0].1, w[1].0)).collect();
    gaps.push((speech[speech.len() - 1].1, len));
    gaps.iter().rev().map(|(a, b)| (a + b) / 2).find(|c| *c >= MIN_S * RATE && c + WIN / 2 <= len)
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
Además resume la reunión en 3 a 5 frases cortas (de qué se habló y en qué quedó; máximo 80 palabras) y lista las decisiones: acuerdos que se \
tomaron explícitamente, no temas que quedaron abiertos.\n\
Responde únicamente JSON: {\"resumen\":\"3 a 5 frases\",\"decisiones\":[\"qué se decidió, una frase\"],\
\"tareas\":[{\"titulo\":\"verbo en infinitivo + qué, máximo 80 caracteres\",\
\"detalle\":\"quién lo pidió y plazo si se mencionó; breve\"}]}. Sin tareas: \"tareas\":[]; sin decisiones: \"decisiones\":[].";

/// Con el evento del calendario y el nombre del usuario el modelo acierta mejor quién pidió qué.
/// Sin micrófono (ninguna línea "Yo") el prompt normal casi nunca encuentra tareas: no hay compromisos del usuario.
fn prompt(lines: &[Line], ctx: Option<&Ctx>, me: &str) -> String {
    let mut p = PROMPT.to_string();
    if let Some(c) = ctx {
        p += &format!("\nReunión: {}.", c.title);
        if !c.attendees.is_empty() {
            p += &format!(" Participantes: {}.", c.attendees.join(", "));
        }
    }
    if !me.is_empty() {
        p += &format!(" \"Yo\" es {me}.");
    }
    if !lines.iter().any(|l| l.who == "Yo") {
        p += "\nOJO: en esta reunión no se grabó el micrófono del usuario; todas las líneas son \"Otros\". Incluye \
              también lo que le piden o asignan a quien escucha y los acuerdos o pendientes de la reunión que no tengan \
              un responsable claro; el usuario revisará cada una.";
    }
    p
}

/// Nombre del usuario (Ajustes → Reuniones), leído de settings.json: sirve igual si la reunión empezó en la web.
fn user_name(app: &AppHandle) -> String {
    use tauri_plugin_store::StoreExt;
    let prefs = app.store("settings.json").ok().and_then(|s| s.get("prefs")).unwrap_or_default();
    prefs["userName"].as_str().unwrap_or("").trim().to_string()
}

const MANAGE_PROMPT: &str = "Eres el asistente personal del usuario. Recibes su lista de tareas pendientes (cada una con su id) \
y la transcripción automática de lo que dictó al micrófono (puede tener errores de reconocimiento) para ordenar sus tareas.\n\
Devuelve las acciones que pidió: crear tareas nuevas, editar existentes (título, proyecto, prioridad, fecha, pomodoros) \
o completar existentes. Solo lo que pidió explícitamente; no inventes. Para editar o completar usa el id de la lista; si \
ninguna tarea calza claramente con lo que dice, no inventes un id (crea una nueva solo si lo pidió). Resuelve fechas \
relativas (\"el viernes\", \"pasado mañana\", \"en dos semanas\") con la fecha de hoy, en formato AAAA-MM-DD. Prioridad: \
0 baja, 1 media, 2 alta. Pomodoros = bloques de foco de 25 min estimados.\n\
Responde únicamente JSON: {\"acciones\":[{\"op\":\"crear\",\"titulo\":\"verbo en infinitivo + qué, máximo 80 caracteres\",\
\"proyecto\":\"nombre o null\",\"prioridad\":1,\"fecha\":\"AAAA-MM-DD o null\",\"pomodoros\":1,\"detalle\":\"contexto breve o vacío\"},\
{\"op\":\"editar\",\"id\":14,\"fecha\":\"2026-10-27\"},{\"op\":\"completar\",\"id\":9}]}. En \"editar\" incluye solo los campos que \
cambian. Si no hay acciones: {\"acciones\":[]}.";

/// Acción sobre las tareas propuesta por el LLM en modo gestión. Se guarda tal cual (JSON) en meeting_tasks.action y
/// el frontend la aplica al aceptar (src/lib/suggestions.ts).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Action {
    pub op: String, // crear | editar | completar
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub titulo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proyecto: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prioridad: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fecha: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pomodoros: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detalle: Option<String>,
}

/// Tarea pendiente tal como se le describe al LLM.
pub struct Pending {
    pub id: i64,
    pub title: String,
    pub project: Option<String>,
    pub priority: i64,
    pub due: Option<String>, // AAAA-MM-DD
    pub pomodoros: i64,
}

/// Mensaje de usuario del modo gestión: fecha de hoy, pendientes con id y la transcripción.
pub fn manage_input(today: &str, pending: &[Pending], lines: &[Line]) -> String {
    const PRIO: [&str; 3] = ["baja", "media", "alta"];
    let tasks: Vec<String> = pending
        .iter()
        .map(|t| {
            let mut extra = vec![];
            if let Some(p) = &t.project {
                extra.push(format!("proyecto: {p}"));
            }
            extra.push(format!("prioridad: {}", PRIO[t.priority.clamp(0, 2) as usize]));
            if let Some(d) = &t.due {
                extra.push(format!("vence: {d}"));
            }
            extra.push(format!("{} pomodoros", t.pomodoros));
            format!("- [{}] {} ({})", t.id, t.title, extra.join("; "))
        })
        .collect();
    let tasks = if tasks.is_empty() { "(ninguna)".to_string() } else { tasks.join("\n") };
    format!("Hoy es {today}.\nTareas pendientes:\n{tasks}\nTranscripción:\n{}", fmt_lines(lines))
}

/// Acciones del JSON del modelo, ya validadas: ids que existan entre los pendientes, "crear" con título, "editar"
/// con algo que cambiar, prioridad en 0..=2 y fecha AAAA-MM-DD (otra cosa se descarta). Sin `{"acciones":[…]}` = error.
pub fn parse_actions(content: &str, ids: &[i64]) -> Result<Vec<Action>, String> {
    let v = json_of(content, "acciones")?;
    let v = v["acciones"].as_array().into_iter().flatten();
    let date_ok = |d: &str| d.len() == 10 && d.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
    let clean = |s: Option<&str>| s.map(str::trim).filter(|s| !s.is_empty()).map(|s| s.chars().take(120).collect::<String>());
    Ok(v
        .filter_map(|a| {
            let mut act = Action {
                op: a["op"].as_str()?.trim().to_lowercase(),
                id: a["id"].as_i64(),
                titulo: clean(a["titulo"].as_str()),
                proyecto: clean(a["proyecto"].as_str()),
                prioridad: a["prioridad"].as_i64().filter(|p| (0..=2).contains(p)),
                fecha: clean(a["fecha"].as_str()).filter(|d| date_ok(d)),
                pomodoros: a["pomodoros"].as_i64().filter(|p| (1..=20).contains(p)),
                detalle: clean(a["detalle"].as_str()),
            };
            let known = act.id.is_some_and(|id| ids.contains(&id));
            let changes = act.titulo.is_some() || act.proyecto.is_some() || act.prioridad.is_some() || act.fecha.is_some() || act.pomodoros.is_some();
            match act.op.as_str() {
                "crear" if act.titulo.is_some() => act.id = None,
                "editar" if known && changes => act.detalle = None,
                "completar" if known => act = Action { op: act.op, id: act.id, titulo: None, proyecto: None, prioridad: None, fecha: None, pomodoros: None, detalle: None },
                _ => return None,
            }
            Some(act)
        })
        .collect())
}

/// El JSON que venga en la respuesta, que debe traer el array `key`; tolera texto o `<think>…</think>` alrededor.
/// Lee el primer objeto completo: lo que siga (una "explicación" con más llaves, como agrega Nova) se ignora.
fn json_of(content: &str, key: &str) -> Result<Value, String> {
    let c = content.rsplit("</think>").next().unwrap_or(content);
    let bad = || format!("respuesta sin JSON de {key}: {}", c.trim().chars().take(120).collect::<String>());
    let a = c.find('{').ok_or_else(bad)?;
    let v: Value = serde_json::Deserializer::from_str(&c[a..]).into_iter().next().and_then(Result::ok).ok_or_else(bad)?;
    if v[key].is_array() { Ok(v) } else { Err(bad()) }
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

/// Lo que el LLM devuelve de una reunión normal.
#[derive(Debug, Default, PartialEq)]
pub struct Outcome {
    pub tareas: Vec<(String, String)>, // (título, detalle)
    pub resumen: String,
    pub decisiones: Vec<String>,
}

/// Tareas, resumen y decisiones del JSON del modelo; tolera texto o `<think>…</think>` alrededor.
/// Respuesta sin `{"tareas":[…]}` = error (pasa al siguiente modelo), no "cero tareas"; resumen y decisiones que
/// falten quedan vacíos (un resumen en array de líneas se une).
pub fn parse_result(content: &str) -> Result<Outcome, String> {
    let v = json_of(content, "tareas")?;
    let strs = |k: &str| -> Vec<String> {
        let items = v[k].as_array().into_iter().flatten().filter_map(|x| x.as_str()).map(str::trim);
        items.filter(|s| !s.is_empty()).map(String::from).collect()
    };
    let tareas = v["tareas"].as_array().into_iter().flatten().filter_map(|t| {
        let title = t["titulo"].as_str()?.trim();
        let detail = t["detalle"].as_str().unwrap_or("").trim();
        (!title.is_empty()).then(|| (title.chars().take(120).collect(), detail.to_string()))
    });
    let resumen = v["resumen"].as_str().map(|s| s.trim().to_string()).unwrap_or_else(|| strs("resumen").join("\n"));
    Ok(Outcome { tareas: tareas.collect(), resumen, decisiones: strs("decisiones") })
}

/// Prueba cada proveedor y, dentro de él, cada modelo en orden hasta que uno responda (sobrecarga, cuota, key
/// inválida… cualquier error pasa al siguiente). `on_try` avisa cuál se está probando.
fn ask_any<T>(llms: &[Llm], system: &str, user: &str, parse: impl Fn(&str) -> Result<T, String>, mut on_try: impl FnMut(&str)) -> Result<T, String> {
    let mut errs = vec![];
    for llm in llms {
        for model in &llm.models {
            on_try(model);
            match ask(llm, model, system, user).and_then(|c| parse(&c)) {
                Ok(t) => return Ok(t),
                Err(e) if llm.provider == "candola" => errs.push(e), // ya viene en palabras del tester (ai::friendly)
                Err(e) => errs.push(format!("{model}: {e}")),
            }
        }
    }
    Err(if errs.is_empty() { "no hay modelos configurados (Ajustes → Reuniones)".into() } else { errs.join(" · ") })
}

/// `claude -p` (Claude Code instalado y con sesión): sin API key ni llamada propia a la API. Con límite de tiempo:
/// si `claude` se cuelga (login vencido, diálogo de confianza, red caída) se mata y `ask_any` pasa al siguiente.
/// Sin `--bare`: en ese modo la CLI no lee la sesión del keychain y exigiría ANTHROPIC_API_KEY.
fn ask_claude_code(model: &str, system: &str, user: &str) -> Result<String, String> {
    use std::io::{Read, Write};
    use std::process::Stdio;
    use std::time::{Duration, Instant};
    const TIMEOUT: Duration = Duration::from_secs(300);
    let args: Vec<String> = ["-p", "--model", model, "--tools", "", "--no-session-persistence", "--system-prompt", system].map(String::from).into();
    let mut child = crate::claude::command(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("no pude lanzar claude: {e}"))?;
    child.stdin.take().unwrap().write_all(user.as_bytes()).map_err(|e| e.to_string())?;
    // ponytail: stdout en un hilo para que el pipe no se llene; stderr se lee al final (claude escribe poco ahí).
    let mut out = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        s
    });
    let deadline = Instant::now() + TIMEOUT;
    let status = loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            break st;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("claude -p: sin respuesta en {} min", TIMEOUT.as_secs() / 60));
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    let stdout = reader.join().unwrap_or_default();
    if !status.success() {
        let mut err = String::new();
        let _ = child.stderr.take().unwrap().read_to_string(&mut err);
        return Err(format!("claude -p: {}", err.trim().chars().take(200).collect::<String>()));
    }
    Ok(stdout)
}

/// Texto de la respuesta del modelo (el JSON lo lee quien llama).
fn ask(llm: &Llm, model: &str, system: &str, user: &str) -> Result<String, String> {
    if llm.provider.trim().eq_ignore_ascii_case("claude-code") {
        return ask_claude_code(model, system, user);
    }
    let url = base_url(&llm.provider);
    let candola = llm.provider == "candola"; // el proxy propio: errores en palabras del tester
    // ponytail: "remoto" = no es localhost; Ollama local no pide key.
    if llm.apikey.is_empty() && !url.contains("127.0.0.1") && !url.contains("localhost") {
        return Err(if candola { crate::ai::NO_KEY.into() } else { "falta la API key".into() });
    }
    let body = json!({
        "model": model,
        "temperature": 0.2,
        "max_tokens": 8192, // Haiku en reuniones de 3 h pasa de 5000 tokens de salida y sin tope se truncaba el JSON
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
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
    let mut res = req.send(body.to_string()).map_err(|e| if candola { crate::ai::OFFLINE.into() } else { format!("LLM: {e}") })?;
    let status = res.status();
    let text = res.body_mut().read_to_string().map_err(|e| e.to_string())?;
    if !status.is_success() && candola {
        return Err(crate::ai::friendly(status.as_u16(), &text));
    }
    if !status.is_success() {
        let v: Value = serde_json::from_str(&text).unwrap_or_default();
        // Gemini a veces envuelve el error en un array: [{"error": …}]
        let msg = v["error"]["message"].as_str().or(v[0]["error"]["message"].as_str()).unwrap_or(&text);
        return Err(format!("LLM {}: {}", status.as_u16(), msg.chars().take(200).collect::<String>()));
    }
    let v: Value = serde_json::from_str(&text).map_err(|_| "LLM: respuesta no es JSON".to_string())?;
    Ok(v["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string())
}

/// Postproceso: transcripción limpia → LLM → tareas sugeridas (tabla meeting_tasks), con notificación.
/// Reintentar reemplaza las pendientes de esa reunión; las aceptadas o descartadas se quedan.
fn finalize(app: &AppHandle, llms: &[Llm], id: u64, lines: &[Line], manage: bool, ctx: Option<&Ctx>) -> Result<String, String> {
    let pool = &app.state::<crate::db::Db>().0;
    let lines = condense(lines);
    let mut model = String::new();
    let what = if manage { "Ordenando las tareas" } else { "Buscando tareas en la reunión" };
    let on_try = |m: &str| {
        model = m.to_string();
        update(app, |g| g.snap.status = format!("{what} ({m})…"));
    };
    // (título, detalle, acción JSON): en reunión solo tareas nuevas; en gestión acciones sobre las tareas.
    let mut notes = None; // (resumen, decisiones): solo reuniones
    let rows: Vec<(String, String, Option<String>)> = if manage {
        let pending = pending_tasks(pool)?;
        let ids: Vec<i64> = pending.iter().map(|t| t.id).collect();
        let user = manage_input(&today(), &pending, &lines);
        ask_any(llms, MANAGE_PROMPT, &user, |c| parse_actions(c, &ids), on_try)?
            .into_iter()
            .map(|a| {
                let title = a.titulo.clone().or_else(|| pending.iter().find(|t| Some(t.id) == a.id).map(|t| t.title.clone())).unwrap_or_default();
                (title, a.detalle.clone().unwrap_or_default(), Some(serde_json::to_string(&a).unwrap_or_default()))
            })
            .collect()
    } else {
        let user = format!("Transcripción:\n{}", fmt_lines(&lines));
        let r = ask_any(&crate::ai::for_meeting(llms), &prompt(&lines, ctx, &user_name(app)), &user, parse_result, on_try)?;
        notes = Some((r.resumen, r.decisiones));
        r.tareas.into_iter().map(|(t, d)| (t, d, None)).collect()
    };
    let n = rows.len();
    let id = json!(id);
    let run = |sql: &str, args: &[Value]| block_on(crate::db::execute(pool, sql, args)).map_err(|e| e.to_string());
    run("DELETE FROM meeting_tasks WHERE meeting = $1 AND status = 'pending'", &[id.clone()])?;
    for (title, detail, action) in rows {
        run("INSERT INTO meeting_tasks (meeting, title, detail, action) VALUES ($1, $2, $3, $4)", &[id.clone(), json!(title), json!(detail), json!(action)])?;
    }
    if let Some((summary, decisions)) = notes {
        let at = chrono::Utc::now().timestamp_millis();
        run(
            "INSERT OR REPLACE INTO meeting_notes (meeting, summary, decisions, model, at) VALUES ($1, $2, $3, $4, $5)",
            &[id.clone(), json!(summary), json!(json!(decisions).to_string()), json!(model), json!(at)],
        )?;
        update(app, |g| (g.snap.summary, g.snap.decisions) = (summary, decisions));
    }
    let _ = app.emit("db://changed", ());
    let (noun, head) = if manage { ("cambio", "Gestión revisada") } else { ("tarea sugerida", "Reunión revisada") };
    let msg = match n {
        0 if manage => "No encontré cambios que hacer".to_string(),
        0 => "No encontré tareas para ti".to_string(),
        1 => format!("1 {noun}"),
        n => format!("{n} {noun}s"),
    };
    crate::timer::send_notification(app.clone(), head.into(), format!("{msg}. Revísalos en el panel."));
    Ok(format!("{head} con {model}: {}", msg.to_lowercase()))
}

/// Tareas sin terminar, como se le describen al LLM (fechas en local, AAAA-MM-DD).
fn pending_tasks(pool: &sqlx::SqlitePool) -> Result<Vec<Pending>, String> {
    use chrono::{Local, TimeZone};
    let rows = block_on(crate::db::select(pool, "SELECT id, title, project, priority, due_at, est_pomodoros FROM tasks WHERE done = 0 ORDER BY id", &[]))
        .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| Pending {
            id: r["id"].as_i64().unwrap_or(0),
            title: r["title"].as_str().unwrap_or("").to_string(),
            project: r["project"].as_str().filter(|p| !p.is_empty()).map(String::from),
            priority: r["priority"].as_i64().unwrap_or(1),
            due: r["due_at"].as_i64().and_then(|ms| Local.timestamp_millis_opt(ms).single()).map(|d| d.format("%Y-%m-%d").to_string()),
            pomodoros: r["est_pomodoros"].as_i64().unwrap_or(1),
        })
        .collect())
}

/// "martes 2026-10-20" en hora local: el LLM resuelve "el viernes" con esto.
fn today() -> String {
    use chrono::{Datelike, Local};
    const DAYS: [&str; 7] = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
    let now = Local::now();
    format!("{} {}", DAYS[now.weekday().num_days_from_monday() as usize], now.format("%Y-%m-%d"))
}

// Preguntarle a las reuniones: embeddings por bloque (Ollama local en Mac, el proxy en modo Windows), coseno contra
// la pregunta y el LLM responde con citas. ponytail: todos los vectores en memoria sin índice; alcanza para unos miles
// de bloques.
const OLLAMA: &str = "http://127.0.0.1:11434";
const EMBED_MODEL: &str = "nomic-embed-text";
const PROXY_EMBED: &str = "titan-embed-v2";
const CHUNK_LINES: usize = 10;
const TOP_K: usize = 8;

const ASK_PROMPT: &str = "Eres el asistente personal del usuario. Respondes una pregunta sobre sus reuniones usando SOLO \
los fragmentos de transcripción que se te dan, numerados [1], [2]… (\"Yo\" es el usuario, \"Otros\" el resto; la \
transcripción es automática y puede tener errores de reconocimiento). Responde breve y directo, citando con [n] el \
fragmento de cada afirmación. Si los fragmentos no lo dicen, dilo; no inventes.\n\
Responde únicamente JSON: {\"respuesta\":\"texto con citas [n]\",\"fuentes\":[1,3]}.";

/// Lo que se indexa: bloques de CHUNK_LINES líneas "Yo: …" / "Otros: …".
pub fn chunks(lines: &[Line]) -> Vec<String> {
    lines.chunks(CHUNK_LINES).map(fmt_lines).collect()
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let (dot, na, nb) = a.iter().zip(b).fold((0.0, 0.0, 0.0), |(d, x, y), (p, q)| (d + p * q, x + p * p, y + q * q));
    if na == 0.0 || nb == 0.0 { 0.0 } else { dot / (na * nb).sqrt() }
}

fn to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn from_blob(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

/// (respuesta, números de fragmento citados) del JSON del modelo.
pub fn parse_answer(content: &str) -> Result<(String, Vec<usize>), String> {
    let v = json_of(content, "fuentes")?;
    let answer = v["respuesta"].as_str().map(str::trim).filter(|a| !a.is_empty()).ok_or("respuesta vacía")?;
    let refs = v["fuentes"].as_array().into_iter().flatten().filter_map(|n| n.as_u64()).map(|n| n as usize);
    Ok((answer.to_string(), refs.collect()))
}

/// De dónde salen los embeddings: Ollama local (Mac) o el proxy de Candola con su key (modo Windows, F19).
pub enum Embedder {
    Ollama,
    Proxy(String),
}

impl Embedder {
    fn of(app: &AppHandle) -> Self {
        crate::ai::proxy_key(app).map_or(Self::Ollama, Self::Proxy)
    }

    /// Se guarda con cada bloque: vectores de modelos distintos no se comparan.
    fn model(&self) -> &'static str {
        match self {
            Self::Ollama => EMBED_MODEL,
            Self::Proxy(_) => PROXY_EMBED,
        }
    }

    /// `query`: es la pregunta y no un bloque (nomic-embed-text pide prefijos distintos para cada uno).
    fn embed(&self, texts: &[String], query: bool) -> Result<Vec<Vec<f32>>, String> {
        match self {
            Self::Proxy(key) => crate::ai::embed(key, PROXY_EMBED, texts),
            Self::Ollama => {
                let pre = if query { "search_query: " } else { "search_document: " };
                ollama_embed(&texts.iter().map(|t| format!("{pre}{t}")).collect::<Vec<_>>())
            }
        }
    }
}

/// Embeddings con Ollama (`/api/embed`, todos los textos en una llamada).
fn ollama_embed(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    let mut res = ureq::post(format!("{OLLAMA}/api/embed"))
        .config()
        .timeout_global(Some(Duration::from_secs(300)))
        .http_status_as_error(false)
        .build()
        .header("Content-Type", "application/json")
        .send(json!({"model": EMBED_MODEL, "input": texts}).to_string())
        .map_err(|_| format!("Ollama no está corriendo: instálalo (ollama.com) y baja el modelo con `ollama pull {EMBED_MODEL}`"))?;
    let v: Value = serde_json::from_str(&res.body_mut().read_to_string().map_err(|e| e.to_string())?).unwrap_or_default();
    if !res.status().is_success() {
        return Err(format!("Ollama: {} (`ollama pull {EMBED_MODEL}`)", v["error"].as_str().unwrap_or("error")));
    }
    serde_json::from_value(v["embeddings"].clone()).map_err(|_| "Ollama: respuesta sin embeddings".into())
}

/// Indexa las reuniones guardadas que aún no tienen bloques del modelo actual (no las sesiones de gestión): las que
/// estaban con otro modelo se reindexan. Devuelve cuántas.
pub fn index_missing(app: &AppHandle) -> Result<usize, String> {
    let pool = &app.state::<crate::db::Db>().0;
    let db = |e: sqlx::Error| e.to_string();
    let emb = Embedder::of(app);
    let q = sqlx::query_scalar("SELECT DISTINCT meeting FROM meeting_chunks WHERE model = ?").bind(emb.model());
    let done: Vec<i64> = block_on(q.fetch_all(pool)).map_err(db)?;
    let mut n = 0;
    for m in meetings_list(app.clone()) {
        let parts = chunks(&parse_lines(&m.text));
        if done.contains(&(m.id as i64)) || m.text.starts_with(MANAGE_HEADER) || parts.is_empty() {
            continue;
        }
        let vecs = emb.embed(&parts, false)?;
        // los bloques de otro modelo (si los había) salen antes de guardar los nuevos
        block_on(sqlx::query("DELETE FROM meeting_chunks WHERE meeting = ?").bind(m.id as i64).execute(pool)).map_err(db)?;
        for (i, (text, v)) in parts.iter().zip(vecs).enumerate() {
            let q = sqlx::query("INSERT INTO meeting_chunks (meeting, idx, text, vec, model) VALUES (?, ?, ?, ?, ?)");
            block_on(q.bind(m.id as i64).bind(i as i64).bind(text).bind(to_blob(&v)).bind(emb.model()).execute(pool)).map_err(db)?;
        }
        n += 1;
    }
    Ok(n)
}

#[derive(Serialize)]
pub struct Source {
    n: usize, // el [n] de la respuesta
    meeting: u64,
    title: Option<String>,
    text: String,
}

#[derive(Serialize)]
pub struct Answer {
    answer: String,
    sources: Vec<Source>, // solo las citadas
}

/// Pregunta → embedding → los TOP_K bloques más parecidos → el LLM responde citándolos.
pub fn ask_meetings(app: &AppHandle, llms: &[Llm], q: &str) -> Result<Answer, String> {
    if q.trim().is_empty() {
        return Err("Escribe una pregunta".into());
    }
    index_missing(app)?;
    let pool = &app.state::<crate::db::Db>().0;
    let emb = Embedder::of(app);
    let sel = sqlx::query_as("SELECT meeting, text, vec FROM meeting_chunks WHERE model = ?").bind(emb.model());
    let rows: Vec<(i64, String, Vec<u8>)> = block_on(sel.fetch_all(pool)).map_err(|e| e.to_string())?;
    let saved = meetings_list(app.clone());
    let blocks = rows
        .into_iter()
        .filter_map(|(m, text, vec)| {
            let s = saved.iter().find(|s| s.id as i64 == m)?; // .md borrado: fuera
            Some(Block { meeting: s.id, title: s.ctx.as_ref().map(|c| c.title.clone()), text, vec: from_blob(&vec) })
        })
        .collect();
    answer(&crate::ai::llms(app, llms.to_vec()), &emb, q.trim(), blocks)
}

/// Un bloque indexado de una reunión.
pub struct Block {
    meeting: u64,
    title: Option<String>,
    text: String,
    vec: Vec<f32>,
}

fn answer(llms: &[Llm], emb: &Embedder, q: &str, mut blocks: Vec<Block>) -> Result<Answer, String> {
    use chrono::{Local, TimeZone};
    if blocks.is_empty() {
        return Err("Todavía no hay reuniones guardadas".into());
    }
    let qv = emb.embed(&[q.to_string()], true)?.pop().ok_or("respuesta sin embeddings")?;
    blocks.sort_by(|a, b| cosine(&qv, &b.vec).total_cmp(&cosine(&qv, &a.vec)));
    blocks.truncate(TOP_K);
    let when = |id: u64| Local.timestamp_opt(id as i64, 0).single().map(|d| d.format("%Y-%m-%d %H:%M").to_string()).unwrap_or_default();
    let frags: Vec<String> = blocks
        .iter()
        .enumerate()
        .map(|(i, b)| format!("[{}] Reunión «{}» del {}:\n{}", i + 1, b.title.as_deref().unwrap_or(""), when(b.meeting), b.text))
        .collect();
    let user = format!("Pregunta: {q}\n\nFragmentos:\n{}", frags.join("\n\n"));
    let (answer, refs) = ask_any(llms, ASK_PROMPT, &user, parse_answer, |_| {})?;
    let sources = blocks
        .into_iter()
        .enumerate()
        .filter(|(i, _)| refs.contains(&(i + 1)))
        .map(|(i, b)| Source { n: i + 1, meeting: b.meeting, title: b.title, text: b.text })
        .collect();
    Ok(Answer { answer, sources })
}

/// El LLM tarda: fuera del hilo principal.
#[tauri::command]
pub async fn meetings_ask(app: AppHandle, llms: Vec<Llm>, q: String) -> Result<Answer, String> {
    tauri::async_runtime::spawn_blocking(move || ask_meetings(&app, &llms, &q)).await.map_err(|e| e.to_string())?
}

/// Captura (ScreenCaptureKit en macOS, WASAPI vía cpal en Windows) + whisper.cpp local.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub mod local {
    use super::*;
    #[cfg(target_os = "macos")]
    use screencapturekit::prelude::*;
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
    use whisper_rs::{WhisperVadContext, WhisperVadContextParams, WhisperVadParams};

    #[cfg(target_os = "macos")]
    const MODEL: (&str, &str) = ("ggml-large-v3-turbo-q5_0.bin", "~550 MB");
    /// En Windows corre en CPU: el encoder de turbo (el de large, 32 capas sobre una ventana fija de 30 s) tarda más
    /// que el audio en un laptop y la reunión se atrasa sin fin. small tiene ~7x menos cómputo.
    /// ponytail: small fijo; un modelo elegible en Ajustes si hay PCs con GPU o CPUs sobrados.
    #[cfg(target_os = "windows")]
    const MODEL: (&str, &str) = ("ggml-small-q5_1.bin", "~190 MB");
    /// Silero VAD de whisper.cpp (~1 MB): dónde hay voz, para cortar en pausas reales y no transcribir ruido.
    const VAD_MODEL: &str = "ggml-silero-v5.1.2.bin";
    const VAD_URL: &str = "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin";
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

    /// Audio de una fuente (mono, a `rate` Hz) → 16 kHz al búfer, y medidor.
    fn feed(bufs: &Bufs, meter: &Meter, src: usize, mono: &[f32], rate: f64) {
        let out = resample(mono, rate);
        let peak = out.iter().fold(0f32, |a, v| a.max(v.abs()));
        meter.got[src].fetch_add(out.len(), Ordering::Relaxed);
        meter.peak[src].fetch_max(peak.to_bits(), Ordering::Relaxed);
        bufs.lock().unwrap()[src].extend_from_slice(&out);
    }

    #[cfg(target_os = "macos")]
    struct Capture(Bufs, Arc<Meter>);

    #[cfg(target_os = "macos")]
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
            feed(&self.0, &self.1, src, &mono, rate);
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

    /// Ruta del modelo en $APPDATA/models; lo descarga la primera vez (`what` va al estado mientras baja).
    fn model_path(app: &AppHandle, name: &str, url: &str, what: &str) -> Result<std::path::PathBuf, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
        let path = dir.join(name);
        if path.exists() {
            return Ok(path);
        }
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        update(app, |g| g.snap.status = format!("Descargando {what} (solo la primera vez)…"));
        let tmp = dir.join(format!("{name}.part"));
        let ok = crate::cmd("curl") // Windows 10+ trae curl.exe
            .args(["-fsSL", "--retry", "3", "-o"])
            .arg(&tmp)
            .arg(url)
            .status()
            .map_err(|e| e.to_string())?
            .success();
        if !ok {
            return Err(format!("no se pudo descargar {what}"));
        }
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        Ok(path)
    }

    /// El modelo de voz se carga una vez y queda en memoria: la reunión y el dictado a la Candola (voice.rs) lo
    /// comparten, así una frase no espera los segundos que tarda cargarlo.
    /// ponytail: no se libera nunca (~1 GB de RAM/GPU tras el primer uso); soltarlo tras N min sin uso si molesta.
    fn whisper(app: &AppHandle) -> Result<Arc<WhisperContext>, String> {
        static CTX: Mutex<Option<Arc<WhisperContext>>> = Mutex::new(None);
        let mut g = CTX.lock().unwrap();
        if let Some(c) = g.as_ref() {
            return Ok(c.clone());
        }
        let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}", MODEL.0);
        let path = model_path(app, MODEL.0, &url, &format!("el modelo de voz ({})", MODEL.1))?;
        whisper_rs::install_logging_hooks(); // sin logger, silencia el log de whisper.cpp en la consola
        let c = Arc::new(WhisperContext::new_with_params(&path, WhisperContextParameters::default()).map_err(|e| format!("whisper: {e}"))?);
        *g = Some(c.clone());
        Ok(c)
    }

    /// Graba solo el micrófono hasta `stop` o `max` (dictado a la Candola). Mismo camino que el modo Gestión.
    pub fn record_mic(stop: &AtomicBool, max: Duration) -> Result<Vec<f32>, String> {
        let bufs: Bufs = Arc::default();
        let stream = start_capture(bufs.clone(), Arc::default(), true)?;
        let t = std::time::Instant::now();
        while !stop.load(Ordering::Relaxed) && t.elapsed() < max {
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = stream.stop_capture();
        let audio = std::mem::take(&mut bufs.lock().unwrap()[0]);
        Ok(audio)
    }

    /// Una frase corta → texto limpio (`None` si no se entendió nada).
    pub fn transcribe_once(app: &AppHandle, audio: &[f32]) -> Result<Option<String>, String> {
        let ctx = whisper(app)?;
        let mut ws = ctx.create_state().map_err(|e| format!("whisper: {e}"))?;
        Ok(clean(&transcribe(&mut ws, audio)))
    }

    /// Permiso de Micrófono. ScreenCaptureKit no lo pide solo: sin él entrega el micrófono vacío y toda la
    /// reunión queda como "Otros". Pide el permiso la primera vez (bloquea hasta que el usuario responda).
    #[cfg(target_os = "macos")]
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

    /// `manage`: solo micrófono (sin audio del sistema). ponytail: sigue pasando por ScreenCaptureKit, así que
    /// pide igual el permiso de Grabación de pantalla; AVAudioEngine/cpal si eso molesta.
    #[cfg(target_os = "macos")]
    fn start_capture(bufs: Bufs, meter: Arc<Meter>, manage: bool) -> Result<SCStream, String> {
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
            .with_captures_audio(!manage)
            .with_excludes_current_process_audio(true)
            .with_sample_rate(RATE as i32)
            .with_channel_count(1)
            .with_captures_microphone(true)
            .map_err(|e| e.to_string())?
            .with_microphone_capture_device_id(&mic.id)
            .map_err(|e| e.to_string())?;
        let mut stream = SCStream::new(&filter, &config).map_err(|e| e.to_string())?;
        if !manage {
            stream.add_output_handler(Capture(bufs.clone(), meter.clone()), SCStreamOutputType::Audio).map_err(|e| e.to_string())?;
        }
        stream.add_output_handler(Capture(bufs, meter), SCStreamOutputType::Microphone).map_err(|e| e.to_string())?;
        stream.start_capture().map_err(|e| e.to_string())?;
        Ok(stream)
    }

    /// Streams de cpal; se paran al soltarlos (`stop_capture` para que el código de arriba sea el mismo).
    #[cfg(target_os = "windows")]
    struct Streams(Vec<cpal::Stream>);

    #[cfg(target_os = "windows")]
    impl Streams {
        fn stop_capture(&self) -> Result<(), String> {
            use cpal::traits::StreamTrait;
            self.0.iter().try_for_each(|s| s.pause().map_err(|e| e.to_string()))
        }
    }

    /// Micrófono por defecto ("Yo") y, salvo en `manage`, loopback de la salida por defecto ("Otros"): en WASAPI
    /// abrir un stream de entrada sobre un dispositivo de salida graba lo que suena.
    /// ponytail: el loopback incluye los sonidos de la propia Candola (ladrido); excluirlos pide la API de loopback
    /// por proceso de Windows 10 2004+.
    #[cfg(target_os = "windows")]
    fn start_capture(bufs: Bufs, meter: Arc<Meter>, manage: bool) -> Result<Streams, String> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        let host = cpal::default_host();
        let mic = host.default_input_device().ok_or("no hay micrófono")?;
        let mut devs = vec![(0, mic.default_input_config().map_err(|e| format!("micrófono: {e}"))?, mic)];
        if !manage {
            let out = host.default_output_device().ok_or("no hay salida de audio")?;
            devs.push((1, out.default_output_config().map_err(|e| format!("audio del sistema: {e}"))?, out));
        }
        let streams = devs
            .into_iter()
            .map(|(src, cfg, dev)| {
                let (bufs, meter) = (bufs.clone(), meter.clone());
                let fmt = cfg.sample_format();
                let (rate, ch) = (cfg.sample_rate().0 as f64, cfg.channels() as usize);
                let s = dev
                    .build_input_stream_raw(
                        &cfg.config(),
                        fmt,
                        move |data: &cpal::Data, _: &_| {
                            let mono = super::decode(data.bytes(), fmt.is_float(), fmt.sample_size() as u32 * 8, ch);
                            feed(&bufs, &meter, src, &mono, rate);
                        },
                        |e| eprintln!("captura de audio: {e}"),
                        None,
                    )
                    .map_err(|e| format!("{}: {e}", WHO[src]))?;
                s.play().map_err(|e| e.to_string())?;
                Ok(s)
            })
            .collect::<Result<_, String>>()?;
        Ok(Streams(streams))
    }

    /// Segmentos con voz `(ini, fin)` en muestras. Pausas de 200 ms o más separan segmentos.
    fn speech(vad: &mut WhisperVadContext, x: &[f32]) -> Vec<(usize, usize)> {
        let mut p = WhisperVadParams::default();
        p.set_min_silence_duration(200);
        let cs = RATE / 100; // los tiempos vienen en centésimas de segundo
        vad.segments_from_samples(p, x).map(|s| s.map(|g| (g.start as usize * cs, g.end as usize * cs)).collect()).unwrap_or_default()
    }

    pub fn transcribe(ws: &mut whisper_rs::WhisperState, audio: &[f32]) -> String {
        let mut p = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        p.set_language(Some(LANG));
        p.set_no_context(true); // sin arrastrar texto: evita bucles de repetición entre fragmentos
        p.set_suppress_blank(true);
        // ponytail: hasta 8 hilos; en Windows (CPU, sin Metal) 4 fijos se quedaban cortos para el modelo turbo
        p.set_n_threads(std::thread::available_parallelism().map_or(4, |n| n.get().clamp(1, 8)) as i32);
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

    /// Compara los cortes por RMS (`take_chunk`) con los del VAD simulando la captura (bloques de 300 ms):
    /// `VAD_MODEL=…/ggml-silero-v5.1.2.bin AUDIO_F32=voz.f32 GAPS=pausas.json [CLEAN_F32=…] [WHISPER_MODEL=…] cargo test --lib probar_vad -- --ignored --nocapture`
    /// GAPS: `[[ini, fin], …]` en muestras sin voz (verdad de terreno); CLEAN_F32: el mismo audio sin ruido, para ver
    /// si el corte cae en silencio (aunque sea una coma); con WHISPER_MODEL además transcribe cada fragmento.
    #[test]
    #[ignore]
    fn probar_vad() {
        let env = |k: &str| std::env::var(k).ok();
        let f32s = |p: String| -> Vec<f32> { std::fs::read(p).unwrap().chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect() };
        let audio = f32s(env("AUDIO_F32").unwrap());
        let clean = env("CLEAN_F32").map(f32s).unwrap_or_default();
        let gaps: Vec<[usize; 2]> = serde_json::from_str(&std::fs::read_to_string(env("GAPS").unwrap()).unwrap()).unwrap();
        let in_gap = |i: usize| gaps.iter().any(|g| g[0] <= i && i < g[1]);
        let mute = |a: usize, b: usize| (a..b).step_by(160).filter(|i| !in_gap(*i)).count() * 160 < RATE / 4; // < 250 ms de voz
        let quiet = |i: usize| clean.get(i.saturating_sub(400)..(i + 400).min(clean.len())).is_some_and(|w| rms(w) < 0.003);
        let mut vad = WhisperVadContext::new(&env("VAD_MODEL").unwrap(), WhisperVadContextParams::default()).unwrap();
        let whisper = env("WHISPER_MODEL").map(|m| WhisperContext::new_with_params(&m, WhisperContextParameters::default()).unwrap());
        let mut ws = whisper.as_ref().map(|c| c.create_state().unwrap());
        for use_vad in [false, true] {
            let t = std::time::Instant::now();
            let (mut buf, mut base, mut fed) = (vec![], 0, 0);
            let [mut cuts, mut in_pause, mut silent, mut forced, mut sent, mut mute_sent, mut mute_skipped, mut lost] = [0usize; 8];
            loop {
                let flush = fed >= audio.len();
                let n = (RATE * 3 / 10).min(audio.len() - fed);
                buf.extend_from_slice(&audio[fed..fed + n]);
                fed += n;
                loop {
                    let full = buf.len() >= MAX_S * RATE;
                    let mut found = false;
                    let chunk = take_chunk_with(&mut buf, flush, |x| {
                        let c = if use_vad { last_pause(&speech(&mut vad, x), x.len()) } else { rms_cut(x) };
                        found = c.is_some();
                        c
                    });
                    let Some(chunk) = chunk else { break };
                    let (a, b) = (base, base + chunk.len());
                    base = b;
                    if !flush {
                        cuts += 1;
                        in_pause += in_gap(b) as usize;
                        silent += quiet(b) as usize;
                        forced += (full && !found) as usize;
                    }
                    let m = mute(a, b);
                    if if use_vad { speech(&mut vad, &chunk).is_empty() } else { rms(&chunk) < SILENCE / 2.0 } {
                        mute_skipped += m as usize;
                        lost += !m as usize;
                        continue;
                    }
                    sent += 1;
                    mute_sent += m as usize;
                    if let Some(ws) = ws.as_mut() {
                        println!("  [{:5.1}–{:5.1}s{}] {}", a as f32 / RATE as f32, b as f32 / RATE as f32, if m { " SIN VOZ" } else { "" }, transcribe(ws, &chunk));
                    }
                }
                if flush {
                    break;
                }
            }
            println!(
                "{}: {cuts} cortes · {in_pause} entre frases · {silent} en silencio · {forced} forzados a {MAX_S} s · {sent} a whisper ({mute_sent} sin voz) · descartados sin voz {mute_skipped}, con voz {lost} · {} ms",
                if use_vad { "vad" } else { "rms" },
                t.elapsed().as_millis()
            );
        }
    }

    pub fn run(app: &AppHandle, stop: &AtomicBool, llms: &[Llm], manage: bool, cal: Option<Ctx>) -> Result<(), String> {
        let sources = if manage { 1 } else { 2 }; // 0 = micrófono, 1 = audio del sistema
        update(app, |g| g.snap.status = "Cargando el modelo de voz…".into());
        let ctx = whisper(app)?;
        let mut ws = ctx.create_state().map_err(|e| format!("whisper: {e}"))?;
        let mut transcribe = |audio: &[f32]| transcribe(&mut ws, audio);
        // Sin el VAD (no bajó o no carga) se sigue con el umbral de RMS: peor con ruido de fondo, pero funciona.
        let mut vad = model_path(app, VAD_MODEL, VAD_URL, "el detector de voz (~1 MB)")
            .ok()
            .and_then(|p| WhisperVadContext::new(p.to_str()?, WhisperVadContextParams::default()).ok());
        let mut voice = |x: &[f32]| vad.as_mut().map(|v| speech(v, x));

        let bufs: Bufs = Arc::default();
        let meter: Arc<Meter> = Arc::default();
        let stream = start_capture(bufs.clone(), meter.clone(), manage)?;
        update(app, |g| g.snap.status = "Escuchando…".into());
        // "Escuchando · Yo 0:42 con voz · Otros 0:10 en silencio": muestra si de verdad llega audio de cada fuente.
        let listening = || {
            let src = |i: usize| {
                let secs = meter.got[i].load(Ordering::Relaxed) / RATE;
                let peak = f32::from_bits(meter.peak[i].swap(0, Ordering::Relaxed));
                let how = if secs == 0 { "sin audio" } else if peak < SILENCE { "en silencio" } else { "con voz" };
                format!("{} {}:{:02} {how}", WHO[i], secs / 60, secs % 60)
            };
            let srcs: Vec<String> = (0..sources).map(src).collect();
            format!("Escuchando · {}", srcs.join(" · "))
        };

        let mut lines: Vec<Line> = vec![];
        let mut push = |app: &AppHandle, lines: &mut Vec<Line>, flush: bool| {
            for src in 0..sources {
                loop {
                    // El candado se suelta aquí mismo: transcribir tarda ~2 s y el callback de la captura
                    // no puede esperar tanto para guardar el audio que va llegando.
                    // ponytail: el VAD corre con el candado tomado (~ms por 20 s de audio, no los ~2 s de whisper).
                    let chunk = {
                        let mut b = bufs.lock().unwrap();
                        take_chunk_with(&mut b[src], flush, |x| voice(x).map_or_else(|| rms_cut(x), |s| last_pause(&s, x.len())))
                    };
                    let Some(chunk) = chunk else { break };
                    if voice(&chunk).map_or(rms(&chunk) < SILENCE / 2.0, |s| s.is_empty()) {
                        continue; // sin voz: whisper alucinaría ("Gracias.", "Gracias por ver el video")
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
            let id = save(app, &lines, manage, cal.as_ref());
            let a = app.clone();
            std::thread::spawn(move || index_missing(&a)); // para preguntarle; sin Ollama no pasa nada
            update(app, |g| g.snap.status = if manage { "Ordenando las tareas…" } else { "Buscando tareas en la reunión…" }.into());
            let msg = finalize(app, llms, id, &lines, manage, cal.as_ref())?;
            update(app, |g| g.snap.status = msg);
        }
        Ok(())
    }

    /// Guarda la transcripción en $APPDATA/meetings/<epoch>.md y devuelve el epoch (id de la reunión).
    fn save(app: &AppHandle, lines: &[Line], manage: bool, ctx: Option<&Ctx>) -> u64 {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        if let Some(dir) = meetings_dir(app) {
            let _ = std::fs::create_dir_all(&dir);
            let head = if manage { MANAGE_HEADER.to_string() } else { ctx.map(fmt_head).unwrap_or_default() };
            let _ = std::fs::write(dir.join(format!("{secs}.md")), format!("{head}{}", fmt_lines(lines)));
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
    fn corta_en_la_ultima_pausa_del_vad() {
        let s = |a: f32, b: f32| ((a * RATE as f32) as usize, (b * RATE as f32) as usize);
        let at = |x: Option<usize>| x.map(|i| i as f32 / RATE as f32);
        // voz 0–9 s, pausa, voz 9,5–12 s: con 12,2 s de búfer la cola (200 ms) es muy corta → la pausa de 9,25 s
        assert_eq!(at(last_pause(&[s(0.0, 9.0), s(9.5, 12.0)], 12 * RATE + RATE / 5)), Some(9.25));
        // con 1 s de silencio al final, corta ahí
        assert_eq!(at(last_pause(&[s(0.0, 9.0), s(9.5, 12.0)], 13 * RATE)), Some(12.5));
        // la única pausa queda antes de MIN_S y la voz sigue hasta el final: espera
        assert_eq!(last_pause(&[s(0.0, 3.0), s(4.0, 12.0)], 12 * RATE), None);
        // sin voz: corta ya, para descartarlo
        assert_eq!(last_pause(&[], 9 * RATE), Some(9 * RATE - WIN / 2));
        // take_chunk_with respeta el corte inyectado y, sin corte, espera a MAX_S
        let mut buf = tone(9.0, 0.3);
        assert_eq!(take_chunk_with(&mut buf, false, |_| Some(8 * RATE + 7)).map(|c| c.len()), Some(8 * RATE + 7));
        assert_eq!(buf.len(), RATE - 7);
        let mut buf = tone(12.0, 0.3);
        assert!(take_chunk_with(&mut buf, false, |_| None).is_none());
        let mut buf = tone(21.0, 0.3);
        assert!(take_chunk_with(&mut buf, false, |_| Some(RATE)).unwrap().len() <= MAX_S * RATE); // corte inválido: el de RMS
    }

    #[test]
    fn bloques_y_coseno_para_preguntar() {
        let lines: Vec<Line> = (0..23).map(|i| Line { who: if i % 2 == 0 { "Yo" } else { "Otros" }, text: format!("frase {i}") }).collect();
        let c = chunks(&lines);
        assert_eq!(c.len(), 3);
        assert!(c[0].starts_with("Yo: frase 0\nOtros: frase 1\n") && c[0].ends_with("Otros: frase 9"));
        assert_eq!(c[2], "Yo: frase 20\nOtros: frase 21\nYo: frase 22");
        assert!(chunks(&[]).is_empty());
        assert!((cosine(&[1.0, 0.0], &[2.0, 0.0]) - 1.0).abs() < 1e-6);
        assert!(cosine(&[1.0, 0.0], &[0.0, 3.0]).abs() < 1e-6);
        assert!((cosine(&[1.0, 1.0], &[-1.0, -1.0]) + 1.0).abs() < 1e-6);
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 1.0]), 0.0);
        let v = vec![0.25, -1.5, 3.0e-7];
        assert_eq!(from_blob(&to_blob(&v)), v);
        assert_eq!(parse_answer(r#"Ok: {"respuesta":" El plazo es el viernes [2]. ","fuentes":[2,"x"]}"#), Ok(("El plazo es el viernes [2].".into(), vec![2])));
        assert!(parse_answer(r#"{"respuesta":"","fuentes":[]}"#).is_err());
        assert!(parse_answer(r#"{"respuesta":"sin fuentes"}"#).is_err());
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
        let tareas = vec![("Enviar informe".to_string(), "Ana, lunes".to_string())];
        assert_eq!(parse_result(out), Ok(Outcome { tareas: tareas.clone(), ..Default::default() })); // sin resumen ni decisiones
        let full = r#"{"resumen":" Se revisó el plan. ","decisiones":["Lanzar el lunes"," ",3],"tareas":[{"titulo":"Enviar informe","detalle":"Ana, lunes"}]}"#;
        let r = parse_result(full).unwrap();
        assert_eq!((r.resumen.as_str(), r.decisiones, r.tareas), ("Se revisó el plan.", vec!["Lanzar el lunes".to_string()], tareas));
        assert_eq!(parse_result(r#"{"resumen":["Uno.","Dos."],"tareas":[]}"#).unwrap().resumen, "Uno.\nDos.");
        assert_eq!(parse_result("{\"tareas\":[]}"), Ok(Outcome::default()));
        let nova = "```json\n{\"tareas\":[]}\n```\n### Explicación: el campo {tareas} va vacío.";
        assert_eq!(parse_result(nova), Ok(Outcome::default()));
        assert!(parse_result("sin json").is_err());
        assert!(parse_result("} {").is_err());
        assert!(parse_result("{\"tasks\":[],\"resumen\":\"x\"}").is_err()); // clave equivocada ≠ cero tareas
    }

    #[test]
    fn prueba_todos_los_modelos_en_orden() {
        // Sin key ninguno llega a la red: cada uno falla y pasa al siguiente.
        let llm = |p: &str, m: &[&str]| Llm { provider: p.into(), apikey: "".into(), models: m.iter().map(|s| s.to_string()).collect() };
        let mut tried = vec![];
        let err = ask_any(&[llm("gemini", &["a", "b"]), llm("https://x.dev/v1", &["c"])], "", "", parse_result, |m| tried.push(m.to_string()));
        assert_eq!(tried, ["a", "b", "c"]);
        assert_eq!(err.unwrap_err(), "a: falta la API key · b: falta la API key · c: falta la API key");
        assert!(ask_any(&[], "", "", parse_result, |_| {}).is_err());
        // el proxy propio: sin prefijo de modelo y en palabras del tester
        assert_eq!(ask_any(&[llm("candola", &["candola"])], "", "", parse_result, |_| {}).unwrap_err(), crate::ai::NO_KEY);
        assert_eq!(base_url("Gemini"), "https://generativelanguage.googleapis.com/v1beta/openai");
        assert_eq!(base_url("candola"), "https://ai.spadelab.xyz/v1");
    }

    #[test]
    fn lee_las_acciones_del_modelo() {
        let out = r#"{"acciones":[
            {"op":"crear","titulo":" Revisar deploy ","proyecto":"pet","prioridad":2,"fecha":"2026-10-23","pomodoros":2,"detalle":"antes del demo"},
            {"op":"crear","titulo":"","fecha":"x"},
            {"op":"editar","id":14,"fecha":"27/10/2026","prioridad":7},
            {"op":"editar","id":14,"fecha":"2026-10-27","detalle":"ignorado"},
            {"op":"editar","id":99,"fecha":"2026-10-27"},
            {"op":"completar","id":9,"titulo":"ignorado"},
            {"op":"borrar","id":9}
        ]}"#;
        let got = parse_actions(out, &[9, 14]).unwrap();
        let a = |j: &str| serde_json::from_str::<Action>(j).unwrap();
        assert_eq!(
            got,
            [
                a(r#"{"op":"crear","titulo":"Revisar deploy","proyecto":"pet","prioridad":2,"fecha":"2026-10-23","pomodoros":2,"detalle":"antes del demo"}"#),
                a(r#"{"op":"editar","id":14,"fecha":"2026-10-27"}"#),
                a(r#"{"op":"completar","id":9}"#),
            ]
        );
        assert_eq!(serde_json::to_string(&got[2]).unwrap(), r#"{"op":"completar","id":9}"#); // sin nulls en la BD
        assert!(parse_actions("{\"tareas\":[]}", &[]).is_err());
        let input = manage_input(
            "martes 2026-10-20",
            &[Pending { id: 14, title: "Enviar propuesta".into(), project: Some("Acme".into()), priority: 2, due: Some("2026-10-20".into()), pomodoros: 2 }],
            &[Line { who: "Yo", text: "pásala al jueves".into() }],
        );
        assert_eq!(
            input,
            "Hoy es martes 2026-10-20.\nTareas pendientes:\n- [14] Enviar propuesta (proyecto: Acme; prioridad: alta; vence: 2026-10-20; 2 pomodoros)\nTranscripción:\nYo: pásala al jueves"
        );
    }

    #[test]
    fn cabecera_del_calendario_ida_y_vuelta() {
        let ctx = Ctx { title: "Daily: equipo \"pet\"".into(), attendees: vec!["Ana Pérez".into(), "bob@x.dev".into()] };
        let md = format!("{}Yo: hola\nOtros: chao", fmt_head(&ctx));
        assert!(md.starts_with("---\ntitle: \"Daily: equipo \\\"pet\\\"\"\nattendees: [\"Ana Pérez\",\"bob@x.dev\"]\n---\n"));
        let (back, body) = parse_head(&md);
        assert_eq!(back, Some(ctx.clone()));
        assert_eq!(body, "Yo: hola\nOtros: chao");
        assert_eq!(parse_lines(&md).len(), 2); // la cabecera no son líneas de la reunión
        assert_eq!(parse_head("Yo: sin cabecera"), (None, "Yo: sin cabecera"));
        let p = prompt(&parse_lines(body), Some(&ctx), "Luis");
        assert!(p.contains("Reunión: Daily: equipo \"pet\". Participantes: Ana Pérez, bob@x.dev. \"Yo\" es Luis."));
        assert!(!p.contains("OJO"));
        assert!(prompt(&[], None, "").ends_with("revisará cada una."));
    }

    #[test]
    fn relee_la_transcripcion_guardada() {
        let lines = vec![Line { who: "Yo", text: "Hora: 10:30".into() }, Line { who: "Otros", text: "ok".into() }];
        let back = parse_lines(&format!("{MANAGE_HEADER}{}\nbasura sin hablante", fmt_lines(&lines)));
        assert_eq!(fmt_lines(&back), fmt_lines(&lines));
    }
}

/// Prueba el postproceso con una transcripción de ejemplo:
/// `MEETING_TXT=reunion.txt LLM_MODEL=qwen3.5:9b cargo test --lib probar_llm -- --ignored --nocapture`
/// (líneas "Yo: …" / "Otros: …"; LLM_PROVIDER y LLM_KEY opcionales, por defecto Ollama local).
/// Con Claude Code: `LLM_PROVIDER=claude-code LLM_MODEL=sonnet` (usa la sesión de `claude`, sin key).
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
    let user = format!("Transcripción:\n{}", fmt_lines(&clean));
    let r = ask_any(&[llm], &prompt(&clean, None, ""), &user, parse_result, |m| println!("probando {m}")).unwrap();
    println!("{:.1}s\nResumen:\n{}\nDecisiones:", t.elapsed().as_secs_f32(), r.resumen);
    for d in r.decisiones {
        println!("  · {d}");
    }
    println!("Tareas:");
    for (title, detail) in r.tareas {
        println!("  + {title} — {detail}");
    }
}

/// Pregunta a las reuniones guardadas con Ollama de verdad (sin la app ni la BD):
/// `PREGUNTA="¿qué quedó del formulario de reclamos?" MEETINGS_DIR=… cargo test --lib probar_preguntar -- --ignored --nocapture`
/// (LLM_PROVIDER / LLM_MODEL / LLM_KEY como en `probar_llm`). Con `CANDOLA_KEY` los embeddings van por el proxy.
#[cfg(test)]
#[test]
#[ignore]
fn probar_preguntar() {
    let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.into());
    let llm = Llm { provider: env("LLM_PROVIDER", "ollama"), apikey: env("LLM_KEY", ""), models: vec![env("LLM_MODEL", "qwen3.5:9b")] };
    let emb = std::env::var("CANDOLA_KEY").map_or(Embedder::Ollama, Embedder::Proxy);
    let t = std::time::Instant::now();
    let mut blocks = vec![];
    for e in std::fs::read_dir(env("MEETINGS_DIR", ".")).unwrap().flatten() {
        let Some(id) = e.file_name().to_str().and_then(|n| n.strip_suffix(".md")?.parse().ok()) else { continue };
        let raw = std::fs::read_to_string(e.path()).unwrap();
        let (ctx, text) = parse_head(&raw);
        let parts = chunks(&parse_lines(text));
        if raw.starts_with(MANAGE_HEADER) || parts.is_empty() {
            continue;
        }
        let vecs = emb.embed(&parts, false).unwrap();
        blocks.extend(parts.into_iter().zip(vecs).map(|(text, vec)| Block { meeting: id, title: ctx.as_ref().map(|c| c.title.clone()), text, vec }));
    }
    println!("{} bloques indexados en {:.1}s", blocks.len(), t.elapsed().as_secs_f32());
    let r = answer(&[llm], &emb, &env("PREGUNTA", "¿Qué se decidió?"), blocks).unwrap();
    println!("{:.1}s\n{}", t.elapsed().as_secs_f32(), r.answer);
    for s in r.sources {
        println!("  [{}] #meetings/{} · {}", s.n, s.meeting, s.text.lines().next().unwrap_or(""));
    }
}
