use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Focus,
    Short,
    Long,
}

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Idle,
    Running,
    Paused,
}

/// Pausas automáticas tras un foco (configurable desde Settings en F6).
#[derive(Default)]
pub struct Cfg {
    pub focus_s: u64,
    pub short_s: u64,
    pub long_s: u64,
    pub long_every: u32,
    /// Al terminar una pausa, arranca el siguiente foco solo.
    pub auto_cycle: bool,
    /// Muestra el tiempo restante junto al ícono del tray (macOS).
    pub tray_timer: bool,
    /// Bundle ids de las apps que cuentan como distracción durante un foco.
    pub distractions: Vec<String>,
    /// Bloques de la rutina activa (F18); vacío = esquema clásico (foco/corta/larga cada `long_every`).
    pub steps: Vec<Step>,
}

/// Un bloque de la rutina: una actividad con sus minutos ya resueltos.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Step {
    pub mode: Mode,
    pub secs: u64,
    pub activity_id: i64,
    pub label: String,
    pub emoji: String,
    pub color: String, // "#rrggbb" de la actividad: la píldora y el panel se pintan con él
}

impl Step {
    /// Las pausas de 15 min o más cuentan como `Long`: stats y la barra de menú siguen con los tres modos.
    pub fn new(kind: &str, min: u64, activity_id: i64, label: String, emoji: String, color: String) -> Self {
        let mode = match kind {
            "focus" => Mode::Focus,
            _ if min >= 15 => Mode::Long,
            _ => Mode::Short,
        };
        Self { mode, secs: min.max(1) * 60, activity_id, label, emoji, color }
    }
}

/// Tiempo y distracciones de una app durante un foco (se vuelca en `session_apps`).
#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
pub struct AppUse {
    pub bundle: String,
    pub name: String,
    pub ms: u64,
    pub hits: u32,
}

/// Lo que pasó al mirar la app al frente.
#[derive(Debug, PartialEq)]
pub enum Watch {
    /// Acaba de abrir una app de la lista de distracciones.
    Distracted(String, String), // bundle, nombre
    /// Lleva más de 1 min seguido en una (se avisa una sola vez por visita).
    Lingering(String),
}

const LINGER_MS: u64 = 60_000;
/// "App" del teléfono en `session_apps` (lo ve la cámara, F17).
const PHONE: &str = "phone";

/// Tiempos en ms de reloj (epoch), no `Instant`: así el estado se puede guardar en disco
/// y retomarse tras cerrar la app (y el día de mañana sincronizarse con otro dispositivo).
#[derive(Serialize, Deserialize)]
pub struct Timer {
    mode: Mode,
    status: Status,
    total: u64,       // ms
    left: u64,        // ms, válido en Paused
    end: Option<u64>, // epoch ms, válido en Running
    count: u32,
    task_id: Option<i64>,
    last_task: Option<i64>, // tarea del último foco, para continuar el ciclo
    #[serde(default)]
    step: usize, // bloque de la rutina en curso (o el siguiente, en reposo)
    #[serde(default)]
    activity: Option<i64>, // actividad del bloque en curso; None fuera de una rutina
    #[serde(skip)]
    cfg: Cfg,
    // Apps al frente durante el foco en curso (F11); va en timer.json para sobrevivir a un cierre a mitad de foco.
    #[serde(default)]
    apps: HashMap<String, AppUse>,
    #[serde(skip)]
    front: Option<String>, // bundle al frente en la última mirada
    #[serde(skip)]
    away_ms: u64, // tiempo seguido en la distracción actual
    #[serde(skip)]
    away_warned: bool,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Done {
    pub mode: Mode,
    next: Option<Mode>,
    pub task_id: Option<i64>,
    pub elapsed: u64, // s realmente transcurridos
    pub skipped: bool,
    pub activity_id: Option<i64>,
    #[serde(skip)]
    pub apps: Vec<AppUse>,
}

#[derive(Serialize, Clone)]
pub struct Snap {
    mode: Mode,
    status: Status,
    remaining: u64,
    total: u64,
    count: u32,
    task_id: Option<i64>,
    // Rutina (F18): posición, total de bloques y nombres del actual y el siguiente ("" sin rutina o fuera de ella).
    step: usize,
    steps: usize,
    label: String,
    emoji: String,
    color: String,
    next_label: String,
}

impl Timer {
    pub fn new() -> Self {
        Self {
            mode: Mode::Focus,
            status: Status::Idle,
            total: 0,
            left: 0,
            end: None,
            count: 0,
            task_id: None,
            last_task: None,
            step: 0,
            activity: None,
            cfg: Cfg { focus_s: 1500, short_s: 300, long_s: 900, long_every: 4, auto_cycle: false, tray_timer: true, distractions: vec![], steps: vec![] },
            apps: HashMap::new(),
            front: None,
            away_ms: 0,
            away_warned: false,
        }
    }

