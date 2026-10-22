import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { headroom, Sprite, spriteSize } from "./Sprite";
import { BUILTIN, loadSkin, revokeSkin, type Skin } from "../skins/loader";
import { useSettings } from "../store/useSettings";
import { chime } from "../lib/sound";
import { PILL_H, TimerPill } from "./TimerPill";
import { notify, togglePanel } from "../lib/ipc";
import * as db from "../lib/db";
import { load } from "@tauri-apps/plugin-store";
import { needsReminder, startOfDay } from "../lib/tasks";
import { closeMessage, dayKey, shouldClose, summarize } from "../lib/standup";
import { dueMeetings, meetingsBetween, type Meeting } from "../lib/calendar";
import { useTimer } from "../store/useTimer";
import { useMusic } from "../store/useMusic";
import { MOOD_S } from "../skins/schema";
import { clamp, fallStep, groundY, walkStep, type Rect } from "./physics";
import { initial, transition, type ClaudeOutcome, type PetEvent, type PetState } from "./stateMachine";

const GRAVITY = 2400; // px lógicos/s²
const DRAG_END_MS = 150; // sin onMoved por este tiempo = soltó

export function PetWindow() {
  const hit = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ state: PetState; dir: number }>({ state: "idle", dir: 1 });

  const skinId = useSettings((s) => s.skin);
  const skinRev = useSettings((s) => s.skinRev);
  const [skin, setSkin] = useState<Skin>({ kind: "builtin" });
  // Valores del skin que lee el loop de animación (walkSpeed px lógicos/s, groundOffset px lógicos).
  const cfg = useRef({ walkSpeed: 40, groundOffset: 0 });

  // Carga (y recarga en caliente) el skin activo; si falla, vuelve al integrado.
  useEffect(() => {
    let cancelled = false;
    loadSkin(skinId)
      .catch(() => loadSkin(BUILTIN))
      .then((next) => {
        if (cancelled) return revokeSkin(next);
        cfg.current =
          next.kind === "pack"
            ? { walkSpeed: next.manifest.walkSpeed, groundOffset: next.manifest.groundOffset }
            : { walkSpeed: 40, groundOffset: 0 };
        setSkin((prev) => (revokeSkin(prev), next));
      });
    return () => {
      cancelled = true;
    };
  }, [skinId, skinRev]);

  const prefs = useSettings((s) => s.prefs);
  const sound = useRef(prefs);
  sound.current = prefs;
  const size = prefs.petSize;
  const relayout = useRef(async () => {}); // lo define el loop: re-mide la ventana y la pega al suelo

  // Duraciones y atajo viven en Rust: se les empuja la config al arrancar y al cambiar.
  useEffect(() => {
    invoke("timer_config", {
      focusS: prefs.focusMin * 60,
      shortS: prefs.shortMin * 60,
      longS: prefs.longMin * 60,
      longEvery: prefs.longEvery,
      autoCycle: prefs.autoCycle,
      trayTimer: prefs.trayTimer,
      distractions: prefs.distractions,
    });
    invoke("set_quick_shortcut", { kind: "panel", accel: prefs.shortcut }).catch(() => {});
    invoke("set_quick_shortcut", { kind: "focus", accel: prefs.focusShortcut }).catch(() => {});
  }, [prefs]);

  // Calendario: baja el .ics cada 5 min (próximas 24 h); el aviso lo revisa remind() cada 20 s.
  const meetings = useRef<Meeting[]>([]);
  useEffect(() => {
    if (!prefs.icalUrl) return void (meetings.current = []);
    const load = () =>
      invoke<string>("fetch_ical", { url: prefs.icalUrl })
        .then(
          (ics) => (meetings.current = meetingsBetween(ics, Date.now() - 60_000, Date.now() + 86_400_000)),
        )
        .catch((e) => console.warn("calendario:", e));
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => clearInterval(id);
  }, [prefs.icalUrl]);

  const active = useTimer((s) => s.snap.status !== "idle");
  const snap = useTimer((s) => s.snap);

  // Ánimo: con música rockea; las variantes de cada estado se alternan cada MOOD_S.
  const music = useMusic((s) => !!s.s?.playing);
  const [slot, setSlot] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSlot((n) => n + 1), MOOD_S * 1000);
    return () => clearInterval(id);
  }, []);

  // El timer va pegado a la cabeza: se come el espacio transparente de arriba del sprite.
  const body = useRef<HTMLDivElement>(null);
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    headroom(skin, size)
      .then((px) => setOverlap(Math.max(0, Math.round(px) - 4)))
      .catch(() => setOverlap(0));
  }, [skin, size]);

  // La ventana crece con el sprite: margen para la píldora del timer arriba y holgura a los lados.
  useEffect(() => {
    const { w, h } = spriteSize(skin, size);
    getCurrentWindow()
      .setSize(new LogicalSize(Math.max(160, w + 32), h + PILL_H + 28))
      .then(() => relayout.current());
  }, [skin, size]);

  // Informa a Rust la zona opaca para el click-through (sprite, + píldora si hay timer).
  useEffect(() => {
    const r = (active ? hit : body).current!.getBoundingClientRect();
    invoke("set_hit_rect", { rect: [r.x, r.y, r.width, r.height] });
  }, [active, skin, overlap, size]);

  useEffect(() => {
    const win = getCurrentWindow();
    let ctx = initial();
    let dir = 1;
    let target = 0;
    let vy = 0;
    let x = 0;
    let y = 0;
    let area: Rect = { x: 0, y: 0, w: 0, h: 0 }; // work area en px físicos
    let size = { w: 0, h: 0 };
    let scale = 1;
    let dragging = false;
    let dragTimer: ReturnType<typeof setTimeout> | undefined;
    let last = performance.now();
    let raf = 0;
    let alive = true;

    const send = (ev: PetEvent) => {
      const prev = ctx.state;
      ctx = transition(ctx, ev);
      if (ctx.state !== prev) {
        if (ctx.state === "walk") pickTarget();
        setView((v) => ({ ...v, state: ctx.state }));
      }
    };
    const maxX = () => area.x + area.w - size.w;
    const pickTarget = () => {
      target = area.x + Math.random() * (area.w - size.w);
    };
    const move = () => win.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
    relayout.current = async () => {
      const p = await refreshArea();
      if (!p) return;
      x = clamp(p.x, area.x, maxX());
      if (ctx.state !== "fall" && !dragging) y = groundY(area, size.h, cfg.current.groundOffset * scale);
      move();
    };

    // Work area del monitor donde está la ventana (respeta dock / barra de tareas).
    const refreshArea = async () => {
      const [m, s, p] = await Promise.all([currentMonitor(), win.outerSize(), win.outerPosition()]);
      if (!m) return;
      area = {
        x: m.workArea.position.x,
        y: m.workArea.position.y,
        w: m.workArea.size.width,
        h: m.workArea.size.height,
      };
      size = { w: s.width, h: s.height };
      scale = m.scaleFactor;
      return p;
    };

    // Clic (sin mover) abre el panel; mover > 3 px inicia el arrastre nativo.
    let press: { x: number; y: number } | null = null;
    const onMouseDown = (e: MouseEvent) => {
      press = { x: e.screenX, y: e.screenY };
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!press || Math.hypot(e.screenX - press.x, e.screenY - press.y) < 3) return;
      press = null;
      dragging = true;
      send({ type: "drag" });
      win.startDragging();
    };
    const onMouseUp = () => {
      if (press) togglePanel();
      press = null;
      endDrag();
    };
    const endDrag = async () => {
      if (!dragging) return;
      dragging = false;
      const p = await win.outerPosition();
      x = p.x;
      y = p.y;
      await refreshArea(); // multi-monitor: toma el monitor donde quedó
      vy = 0;
      send({ type: "drop" });
    };
    const bump = () => {
      if (!dragging) return;
      clearTimeout(dragTimer);
      dragTimer = setTimeout(endDrag, DRAG_END_MS);
    };
    const unMoved = win.onMoved(bump);
    document.addEventListener("mouseup", onMouseUp);
    const el = hit.current!;
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("mousemove", onMouseMove);

    // Timer (vive en Rust) -> estados de la mascota.
    const unsub = useTimer.subscribe((s, p) => {
      const [a, b] = [s.snap, p.snap];
      if (a.status !== "idle" && (b.status === "idle" || a.mode !== b.mode))
        send({ type: a.mode === "focus" ? "timerStart" : "breakStart" });
      else if (a.status === "idle" && b.status !== "idle") send({ type: "timerStop" });
      // Inicio manual (botones/tray): suena igual que un cambio de ciclo. Los encadenados suenan vía timer://done;
      // un timer retomado de disco al abrir la app ya lleva tiempo corrido y no suena.
      if (a.status !== "idle" && b.status === "idle" && a.remaining >= a.total - 1 && sound.current.sound)
        chime(a.mode === "focus" ? "work" : "rest");
      // Pre-aviso: un tick a los 10 s y uno por segundo en los últimos 5.
      if (
        a.status === "running" &&
        a.remaining !== b.remaining &&
        [10, 5, 4, 3, 2, 1].includes(a.remaining) &&
        sound.current.sound
      )
        chime("tick");
    });
    // El timer pudo llegar antes de suscribirse (p. ej. retomado de disco al abrir la app).
    const s0 = useTimer.getState().snap;
    if (s0.status !== "idle") send({ type: s0.mode === "focus" ? "timerStart" : "breakStart" });
    const unDone = listen<{ mode: string; skipped: boolean; next: string | null }>("timer://done", (e) => {
      const d = e.payload;
      if (d.mode === "focus") send({ type: "timerEnd" });
      // Saltar también suena si arranca otro bloque; saltar a la nada (fin del ciclo) no.
      if ((!d.skipped || d.next) && sound.current.sound) chime(d.mode === "focus" ? "rest" : "work");
    });
    const unDistract = listen("focus://distraction", () => send({ type: "distracted" }));
    const unTask = listen("task://done", () => send({ type: "taskDone" }));
    const unClaude = listen("claude://start", () => send({ type: "claudeStart" }));
    const unClaudeEnd = listen<{ outcome: ClaudeOutcome }>("claude://exit", (e) =>
      send({ type: "claudeEnd", outcome: e.payload.outcome }),
    );
    // Panel abierto: la mascota se queda quieta y atenta; al cerrarlo sigue.
    const unPanel = listen<boolean>("panel://visible", (e) =>
      send({ type: e.payload ? "panelOpen" : "panelClose" }),
    );

    // Recordatorios de tareas con fecha/hora (granularidad de minutos; la ventana mascota siempre está viva).
    const warned = new Set<string>();
    const remind = async () => {
      const now = Date.now();
      for (const m of dueMeetings(meetings.current, now, warned)) {
        warned.add(m.key);
        const min = Math.round((m.start - now) / 60_000);
        notify(
          min > 0 ? `Reunión en ${min} min` : "Reunión ahora",
          `${m.title} · Panel → Reunión para escucharla`,
        );
        if (sound.current.sound) chime("work");
      }
      const tasks = await db.listTasks();
      for (const t of tasks.filter((t) => needsReminder(t, now))) {
        await db.markNotified(t.id);
        notify("Recordatorio", t.title);
      }
      // Cierre del día: una vez por día, pasada la hora y si hubo actividad (la fecha ya avisada vive en settings.json).
      const { dayEndHour, dailyGoalMin } = sound.current;
      if (dayEndHour && new Date(now).getHours() >= dayEndHour) {
        const store = await load("settings.json", { autoSave: true, defaults: {} });
        const last = await store.get<string>("dayEnd");
        const s = summarize(
          tasks,
          await db.listSessions(startOfDay(now)),
          (await db.listSuggestions("pending")).length,
          dailyGoalMin,
          now,
        );
        if (shouldClose(dayEndHour, now, last, s)) {
          await store.set("dayEnd", dayKey(now));
          notify(s.goalMet ? "¡Día cerrado, meta cumplida!" : "Cierre del día", closeMessage(s));
          send({ type: "dayEnd", met: s.goalMet });
          if (sound.current.sound) chime(s.goalMet ? "rest" : "work");
        }
      }
    };
    remind();
    const remindTimer = setInterval(remind, 20_000);

    const frame = (now: number) => {
      if (!alive) return;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      send({ type: "tick", dt });
      const floor = groundY(area, size.h, cfg.current.groundOffset * scale);
      if (ctx.state === "walk") {
        const s = walkStep(x, clamp(target, area.x, maxX()), cfg.current.walkSpeed * scale, dt);
        x = s.x;
        y = floor;
        if (s.dir !== dir) {
          dir = s.dir;
          setView((v) => ({ ...v, dir }));
        }
        move();
        if (s.arrived) send({ type: "arrive" });
      } else if (ctx.state === "fall") {
        const f = fallStep(y, vy, dt, floor, GRAVITY * scale);
        y = f.y;
        vy = f.vy;
        move();
        if (f.landed) send({ type: "land" });
      }
      raf = requestAnimationFrame(frame);
    };

    (async () => {
      const p = await refreshArea();
      if (!p) return;
      x = clamp(p.x, area.x, maxX());
      y = groundY(area, size.h, cfg.current.groundOffset * scale);
      move();
      raf = requestAnimationFrame(frame);
    })();
    const areaTimer = setInterval(() => !dragging && ctx.state !== "fall" && refreshArea(), 5000);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearInterval(areaTimer);
      clearTimeout(dragTimer);
      unMoved.then((f) => f());
      document.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("mousemove", onMouseMove);
      unsub();
      unDone.then((f) => f());
      unTask.then((f) => f());
      unDistract.then((f) => f());
      unClaude.then((f) => f());
      unClaudeEnd.then((f) => f());
      unPanel.then((f) => f());
      clearInterval(remindTimer);
      el.removeEventListener("mousedown", onMouseDown);
    };
  }, []);

  return (
    <div
      style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center" }}
    >
      <div ref={hit} style={{ cursor: view.state === "dragged" ? "grabbing" : "grab" }}>
        <div style={{ marginBottom: -Math.min(overlap, PILL_H), position: "relative", zIndex: 1 }}>
          <TimerPill snap={snap} />
        </div>
        <div ref={body}>
          <Sprite skin={skin} state={view.state} dir={view.dir} mood={{ music, slot }} size={size} />
        </div>
      </div>
    </div>
  );
}
