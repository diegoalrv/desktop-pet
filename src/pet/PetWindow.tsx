import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { Sprite } from "./Sprite";
import { clamp, fallStep, groundY, walkStep, type Rect } from "./physics";
import { initial, transition, type PetEvent, type PetState } from "./stateMachine";

const WALK_SPEED = 40; // px lógicos/s (luego sale del manifest)
const GRAVITY = 2400; // px lógicos/s²
const DRAG_END_MS = 150; // sin onMoved por este tiempo = soltó

export function PetWindow() {
  const hit = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ state: PetState; dir: number }>({ state: "idle", dir: 1 });

  // Informa a Rust la zona opaca para el click-through.
  useEffect(() => {
    const r = hit.current!.getBoundingClientRect();
    invoke("set_hit_rect", { rect: [r.x, r.y, r.width, r.height] });
  }, []);

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

    const onMouseDown = () => {
      dragging = true;
      send({ type: "drag" });
      win.startDragging();
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
    document.addEventListener("mouseup", endDrag);
    const el = hit.current!;
    el.addEventListener("mousedown", onMouseDown);

    const frame = (now: number) => {
      if (!alive) return;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      send({ type: "tick", dt });
      const floor = groundY(area, size.h);
      if (ctx.state === "walk") {
        const s = walkStep(x, clamp(target, area.x, maxX()), WALK_SPEED * scale, dt);
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
      y = groundY(area, size.h);
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
      document.removeEventListener("mouseup", endDrag);
      el.removeEventListener("mousedown", onMouseDown);
    };
  }, []);

  return (
    <div
      style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center" }}
    >
      <div ref={hit} style={{ cursor: view.state === "dragged" ? "grabbing" : "grab" }}>
        <Sprite state={view.state} dir={view.dir} />
      </div>
    </div>
  );
}