    fn remaining(&self, now: u64) -> u64 {
        match (self.status, self.end) {
            (Status::Running, Some(e)) => e.saturating_sub(now),
            (Status::Paused, _) => self.left,
            _ => 0,
        }
    }

    pub fn start(&mut self, mode: Mode, secs: u64, task_id: Option<i64>, now: u64) {
        self.mode = mode;
        self.task_id = task_id;
        self.activity = None;
        self.apps.clear();
        self.front = None;
        self.total = secs * 1000;
        self.status = Status::Running;
        self.end = Some(now + self.total);
    }

    /// Arranca el bloque `i` de la rutina; los focos siguen con la última tarea.
    fn start_step(&mut self, i: usize, now: u64) {
        let s = self.cfg.steps[i].clone();
        let task = (s.mode == Mode::Focus).then_some(self.last_task).flatten();
        self.start(s.mode, s.secs, task, now);
        self.step = i;
        self.activity = Some(s.activity_id);
    }

    /// Rutina nueva (o editada): aplica desde el próximo bloque; el que corre termina como empezó.
    pub fn set_steps(&mut self, steps: Vec<Step>) {
        if steps != self.cfg.steps {
            self.step = 0;
            self.cfg.steps = steps;
        }
    }

    /// Reposo → siguiente bloque: el de la rutina, o un foco con la duración de Ajustes.
    fn start_next(&mut self, now: u64) {
        if self.cfg.steps.is_empty() {
            self.start(Mode::Focus, self.cfg.focus_s, self.last_task, now);
        } else {
            self.start_step(self.step.min(self.cfg.steps.len() - 1), now);
        }
    }

    pub fn pause(&mut self, now: u64) {
        if self.status == Status::Running {
            self.left = self.remaining(now);
            self.status = Status::Paused;
            self.end = None;
        }
    }

    pub fn resume(&mut self, now: u64) {
        if self.status == Status::Paused {
            self.status = Status::Running;
            self.end = Some(now + self.left);
        }
    }

    /// Corta el temporizador. Si era un foco, devuelve lo trabajado para registrarlo como tiempo (no como 🍅).
    pub fn reset(&mut self, now: u64) -> Option<Done> {
        let partial = (self.status != Status::Idle && self.mode == Mode::Focus).then(|| Done {
            mode: Mode::Focus,
            next: None,
            task_id: self.task_id,
            elapsed: self.elapsed(now),
            skipped: true,
            activity_id: self.activity,
            apps: self.take_apps(),
        });
        self.status = Status::Idle;
        self.end = None;
        self.left = 0;
        partial
    }

    /// Entrega las apps del foco que termina, de más a menos tiempo.
    fn take_apps(&mut self) -> Vec<AppUse> {
        self.front = None;
        let mut v: Vec<AppUse> = self.apps.drain().map(|(_, a)| a).collect();
        v.sort_by(|a, b| b.ms.cmp(&a.ms).then_with(|| a.bundle.cmp(&b.bundle)));
        v
    }

    /// ¿Hay que mirar la app al frente? Solo con un foco corriendo.
    pub fn watching(&self) -> bool {
        self.status == Status::Running && self.mode == Mode::Focus
    }

    /// Registra la app al frente durante los últimos `dt_ms` y detecta distracciones.
    pub fn watch(&mut self, front: Option<(String, String)>, dt_ms: u64) -> Option<Watch> {
        let front = front.filter(|_| self.watching()); // el foco pudo terminar entre la mirada y el candado
        let Some((bundle, name)) = front else {
            self.front = None;
            self.away_ms = 0;
            return None;
        };
        let a = self.apps.entry(bundle.clone()).or_insert_with(|| AppUse { bundle: bundle.clone(), ..Default::default() });
        a.name = name.clone();
        a.ms += dt_ms;
        let arrived = self.front.as_deref() != Some(bundle.as_str());
        self.front = Some(bundle.clone());
        if !self.cfg.distractions.contains(&bundle) {
            self.away_ms = 0;
            self.away_warned = false;
            return None;
        }
        if arrived {
            self.apps.get_mut(&bundle).unwrap().hits += 1;
            self.away_ms = 0;
            self.away_warned = false;
            return Some(Watch::Distracted(bundle, name));
        }
        self.away_ms += dt_ms;
        if self.away_ms > LINGER_MS && !self.away_warned {
            self.away_warned = true;
            return Some(Watch::Lingering(name));
        }
        None
    }

