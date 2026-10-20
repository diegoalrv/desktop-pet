import { useEffect, useState } from "react";
import { call, type Mode, type TimerSnap } from "../lib/ipc";
import * as db from "../lib/db";
import { isToday, startOfDay } from "../lib/tasks";
import { byHour, dayStart, perDay, streak } from "../lib/stats";
import { fmt, fmtDur } from "../lib/time";
import { useLive, useTasks } from "../store/useTasks";
import { useSettings } from "../store/useSettings";
import { MODE_COLOR } from "../pet/TimerPill";
import { Icon, type IconName } from "../panel/icons";
import { PANEL_CSS } from "../panel/ui";
import { TasksWindow } from "../tasks/TasksWindow";
import type { MusicState } from "../store/useMusic";
import { Bars, DASH_CSS, download, fmtDate, fmtDay, HBars, Hl, usePoll } from "./kit";
import { Meetings, Suggestions } from "./Meetings";

const VIEWS: { id: string; label: string; icon: IconName }[] = [
  { id: "home", label: "Resumen", icon: "home" },
  { id: "tasks", label: "Tareas", icon: "tasks" },
  { id: "meetings", label: "Reuniones", icon: "mic" },
  { id: "suggestions", label: "Sugerencias", icon: "inbox" },
  { id: "focus", label: "Foco", icon: "chart" },
  { id: "chat", label: "Chat", icon: "terminal" },
];
const MODE_LABEL = { focus: "Foco", short: "Pausa corta", long: "Pausa larga" } as const;

/** Vista y parámetro desde el hash (#meetings/1792420001): recargar o compartir el link deja donde estabas. */
function useHash() {
  const [h, setH] = useState(location.hash.slice(1));
  useEffect(() => {
    const f = () => setH(location.hash.slice(1));
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const [view = "home", param] = h.split("/");
  return { view: VIEWS.some((v) => v.id === view) ? view : "home", param };
}

/** Respaldo de todo lo que guarda la app (tablas + transcripciones) en un JSON. */
async function backup() {
  const tables = ["categories", "tasks", "sessions", "chat_log", "meeting_tasks"];
  const data = Object.fromEntries(
    await Promise.all(tables.map(async (t) => [t, await db.query(`SELECT * FROM ${t}`)])),
  );
  data.meetings = await call("meetings_list");
  download(
    `pet-respaldo-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(data, null, 1),
    "application/json",
  );
}

/** Panel web completo: el mismo en el navegador (127.0.0.1:4747) y en la ventana de Tareas de la app. */
export function Dashboard() {
  const { view, param } = useHash();
  const pending = useLive(() => db.listSuggestions("pending"))?.length ?? 0;
  useEffect(() => {
    document.title = `${VIEWS.find((v) => v.id === view)?.label} · Pet`;
  }, [view]);

  return (
    <div className="d">
      <style>{PANEL_CSS + DASH_CSS + "body{margin:0}"}</style>
      <nav className="d-side">
        <div className="d-brand">
          <Icon name="tomato" /> Candolita
        </div>
        {VIEWS.map((v) => (
          <a key={v.id} href={`#${v.id}`} className="d-nav" aria-current={view === v.id ? "page" : undefined}>
            <Icon name={v.icon} /> {v.label}
            {v.id === "suggestions" && pending > 0 && <span className="n">{pending}</span>}
          </a>
        ))}
        <span style={{ flex: 1 }} />
        {db.IS_WEB ? (
          <button
            className="d-nav"
            style={{ border: 0, background: "none", font: "inherit", cursor: "pointer" }}
            onClick={backup}
          >
            <Icon name="download" /> Respaldo
          </button>
        ) : (
          <button
            className="d-nav"
            style={{ border: 0, background: "none", font: "inherit", cursor: "pointer" }}
            title="http://127.0.0.1:4747"
            onClick={() => call("open_web")}
          >
            <Icon name="external" /> Navegador
          </button>
        )}
      </nav>
      <main className="d-main">
        {view === "home" && <Home />}
        {view === "tasks" && <TasksWindow />}
        {view === "meetings" && <Meetings id={param ? Number(param) : undefined} />}
        {view === "suggestions" && <Suggestions />}
        {view === "focus" && <Focus />}
        {view === "chat" && <ChatLog />}
      </main>
    </div>
  );
}

