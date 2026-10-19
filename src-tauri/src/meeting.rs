//! Reuniones: durante la reunión escucha el micrófono ("Yo") y el audio del sistema ("Otros") por separado y
//! transcribe en local con whisper por fragmentos. Al terminar guarda la transcripción, la limpia (`condense`)
//! y la manda completa, en una sola llamada, a un LLM compatible con OpenAI (Gemini, Claude, Ollama) que
//! devuelve las tareas sugeridas.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

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

#[derive(Clone, Serialize)]
pub struct Suggestion {
    pub id: u64,
    pub title: String,
    pub detail: String,
}

/// Proveedor del LLM: base URL compatible con OpenAI (termina en /v1), modelo y API key (vacía para Ollama).
#[derive(Clone, Deserialize)]
pub struct Llm {
    pub url: String,
    pub model: String,
    pub key: String,
}

#[derive(Clone, Default, Serialize)]
pub struct Snapshot {
    active: bool,
    status: String,
    lines: Vec<Line>,
    suggestions: Vec<Suggestion>, // tareas del postproceso, para aceptar o descartar
}

#[derive(Default)]
struct Inner {
    snap: Snapshot,
    next_id: u64,
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

/// Quita una sugerencia del panel (aceptada o descartada; aceptar crea la tarea desde el frontend).
#[tauri::command]
pub fn meeting_dismiss(app: AppHandle, id: u64) {
    update(&app, |g| g.snap.suggestions.retain(|s| s.id != id));
}

#[tauri::command]
pub fn meeting_stop(state: State<MeetingState>) {
    if let Some(stop) = &state.0.lock().unwrap().stop {
        stop.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn meeting_start(app: AppHandle, state: State<MeetingState>, llm: Llm) -> Result<(), String> {
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
        let res = mac::run(&app, &stop, &llm);
        #[cfg(not(target_os = "macos"))]
        let res: Result<(), String> = Ok(());
        update(&app, |g| {
            g.stop = None;
            g.snap.active = false;
            g.snap.status = match res {
                Ok(()) => "Reunión terminada".into(),
                Err(e) => format!("Error: {e}"),
            };
        });
    });
    Ok(())
}

/// Vuelve a mandar al LLM la última transcripción guardada (si falló la llamada o se cerró la app).
#[tauri::command]
pub fn meeting_retry(app: AppHandle, state: State<MeetingState>, llm: Llm) -> Result<(), String> {
    if state.0.lock().unwrap().stop.is_some() {
        return Err("Hay una reunión en curso".into());
    }
    let dir = meetings_dir(&app).ok_or("No encontré la carpeta de reuniones")?;
    // Los archivos se llaman <epoch>.md: el mayor nombre es el más reciente.
    let last = std::fs::read_dir(&dir)
        .map_err(|_| "No hay reuniones guardadas".to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "md"))
        .max()
        .ok_or("No hay reuniones guardadas")?;
    let lines = parse_lines(&std::fs::read_to_string(&last).map_err(|e| e.to_string())?);
    if lines.is_empty() {
        return Err("La última transcripción está vacía".into());
    }
    update(&app, |g| {
        g.snap.lines = lines.clone();
        g.snap.status = "Buscando tareas en la reunión…".into();
    });
    std::thread::spawn(move || {
        let res = finalize(&app, &llm, &lines);
        update(&app, |g| {
            g.snap.status = match res {
                Ok(()) => "Reunión revisada".into(),
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

fn fmt_lines(lines: &[Line]) -> String {
    lines.iter().map(|l| format!("{}: {}", l.who, l.text)).collect::<Vec<_>>().join("\n")
}

fn words(t: &str) -> Vec<String> {
    t.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect()
}

/// Limpia la transcripción antes de mandarla: quita muletillas sueltas, repeticiones de whisper y el eco de la
/// llamada que el micrófono capta sin audífonos ("Yo" que repite a "Otros"), y une líneas seguidas del mismo hablante.
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
            Some(prev) if prev.who == l.who => prev.text = format!("{} {}", prev.text, l.text),
            _ => out.push(l.clone()),
        }
    }
    out
}

/// (título, detalle) del JSON del modelo; tolera texto o `<think>…</think>` alrededor.
pub fn parse_tasks(content: &str) -> Vec<(String, String)> {
    let c = content.rsplit("</think>").next().unwrap_or(content);
    let (Some(a), Some(b)) = (c.find('{'), c.rfind('}')) else { return vec![] };
    if a > b {
        return vec![];
    }
    let Ok(v) = serde_json::from_str::<Value>(&c[a..=b]) else { return vec![] };
    v["tareas"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| {
            let title = t["titulo"].as_str()?.trim();
            let detail = t["detalle"].as_str().unwrap_or("").trim();
            (!title.is_empty()).then(|| (title.chars().take(120).collect(), detail.to_string()))
        })
        .collect()
}

fn ask(llm: &Llm, lines: &[Line]) -> Result<Vec<(String, String)>, String> {
    // ponytail: "remoto" = no es localhost; Ollama local no pide key.
    if llm.key.is_empty() && !llm.url.contains("127.0.0.1") && !llm.url.contains("localhost") {
        return Err("LLM: falta la API key (Ajustes → LLM). La transcripción quedó guardada.".into());
    }
    let body = json!({
        "model": llm.model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": format!("Transcripción:\n{}", fmt_lines(lines))},
        ],
    });
    let mut req = ureq::post(format!("{}/chat/completions", llm.url.trim_end_matches('/')))
        .config()
        .timeout_global(Some(Duration::from_secs(900)))
        .http_status_as_error(false) // para leer el mensaje del proveedor en vez de solo "http status: 400"
        .build()
        .header("Content-Type", "application/json");
    if !llm.key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", llm.key));
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
    Ok(parse_tasks(v["choices"][0]["message"]["content"].as_str().unwrap_or("")))
}

/// Postproceso: transcripción limpia → LLM → tareas sugeridas en el panel, con notificación.
fn finalize(app: &AppHandle, llm: &Llm, lines: &[Line]) -> Result<(), String> {
    let tasks = ask(llm, &condense(lines))?;
    let n = tasks.len();
    update(app, |g| {
        for (title, detail) in tasks {
            g.next_id += 1;
            g.snap.suggestions.push(Suggestion { id: g.next_id, title, detail });
        }
    });
    let msg = match n {
        0 => "No encontré tareas para ti".to_string(),
        1 => "1 tarea sugerida".to_string(),
        n => format!("{n} tareas sugeridas"),
    };
    crate::timer::send_notification(app.clone(), "Reunión revisada".into(), format!("{msg}. Revísalas en el panel."));
    Ok(())
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

    struct Capture(Bufs);

    impl SCStreamOutputTrait for Capture {
        fn did_output_sample_buffer(&self, sample: CMSampleBuffer, kind: SCStreamOutputType) {
            let src = match kind {
                SCStreamOutputType::Microphone => 0,
                SCStreamOutputType::Audio => 1,
                SCStreamOutputType::Screen => return,
            };
            let rate = sample.format_description().and_then(|f| f.audio_sample_rate()).unwrap_or(RATE as f64);
            let Ok(list) = sample.audio_buffer_list() else { return };
            // ponytail: solo el primer canal (ScreenCaptureKit entrega float32 sin intercalar, un buffer por canal).
            let Some(b) = list.get(0) else { return };
            let step = b.number_channels.max(1) as usize;
            let mono: Vec<f32> = b
                .data()
                .chunks_exact(4)
                .step_by(step)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            let out = resample(&mono, rate);
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

    fn start_capture(bufs: Bufs) -> Result<SCStream, String> {
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
            .map_err(|e| e.to_string())?;
        let mut stream = SCStream::new(&filter, &config).map_err(|e| e.to_string())?;
        stream.add_output_handler(Capture(bufs.clone()), SCStreamOutputType::Audio).map_err(|e| e.to_string())?;
        stream.add_output_handler(Capture(bufs), SCStreamOutputType::Microphone).map_err(|e| e.to_string())?;
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

    pub fn run(app: &AppHandle, stop: &AtomicBool, llm: &Llm) -> Result<(), String> {
        let path = model_path(app)?;
        update(app, |g| g.snap.status = "Cargando el modelo de voz…".into());
        whisper_rs::install_logging_hooks(); // sin logger, silencia el log de whisper.cpp en la consola
        let ctx = WhisperContext::new_with_params(&path, WhisperContextParameters::default())
            .map_err(|e| format!("whisper: {e}"))?;
        let mut ws = ctx.create_state().map_err(|e| format!("whisper: {e}"))?;
        let mut transcribe = |audio: &[f32]| transcribe(&mut ws, audio);

        let bufs: Bufs = Arc::default();
        let stream = start_capture(bufs.clone())?;
        update(app, |g| g.snap.status = "Escuchando…".into());

        let mut lines: Vec<Line> = vec![];
        let mut push = |app: &AppHandle, lines: &mut Vec<Line>, flush: bool| {
            for src in 0..2 {
                while let Some(chunk) = take_chunk(&mut bufs.lock().unwrap()[src], flush) {
                    if rms(&chunk) < SILENCE / 2.0 {
                        continue; // todo silencio: whisper alucinaría
                    }
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
        }

        let _ = stream.stop_capture();
        update(app, |g| g.snap.status = "Transcribiendo lo último…".into());
        push(app, &mut lines, true);
        if !lines.is_empty() {
            save(app, &lines);
            update(app, |g| g.snap.status = "Buscando tareas en la reunión…".into());
            finalize(app, llm, &lines)?;
        }
        Ok(())
    }

    /// Guarda la transcripción en $APPDATA/meetings/<epoch>.md.
    fn save(app: &AppHandle, lines: &[Line]) {
        let Some(dir) = meetings_dir(app) else { return };
        let _ = std::fs::create_dir_all(&dir);
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = std::fs::write(dir.join(format!("{secs}.md")), fmt_lines(lines));
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
        ]);
        let got: Vec<_> = out.iter().map(|l| format!("{}: {}", l.who, l.text)).collect();
        assert_eq!(
            got,
            [
                "Otros: Necesito que me mandes la propuesta antes del jueves.",
                "Yo: Te la mando el miércoles. En la tarde.",
                "Otros: Genial, gracias.",
            ]
        );
    }

    #[test]
    fn lee_el_json_del_modelo() {
        let out = "<think>{no}</think>Claro: {\"tareas\":[{\"titulo\":\"Enviar informe\",\"detalle\":\"Ana, lunes\"},{\"titulo\":\" \"}]}";
        assert_eq!(parse_tasks(out), vec![("Enviar informe".into(), "Ana, lunes".into())]);
        assert!(parse_tasks("sin json").is_empty());
        assert!(parse_tasks("} {").is_empty());
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
/// (líneas "Yo: …" / "Otros: …"; LLM_URL y LLM_KEY opcionales, por defecto Ollama local).
#[cfg(test)]
#[test]
#[ignore]
fn probar_llm() {
    let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.into());
    let llm = Llm { url: env("LLM_URL", "http://127.0.0.1:11434/v1"), model: env("LLM_MODEL", "qwen3.5:9b"), key: env("LLM_KEY", "") };
    let text = std::fs::read_to_string(env("MEETING_TXT", "reunion.txt")).unwrap();
    let lines: Vec<Line> = text
        .lines()
        .filter_map(|l| l.split_once(": "))
        .map(|(w, t)| Line { who: if w == "Yo" { "Yo" } else { "Otros" }, text: t.into() })
        .collect();
    let clean = condense(&lines);
    println!("{} líneas → {} tras limpiar", lines.len(), clean.len());
    let t = std::time::Instant::now();
    let tasks = ask(&llm, &clean).unwrap();
    println!("{:.1}s", t.elapsed().as_secs_f32());
    for (title, detail) in tasks {
        println!("  + {title} — {detail}");
    }
}
