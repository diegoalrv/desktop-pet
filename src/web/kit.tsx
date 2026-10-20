import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { call } from "../lib/ipc";
import * as db from "../lib/db";
import { T } from "../panel/ui";
import { Icon } from "../panel/icons";
import { durTicks, perDay } from "../lib/stats";
import { fmtDur } from "../lib/time";
import { describeAction, parseAction } from "../lib/suggestions";
import { useTasks } from "../store/useTasks";

/** Estilos del panel web (todo bajo `.d`). Mismos tokens que el panel de la mascota (PN_CSS). */
export const DASH_CSS = `
  body{margin:0;background:#111117}
  .d{
    --bg:#111117; --surface:#1a1a22; --surface-2:#22222c; --hover:#2c2c38;
    --line:rgba(255,255,255,.07); --line-2:rgba(255,255,255,.12);
    --text:${T.text}; --muted:#8d8d9c; --accent:${T.accent}; --accent-soft:rgba(232,82,60,.14);
    --ok:#3cb371; --warn:#e8a33c; --err:#ff6b6b;
    min-height:100vh;display:grid;grid-template-columns:224px minmax(0,1fr);
    font:14px/1.5 system-ui,-apple-system,sans-serif;color:var(--text);-webkit-font-smoothing:antialiased;
    background:radial-gradient(70% 40% at 100% 0%,rgba(232,82,60,.06),transparent 70%),var(--bg);
  }
  .d *{box-sizing:border-box}
  .d a{color:inherit}
  .d-side{position:sticky;top:0;height:100vh;padding:20px 12px;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:2px;background:rgba(0,0,0,.18)}
  .d-brand{display:flex;align-items:center;gap:10px;padding:0 8px 20px}
  .d-brand>i{display:grid;place-items:center;width:40px;height:40px;flex:none;border-radius:12px;background-color:var(--surface-2);color:var(--accent);font-size:18px}
  .d-brand>i[style]{background-size:160px 40px;background-repeat:no-repeat;image-rendering:pixelated;animation:d-sprite 1s steps(4) infinite}
  @keyframes d-sprite{to{background-position-x:-160px}}
  .d-brand b{display:block;font-size:15px;letter-spacing:-.01em}
  .d-brand small{display:block;font-size:12px;color:var(--muted)}
  .d-nav{position:relative;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;color:var(--muted);text-decoration:none;border:0;background:none;font:inherit;cursor:pointer;text-align:left;transition:background .15s,color .15s}
  .d-nav:hover{background:var(--surface);color:var(--text)}
  .d-nav[aria-current]{background:var(--surface-2);color:var(--text);font-weight:600}
  .d-nav[aria-current] svg{color:var(--accent)}
  .d-side>.d-nav[aria-current]::before{content:"";position:absolute;left:-12px;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--accent)}
  .d-nav .n{margin-left:auto;font-size:11px;font-weight:600;background:var(--accent);color:#fff;border-radius:999px;padding:1px 7px}
  .d-main{padding:28px 32px 48px;display:grid;gap:18px;align-content:start;min-width:0;max-width:1240px;width:100%}
  .d-head{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:2px}
  .d-head>div{flex:1;min-width:0}
  .d-h1{font-size:24px;font-weight:700;margin:0;letter-spacing:-.02em;line-height:1.2}
  .d-h1::first-letter{text-transform:uppercase}
  .d-sub{color:var(--muted);margin-top:2px}
  .d-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
  .d-hero{display:grid;gap:16px;grid-template-columns:minmax(0,1.6fr) minmax(260px,1fr)}
  .d-stack{display:grid;gap:16px;align-content:start}
  .d-card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px;display:grid;gap:12px;align-content:start;min-width:0}
  .d-card>*{min-width:0}
  a.d-card{text-decoration:none;transition:border-color .15s}
  a.d-card:hover{border-color:var(--line-2)}
  .d-label{font-size:13px;font-weight:600;color:var(--muted)}
  .d-big{font-size:26px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .d-dim{color:var(--muted)}
  .d-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .d-more{margin-left:auto;color:var(--muted);text-decoration:none;font-size:13px}
  .d-more:hover{color:var(--text)}
  .d-b{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 12px;border-radius:10px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--text);font:inherit;font-weight:500;cursor:pointer;text-decoration:none;white-space:nowrap}
  .d-b.on,.d-b.pri{background:var(--accent);border-color:transparent;color:#fff}
  .d-b.sm{padding:4px 9px;font-size:12.5px;border-radius:8px}
  .d-b[aria-disabled=true]{opacity:.4;pointer-events:none}
  .d-b.ghost{background:none;border-color:transparent;color:var(--muted)}
  .d-seg{display:inline-flex;gap:2px;padding:3px;border-radius:11px;background:var(--surface-2);border:1px solid var(--line)}
  .d-seg .d-b{background:none;border-color:transparent;color:var(--muted);padding:5px 11px;border-radius:8px}
  .d-seg .d-b.sm{padding:3px 9px}
  .d-seg .d-b.on{background:var(--hover);color:var(--text)}
  .d-in{padding:7px 11px;border-radius:10px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--text);font:inherit;min-width:0}
  .d-timer{font-size:clamp(48px,7vw,72px);font-weight:650;letter-spacing:-.04em;line-height:1;font-variant-numeric:tabular-nums}
  .d-track{height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden}
  .d-track>i{display:block;height:100%;border-radius:3px;transition:width 1s linear}
  .d-stats{display:flex;flex-wrap:wrap;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden}
  .d-stats>div{flex:1 1 110px;background:var(--surface);padding:16px 18px;display:grid;gap:2px}
  .d-chart{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:10px;padding-top:6px}
  .d-yaxis{position:relative;height:160px;min-width:24px}
  .d-yaxis span{position:absolute;right:0;transform:translateY(50%);font-size:11px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .d-bars{position:relative;display:flex;align-items:flex-end;gap:4px;height:160px}
  .d-gl{position:absolute;left:0;right:0;border-top:1px dashed var(--line)}
  .d-gl:first-child{border-top-style:solid;border-color:var(--line-2)}
  .d-avg{position:absolute;left:0;right:0;z-index:1;border-top:1.5px dashed var(--warn);pointer-events:none}
  .d-avg span{position:absolute;right:0;bottom:3px;font-size:11px;font-weight:600;color:var(--warn);background:var(--surface);padding:0 4px;border-radius:4px}
  .d-bar{position:relative;flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end}
  .d-bar i{display:block;background:var(--accent);border-radius:5px 5px 2px 2px;min-height:3px;opacity:.38;transition:opacity .15s}
  .d-bar.hi i,.d-bar:hover i{opacity:1}
  .d-bar.zero i{background:var(--line-2);opacity:1}
  .d-ticks{display:flex;gap:4px;margin-top:6px}
  .d-ticks span{flex:1;min-width:0;font-size:11px;color:var(--muted);text-align:center;white-space:nowrap;overflow:visible}
  .d-heat-wrap{overflow-x:auto;scrollbar-width:thin}
  .d-heat{display:grid;gap:3px;width:100%;min-width:640px;align-items:center}
  .d-heat i{display:block;aspect-ratio:1;border-radius:3px;background:var(--surface-2)}
  .d-heat i.l1{background:rgba(232,82,60,.28)} .d-heat i.l2{background:rgba(232,82,60,.5)}
  .d-heat i.l3{background:rgba(232,82,60,.75)} .d-heat i.l4{background:var(--accent)}
  .d-heat i:hover{outline:1px solid var(--text)}
  .d-heat-m,.d-heat-d{font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:visible;line-height:1}
  .d-hbar{display:grid;grid-template-columns:minmax(0,1fr) minmax(48px,1.2fr) auto;gap:12px;align-items:center;font-size:13px}
  .d-hbar>div{height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden}
  .d-hbar>div>i{display:block;height:100%;border-radius:3px;background:var(--accent)}
  .d-hbar b{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
  .d-list{display:grid;gap:6px}
  .d-item{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:11px;background:var(--surface-2)}
  label.d-item:hover{background:var(--hover)}
  .d-item input[type=checkbox]{accent-color:var(--accent);width:16px;height:16px;margin:2px 0 0}
  .d-pill{font-size:11.5px;font-weight:500;padding:2px 8px;border-radius:999px;background:var(--surface-2);border:1px solid var(--line);color:var(--muted);white-space:nowrap}
  .d-empty{color:var(--muted);padding:6px 0}
  .d-lrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px;border-radius:11px;text-decoration:none}
  .d-lrow+.d-lrow{border-top:1px solid var(--line);border-radius:0}
  a.d-lrow:hover{background:var(--surface-2);border-radius:11px}
  a.d-lrow:hover+.d-lrow{border-top-color:transparent}
  .d-table{width:100%;border-collapse:collapse;font-size:13px}
  .d-table td{padding:8px 6px;border-top:1px solid var(--line);vertical-align:middle}
  .d-table tr:first-child td{border-top:0}
  .d-table tr:hover td{background:rgba(255,255,255,.02)}
  .d-prose{white-space:pre-wrap;color:#c9c9d3;max-width:80ch}
  .d mark{background:rgba(232,163,60,.35);color:inherit;border-radius:3px}
  .d details>summary{cursor:pointer;color:var(--muted);font-size:13px}
  .d pre{white-space:pre-wrap;margin:8px 0 0;padding:10px 12px;border-radius:10px;background:var(--bg);font:12px/1.5 ui-monospace,Menlo,monospace;color:#b9b9c6}
  @media (max-width:1000px){ .d-hero{grid-template-columns:minmax(0,1fr)} }
  @media (max-width:760px){
    .d{grid-template-columns:1fr}
    .d-side{position:sticky;z-index:2;height:auto;flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid var(--line);padding:8px 12px;background:var(--bg)}
    .d-side{scrollbar-width:none}
    .d-brand,.d-side>span{display:none}
    .d-nav{flex:none}
    .d-side>.d-nav[aria-current]::before{display:none}
    .d-main{padding:18px 16px 32px}
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

/** Título de vista con subtítulo opcional y acciones a la derecha. */
export function Head({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="d-head">
      <div>
        <h1 className="d-h1">{title}</h1>
        {sub && <div className="d-sub">{sub}</div>}
      </div>
      {children}
    </header>
  );
}

/** Etiqueta corta del eje: 30m, 1h, 1h 30m. */
const tick = (s: number) => (s % 3600 ? fmtDur(s) : `${s / 3600}h`);

/** Barras verticales de duraciones con eje Y, valor en el tooltip, `hi` resaltada (hoy, la hora actual)
 *  y línea de media opcional. */
export function Bars({
  data,
  hi = -1,
  avg,
}: {
  data: { label: string; v: number; title: string }[];
  hi?: number;
  avg?: number;
}) {
  const ticks = durTicks(Math.max(...data.map((d) => d.v), avg ?? 0));
  const top = ticks[ticks.length - 1];
  const pct = (v: number) => `${(v / top) * 100}%`;
  return (
    <div className="d-chart">
      <div className="d-yaxis">
        {ticks.map((t) => (
          <span key={t} style={{ bottom: pct(t) }}>
            {tick(t)}
          </span>
        ))}
      </div>
      <div className="d-bars">
        {ticks.map((t) => (
          <b key={t} className="d-gl" style={{ bottom: pct(t) }} />
        ))}
        {!!avg && (
          <b className="d-avg" style={{ bottom: pct(avg) }}>
            <span>media {fmtDur(avg)}</span>
          </b>
        )}
        {data.map((d, i) => (
          <div
            key={i}
            className={`d-bar${i === hi ? " hi" : ""}${d.v ? "" : " zero"}`}
            title={`${d.title}: ${fmtDur(d.v)}`}
          >
            <i style={{ height: pct(d.v) }} />
          </div>
        ))}
      </div>
      <span />
      <div className="d-ticks">
        {data.map((d, i) => (
          <span key={i}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

/** Calendario de foco estilo GitHub: una columna por semana (lunes arriba), del último año. */
export function Heatmap({ rows }: { rows: { start: number; end: number; mode: string }[] }) {
  const today = (new Date().getDay() + 6) % 7; // 0 = lunes
  const days = perDay(rows, 52 * 7 + today + 1); // empieza en lunes
  const max = Math.max(1, ...days.map((d) => d.secs));
  const weeks = Array.from({ length: days.length / 7 + 1 }, (_, w) => days.slice(w * 7, w * 7 + 7)).filter(
    (w) => w.length,
  );
  const total = days.reduce((a, d) => a + d.secs, 0);
  const active = days.filter((d) => d.secs).length;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => void scroller.current?.scrollTo(scroller.current.scrollWidth, 0), []);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="d-heat-wrap" ref={scroller}>
        <div
          className="d-heat"
          style={{ gridTemplateColumns: `22px repeat(${weeks.length},minmax(10px,1fr))` }}
        >
          <span />
          {weeks.map((w, i) => {
            const d = new Date(w[0].day);
            return (
              <span key={i} className="d-heat-m">
                {d.getDate() <= 7 ? d.toLocaleDateString("es", { month: "short" }) : ""}
              </span>
            );
          })}
          {["L", "", "X", "", "V", "", ""].map((l, r) => (
            <Fragment key={r}>
              <span className="d-heat-d">{l}</span>
              {weeks.map((w, i) => {
                const d = w[r];
                if (!d) return <span key={i} />;
                const lvl = d.secs ? Math.ceil((d.secs / max) * 4) : 0;
                return <i key={i} className={`l${lvl}`} title={`${fmtDay(d.day)}: ${fmtDur(d.secs)}`} />;
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="d-row d-dim" style={{ fontSize: 12 }}>
        {fmtDur(total)} de foco en {active} días del último año
        <span style={{ marginLeft: "auto" }}>Menos</span>
        <span
          className="d-heat"
          style={{ gridTemplateColumns: "repeat(5,11px)", width: "auto", minWidth: 0 }}
        >
          {[0, 1, 2, 3, 4].map((l) => (
            <i key={l} className={`l${l}`} />
          ))}
        </span>
        Más
      </div>
    </div>
  );
}

/** Barras horizontales: nombre · barra · valor · % del `total` (por defecto, la suma). */
export function HBars({
  data,
  fmt,
  total,
}: {
  data: [string, number][];
  fmt: (v: number) => string;
  total?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d[1]));
  const all = total || data.reduce((a, d) => a + d[1], 0) || 1;
  if (!data.length) return <span className="d-empty">Sin datos.</span>;
  return (
    <div className="d-list" style={{ gap: 10 }}>
      {data.map(([k, v]) => (
        <div key={k} className="d-hbar">
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={k}>
            {k}
          </span>
          <div>
            <i style={{ width: `${(v / max) * 100}%` }} />
          </div>
          <b>
            {fmt(v)} <small className="d-dim">{Math.round((v / all) * 100)}%</small>
          </b>
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
  const action = parseAction(s.action);
  const chips = action ? describeAction(action, useTasks.getState().tasks) : [];
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
        {chips.length > 0 && (
          <span className="d-dim" style={{ fontSize: 13 }}>
            {chips.join(" · ")}
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
            style={{ color: "var(--ok)" }}
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
        <span className="d-pill" style={{ color: "var(--ok)" }}>
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
