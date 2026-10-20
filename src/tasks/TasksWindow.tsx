import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import * as db from "../lib/db";
import { compareTasks, PRIORITIES, projectsOf, startOfDay, type Task } from "../lib/tasks";
import { fmtDur } from "../lib/time";
import { useTasks } from "../store/useTasks";
import { btn, T, PANEL_CSS } from "../panel/ui";

const NONE = "\u0000"; // filtro "Sin proyecto"
const cell = { ...btn, padding: "4px 6px", borderRadius: 6, width: "100%", boxSizing: "border-box" } as const;
const PRIO_COLOR = [T.dim, "#e8a33c", "#e8523c"];

/** ms epoch ⇄ valor de <input type="datetime-local"> en hora local. */
const toLocal = (ms: number | null) =>
  ms == null ? "" : new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const fromLocal = (v: string) => (v ? new Date(v).getTime() : null);

const DAY = 86_400_000;
const PERIODS = {
  today: { label: "Hoy", since: () => startOfDay(Date.now()) },
  week: { label: "7 días", since: () => startOfDay(Date.now()) - 6 * DAY },
  month: { label: "30 días", since: () => startOfDay(Date.now()) - 29 * DAY },
  all: { label: "Todo", since: () => 0 },
};
type Period = keyof typeof PERIODS;
const confirmDelete = async (title: string) =>
  db.IS_WEB ? confirm(`¿Eliminar "${title}"?`) : ask(`¿Eliminar "${title}"?`, { kind: "warning" });

export function TasksWindow() {
  const { tasks, cats } = useTasks();
  const projects = projectsOf(tasks);
  const titleRef = useRef<HTMLInputElement>(null);
  // Alta rápida: proyecto/categoría/prioridad quedan fijos para cargar varias seguidas.
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [cat, setCat] = useState<number | null>(null);
  const [prio, setPrio] = useState(1);
  const [est, setEst] = useState(1);
  const [due, setDue] = useState("");
  // Filtros
  const [q, setQ] = useState("");
  const [fProject, setFProject] = useState("");
  const [status, setStatus] = useState<"open" | "all" | "done">("open");
  // Tracking: segundos de foco por tarea en el período (se recalcula cuando cambia la BD).
  const [period, setPeriod] = useState<Period>("week");
  const [secs, setSecs] = useState(new Map<number | null, number>());
  useEffect(() => {
    db.focusByTask(PERIODS[period].since()).then((rows) => setSecs(new Map(rows.map((r) => [r.task_id, r.secs]))));
  }, [tasks, period]);
  const projectOf = new Map(tasks.map((t) => [t.id, t.project || null]));
  const byProject = new Map<string, number>();
  let total = 0;
  secs.forEach((v, id) => {
    const p = id == null ? "Sin tarea" : (projectOf.get(id) ?? "Sin proyecto");
    byProject.set(p, (byProject.get(p) ?? 0) + v);
    total += v;
  });

  const catId = cat ?? cats[0]?.id ?? null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await db.addTask({
      title: title.trim(),
      project: project.trim() || null,
      category_id: catId,
      priority: prio,
      est_pomodoros: est,
      due_at: fromLocal(due),
    });
    setTitle("");
    setDue("");
    titleRef.current?.focus();
  };

  const shown = tasks
    .filter((t) => (status === "all" ? true : status === "done" ? t.done : !t.done))
    .filter((t) => !fProject || (fProject === NONE ? !t.project : t.project === fProject))
    .filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase()))
    .sort(compareTasks);
  const groups = [...projects, null]
    .map((p) => ({ p, ts: shown.filter((t) => (t.project || null) === p) }))
    .filter((g) => g.ts.length);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", fontSize: 13, color: T.text, display: "grid", gap: 14 }}>
      <style>{PANEL_CSS + `body{margin:0} input,select{min-width:0;font-size:13px} th{font-weight:600;text-align:left;color:${T.dim};font-size:12px;padding:4px 6px}`}</style>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ fontSize: 15 }}>⏱ {fmtDur(total)}</b>
        {(Object.keys(PERIODS) as Period[]).map((k) => (
          <button
            key={k}
            onClick={() => setPeriod(k)}
            style={{ ...btn, padding: "4px 10px", background: period === k ? T.accent : T.card, border: period === k ? "1px solid transparent" : btn.border }}
          >
            {PERIODS[k].label}
          </button>
        ))}
        {[...byProject].sort((a, b) => b[1] - a[1]).map(([p, v]) => (
          <span key={p} style={{ padding: "4px 10px", borderRadius: 999, background: T.card, color: T.dim }}>
            {p} · <b style={{ color: T.text }}>{fmtDur(v)}</b>
          </span>
        ))}
      </div>

      <form onSubmit={add} style={{ display: "grid", gridTemplateColumns: "minmax(160px,1fr) 140px 150px 84px 52px 180px auto", gap: 8 }}>
        <input
          ref={titleRef}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nueva tarea… (Enter para añadir)"
          style={btn}
        />
        <input list="tm-projects" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Proyecto" style={btn} />
        <select value={catId ?? ""} onChange={(e) => setCat(Number(e.target.value))} style={btn}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
        <select value={prio} onChange={(e) => setPrio(Number(e.target.value))} style={btn}>
          {PRIORITIES.map((p, i) => (
            <option key={p} value={i}>
              {p}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={20}
          value={est}
          onChange={(e) => setEst(Math.max(1, Number(e.target.value)))}
          title="Pomodoros estimados"
          style={btn}
        />
        <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} style={btn} />
        <button style={{ ...btn, background: T.accent, border: 0, color: "#fff", fontWeight: 600 }}>Añadir</button>
      </form>
      <datalist id="tm-projects">
        {projects.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" style={{ ...btn, width: 220 }} />
        <select value={fProject} onChange={(e) => setFProject(e.target.value)} style={btn}>
          <option value="">Todos los proyectos</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value={NONE}>Sin proyecto</option>
        </select>
        {(["open", "all", "done"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            style={{ ...btn, background: status === s ? T.accent : T.card, border: status === s ? "1px solid transparent" : btn.border }}
          >
            {{ open: "Pendientes", all: "Todas", done: "Hechas" }[s]}
          </button>
        ))}
        <span style={{ marginLeft: "auto", color: T.dim }}>{shown.length} tareas</span>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 32 }} />
          <col />
          <col style={{ width: 140 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 84 }} />
          <col style={{ width: 76 }} />
          <col style={{ width: 180 }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 36 }} />
        </colgroup>
        <thead>
          <tr>
            <th />
            <th>Tarea</th>
            <th>Proyecto</th>
            <th>Categoría</th>
            <th>Prioridad</th>
            <th title="Hechos / estimados">🍅</th>
            <th>Fecha</th>
            <th title={`Tiempo de foco (${PERIODS[period].label})`}>⏱</th>
            <th />
          </tr>
        </thead>
        {groups.map(({ p, ts }) => (
          <tbody key={p ?? NONE}>
            <tr>
              <td colSpan={9} style={{ padding: "14px 6px 4px", fontWeight: 700, color: T.accent }}>
                {p ?? "Sin proyecto"}{" "}
                <span style={{ color: T.dim, fontWeight: 400 }}>
                  · {ts.length} · ⏱ {fmtDur(byProject.get(p ?? "Sin proyecto") ?? 0)}
                </span>
              </td>
            </tr>
            {ts.map((t) => (
              <Row key={t.id} t={t} secs={secs.get(t.id) ?? 0} />
            ))}
          </tbody>
        ))}
      </table>
      {!shown.length && <div style={{ color: T.dim, textAlign: "center" }}>Sin tareas.</div>}
    </div>
  );
}