    /// Teléfono visto por la cámara (F17): suma `ms` a la sesión y, si `hit`, una distracción. false fuera del foco.
    pub fn phone(&mut self, ms: u64, hit: bool) -> bool {
        if !self.watching() {
            return false;
        }
        let a = self.apps.entry(PHONE.into()).or_insert_with(|| AppUse { bundle: PHONE.into(), name: "Teléfono".into(), ..Default::default() });
        a.ms += ms;
        a.hits += hit as u32;
        true
    }

    fn elapsed(&self, now: u64) -> u64 {
        self.total.saturating_sub(self.remaining(now)) / 1000
    }

    /// Termina el temporizador actual (por vencimiento o skip). Tras un foco arranca la pausa.
    pub fn complete(&mut self, now: u64, skipped: bool) -> Option<Done> {
        if self.status == Status::Idle {
            return None;
        }
        let mode = self.mode;
        let task_id = self.task_id;
        let elapsed = self.elapsed(now);
        let activity_id = self.activity;
        let apps = self.take_apps();
        if !self.cfg.steps.is_empty() {
            // Rutina: tras un foco sigue siempre (como el clásico); tras una pausa, solo con auto_cycle.
            let next = (self.step + 1) % self.cfg.steps.len();
            if mode == Mode::Focus {
                self.count += 1;
                self.last_task = task_id;
            }
            return Some(if mode == Mode::Focus || self.cfg.auto_cycle {
                self.start_step(next, now);
                Done { mode, next: Some(self.mode), task_id, elapsed, skipped, activity_id, apps }
            } else {
                self.reset(now);
                self.step = next;
                Done { mode, next: None, task_id, elapsed, skipped, activity_id, apps }
            });
        }
        if mode == Mode::Focus {
            self.count += 1;
            self.last_task = task_id;
            let (next, secs) = if self.count % self.cfg.long_every == 0 {
                (Mode::Long, self.cfg.long_s)
            } else {
                (Mode::Short, self.cfg.short_s)
            };
            self.start(next, secs, None, now);
            Some(Done { mode, next: Some(next), task_id, elapsed, skipped, activity_id, apps })
        } else if self.cfg.auto_cycle {
            self.start(Mode::Focus, self.cfg.focus_s, self.last_task, now);
            Some(Done { mode, next: Some(Mode::Focus), task_id, elapsed, skipped, activity_id, apps })
        } else {
            self.reset(now);
            Some(Done { mode, next: None, task_id, elapsed, skipped, activity_id, apps })
        }
    }

    pub fn due(&mut self, now: u64) -> Option<Done> {
        if self.status == Status::Running && self.remaining(now) == 0 {
            self.complete(now, false)
        } else {
            None
        }
    }

    /// Si venció con la app cerrada: lo completa a su hora real (no ahora) y queda en reposo.
    pub fn catch_up(&mut self, now: u64) -> Option<(Done, u64)> {
        let end = self.end.filter(|&e| self.status == Status::Running && e <= now)?;
        let done = self.complete(end, false)?;
        self.reset(now);
        Some((done, end))
    }

    /// Botón principal: reposo → siguiente bloque (foco de Ajustes o el de la rutina); corriendo → pausa; pausa → reanuda.
    pub fn toggle(&mut self, now: u64) {
        match self.status {
            Status::Idle => self.start_next(now),
            Status::Running => self.pause(now),
            Status::Paused => self.resume(now),
        }
    }

    /// Duración configurada de cada modo (s).
    pub fn secs_for(&self, mode: Mode) -> u64 {
        match mode {
            Mode::Focus => self.cfg.focus_s,
            Mode::Short => self.cfg.short_s,
            Mode::Long => self.cfg.long_s,
        }
    }

    pub fn snap(&self, now: u64) -> Snap {
        let steps = &self.cfg.steps;
        let cur = (self.status != Status::Idle && self.activity.is_some()).then(|| steps.get(self.step)).flatten();
        // en reposo, `step` ya apunta al siguiente; corriendo, el siguiente es step + 1
        let next = match self.status {
            _ if steps.is_empty() => None,
            Status::Idle => steps.get(self.step),
            _ => steps.get((self.step + 1) % steps.len()),
        };
        Snap {
            mode: self.mode,
            status: self.status,
            remaining: self.remaining(now).div_ceil(1000),
            total: self.total / 1000,
            count: self.count,
            task_id: self.task_id,
            step: self.step,
            steps: steps.len(),
            label: cur.map(|s| s.label.clone()).unwrap_or_default(),
            emoji: cur.map(|s| s.emoji.clone()).unwrap_or_default(),
            color: cur.map(|s| s.color.clone()).unwrap_or_default(),
            next_label: next.map(|s| s.label.clone()).unwrap_or_default(),
        }
    }
}

pub type TimerState = Mutex<Timer>;

/// Texto junto al ícono del tray: `🍅 12:34` en foco, `☕ 04:10` en pausa, `⏸ 12:34` en pausa manual; nada en reposo.
fn tray_label(mode: Mode, status: Status, remaining_s: u64) -> Option<String> {
    let icon = match (status, mode) {
        (Status::Idle, _) => return None,
        (Status::Paused, _) => "⏸",
        (Status::Running, Mode::Focus) => "🍅",
        (Status::Running, _) => "☕",
    };
    Some(format!("{icon} {:02}:{:02}", remaining_s / 60, remaining_s % 60))
}

fn emit_tick(app: &AppHandle, t: &Timer) {
    let _ = app.emit("timer://tick", t.snap(now_ms()));
}

fn state_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_data_dir().ok()?.join("timer.json"))
}