function TimerCard() {
  const snap = usePoll<TimerSnap>("timer_get", 1000);
  const tasks = useTasks((s) => s.tasks);
  const [taskId, setTaskId] = useState<number | null>(null);
  const p = useSettings((s) => s.prefs);
  if (!snap) return <div className="d-card d-dim">Conectando con la app…</div>;
  const active = snap.status !== "idle";
  const task = tasks.find((t) => t.id === snap.task_id);
  const go = (cmd: string, args = {}) => call(cmd, args);
  // En la web no hay prefs: sin `seconds`, Rust usa la duración de Ajustes.
  const mins = { focus: p.focusMin, short: p.shortMin, long: p.longMin };
  const start = (mode: Mode) =>
    go("timer_start", {
      mode,
      taskId: mode === "focus" ? taskId : null,
      ...(db.IS_WEB ? {} : { seconds: mins[mode] * 60 }),
    });
  return (
    <div className="d-card">
      <span className="d-label">Timer</span>
      <div className="d-row" style={{ alignItems: "baseline" }}>
        <span
          style={{
            font: "700 40px ui-monospace,Menlo,monospace",
            color: active ? MODE_COLOR[snap.mode] : undefined,
          }}
        >
          {active ? fmt(snap.remaining) : "--:--"}
        </span>
        <span className="d-dim">
          {active ? `${MODE_LABEL[snap.mode]}${snap.status === "paused" ? " · en pausa" : ""}` : "En reposo"}
          {task && ` · ${task.title}`}
        </span>
      </div>
      {active ? (
        <div className="d-row">
          <button
            className="d-b pri"
            onClick={() => go(snap.status === "running" ? "timer_pause" : "timer_resume")}
          >
            <Icon name={snap.status === "running" ? "pause" : "play"} size="1em" />{" "}
            {snap.status === "running" ? "Pausar" : "Reanudar"}
          </button>
          <button className="d-b" onClick={() => go("timer_restart")}>
            <Icon name="restart" size="1em" /> Reiniciar
          </button>
          <button className="d-b" onClick={() => go("timer_skip")}>
            <Icon name="next" size="1em" /> Saltar
          </button>
          <button className="d-b" onClick={() => go("timer_reset")}>
            <Icon name="stop" size="1em" /> Terminar
          </button>
        </div>
      ) : (
        <div className="d-row">
          <select
            className="d-in"
            value={taskId ?? ""}
            onChange={(e) => setTaskId(e.target.value ? Number(e.target.value) : null)}
            style={{ flex: "1 1 100%" }}
          >
            <option value="">Foco sin tarea</option>
            {tasks
              .filter((t) => !t.done)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <button key={m} className={m === "focus" ? "d-b pri" : "d-b"} onClick={() => start(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MusicCard() {
  const s = usePoll<MusicState | null>("music_state", 2000);
  if (!s) return null;
  const cmd = (c: string) => call("music_cmd", { cmd: c });
  return (
    <div className="d-card">
      <span className="d-label">Música</span>
      <div className="d-row" style={{ flexWrap: "nowrap" }}>
        {s.art && (
          <img src={s.art} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {s.title || "Nada sonando"}
          </div>
          <div className="d-dim" style={{ fontSize: 13 }}>
            {s.artist}
          </div>
        </div>
        <button className="d-b sm" aria-label="Anterior" onClick={() => cmd("prev")}>
          <Icon name="prev" size="1em" />
        </button>
        <button
          className="d-b sm pri"
          aria-label={s.playing ? "Pausar" : "Reproducir"}
          onClick={() => cmd("toggle")}
        >
          <Icon name={s.playing ? "pause" : "play"} size="1em" />
        </button>
        <button className="d-b sm" aria-label="Siguiente" onClick={() => cmd("next")}>
          <Icon name="next" size="1em" />
        </button>
      </div>
    </div>
  );
}

function Home() {
  const { tasks } = useTasks();
  const sessions = useLive(() => db.listSessions(0)) ?? [];
  const pending = useLive(() => db.listSuggestions("pending")) ?? [];
  const live = usePoll<{ active: boolean; status: string }>("meeting_state", 3000);
  const days = perDay(sessions, 14);
  const today = sessions.filter((s) => s.mode === "focus" && s.start >= startOfDay(Date.now()));
  const week = days.slice(-7).reduce((a, d) => a + d.secs, 0);
  const due = tasks.filter((t) => isToday(t, Date.now()));

  return (
    <>
      <h1 className="d-h1">{fmtDay(Date.now())}</h1>
      <div className="d-grid">
        <TimerCard />
        <MusicCard />
        {live?.active && (
          <a href="#meetings" className="d-card" style={{ color: "inherit", textDecoration: "none" }}>
            <span className="d-label">Reunión en curso</span>
            <span className="d-row">
              <Icon name="mic" /> {live.status} →
            </span>
          </a>
        )}
      </div>
      <div className="d-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        {[
          ["Focos hoy", String(today.length)],
          ["Foco hoy", fmtDur(today.reduce((a, s) => a + (s.end - s.start) / 1000, 0))],
          ["Últimos 7 días", fmtDur(week)],
          ["Racha", `${streak(sessions)} días`],
          ["Pendientes", String(tasks.filter((t) => !t.done).length)],
        ].map(([k, v]) => (
          <div key={k} className="d-card">
            <span className="d-label">{k}</span>
            <span className="d-big">{v}</span>
          </div>
        ))}
      </div>
      <div className="d-card">
        <span className="d-label">Foco · 14 días</span>
        <Bars
          fmt={fmtDur}
          data={days.map((d) => ({
            v: d.secs,
            title: fmtDay(d.day),
            label: new Date(d.day).toLocaleDateString("es", { weekday: "narrow" }),
          }))}
        />
      </div>
      <div className="d-grid">
        <div className="d-card">
          <span className="d-label">Para hoy y vencidas</span>
          <div className="d-list">
            {due.map((t) => (
              <label key={t.id} className="d-item" style={{ alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" onChange={(e) => db.setDone(t.id, e.target.checked)} />
                <span style={{ flex: 1 }}>{t.title}</span>
                <span className="d-pill" style={{ color: t.due_at! < Date.now() ? "#ff6b6b" : undefined }}>
                  {fmtDate(t.due_at!)}
                </span>
              </label>
            ))}
            {!due.length && <span className="d-dim">Nada con fecha para hoy.</span>}
          </div>
        </div>
        <div className="d-card">
          <div className="d-row">
            <span className="d-label">Sugerencias por revisar</span>
            <a href="#suggestions" className="d-dim" style={{ marginLeft: "auto" }}>
              ver todas →
            </a>
          </div>
          <div className="d-list">
            {pending.slice(0, 5).map((s) => (
              <div key={s.id} className="d-item">
                <span style={{ flex: 1 }}>{s.title}</span>
                <span className="d-pill">{fmtDate(s.meeting * 1000)}</span>
              </div>
            ))}
            {!pending.length && <span className="d-dim">Todo revisado.</span>}
          </div>
        </div>
      </div>
    </>
  );
}

const PERIODS = { 7: "7 días", 30: "30 días", 90: "90 días" } as const;

function Focus() {
  const { tasks, cats } = useTasks();
  const [n, setN] = useState<keyof typeof PERIODS>(30);
  const rows = useLive(() => db.listSessions(dayStart(n - 1)), [n]) ?? [];
  const focus = rows.filter((r) => r.mode === "focus");
  const secs = (r: db.SessionRow) => (r.end - r.start) / 1000;
  const total = focus.reduce((a, r) => a + secs(r), 0);
  const task = new Map(tasks.map((t) => [t.id, t]));
  const sum = (key: (r: db.SessionRow) => string) => {
    const m = new Map<string, number>();
    focus.forEach((r) => m.set(key(r), (m.get(key(r)) ?? 0) + secs(r)));
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const catName = (r: db.SessionRow) => {
    const c = cats.find((c) => c.id === task.get(r.task_id!)?.category_id);
    return c ? `${c.icon} ${c.name}` : "Sin categoría";
  };
  const days = perDay(rows, n);
  const every = n > 30 ? 7 : n > 7 ? 3 : 1; // etiquetas espaciadas en períodos largos

  return (
    <>
      <div className="d-row">
        <h1 className="d-h1">Foco</h1>
        <span className="d-dim">
          {fmtDur(total)} en {focus.length} focos · media {fmtDur(total / n)}/día
        </span>
        <span style={{ marginLeft: "auto" }} />
        {(Object.keys(PERIODS) as unknown as (keyof typeof PERIODS)[]).map((k) => (
          <button
            key={k}
            className={`d-b ${n == k ? "on" : ""}`}
            onClick={() => setN(Number(k) as keyof typeof PERIODS)}
          >
            {PERIODS[k]}
          </button>
        ))}
      </div>
      <div className="d-card">
        <span className="d-label">Por día</span>
        <Bars
          fmt={fmtDur}
          data={days.map((d, i) => ({
            v: d.secs,
            title: fmtDay(d.day),
            label: (n - 1 - i) % every ? "" : String(new Date(d.day).getDate()),
          }))}
        />
      </div>
      <div className="d-grid">
        <div className="d-card">
          <span className="d-label">Por proyecto</span>
          <HBars
            fmt={fmtDur}
            data={sum((r) =>
              r.task_id == null ? "Sin tarea" : (task.get(r.task_id)?.project ?? "Sin proyecto"),
            )}
          />
        </div>
        <div className="d-card">
          <span className="d-label">Por categoría</span>
          <HBars fmt={fmtDur} data={sum(catName)} />
        </div>
        <div className="d-card">
          <span className="d-label">Por tarea</span>
          <HBars fmt={fmtDur} data={sum((r) => task.get(r.task_id!)?.title ?? "Sin tarea").slice(0, 8)} />
        </div>
      </div>
      <div className="d-card">
        <span className="d-label">¿A qué hora te concentras?</span>
        <Bars
          fmt={fmtDur}
          data={byHour(rows).map((v, h) => ({ v, title: `${h}:00`, label: h % 3 ? "" : String(h) }))}
        />
      </div>
      <div className="d-card">
        <span className="d-label">Sesiones</span>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <tbody>
            {rows.slice(0, 200).map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
                <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{fmtDate(r.start)}</td>
                <td>
                  <span className="d-pill" style={{ color: MODE_COLOR[r.mode as Mode] }}>
                    {MODE_LABEL[r.mode as Mode] ?? r.mode}
                  </span>
                </td>
                <td style={{ width: "100%" }}>
                  {task.get(r.task_id!)?.title ?? <span className="d-dim">—</span>}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtDur(secs(r))}</td>
                <td>
                  <button
                    className="d-b sm"
                    style={{ border: 0, background: "none" }}
                    title="Borrar sesión"
                    onClick={() => confirm("¿Borrar esta sesión?") && db.deleteSession(r.id)}
                  >
                    <Icon name="trash" size="1em" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <span className="d-dim">Sin sesiones en este período.</span>}
      </div>
    </>
  );
}

const OUTCOME = {
  mission: ["Hecho", "#3cb371"],
  oops: ["Error", "#ff6b6b"],
  ask: ["Pidió permiso", "#e8a33c"],
} as const;

/** Historial del chat con Claude Code (chat_log), con búsqueda en pedido, respuesta y comandos. */
function ChatLog() {
  const rows = useLive(() => db.chatHistory(0, 1000)) ?? [];
  const [q, setQ] = useState("");
  const shown = rows
    .filter((r) => !q || [r.prompt, r.reply, r.tools].some((t) => t?.toLowerCase().includes(q.toLowerCase())))
    .reverse();
  return (
    <>
      <div className="d-row">
        <h1 className="d-h1">Chat con Claude Code</h1>
        <span className="d-dim">{rows.length} órdenes</span>
        <input
          className="d-in"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar…"
          style={{ marginLeft: "auto", width: 260 }}
        />
      </div>
      {shown.map((r) => {
        const [label, color] = OUTCOME[r.outcome as keyof typeof OUTCOME] ?? [r.outcome, undefined];
        return (
          <div key={r.id} className="d-card">
            <div className="d-row">
              <span className="d-dim">{fmtDate(r.at)}</span>
              <span className="d-pill" style={{ color }}>
                {label}
              </span>
              {!!r.god && (
                <span className="d-pill" style={{ color: "#e8523c" }}>
                  modo dios
                </span>
              )}
            </div>
            <b>
              <Hl text={r.prompt} q={q} />
            </b>
            {r.reply && (
              <div style={{ whiteSpace: "pre-wrap" }}>
                <Hl text={r.reply} q={q} />
              </div>
            )}
            {r.tools && (
              <details>
                <summary>{r.tools.split("\n").length} herramientas usadas</summary>
                <pre>{r.tools}</pre>
              </details>
            )}
          </div>
        );
      })}
      {!shown.length && (
        <span className="d-dim">{q ? "Nada coincide." : "Todavía no hay conversaciones."}</span>
      )}
    </>
  );
}
