// Ventana "Ver cámara" (demo de F17): lo que ve la cámara con las cajas de cara y teléfono, y a un lado los
// gráficos de inclinación de la cabeza y puntaje de teléfono. Mientras está abierta es la dueña de la cámara
// (WebKit deja capturar a una sola página): detecta ~6 por segundo y le pasa cada muestra a la mascota
// (`cam://seen`), que sigue decidiendo y devuelve base, umbral y gruñidos/ladridos por `cam://sample`. Al cerrar la
// ventana se destruye, su cámara se apaga y la mascota vuelve a abrir la suya.
import { useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { openCam, PHONE_SCORE, type Box, type Cam, type Seen } from "../lib/camera";
import { T } from "../panel/ui";
import { loadManifest } from "../skins/loader";
import { DEFAULT_VOICE } from "../skins/schema";
import { useSettings } from "../store/useSettings";

const FRAME_MS = 150; // ~6 detecciones por segundo
const SPAN_MS = 60_000; // historia de los gráficos
const ORANGE = "#eb6834";
const BLUE = "#3987e5";
const RED = "#e34948";
const AMBER = "#eda100";

type Point = { t: number; pitch: number | null; phone: number };
type Decided = { base: number; down: number; at: number };

/** Caja en el canvas, espejada como el video (vista de selfie), con su etiqueta sin espejar. */
function drawBox(g: CanvasRenderingContext2D, b: Box, color: string, label: string) {
  const { width: W, height: H } = g.canvas;
  const x = (1 - b.x - b.w) * W;
  const [y, w, h] = [b.y * H, b.w * W, b.h * H];
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.strokeRect(x, y, w, h);
  g.font = "600 18px ui-monospace, Menlo, monospace";
  const tw = g.measureText(label).width + 12;
  g.fillStyle = color;
  g.fillRect(x - 1.5, y - 26, tw, 26);
  g.fillStyle = "#fff";
  g.fillText(label, x + 4.5, y - 7);
}

/** Línea de los últimos SPAN_MS con líneas horizontales de referencia. */
function drawSpark(
  c: HTMLCanvasElement,
  pts: Point[],
  get: (p: Point) => number | null,
  [lo, hi]: [number, number],
  color: string,
  refs: { v: number; color: string }[],
) {
  const g = c.getContext("2d")!;
  const { width: W, height: H } = c;
  const now = performance.now();
  const X = (t: number) => W - ((now - t) / SPAN_MS) * W;
  const Y = (v: number) => H - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * H;
  g.clearRect(0, 0, W, H);
  g.setLineDash([6, 5]);
  g.lineWidth = 1.5;
  for (const r of refs) {
    g.strokeStyle = r.color;
    g.beginPath();
    g.moveTo(0, Y(r.v));
    g.lineTo(W, Y(r.v));
    g.stroke();
  }
  g.setLineDash([]);
  g.strokeStyle = color;
  g.lineWidth = 2.5;
  g.lineJoin = g.lineCap = "round";
  g.beginPath();
  let pen = false;
  for (const p of pts) {
    const v = get(p);
    if (v === null) {
      pen = false;
      continue;
    }
    if (pen) g.lineTo(X(p.t), Y(v));
    else g.moveTo(X(p.t), Y(v));
    pen = true;
  }
  g.stroke();
}

export function CamWindow() {
  const box = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const pitchC = useRef<HTMLCanvasElement>(null);
  const phoneC = useRef<HTMLCanvasElement>(null);
  const [seen, setSeen] = useState<Seen | null>(null);
  const [decided, setDecided] = useState<Decided | null>(null);
  const [shout, setShout] = useState<{ text: string; color: string; at: number } | null>(null);
  const [error, setError] = useState("");
  const decidedRef = useRef<Decided | null>(null);
  decidedRef.current = decided;
  const voice = useRef(DEFAULT_VOICE);
  const skin = useSettings((s) => s.skin);
  useEffect(() => {
    loadManifest(skin)
      .then((m) => (voice.current = { ...DEFAULT_VOICE, ...m?.voice }))
      .catch(() => {});
  }, [skin]);

  // Lo que decide la mascota: base/umbral y gruñidos/ladridos (llega cada 2 s mientras vigila un foco).
  useEffect(() => {
    const un = listen<{ base: number; down: number; events: string[] }>("cam://sample", ({ payload: p }) => {
      setDecided({ base: p.base, down: p.down, at: Date.now() });
      if (p.events.includes("bark")) setShout({ text: voice.current.bark, color: RED, at: Date.now() });
      else if (p.events.includes("growl")) setShout({ text: voice.current.growl, color: AMBER, at: Date.now() });
      else if (p.events.includes("calm") || p.events.includes("back")) setShout(null);
    });
    return () => void un.then((f) => f());
  }, []);

  useEffect(() => {
    let cam: Cam | null = null;
    let alive = true;
    let id: ReturnType<typeof setInterval> | undefined;
    const pts: Point[] = [];
    openCam()
      .then((c) => {
        if (!alive) return c.stop();
        cam = c;
        c.video.style.cssText =
          "width:100%;height:100%;object-fit:contain;transform:scaleX(-1);display:block";
        box.current!.prepend(c.video);
        const o = overlay.current!;
        o.width = c.video.videoWidth || 640;
        o.height = c.video.videoHeight || 480;
        id = setInterval(() => {
          const s = c.look();
          const now = performance.now();
          pts.push({ t: now, pitch: s.pitch, phone: s.phoneScore });
          while (pts.length && now - pts[0].t > SPAN_MS) pts.shift();
          const g = o.getContext("2d")!;
          g.clearRect(0, 0, o.width, o.height);
          const d = decidedRef.current;
          if (s.faceBox && s.pitch !== null) {
            const down = d && s.pitch - d.base >= d.down;
            const rel = d ? ` (${s.pitch - d.base >= 0 ? "+" : ""}${Math.round(s.pitch - d.base)}°)` : "";
            drawBox(g, s.faceBox, down ? AMBER : BLUE, `cabeza ${Math.round(s.pitch)}°${rel}`);
          }
          if (s.phoneBox)
            drawBox(
              g,
              s.phoneBox,
              s.phoneScore >= PHONE_SCORE ? RED : ORANGE,
              `teléfono ${s.phoneScore.toFixed(2)}`,
            );
          const refs = d
            ? [
                { v: d.base, color: T.dim },
                { v: d.base + d.down, color: AMBER },
              ]
            : [];
          drawSpark(pitchC.current!, pts, (p) => p.pitch, [-20, 50], BLUE, refs);
          drawSpark(phoneC.current!, pts, (p) => p.phone, [0, 1], ORANGE, [{ v: PHONE_SCORE, color: RED }]);
          setSeen(s);
          void emit("cam://seen", s); // la mascota decide con esto mientras la ventana tiene la cámara
        }, FRAME_MS);
      })
      .catch((e) => setError(String(e)));
    return () => {
      alive = false;
      clearInterval(id);
      cam?.stop();
    };
  }, []);

  const live = shout && Date.now() - shout.at < 6000 ? shout : null;
  const d = decided && Date.now() - decided.at < 5000 ? decided : null; // sin muestras: la mascota dejó de vigilar
  const stat = (label: string, value: string, color: string = T.text) => (
    <div>
      <div style={{ fontSize: 12, color: T.dim }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) 300px",
        gap: 14,
        height: "100vh",
        boxSizing: "border-box",
        padding: 14,
        background: T.bg,
        color: T.text,
        fontFamily: "-apple-system, system-ui, sans-serif",
      }}
    >
      <div
        ref={box}
        style={{ position: "relative", borderRadius: 14, overflow: "hidden", background: "#000" }}
      >
        <canvas
          ref={overlay}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
        />
        {error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: 24,
              color: T.dim,
            }}
          >
            No pude abrir la cámara: {error}
          </div>
        )}
        {live && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 18,
              textAlign: "center",
              fontSize: 44,
              fontWeight: 800,
              letterSpacing: 2,
              color: live.color,
              textShadow: "0 2px 12px rgba(0,0,0,.8)",
            }}
          >
            {live.text}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div style={{ background: T.card, borderRadius: 14, padding: 14, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, color: d ? "#1baf7a" : T.dim }}>
            {d
              ? "● La mascota está vigilando el foco"
              : "○ La mascota no está vigilando (sin foco o cámara apagada)"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {stat(
              "Cabeza",
              seen?.pitch != null ? `${Math.round(seen.pitch)}°` : "—",
              d && seen?.pitch != null && seen.pitch - d.base >= d.down ? AMBER : T.text,
            )}
            {stat("Postura normal", d ? `${Math.round(d.base)}°` : "—", T.dim)}
            {stat(
              "Teléfono",
              seen ? seen.phoneScore.toFixed(2) : "—",
              seen && seen.phoneScore >= PHONE_SCORE ? RED : T.text,
            )}
            {stat("Umbral", d ? `+${d.down}° · ${PHONE_SCORE}` : "—", T.dim)}
          </div>
        </div>
        <div style={{ background: T.card, borderRadius: 14, padding: 14 }}>
          <div style={{ fontSize: 13, color: T.dim, marginBottom: 6 }}>Inclinación de la cabeza · 60 s</div>
          <canvas ref={pitchC} width={540} height={220} style={{ width: "100%", height: 110 }} />
          <div style={{ fontSize: 11, color: T.dim, marginTop: 4 }}>
            <span style={{ color: T.dim }}>— — postura normal</span> ·{" "}
            <span style={{ color: AMBER }}>— — cabeza abajo</span>
          </div>
        </div>
        <div style={{ background: T.card, borderRadius: 14, padding: 14 }}>
          <div style={{ fontSize: 13, color: T.dim, marginBottom: 6 }}>Teléfono a la vista · 60 s</div>
          <canvas ref={phoneC} width={540} height={160} style={{ width: "100%", height: 80 }} />
          <div style={{ fontSize: 11, color: RED, marginTop: 4 }}>
            — — cuenta como teléfono ({PHONE_SCORE})
          </div>
        </div>
      </div>
    </div>
  );
}