/// Cambio de estado: avisa a las ventanas y lo deja en disco para sobrevivir a un cierre.
fn changed(app: &AppHandle, t: &Timer) {
    emit_tick(app, t);
    save(app, t);
}

fn save(app: &AppHandle, t: &Timer) {
    if let (Some(path), Ok(json)) = (state_file(app), serde_json::to_vec(t)) {
        let _ = std::fs::write(path, json);
    }
}

/// Retoma el timer guardado. Si venció con la app cerrada, se registra y queda en reposo (sin encadenar pausas).
pub fn restore(app: &AppHandle) {
    let Some(saved) = state_file(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<Timer>(&b).ok())
    else {
        return;
    };
    let state = app.state::<TimerState>();
    let mut t = state.lock().unwrap();
    let cfg = std::mem::take(&mut t.cfg);
    *t = Timer { cfg, ..saved };
    if let Some((done, end)) = t.catch_up(now_ms()) {
        crate::db::record_session(app, &done, end);
    }
    changed(app, &t);
}

fn notify(app: &AppHandle, done: &Done, t: &Timer) {
    let s = t.snap(now_ms());
    let mins = s.total / 60;
    if done.next.is_some() && !s.label.is_empty() {
        let title = if s.mode == Mode::Focus { "¡A trabajar!" } else { "¡Foco terminado!" };
        let _ = app.notification().builder().title(title).body(format!("{} {} · {mins} min", s.emoji, s.label).trim()).show();
        return;
    }
    let (title, body) = match (done.mode, done.next) {
        (Mode::Focus, _) => ("¡Foco terminado! Descansa".to_string(), format!("Suelta el trabajo: pausa de {mins} min.")),
        (_, Some(_)) => ("¡A trabajar!".to_string(), format!("La pausa terminó. Arranca un foco de {mins} min.")),
        (_, None) => ("¡A trabajar!".to_string(), "La pausa terminó.".to_string()),
    };
    let _ = app.notification().builder().title(title).body(body).show();
}

fn finish(app: &AppHandle, t: &Timer, done: Done) {
    crate::db::record_session(app, &done, now_ms());
    let _ = app.emit("timer://done", &done);
    notify(app, &done, t);
    changed(app, t);
}

/// Hilo del timer: vive en Rust, no depende del webview (sobrevive a throttling y ventana oculta).
///
/// Es el ÚNICO que toca el título del tray, y siempre sin el candado del timer: `set_title` espera al hilo
/// principal, y los comandos síncronos (que corren ahí) piden ese candado → llamarlo con el guard tomado
/// (o desde un comando) cuelga la app. Los comandos solo cambian el estado; el cambio llega a la barra
/// en el siguiente ciclo (250 ms).
pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut last = String::new(); // lo último escrito en la barra; solo lo usa este hilo
        let mut polled = Instant::now(); // última mirada a la app al frente (F11)
        let mut saved = Instant::now(); // último volcado de las apps del foco a timer.json
        let own = app.config().identifier.clone();
        loop {
            thread::sleep(Duration::from_millis(250));
            let (label, watching) = {
                let state = app.state::<TimerState>();
                let mut t = state.lock().unwrap();
                if t.status != Status::Idle {
                    match t.due(now_ms()) {
                        Some(done) => finish(&app, &t, done),
                        None => emit_tick(&app, &t),
                    }
                }
                let s = t.snap(now_ms());
                let label = t.cfg.tray_timer.then(|| tray_label(s.mode, s.status, s.remaining)).flatten();
                (label.unwrap_or_default(), t.watching())
            }; // guard soltado aquí
            if label != last && crate::tray::set_title(&app, (!label.is_empty()).then(|| label.clone())) {
                last = label;
            }
            // App al frente, 1 vez por segundo y solo en foco. También sin el candado puesto: la consulta a
            // NSWorkspace no debe retener el candado del timer (el hilo principal lo pide en cada comando).
            if !watching {
                polled = Instant::now();
            } else if polled.elapsed() >= Duration::from_secs(1) {
                let dt = polled.elapsed().as_millis().min(2000) as u64;
                polled = Instant::now();
                let front = crate::apps::frontmost().filter(|a| a.bundle != own).map(|a| (a.bundle, a.name));
                let ev = app.state::<TimerState>().lock().unwrap().watch(front, dt); // guard temporal: se suelta al final de la línea
                match ev {
                    Some(Watch::Distracted(bundle, name)) => {
                        let _ = app.emit("focus://distraction", serde_json::json!({ "bundle": bundle, "name": name }));
                    }
                    Some(Watch::Lingering(name)) => {
                        let _ = app.notification().builder().title("Sigues distraído").body(format!("Llevas más de 1 min en {name}.")).show();
                    }
                    None => {}
                }
                // ponytail: cada 30 s; si la app se cierra de golpe se pierde como mucho eso del tiempo por app
                if saved.elapsed() >= Duration::from_secs(30) {
                    saved = Instant::now();
                    save(&app, &app.state::<TimerState>().lock().unwrap());
                }
            }
        }
    });
}

