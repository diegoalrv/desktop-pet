import { useEffect, useState } from "react";
import { call, type Mode, type TimerSnap } from "../lib/ipc";
import * as db from "../lib/db";
import { isToday, startOfDay } from "../lib/tasks";
import { byHour, byWeekday, dayStart, perDay, streak } from "../lib/stats";
import { fmt, fmtDur } from "../lib/time";
import { useLive, useTasks } from "../store/useTasks";
import { useSettings } from "../store/useSettings";
import { MODE_COLOR } from "../pet/TimerPill";
import idleSprite from "../../examples/candolita/idle.png";
import { Icon, type IconName } from "../panel/icons";
import { PANEL_CSS } from "../panel/ui";
import { TasksWindow } from "../tasks/TasksWindow";
import type { MusicState } from "../store/useMusic";
import { Bars, DASH_CSS, download, fmtDate, fmtDay, HBars, Head, Heatmap, Hl, usePoll } from "./kit";
import { Meetings, Suggestions } from "./Meetings";
import { Report } from "./Report";

const VIEWS: { id: string; label: string; icon: IconName }[] = [
  { id: "home", label: "Resumen", icon: "home" },
  { id: "tasks", label: "Tareas", icon: "tasks" },
  { id: "meetings", label: "Reuniones", icon: "mic" },
  { id: "suggestions", label: "Sugerencias", icon: "inbox" },
  { id: "focus", label: "Foco", icon: "chart" },
  { id: "report", label: "Informe", icon: "chart" },
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
  const [view = "home", param, sub] = h.split("/");
  return { view: VIEWS.some((v) => v.id === view) ? view : "home", param, sub };
}

