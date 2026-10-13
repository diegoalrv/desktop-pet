import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { Sprite } from "./Sprite";
import { BUILTIN, loadSkin, revokeSkin, type Skin } from "../skins/loader";
import { useSettings } from "../store/useSettings";
import { chime } from "../lib/sound";
import { PILL_H, TimerPill } from "./TimerPill";
import { notify, togglePanel } from "../lib/ipc";
import * as db from "../lib/db";
import { needsReminder } from "../lib/tasks";
import { useTimer } from "../store/useTimer";
import { clamp, fallStep, groundY, walkStep, type Rect } from "./physics";
import { initial, transition, type PetEvent, type PetState } from "./stateMachine";

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

  // Duraciones y atajo viven en Rust: se les empuja la config al arrancar y al cambiar.
  useEffect(() => {
    invoke("timer_config", {
      focusS: prefs.focusMin * 60,
      shortS: prefs.shortMin * 60,
      longS: prefs.longMin * 60,
      longEvery: prefs.longEvery,
      autoCycle: prefs.autoCycle,
    });
    invoke("set_quick_shortcut", { accel: prefs.shortcut }).catch(() => {});
  }, [prefs]);

  const active = useTimer((s) => s.snap.status !== "idle");
  const snap = useTimer((s) => s.snap);

  // Informa a Rust la zona opaca para el click-through (sprite, + píldora si hay timer).
  useEffect(() => {
    const r = hit.current!.getBoundingClientRect();
    invoke("set_hit_rect", { rect: [r.x, r.y, r.width, r.height - (active ? 0 : PILL_H)] });
  }, [active, skin]);

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
    });
    const unDone = listen<{ mode: string; elapsed: number; skipped: boolean; task_id: number | null }>(
      "timer://done",
      (e) => {
        const d = e.payload;
        if (d.mode === "focus") send({ type: "timerEnd" });
        if (!d.skipped && sound.current.sound) chime(d.mode === "focus" ? "rest" : "work", sound.current.loud);
        if (!d.skipped) {
          const end = Date.now();
          db.recordSession({ start: end - d.elapsed * 1000, end, mode: d.mode, task_id: d.task_id });
        }
      },
    );
    const unTask = listen("task://done", () => send({ type: "taskDone" }));

    // Recordatorios de tareas con fecha/hora (granularidad de minutos; la ventana mascota siempre está viva).
    const remind = async () => {
      const now = Date.now();
      for (const t of (await db.listTasks()).filter((t) => needsReminder(t, now))) {
        await db.markNotified(t.id);
        notify("Recordatorio", t.title);
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
      clearInterval(remindTimer);
      el.removeEventListener("mousedown", onMouseDown);
    };
  }, []);

  return (
    <div
      style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center" }}
    >
      <div ref={hit} style={{ cursor: view.state === "dragged" ? "grabbing" : "grab" }}>
        <Sprite skin={skin} state={view.state} dir={view.dir} />
        <TimerPill snap={snap} />
      </div>
    </div>
  );
}