#[tauri::command]
pub fn timer_config(focus_s: u64, short_s: u64, long_s: u64, long_every: u32, auto_cycle: bool, tray_timer: bool, distractions: Vec<String>, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    let steps = std::mem::take(&mut t.cfg.steps); // la rutina viene de la base (timer_routine), no de Ajustes
    t.cfg = Cfg { focus_s: focus_s.max(1), short_s: short_s.max(1), long_s: long_s.max(1), long_every: long_every.max(1), auto_cycle, tray_timer, distractions, steps };
}

/// Tiempos del ciclo clásico (los de Ajustes, que PetWindow empuja con `timer_config`): la web no tiene las prefs.
#[derive(Serialize)]
pub struct Classic {
    focus_min: u64,
    short_min: u64,
    long_min: u64,
    long_every: u32,
    auto_cycle: bool,
}

#[tauri::command]
pub fn timer_classic(s: State<TimerState>) -> Classic {
    let c = &s.lock().unwrap().cfg;
    Classic { focus_min: c.focus_s / 60, short_min: c.short_s / 60, long_min: c.long_s / 60, long_every: c.long_every, auto_cycle: c.auto_cycle }
}

/// Relee la rutina activa de la base (F18). Lo llama el panel al abrir y cada `db://changed` (lib.rs).
#[tauri::command]
pub async fn timer_routine(app: AppHandle) -> Result<usize, String> {
    let pool = app.state::<crate::db::Db>().0.clone();
    let steps = crate::db::active_routine(&pool).await.map_err(|e| e.to_string())?;
    let n = steps.len();
    let state = app.state::<TimerState>();
    let mut t = state.lock().unwrap();
    t.set_steps(steps);
    emit_tick(&app, &t);
    Ok(n)
}

/// La cámara vio el teléfono durante el foco (F17): `hit` = primer ladrido, cuenta como distracción de F11.
#[tauri::command]
pub fn focus_phone(ms: u64, hit: bool, app: AppHandle, s: State<TimerState>) {
    let counted = s.lock().unwrap().phone(ms, hit);
    if counted && hit {
        let _ = app.emit("focus://distraction", serde_json::json!({ "bundle": PHONE, "name": "Teléfono" }));
    }
}

/// Inicia un foco con la duración configurada (menú del tray).
pub fn start_focus(app: &AppHandle) {
    let state = app.state::<TimerState>();
    let mut t = state.lock().unwrap();
    t.start_next(now_ms());
    changed(app, &t);
}

/// Botón principal del panel: en reposo inicia un foco, corriendo pausa, en pausa reanuda (atajo global).
pub fn toggle_focus(app: &AppHandle) {
    let state = app.state::<TimerState>();
    let mut t = state.lock().unwrap();
    t.toggle(now_ms());
    changed(app, &t);
}

/// Botón "Seguir rutina" del panel: en reposo arranca el bloque que toca (como el atajo global).
#[tauri::command]
pub fn timer_toggle(app: AppHandle) {
    toggle_focus(&app);
}

#[tauri::command]
pub fn timer_get(s: State<TimerState>) -> Snap {
    s.lock().unwrap().snap(now_ms())
}

#[tauri::command]
pub fn timer_start(mode: Mode, seconds: u64, task_id: Option<i64>, app: AppHandle, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    t.start(mode, seconds, task_id, now_ms());
    changed(&app, &t);
}

#[tauri::command]
pub fn timer_pause(app: AppHandle, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    t.pause(now_ms());
    changed(&app, &t);
}

