import { useEffect, useState } from "react";
import { call } from "../lib/ipc";
import * as db from "../lib/db";
import { T } from "../panel/ui";
import { Icon } from "../panel/icons";

/** Estilos del panel web (todo bajo `.d`). Mismos tokens que el panel de la mascota. */
export const DASH_CSS = `
  .d{min-height:100vh;display:grid;grid-template-columns:200px minmax(0,1fr);font:14px/1.45 system-ui,-apple-system,sans-serif;color:${T.text};-webkit-font-smoothing:antialiased}
  .d *{box-sizing:border-box}
  .d-side{position:sticky;top:0;height:100vh;padding:18px 10px;border-right:1px solid ${T.line};display:flex;flex-direction:column;gap:2px}
  .d-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;padding:0 8px 14px}
  .d-nav{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;color:${T.dim};text-decoration:none}
  .d-nav:hover{background:${T.card};color:${T.text}}
  .d-nav[aria-current]{background:rgba(232,82,60,.16);color:${T.text}}
  .d-nav .n{margin-left:auto;font-size:11px;background:${T.accent};color:#fff;border-radius:999px;padding:0 7px}
  .d-main{padding:22px 26px 40px;display:grid;gap:16px;align-content:start;min-width:0}
  .d-h1{font-size:20px;font-weight:700;margin:0;letter-spacing:-.01em}
  .d-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
  .d-card{background:${T.card};border:1px solid ${T.line};border-radius:14px;padding:14px 16px;display:grid;gap:10px;align-content:start;min-width:0}
  .d-label{font-size:12px;font-weight:600;color:${T.dim};text-transform:uppercase;letter-spacing:.04em}
  .d-big{font-size:26px;font-weight:700;letter-spacing:-.02em}
  .d-dim{color:${T.dim}}
  .d-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .d-b{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:9px;border:1px solid ${T.line};background:${T.card};color:${T.text};font:inherit;cursor:pointer;text-decoration:none}
  .d-b.on,.d-b.pri{background:${T.accent};border-color:transparent;color:#fff}
  .d-b.sm{padding:3px 8px;font-size:12px}
  .d-in{padding:6px 10px;border-radius:9px;border:1px solid ${T.line};background:${T.card};color:${T.text};font:inherit;min-width:0}
  .d-bars{display:flex;align-items:flex-end;gap:3px;height:130px}
  .d-bar{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;gap:4px}
  .d-bar i{display:block;background:${T.accent};border-radius:4px 4px 0 0;min-height:2px;opacity:.85}
  .d-bar:hover i{opacity:1}
  .d-bar span{font-size:10px;color:${T.dim};text-align:center;white-space:nowrap;overflow:hidden;height:13px}
  .d-hbar{display:grid;grid-template-columns:minmax(80px,160px) 1fr 64px;gap:10px;align-items:center;font-size:13px}
  .d-hbar>div{height:8px;border-radius:4px;background:${T.line};overflow:hidden}
  .d-hbar>div>i{display:block;height:100%;background:${T.accent}}
  .d-list{display:grid;gap:6px}
  .d-item{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid ${T.line}}
  .d-pill{font-size:11px;padding:1px 8px;border-radius:999px;background:${T.line};color:${T.dim};white-space:nowrap}
  .d mark{background:rgba(232,163,60,.35);color:inherit;border-radius:3px}
  .d details>summary{cursor:pointer;color:${T.dim}}
  .d pre{white-space:pre-wrap;margin:0;font:12px/1.5 ui-monospace,Menlo,monospace}
  @media (max-width:760px){
    .d{grid-template-columns:1fr}
    .d-side{position:static;height:auto;flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid ${T.line};padding:8px}
    .d-brand{display:none}
    .d-nav{flex:none}
    .d-main{padding:16px}
  }
`;

/** Llama un comando de la app cada `ms` (la web no recibe eventos de Tauri). undefined hasta la primera respuesta. */
export function usePoll<T>(cmd: string, ms: number) {
  const [v, setV] = useState<T>();
  useEffect(() => {
    const f = () => call<T>(cmd).then(setV, () => {});
    f();
    const i = setInterval(f, ms);
    return () => clearInterval(i);
  }, [cmd, ms]);
  return v;
}

export const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
export const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });

/** Barras verticales simples (CSS), con el valor en el tooltip. */
export function Bars({
  data,
  fmt,
}: {
  data: { label: string; v: number; title: string }[];
  fmt: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.v));
  return (
    <div className="d-bars">
      {data.map((d, i) => (
        <div key={i} className="d-bar" title={`${d.title}: ${fmt(d.v)}`}>
          <i style={{ height: `${(d.v / max) * 100}%` }} />
          <span>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Barras horizontales: nombre · barra · valor. */
export function HBars({ data, fmt }: { data: [string, number][]; fmt: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d[1]));
  if (!data.length) return <span className="d-dim">Sin datos.</span>;
  return (
    <div className="d-list">
      {data.map(([k, v]) => (
        <div key={k} className="d-hbar">
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</span>
          <div>
            <i style={{ width: `${(v / max) * 100}%` }} />
          </div>
          <b style={{ textAlign: "right" }}>{fmt(v)}</b>
        </div>
      ))}
    </div>
  );
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Texto con las coincidencias de `q` resaltadas. */
export function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  return (
    <>
      {text
        .split(new RegExp(`(${esc(q)})`, "gi"))
        .map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}
export const countHits = (text: string, q: string) =>
  q ? text.split(new RegExp(esc(q), "i")).length - 1 : 0;

/** Descarga un archivo generado en el navegador. */
export function download(name: string, text: string, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Sugerencia de una reunión: título editable antes de aceptarla; descartadas se pueden recuperar. */
export function SuggestionRow({ s, project }: { s: db.Suggestion; project: string }) {
  const [title, setTitle] = useState(s.title);
  const pending = s.status === "pending";
  return (
    <div className="d-item" style={{ opacity: pending ? 1 : 0.6 }}>
      <div style={{ flex: 1, display: "grid", gap: 3, minWidth: 0 }}>
        {pending ? (
          <input
            className="d-in"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ border: 0, background: "transparent", padding: 0 }}
          />
        ) : (
          <span style={{ textDecoration: s.status === "dismissed" ? "line-through" : undefined }}>
            {s.title}
          </span>
        )}
        {s.detail && (
          <span className="d-dim" style={{ fontSize: 13 }}>
            {s.detail}
          </span>
        )}
      </div>
      {pending ? (
        <>
          <button
            className="d-b sm"
            style={{ color: "#3cb371" }}
            title="Crear la tarea"
            onClick={() => db.acceptSuggestion(s, title.trim() || s.title, project.trim() || null)}
          >
            <Icon name="check" size="1em" /> Aceptar
          </button>
          <button className="d-b sm" title="Descartar" onClick={() => db.setSuggestion(s.id, "dismissed")}>
            <Icon name="x" size="1em" />
          </button>
        </>
      ) : s.status === "accepted" ? (
        <span className="d-pill" style={{ color: "#3cb371" }}>
          Aceptada
        </span>
      ) : (
        <button
          className="d-b sm"
          title="Volver a pendientes"
          onClick={() => db.setSuggestion(s.id, "pending")}
        >
          <Icon name="restart" size="1em" /> Recuperar
        </button>
      )}
    </div>
  );
}
