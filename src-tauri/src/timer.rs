use serde::{Deserialize, Serialize};
use std::{
    sync::Mutex,
    thread,
    time::{Duration, Instant},
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

#[derive(Clone, Copy, PartialEq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Idle,
    Running,
    Paused,
}

/// Pausas automáticas tras un foco (configurable desde Settings en F6).
pub struct Cfg {
    pub focus_s: u64,
    pub short_s: u64,
    pub long_s: u64,
    pub long_every: u32,
    /// Al terminar una pausa, arranca el siguiente foco solo.
    pub auto_cycle: bool,
}

pub struct Timer {
    mode: Mode,
    status: Status,
    total: Duration,
    left: Duration, // válido en Paused
    end: Option<Instant>,
    count: u32,
    task_id: Option<i64>,
    last_task: Option<i64>, // tarea del último foco, para continuar el ciclo
    cfg: Cfg,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Done {
    mode: Mode,
    next: Option<Mode>,
    task_id: Option<i64>,
    elapsed: u64, // s realmente transcurridos
    skipped: bool,
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
            total: Duration::ZERO,
            left: Duration::ZERO,
            end: None,
            count: 0,
            task_id: None,
            last_task: None,
            cfg: Cfg { focus_s: 1500, short_s: 300, long_s: 900, long_every: 4, auto_cycle: false },
        }
    }

    fn remaining(&self, now: Instant) -> Duration {
        match (self.status, self.end) {
            (Status::Running, Some(e)) => e.saturating_duration_since(now),
            (Status::Paused, _) => self.left,
            _ => Duration::ZERO,
        }
    }

    pub fn start(&mut self, mode: Mode, secs: u64, task_id: Option<i64>, now: Instant) {
        self.mode = mode;
        self.task_id = task_id;
        self.total = Duration::from_secs(secs);
        self.status = Status::Running;
        self.end = Some(now + self.total);
    }

    pub fn pause(&mut self, now: Instant) {
        if self.status == Status::Running {
            self.left = self.remaining(now);
            self.status = Status::Paused;
            self.end = None;
        }
    }

    pub fn resume(&mut self, now: Instant) {
        if self.status == Status::Paused {
            self.status = Status::Running;
            self.end = Some(now + self.left);
        }
    }

    pub fn reset(&mut self) {
        self.status = Status::Idle;
        self.end = None;
        self.left = Duration::ZERO;
    }

    /// Termina el temporizador actual (por vencimiento o skip). Tras un foco arranca la pausa.
    pub fn complete(&mut self, now: Instant, skipped: bool) -> Option<Done> {
        if self.status == Status::Idle {
            return None;
        }
        let mode = self.mode;
        let task_id = self.task_id;
        let elapsed = self.total.saturating_sub(self.remaining(now)).as_secs();
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
            self.reset();
            Some(Done { mode, next: None, task_id, elapsed, skipped })
        }
    }

    pub fn due(&mut self, now: Instant) -> Option<Done> {
        if self.status == Status::Running && self.remaining(now).is_zero() {
            self.complete(now, false)
        } else {
            None
        }
    }

    pub fn snap(&self, now: Instant) -> Snap {
        Snap {
            mode: self.mode,
            status: self.status,
            remaining: self.remaining(now).as_secs_f64().ceil() as u64,
            total: self.total.as_secs(),
            count: self.count,
            task_id: self.task_id,
        }
    }
}

pub type TimerState = Mutex<Timer>;

fn emit_tick(app: &AppHandle, t: &Timer) {
    let _ = app.emit("timer://tick", t.snap(Instant::now()));
}

fn notify(app: &AppHandle, done: &Done, t: &Timer) {
    let mins = t.snap(Instant::now()).total / 60;
    let (title, body) = match (done.mode, done.next) {
        (Mode::Focus, _) => ("¡Foco terminado! Descansa".to_string(), format!("Suelta el trabajo: pausa de {mins} min.")),
        (_, Some(_)) => ("¡A trabajar!".to_string(), format!("La pausa terminó. Arranca un foco de {mins} min.")),
        (_, None) => ("¡A trabajar!".to_string(), "La pausa terminó.".to_string()),
    };
    let _ = app.notification().builder().title(title).body(body).show();
}

fn finish(app: &AppHandle, t: &Timer, done: Done) {
    let _ = app.emit("timer://done", &done);
    notify(app, &done, t);
}