#[tauri::command]
pub fn timer_resume(app: AppHandle, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    t.resume(now_ms());
    changed(&app, &t);
}

#[tauri::command]
pub fn timer_reset(app: AppHandle, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    let now = now_ms();
    if let Some(partial) = t.reset(now) {
        crate::db::record_session(&app, &partial, now);
    }
    t.count = 0; // terminar sesión: el ciclo de pausas largas vuelve a empezar
    t.step = 0; // y la rutina, desde su primer bloque
    changed(&app, &t);
}

/// Reinicia el bloque actual desde cero (registra lo trabajado si era foco).
#[tauri::command]
pub fn timer_restart(app: AppHandle, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    if t.status == Status::Idle {
        return;
    }
    let (mode, secs, task, now) = (t.mode, t.total / 1000, t.task_id, now_ms());
    if let Some(partial) = t.reset(now) {
        crate::db::record_session(&app, &partial, now);
    }
    t.start(mode, secs, task, now);
    changed(&app, &t);
}

/// Tarea del próximo foco encadenado (auto_cycle). No toca el foco en curso: lo trabajado se acredita a la tarea con la que empezó.
#[tauri::command]
pub fn timer_set_task(task_id: Option<i64>, s: State<TimerState>) {
    s.lock().unwrap().last_task = task_id;
}

