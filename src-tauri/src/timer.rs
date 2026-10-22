use serde::{Deserialize, Serialize};
use std::{
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
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
}

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
    #[serde(skip)]
    cfg: Cfg,
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
}

#[derive(Serialize, Clone)]
pub struct Snap {
    mode: Mode,
    status: Status,
    remaining: u64,
    total: u64,
    count: u32,
    task_id: Option<i64>,
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
            cfg: Cfg { focus_s: 1500, short_s: 300, long_s: 900, long_every: 4, auto_cycle: false, tray_timer: true },
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
        self.total = secs * 1000;
        self.status = Status::Running;
        self.end = Some(now + self.total);
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
        });
        self.status = Status::Idle;
        self.end = None;
        self.left = 0;
        partial
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
        if mode == Mode::Focus {
            self.count += 1;
            self.last_task = task_id;
            let (next, secs) = if self.count % self.cfg.long_every == 0 {
                (Mode::Long, self.cfg.long_s)
            } else {
                (Mode::Short, self.cfg.short_s)
            };
            self.start(next, secs, None, now);
            Some(Done { mode, next: Some(next), task_id, elapsed, skipped })
        } else if self.cfg.auto_cycle {
            self.start(Mode::Focus, self.cfg.focus_s, self.last_task, now);
            Some(Done { mode, next: Some(Mode::Focus), task_id, elapsed, skipped })
        } else {
            self.reset(now);
            Some(Done { mode, next: None, task_id, elapsed, skipped })
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

    /// Duración configurada de cada modo (s).
    pub fn secs_for(&self, mode: Mode) -> u64 {
        match mode {
            Mode::Focus => self.cfg.focus_s,
            Mode::Short => self.cfg.short_s,
            Mode::Long => self.cfg.long_s,
        }
    }

    pub fn snap(&self, now: u64) -> Snap {
        Snap {
            mode: self.mode,
            status: self.status,
            remaining: self.remaining(now).div_ceil(1000),
            total: self.total / 1000,
            count: self.count,
            task_id: self.task_id,
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
    let mins = t.snap(now_ms()).total / 60;
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
        loop {
            thread::sleep(Duration::from_millis(250));
            let label = {
                let state = app.state::<TimerState>();
                let mut t = state.lock().unwrap();
                if t.status != Status::Idle {
                    match t.due(now_ms()) {
                        Some(done) => finish(&app, &t, done),
                        None => emit_tick(&app, &t),
                    }
                }
                let s = t.snap(now_ms());
                t.cfg.tray_timer.then(|| tray_label(s.mode, s.status, s.remaining)).flatten().unwrap_or_default()
            }; // guard soltado aquí
            if label != last && crate::tray::set_title(&app, (!label.is_empty()).then(|| label.clone())) {
                last = label;
            }
        }
    });
}

#[tauri::command]
pub fn timer_config(focus_s: u64, short_s: u64, long_s: u64, long_every: u32, auto_cycle: bool, tray_timer: bool, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    t.cfg = Cfg { focus_s: focus_s.max(1), short_s: short_s.max(1), long_s: long_s.max(1), long_every: long_every.max(1), auto_cycle, tray_timer };
}

/// Inicia un foco con la duración configurada (menú del tray).
pub fn start_focus(app: &AppHandle) {
    let state = app.state::<TimerState>();
    let mut t = state.lock().unwrap();
    let secs = t.cfg.focus_s;
    let task = t.last_task;
    t.start(Mode::Focus, secs, task, now_ms());
    changed(app, &t);
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
        assert_eq!(t.due(now), Some(Done { mode: Mode::Long, next: None, task_id: None, elapsed: 900, skipped: false }));
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
}

#[tauri::command]
pub fn send_notification(app: AppHandle, title: String, body: String) {
    let _ = app.notification().builder().title(title).body(body).show();
}