/// Hilo del timer: vive en Rust, no depende del webview (sobrevive a throttling y ventana oculta).
pub fn spawn(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(250));
        let state = app.state::<TimerState>();
        let mut t = state.lock().unwrap();
        if t.status == Status::Idle {
            continue;
        }
        if let Some(done) = t.due(Instant::now()) {
            finish(&app, &t, done);
        }
        emit_tick(&app, &t);
    });
}

#[tauri::command]
pub fn timer_config(focus_s: u64, short_s: u64, long_s: u64, long_every: u32, auto_cycle: bool, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    t.cfg = Cfg { focus_s: focus_s.max(1), short_s: short_s.max(1), long_s: long_s.max(1), long_every: long_every.max(1), auto_cycle };
}

/// Inicia un foco con la duración configurada (menú del tray).
pub fn start_focus(app: &AppHandle) {
    let state = app.state::<TimerState>();
    let mut t = state.lock().unwrap();
    let secs = t.cfg.focus_s;
    t.start(Mode::Focus, secs, None, Instant::now());
    emit_tick(app, &t);
}

#[tauri::command]
pub fn timer_get(s: State<TimerState>) -> Snap {
    s.lock().unwrap().snap(Instant::now())
}

#[tauri::command]
pub fn timer_start(mode: Mode, seconds: u64, task_id: Option<i64>, app: AppHandle, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    t.start(mode, seconds, task_id, Instant::now());
    emit_tick(&app, &t);
}

#[tauri::command]
pub fn timer_pause(app: AppHandle, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    t.pause(Instant::now());
    emit_tick(&app, &t);
}

#[tauri::command]
pub fn timer_resume(app: AppHandle, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    t.resume(Instant::now());
    emit_tick(&app, &t);
}

#[tauri::command]
pub fn timer_reset(app: AppHandle, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    t.reset();
    emit_tick(&app, &t);
}

#[tauri::command]
pub fn timer_skip(app: AppHandle, s: State<TimerState>) {
    let mut t = s.lock().unwrap();
    if let Some(done) = t.complete(Instant::now(), true) {
        finish(&app, &t, done);
    }
    emit_tick(&app, &t);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_congela_y_resume_continua() {
        let t0 = Instant::now();
        let mut t = Timer::new();
        t.start(Mode::Focus, 60, None, t0);
        t.pause(t0 + Duration::from_secs(20));
        assert_eq!(t.remaining(t0 + Duration::from_secs(500)), Duration::from_secs(40));
        t.resume(t0 + Duration::from_secs(500));
        assert_eq!(t.remaining(t0 + Duration::from_secs(510)), Duration::from_secs(30));
    }

    #[test]
    fn ciclo_automatico_continua_con_otro_foco_y_conserva_tarea() {
        let mut now = Instant::now();
        let mut t = Timer::new();
        t.cfg.auto_cycle = true;
        t.cfg.focus_s = 60;
        t.start(Mode::Focus, 60, Some(7), now);
        now += Duration::from_secs(61);
        assert_eq!(t.due(now).unwrap().next, Some(Mode::Short));
        now += Duration::from_secs(301);
        let d = t.due(now).unwrap();
        assert_eq!((d.mode, d.next), (Mode::Short, Some(Mode::Focus)));
        let s = t.snap(now);
        assert_eq!((s.mode, s.status, s.total, s.task_id), (Mode::Focus, Status::Running, 60, Some(7)));
    }

    #[test]
    fn vence_y_encadena_pausa_larga_cada_4() {
        let mut now = Instant::now();
        let mut t = Timer::new();
        for i in 1..=4 {
            t.start(Mode::Focus, 60, None, now);
            assert!(t.due(now + Duration::from_secs(59)).is_none());
            now += Duration::from_secs(61);
            let d = t.due(now).unwrap();
            assert_eq!(d.next, Some(if i == 4 { Mode::Long } else { Mode::Short }));
            assert_eq!(t.status, Status::Running);
        }
        now += Duration::from_secs(901);
        assert_eq!(t.due(now), Some(Done { mode: Mode::Long, next: None, task_id: None, elapsed: 900, skipped: false }));
        assert_eq!(t.status, Status::Idle);
    }
}

#[tauri::command]
pub fn send_notification(app: AppHandle, title: String, body: String) {
    let _ = app.notification().builder().title(title).body(body).show();
}