function Row({ t, secs }: { t: Task; secs: number }) {
  const { cats } = useTasks();
  const up = <K extends keyof db.NewTask>(f: K, v: db.NewTask[K]) => db.updateTask(t.id, f, v);
  // key={valor}: si cambia en la BD (otra ventana), el input se remonta con el dato nuevo.
  return (
    <tr style={{ borderTop: `1px solid ${T.line}`, opacity: t.done ? 0.5 : 1 }}>
      <td style={{ padding: 6, borderLeft: `3px solid ${PRIO_COLOR[t.priority]}` }}>
        <input
          type="checkbox"
          checked={!!t.done}
          onChange={async (e) => {
            await db.setDone(t.id, e.target.checked);
            if (e.target.checked && !db.IS_WEB) emit("task://done");
          }}
        />
      </td>
      <td style={{ padding: 4 }}>
        <input
          key={t.title}
          defaultValue={t.title}
          onBlur={(e) => e.target.value.trim() && e.target.value !== t.title && db.renameTask(t.id, e.target.value.trim())}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          style={{ ...cell, border: 0, background: "transparent", textDecoration: t.done ? "line-through" : "none" }}
        />
      </td>
      <td style={{ padding: 4 }}>
        <input
          key={t.project ?? ""}
          list="tm-projects"
          defaultValue={t.project ?? ""}
          onBlur={(e) => e.target.value.trim() !== (t.project ?? "") && up("project", e.target.value.trim() || null)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          style={cell}
        />
      </td>
      <td style={{ padding: 4 }}>
        <select value={t.category_id ?? ""} onChange={(e) => up("category_id", Number(e.target.value))} style={cell}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
      </td>
      <td style={{ padding: 4 }}>
        <select value={t.priority} onChange={(e) => up("priority", Number(e.target.value))} style={cell}>
          {PRIORITIES.map((p, i) => (
            <option key={p} value={i}>
              {p}
            </option>
          ))}
        </select>
      </td>
      <td style={{ padding: 4, whiteSpace: "nowrap" }}>
        {t.done_pomodoros}/
        <input
          key={t.est_pomodoros}
          type="number"
          min={1}
          max={20}
          defaultValue={t.est_pomodoros}
          onBlur={(e) => Number(e.target.value) !== t.est_pomodoros && up("est_pomodoros", Math.max(1, Number(e.target.value)))}
          style={{ ...cell, width: 44 }}
        />
      </td>
      <td style={{ padding: 4 }}>
        <input
          key={t.due_at ?? ""}
          type="datetime-local"
          defaultValue={toLocal(t.due_at)}
          onBlur={(e) => fromLocal(e.target.value) !== t.due_at && up("due_at", fromLocal(e.target.value))}
          style={cell}
        />
      </td>
      <td style={{ padding: 4, color: secs ? T.text : T.dim, textAlign: "right" }}>{secs ? fmtDur(secs) : "—"}</td>
      <td style={{ padding: 4 }}>
        <button
          title="Eliminar"
          onClick={async () => (await confirmDelete(t.title)) && db.deleteTask(t.id)}
          style={{ ...btn, padding: 2, border: 0, background: "transparent" }}
        >
          🗑
        </button>
      </td>
    </tr>
  );
}