/** Respaldo de todo lo que guarda la app (tablas + transcripciones) en un JSON. */
async function backup() {
  const tables = ["categories", "tasks", "sessions", "chat_log", "meeting_tasks", "meeting_notes"];
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
  const { view, param, sub } = useHash();
  const pending = useLive(() => db.listSuggestions("pending"))?.length ?? 0;
  useEffect(() => void scrollTo(0, 0), [view, param, sub]);
  useEffect(() => {
    document.title = `${VIEWS.find((v) => v.id === view)?.label} · Pet`;
  }, [view]);

  return (
    <div className="d">
      <style>{PANEL_CSS + DASH_CSS + "body{margin:0}"}</style>
      <nav className="d-side">
        <div className="d-brand">
          <i style={{ backgroundImage: `url(${idleSprite})` }} />
          <span>
            <b>Candolita</b>
            <small>Panel</small>
          </span>
        </div>
        {VIEWS.map((v) => (
          <a key={v.id} href={`#${v.id}`} className="d-nav" aria-current={view === v.id ? "page" : undefined}>
            <Icon name={v.icon} /> {v.label}
            {v.id === "suggestions" && pending > 0 && <span className="n">{pending}</span>}
          </a>
        ))}
        <span style={{ flex: 1 }} />
        {db.IS_WEB ? (
          <button className="d-nav" onClick={backup}>
            <Icon name="download" /> Respaldo
          </button>
        ) : (
          <button className="d-nav" title="http://127.0.0.1:4747" onClick={() => call("open_web")}>
            <Icon name="external" /> Navegador
          </button>
        )}
      </nav>
      <main className="d-main">
        {view === "home" && <Home />}
        {view === "tasks" && (
          <>
            <Head title="Tareas" />
            <div className="d-card" style={{ overflowX: "auto" }}>
              <TasksWindow />
            </div>
          </>
        )}
        {view === "meetings" && <Meetings id={param ? Number(param) : undefined} tab={sub} />}
        {view === "suggestions" && <Suggestions />}
        {view === "focus" && <Focus />}
        {view === "report" && <Report />}
        {view === "chat" && <ChatLog id={param ? Number(param) : undefined} />}
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
  const color = active ? MODE_COLOR[snap.mode] : undefined;
  return (
    <div className="d-card" style={{ gap: 18, padding: 22 }}>
      <div className="d-row">
        <span className="d-label">Timer</span>
        <span className="d-pill" style={{ marginLeft: "auto", color }}>
          {active ? `${MODE_LABEL[snap.mode]}${snap.status === "paused" ? " · en pausa" : ""}` : "En reposo"}
        </span>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <span
          className="d-timer"
          style={{ color: color ?? "var(--line-2)", letterSpacing: active ? undefined : 0 }}
        >
          {active ? fmt(snap.remaining) : "--:--"}
        </span>
        <span className="d-dim">{task ? task.title : active ? "Sin tarea" : "Listo para empezar"}</span>
      </div>
      <div className="d-track">
        <i
          style={{
            width: active && snap.total ? `${(1 - snap.remaining / snap.total) * 100}%` : 0,
            background: color,
          }}
        />
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
          <button className="d-b ghost" onClick={() => go("timer_reset")}>
            <Icon name="stop" size="1em" /> Terminar
          </button>
        </div>
      ) : (
        <div className="d-row">
          <select
            className="d-in"
            value={taskId ?? ""}
            onChange={(e) => setTaskId(e.target.value ? Number(e.target.value) : null)}
            style={{ flex: "1 1 200px" }}
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
          <button className="d-b pri" onClick={() => start("focus")}>
            <Icon name="play" size="1em" /> Foco
          </button>
          <button className="d-b" onClick={() => start("short")}>
            {MODE_LABEL.short}
          </button>
          <button className="d-b" onClick={() => start("long")}>
            {MODE_LABEL.long}
          </button>
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
      <div className="d-row" style={{ flexWrap: "nowrap", gap: 12 }}>
        {s.art ? (
          <img src={s.art} alt="" style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover" }} />
        ) : (
          <span
            style={{ display: "grid", placeItems: "center", width: 52, height: 52, borderRadius: 10 }}
            className="d-pill"
          >
            <Icon name="music" />
          </span>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={s.title}
          >
            {s.title || "Nada sonando"}
          </div>
          <div
            className="d-dim"
            style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {s.artist}
          </div>
        </div>
      </div>
      <div className="d-row" style={{ justifyContent: "center", gap: 6 }}>
        <button className="d-b ghost" aria-label="Anterior" onClick={() => cmd("prev")}>
          <Icon name="prev" size="1em" />
        </button>
        <button
          className="d-b pri"
          style={{ width: 44, height: 36 }}
          aria-label={s.playing ? "Pausar" : "Reproducir"}
          onClick={() => cmd("toggle")}
        >
          <Icon name={s.playing ? "pause" : "play"} size="1em" />
        </button>
        <button className="d-b ghost" aria-label="Siguiente" onClick={() => cmd("next")}>
          <Icon name="next" size="1em" />
        </button>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? "Buenas noches" : h < 13 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
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
      <Head title={greeting()} sub={fmtDay(Date.now())} />
      <div className="d-hero">
        <TimerCard />
        <div className="d-stack">
          {live?.active && (
            <a href="#meetings" className="d-card" style={{ borderColor: "var(--accent-soft)" }}>
              <span className="d-row d-label" style={{ color: "var(--accent)" }}>
                <Icon name="mic" size="1em" /> Reunión en curso
              </span>
              <span className="d-row">
                {live.status} <span className="d-more">abrir →</span>
              </span>
            </a>
          )}
          <MusicCard />
        </div>
      </div>
      <div className="d-stats">
        {[
          ["Focos hoy", String(today.length)],
          ["Foco hoy", fmtDur(today.reduce((a, s) => a + (s.end - s.start) / 1000, 0))],
          ["Últimos 7 días", fmtDur(week)],
          ["Racha", `${streak(sessions)} días`],
          ["Pendientes", String(tasks.filter((t) => !t.done).length)],
        ].map(([k, v]) => (
          <div key={k}>
            <span className="d-big">{v}</span>
            <span className="d-dim" style={{ fontSize: 13 }}>
              {k}
            </span>
          </div>
        ))}
      </div>
      <div className="d-card">
        <div className="d-row">
          <span className="d-label">Foco · últimos 14 días</span>
          <a href="#focus" className="d-more">
            ver detalle →
          </a>
        </div>
        <Bars
          hi={days.length - 1}
          data={days.map((d) => ({
            v: d.secs,
            title: fmtDay(d.day),
            label: new Date(d.day).toLocaleDateString("es", { weekday: "narrow" }),
          }))}
        />
      </div>
      <div className="d-grid">
        <div className="d-card">
          <div className="d-row">
            <span className="d-label">Para hoy y vencidas</span>
            <a href="#tasks" className="d-more">
              todas →
            </a>
          </div>
          <div className="d-list">
            {due.map((t) => (
              <label key={t.id} className="d-item" style={{ alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" onChange={(e) => db.setDone(t.id, e.target.checked)} />
                <span style={{ flex: 1 }}>{t.title}</span>
                <span className="d-pill" style={{ color: t.due_at! < Date.now() ? "var(--err)" : undefined }}>
                  {fmtDate(t.due_at!)}
                </span>
              </label>
            ))}
            {!due.length && <span className="d-empty">Nada con fecha para hoy.</span>}
          </div>
        </div>
        <div className="d-card">
          <div className="d-row">
            <span className="d-label">Sugerencias por revisar</span>
            <a href="#suggestions" className="d-more">
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
            {!pending.length && <span className="d-empty">Todo revisado.</span>}
          </div>
        </div>
      </div>
    </>
  );
}

const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const PERIODS = { 7: "7 días", 30: "30 días", 90: "90 días" } as const;

function Focus() {
  const { tasks, cats } = useTasks();
  const [n, setN] = useState<keyof typeof PERIODS>(30);
  const rows = useLive(() => db.listSessions(dayStart(n - 1)), [n]) ?? [];
  const year = useLive(() => db.listSessions(dayStart(371))) ?? [];
  const apps = useLive(() => db.listAppUse(dayStart(n - 1)), [n]) ?? [];
  const appSecs = new Map<string, number>(); // por nombre de app, todo el período
  const appsOf = new Map<number, db.AppUseRow[]>(); // por sesión
  const hitsDay = new Map<number, number>(); // distracciones por día
  apps.forEach((a) => {
    appSecs.set(a.name, (appSecs.get(a.name) ?? 0) + a.secs);
    appsOf.set(a.session_id, [...(appsOf.get(a.session_id) ?? []), a]);
    if (a.hits) hitsDay.set(dayStart(0, a.start), (hitsDay.get(dayStart(0, a.start)) ?? 0) + a.hits);
  });
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
  const best = days.reduce((a, d) => (d.secs > a.secs ? d : a), days[0]);
  const every = n > 30 ? 7 : n > 7 ? 3 : 1; // etiquetas espaciadas en períodos largos
  const today = (new Date().getDay() + 6) % 7;

  return (
    <>
      <Head title="Foco" sub={`Tus sesiones de los últimos ${PERIODS[n]}`}>
        <div className="d-seg">
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
      </Head>
      <div className="d-stats">
        {[
          ["Tiempo de foco", fmtDur(total)],
          ["Focos", String(focus.length)],
          ["Media por día", fmtDur(total / n)],
          ["Días con foco", `${days.filter((d) => d.secs).length}/${n}`],
          [
            best?.secs
              ? `Mejor día · ${new Date(best.day).toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" })}`
              : "Mejor día",
            fmtDur(best?.secs ?? 0),
          ],
        ].map(([k, v]) => (
          <div key={k}>
            <span className="d-big">{v}</span>
            <span className="d-dim" style={{ fontSize: 13 }}>
              {k}
            </span>
          </div>
        ))}
      </div>
      <div className="d-card">
        <span className="d-label">Calendario de foco</span>
        <Heatmap rows={year} />
      </div>
      <div className="d-card">
        <span className="d-label">Por día</span>
        <Bars
          hi={days.length - 1}
          avg={total / n}
          data={days.map((d, i) => ({
            v: d.secs,
            title: fmtDay(d.day),
            label: (n - 1 - i) % every ? "" : String(new Date(d.day).getDate()),
          }))}
        />
      </div>
      <div className="d-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
        <div className="d-card">
          <span className="d-label">¿A qué hora te concentras?</span>
          <Bars
            hi={new Date().getHours()}
            data={byHour(rows).map((v, h) => ({ v, title: `${h}:00`, label: h % 3 ? "" : String(h) }))}
          />
        </div>
        <div className="d-card">
          <span className="d-label">Media por día de la semana</span>
          <Bars
            hi={today}
            data={byWeekday(days).map((v, i) => ({ v, title: WEEKDAYS[i], label: WEEKDAYS[i].slice(0, 2) }))}
          />
        </div>
      </div>
      <div className="d-grid">
        <div className="d-card">
          <span className="d-label">Por proyecto</span>
          <HBars
            fmt={fmtDur}
            total={total}
            data={sum((r) =>
              r.task_id == null ? "Sin tarea" : (task.get(r.task_id)?.project ?? "Sin proyecto"),
            )}
          />
        </div>
        <div className="d-card">
          <span className="d-label">Por categoría</span>
          <HBars fmt={fmtDur} total={total} data={sum(catName)} />
        </div>
        <div className="d-card">
          <span className="d-label">Por tarea</span>
          <HBars
            fmt={fmtDur}
            total={total}
            data={sum((r) => task.get(r.task_id!)?.title ?? "Sin tarea").slice(0, 8)}
          />
        </div>
      </div>
      {!!apps.length && (
        <div className="d-grid">
          <div className="d-card">
            <span className="d-label">Apps durante el foco</span>
            <HBars fmt={fmtDur} data={[...appSecs].sort((a, b) => b[1] - a[1]).slice(0, 8)} />
          </div>
          <div className="d-card">
            <span className="d-label">Distracciones por día</span>
            <HBars
              fmt={String}
              data={days
                .filter((d) => hitsDay.has(d.day))
                .reverse()
                .slice(0, 8)
                .map((d) => [fmtDay(d.day), hitsDay.get(d.day)!])}
            />
          </div>
        </div>
      )}
      <div className="d-card">
        <span className="d-label">Sesiones</span>
        <table className="d-table">
          <tbody>
            {rows.slice(0, 200).map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }} className="d-dim">
                  {fmtDate(r.start)}
                </td>
                <td>
                  <span className="d-pill" style={{ color: MODE_COLOR[r.mode as Mode] }}>
                    {MODE_LABEL[r.mode as Mode] ?? r.mode}
                  </span>
                </td>
                <td style={{ width: "100%" }}>
                  {task.get(r.task_id!)?.title ?? <span className="d-dim">—</span>}
                  {!!appsOf.get(r.id)?.length && (
                    <small className="d-dim" style={{ display: "block" }}>
                      {[...appsOf.get(r.id)!]
                        .sort((a, b) => b.secs - a.secs)
                        .slice(0, 3)
                        .map((a) => `${a.name} ${fmtDur(a.secs)}`)
                        .join(" · ")}
                    </small>
                  )}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {fmtDur(secs(r))}
                </td>
                <td>
                  <button
                    className="d-b sm ghost"
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
        {!rows.length && <span className="d-empty">Sin sesiones en este período.</span>}
      </div>
    </>
  );
}

const OUTCOME = {
  mission: ["Hecho", "var(--ok)"],
  oops: ["Error", "var(--err)"],
  ask: ["Pidió permiso", "var(--warn)"],
} as const;

function Pills({ r }: { r: db.ChatRow }) {
  const [label, color] = OUTCOME[r.outcome as keyof typeof OUTCOME] ?? [r.outcome, undefined];
  return (
    <>
      <span className="d-pill" style={{ color }}>
        {label}
      </span>
      {!!r.god && (
        <span className="d-pill" style={{ color: "var(--accent)" }}>
          modo dios
        </span>
      )}
    </>
  );
}

/** Historial del chat con Claude Code (chat_log): listado con búsqueda (#chat) y cada orden (#chat/<id>). */
function ChatLog({ id }: { id?: number }) {
  const rows = useLive(() => db.chatHistory(0, 1000)) ?? [];
  const [q, setQ] = useState("");
  const shown = rows
    .filter((r) => !q || [r.prompt, r.reply, r.tools].some((t) => t?.toLowerCase().includes(q.toLowerCase())))
    .reverse();
  const i = shown.findIndex((r) => r.id === id);
  const cur = shown[i] ?? rows.find((r) => r.id === id);

  if (cur) {
    const prev = shown[i + 1]; // más antigua
    const next = shown[i - 1];
    return (
      <>
        <div className="d-row">
          <a href="#chat" className="d-more" style={{ marginLeft: 0 }}>
            ← Chat
          </a>
          <span style={{ marginLeft: "auto" }} />
          <a href={prev ? `#chat/${prev.id}` : undefined} className="d-b sm ghost" aria-disabled={!prev}>
            ← Anterior
          </a>
          <a href={next ? `#chat/${next.id}` : undefined} className="d-b sm ghost" aria-disabled={!next}>
            Siguiente →
          </a>
        </div>
        <div className="d-card" style={{ gap: 14, padding: 22 }}>
          <div className="d-row">
            <span className="d-dim" style={{ fontSize: 13 }}>
              {fmtDate(cur.at)}
            </span>
            <Pills r={cur} />
          </div>
          <h1 className="d-h1" style={{ fontSize: 20 }}>
            <Hl text={cur.prompt} q={q} />
          </h1>
          {cur.reply && (
            <div className="d-prose">
              <Hl text={cur.reply} q={q} />
            </div>
          )}
          {cur.tools && (
            <details>
              <summary>{cur.tools.split("\n").length} herramientas usadas</summary>
              <pre>{cur.tools}</pre>
            </details>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <Head title="Chat con Claude Code" sub={`${rows.length} órdenes`}>
        <input
          className="d-in"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar en pedidos, respuestas y comandos…"
          style={{ width: 320, maxWidth: "100%" }}
        />
      </Head>
      <div className="d-card" style={{ padding: 8 }}>
        {shown.map((r) => (
          <a key={r.id} href={`#chat/${r.id}`} className="d-lrow">
            <div style={{ flex: "1 1 260px", minWidth: 0, display: "grid", gap: 2 }}>
              <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <Hl text={r.prompt} q={q} />
              </b>
              {r.reply && (
                <span
                  className="d-dim"
                  style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {r.reply.split("\n")[0]}
                </span>
              )}
            </div>
            <Pills r={r} />
            <span className="d-dim" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
              {fmtDate(r.at)}
            </span>
          </a>
        ))}
        {!shown.length && (
          <span className="d-empty" style={{ padding: 10, display: "block" }}>
            {q ? "Nada coincide." : "Todavía no hay conversaciones."}
          </span>
        )}
      </div>
    </>
  );
}