#[tauri::command]
pub fn timer_skip(app: AppHandle, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    match t.complete(now_ms(), true) {
        Some(done) => finish(&app, &t, done),
        None => changed(&app, &t),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_congela_y_resume_continua() {
        let t0 = 1_000_000;
        let mut t = Timer::new();
        t.start(Mode::Focus, 60, None, t0);
        t.pause(t0 + 20000);
        assert_eq!(t.remaining(t0 + 500000), 40000);
        t.resume(t0 + 500000);
        assert_eq!(t.remaining(t0 + 510000), 30000);
    }

    #[test]
    fn ciclo_automatico_continua_con_otro_foco_y_conserva_tarea() {
        let mut now = 1_000_000;
        let mut t = Timer::new();
        t.cfg.auto_cycle = true;
        t.cfg.focus_s = 60;
        t.start(Mode::Focus, 60, Some(7), now);
        now += 61000;
        assert_eq!(t.due(now).unwrap().next, Some(Mode::Short));
        now += 301000;
        let d = t.due(now).unwrap();
        assert_eq!((d.mode, d.next), (Mode::Short, Some(Mode::Focus)));
        let s = t.snap(now);
        assert_eq!((s.mode, s.status, s.total, s.task_id), (Mode::Focus, Status::Running, 60, Some(7)));
    }

    #[test]
    fn vence_y_encadena_pausa_larga_cada_4() {
        let mut now = 1_000_000;
        let mut t = Timer::new();
        for i in 1..=4 {
            t.start(Mode::Focus, 60, None, now);
            assert!(t.due(now + 59000).is_none());
            now += 61000;
            let d = t.due(now).unwrap();
            assert_eq!(d.next, Some(if i == 4 { Mode::Long } else { Mode::Short }));
            assert_eq!(t.status, Status::Running);
        }
        now += 901000;
        assert_eq!(t.due(now), Some(Done { mode: Mode::Long, next: None, task_id: None, elapsed: 900, skipped: false, activity_id: None, apps: vec![] }));
        assert_eq!(t.status, Status::Idle);
    }

    #[test]
    fn reset_de_foco_devuelve_lo_trabajado() {
        let mut t = Timer::new();
        t.start(Mode::Focus, 1500, Some(3), 0);
        let d = t.reset(600_000).unwrap();
        assert_eq!((d.task_id, d.elapsed, d.skipped), (Some(3), 600, true));
        assert_eq!(t.status, Status::Idle);
        t.start(Mode::Short, 300, None, 0);
        assert!(t.reset(1000).is_none()); // las pausas no son tiempo de trabajo
    }

    #[test]
    fn vencido_con_la_app_cerrada_se_registra_a_su_hora() {
        let t0 = 1_000_000;
        let mut t = Timer::new();
        t.start(Mode::Focus, 1500, Some(2), t0);
        assert!(t.catch_up(t0 + 100).is_none());
        assert_eq!(t.status, Status::Running);
        let (d, end) = t.catch_up(t0 + 36_000_000).unwrap(); // 10 h después
        assert_eq!((end, d.elapsed, d.task_id, t.status), (t0 + 1_500_000, 1500, Some(2), Status::Idle));
        t.start(Mode::Focus, 1500, None, t0);
        t.pause(t0 + 1000);
        assert!(t.catch_up(t0 + 36_000_000).is_none());
    }

    #[test]
    fn toggle_inicia_pausa_y_reanuda() {
        let mut t = Timer::new();
        t.cfg.focus_s = 60;
        t.last_task = Some(4);
        t.toggle(0);
        let s = t.snap(0);
        assert_eq!((s.mode, s.status, s.total, s.task_id), (Mode::Focus, Status::Running, 60, Some(4)));
        t.toggle(20_000);
        assert_eq!((t.status, t.remaining(99_000)), (Status::Paused, 40_000));
        t.toggle(100_000);
        assert_eq!((t.status, t.remaining(110_000)), (Status::Running, 30_000));
    }

    fn rutina(bloques: &[(&str, u64, &str)]) -> Vec<Step> {
        bloques.iter().enumerate().map(|(i, &(k, m, l))| Step::new(k, m, i as i64, l.into(), String::new(), format!("#00000{i}"))).collect()
    }

    /// Recorre `n` bloques dejando vencer cada uno; devuelve (modo, minutos, actividad) del que arrancó tras cada uno.
    fn vueltas(t: &mut Timer, n: usize) -> Vec<(Mode, u64, Option<i64>)> {
        let mut now = 0;
        t.toggle(now);
        let mut out = vec![(t.mode, t.total / 60_000, t.activity)];
        for _ in 1..n {
            now += t.total + 1000;
            assert!(t.due(now).is_some());
            if t.status == Status::Idle {
                t.toggle(now);
            }
            out.push((t.mode, t.total / 60_000, t.activity));
        }
        out
    }

    #[test]
    fn rutina_de_diego_25_5_x4_con_pausa_de_20() {
        let mut t = Timer::new();
        t.cfg.auto_cycle = true;
        let mut b = vec![];
        for _ in 0..3 {
            b.extend([("focus", 25, "Foco"), ("break", 5, "Descanso")]);
        }
        b.extend([("focus", 25, "Foco"), ("break", 20, "Descanso largo")]);
        t.set_steps(rutina(&b));
        let v = vueltas(&mut t, 9);
        let modos: Vec<_> = v.iter().map(|&(m, min, _)| (m, min)).collect();
        use Mode::*;
        assert_eq!(modos, [(Focus, 25), (Short, 5), (Focus, 25), (Short, 5), (Focus, 25), (Short, 5), (Focus, 25), (Long, 20), (Focus, 25)]);
        assert_eq!(v[8].2, Some(0)); // vuelve al primer bloque
        assert_eq!(t.count, 4); // focos completados; el quinto está corriendo
    }

    #[test]
    fn rutina_de_constanza_con_pausa_activa_sin_auto_ciclo() {
        let mut t = Timer::new();
        t.last_task = Some(3);
        t.set_steps(rutina(&[("focus", 25, "Foco"), ("break", 5, "Descanso"), ("focus", 25, "Foco"), ("break", 10, "Pausa activa")]));
        let v = vueltas(&mut t, 5);
        use Mode::*;
        assert_eq!(v, [(Focus, 25, Some(0)), (Short, 5, Some(1)), (Focus, 25, Some(2)), (Short, 10, Some(3)), (Focus, 25, Some(0))]);
        assert_eq!(t.task_id, Some(3)); // los focos siguen con la última tarea
        // sin auto_cycle la pausa termina en reposo, y el panel ya sabe qué viene
        let mut now = t.end.unwrap();
        t.due(now); // → Descanso
        let s = t.snap(now);
        assert_eq!((s.label.as_str(), s.color.as_str(), s.next_label.as_str(), s.step, s.steps), ("Descanso", "#000001", "Foco", 1, 4));
        now += t.total + 1000;
        assert_eq!(t.due(now).unwrap().activity_id, Some(1));
        let s = t.snap(now);
        assert_eq!((s.status, s.label.as_str(), s.color.as_str(), s.next_label.as_str()), (Status::Idle, "", "", "Foco"));
    }

    #[test]
    fn cambiar_de_rutina_vuelve_al_primer_bloque_y_vacia_es_la_clasica() {
        let mut t = Timer::new();
        let r = rutina(&[("focus", 50, "Foco"), ("break", 10, "Pausa")]);
        t.set_steps(r.clone());
        t.step = 1;
        t.set_steps(r.clone()); // la misma (otro db://changed): no toca la posición
        assert_eq!(t.step, 1);
        t.set_steps(vec![]);
        t.toggle(0);
        assert_eq!((t.mode, t.total, t.activity, t.snap(0).label), (Mode::Focus, 1_500_000, None, String::new()));
    }

    fn front(b: &str) -> Option<(String, String)> {
        Some((b.into(), b.to_uppercase()))
    }

    #[test]
    fn distracciones_y_tiempo_por_app() {
        let mut t = Timer::new();
        t.cfg.distractions = vec!["red".into()];
        t.start(Mode::Focus, 600, None, 0);
        assert_eq!(t.watch(front("ide"), 1000), None);
        assert_eq!(t.watch(front("ide"), 1000), None);
        assert_eq!(t.watch(front("red"), 1000), Some(Watch::Distracted("red".into(), "RED".into())));
        assert_eq!(t.watch(front("red"), 30_000), None); // sigue ahí: no cuenta otra distracción
        assert_eq!(t.watch(front("red"), 31_000), Some(Watch::Lingering("RED".into())));
        assert_eq!(t.watch(front("red"), 1000), None); // se avisa una sola vez
        assert_eq!(t.watch(front("ide"), 1000), None);
        assert_eq!(t.watch(front("red"), 1000), Some(Watch::Distracted("red".into(), "RED".into()))); // vuelve: otra
        let d = t.reset(5000).unwrap();
        let sum: Vec<_> = d.apps.iter().map(|a| (a.bundle.as_str(), a.ms, a.hits)).collect();
        assert_eq!(sum, [("red", 64_000, 2), ("ide", 3000, 0)]);
        assert!(t.apps.is_empty());
    }

    #[test]
    fn telefono_de_la_camara() {
        let mut t = Timer::new();
        assert!(!t.phone(5000, true)); // reposo: no cuenta
        t.start(Mode::Focus, 600, None, 0);
        assert!(t.phone(16_000, true));
        assert!(t.phone(30_000, false)); // ladra de nuevo: tiempo, no otra distracción
        let d = t.reset(1000).unwrap();
        assert_eq!(d.apps, [AppUse { bundle: "phone".into(), name: "Teléfono".into(), ms: 46_000, hits: 1 }]);
    }

    #[test]
    fn no_mira_fuera_del_foco() {
        let mut t = Timer::new();
        t.cfg.distractions = vec!["red".into()];
        assert_eq!(t.watch(front("red"), 1000), None); // reposo
        t.start(Mode::Short, 300, None, 0);
        assert_eq!(t.watch(front("red"), 1000), None); // pausa
        t.start(Mode::Focus, 300, None, 0);
        t.pause(1000);
        assert_eq!(t.watch(front("red"), 1000), None); // foco en pausa
        assert!(t.reset(2000).unwrap().apps.is_empty());
    }

    #[test]
    fn texto_del_tray() {
        let l = |m, s, r| tray_label(m, s, r);
        assert_eq!(l(Mode::Focus, Status::Running, 754), Some("🍅 12:34".into()));
        assert_eq!(l(Mode::Short, Status::Running, 250), Some("☕ 04:10".into()));
        assert_eq!(l(Mode::Long, Status::Running, 5), Some("☕ 00:05".into()));
        assert_eq!(l(Mode::Focus, Status::Paused, 754), Some("⏸ 12:34".into()));
        assert_eq!(l(Mode::Short, Status::Paused, 60), Some("⏸ 01:00".into()));
        assert_eq!(l(Mode::Focus, Status::Idle, 0), None);
        assert_eq!(l(Mode::Focus, Status::Running, 180 * 60), Some("🍅 180:00".into()));
    }

    #[test]
    fn sobrevive_a_guardar_y_cargar() {
        let mut t = Timer::new();
        t.start(Mode::Focus, 1500, Some(9), 0);
        let back: Timer = serde_json::from_slice(&serde_json::to_vec(&t).unwrap()).unwrap();
        let s = back.snap(300_000); // 5 min después, con la app recién abierta
        assert_eq!((s.status, s.remaining, s.task_id), (Status::Running, 1200, Some(9)));
    }

    #[test]
    fn las_apps_del_foco_sobreviven_a_un_cierre() {
        let mut t = Timer::new();
        t.start(Mode::Focus, 1500, None, 0);
        t.watch(Some(("com.app.x".into(), "X".into())), 1000);
        t.watch(Some(("com.app.x".into(), "X".into())), 4000);
        let mut back: Timer = serde_json::from_slice(&serde_json::to_vec(&t).unwrap()).unwrap();
        assert_eq!(back.take_apps().first().map(|a| (a.bundle.as_str(), a.ms)), Some(("com.app.x", 5000)));
        // timer.json de antes de este cambio (sin "apps") sigue cargando
        let old = r#"{"mode":"focus","status":"idle","total":0,"left":0,"end":0,"count":0,"task_id":null,"last_task":null}"#;
        assert!(serde_json::from_str::<Timer>(old).is_ok());
    }
}

#[tauri::command]
pub fn send_notification(app: AppHandle, title: String, body: String) {
    let _ = app.notification().builder().title(title).body(body).show();
}
