import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import * as db from "../lib/db";
import {
  groupByCategory,
  isToday,
  PRIORITIES,
  projectsOf,
  REPEAT_LABEL,
  REPEATS,
  type Repeat,
} from "../lib/tasks";
import { useTasks } from "../store/useTasks";
import { Icon } from "./icons";

const PRIO_COLOR = ["var(--muted)", "#e8a33c", "#e8523c"];

export function TaskList({ onFocusTask }: { onFocusTask: () => void }) {
  const { tasks, cats, today, selected, select } = useTasks();
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState<number | null>(null);
  const [project, setProject] = useState("");
  const [prio, setPrio] = useState(1);
  const [est, setEst] = useState(1);
  const [due, setDue] = useState("");
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [onlyToday, setOnlyToday] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editCats, setEditCats] = useState(false);

  useEffect(() => input.current?.focus(), []);
  const catId = cat ?? cats[0]?.id ?? null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await db.addTask({
      title: title.trim(),
      category_id: catId,
      project: project.trim() || null,
      priority: prio,
      est_pomodoros: est,
      due_at: due ? new Date(due).getTime() : null,
      repeat,
    });
    setTitle("");
    setDue("");
  };

  const now = Date.now();
  const shown = onlyToday ? tasks.filter((t) => isToday(t, now)) : tasks;

  return (
    <div className="stack" style={{ gap: "1em" }}>
      <form onSubmit={add} className="card stack" style={{ padding: ".6em" }}>
        <div className="row">
          <input
            ref={input}
            className="field grow"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nueva tarea…"
          />
          <button className="b b-primary b-sq" aria-label="Añadir" disabled={!title.trim()}>
            <Icon name="plus" />
          </button>
        </div>
        {/* Detalles solo mientras escribes: la lista queda limpia el resto del tiempo. */}
        {title && (
          <div className="stack" style={{ gap: ".4em" }}>
            <div className="row">
              <select
                className="field field-sm grow"
                value={catId ?? ""}
                onChange={(e) => setCat(Number(e.target.value))}
                aria-label="Categoría"
              >
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
              <select
                className="field field-sm"
                style={{ width: "auto" }}
                value={prio}
                onChange={(e) => setPrio(Number(e.target.value))}
                aria-label="Prioridad"
              >
                {PRIORITIES.map((p, i) => (
                  <option key={p} value={i}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                className="field field-sm"
                type="number"
                min={1}
                max={20}
                value={est}
                onChange={(e) => setEst(Math.max(1, Number(e.target.value)))}
                title="Pomodoros estimados"
                aria-label="Pomodoros estimados"
                style={{ width: "3.6em", textAlign: "center" }}
              />
            </div>
            <div className="row">
              <input
                className="field field-sm grow"
                list="pet-projects"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="Proyecto"
              />
              <input
                className="field field-sm"
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                title="Fecha y hora (recordatorio)"
                style={{ width: "auto" }}
              />
            </div>
            <select
              className="field field-sm"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as Repeat)}
              aria-label="Repetir"
            >
              {REPEATS.map((r) => (
                <option key={r} value={r}>
                  {r === "none" ? "↻ No se repite" : `↻ ${REPEAT_LABEL[r]}`}
                </option>
              ))}
            </select>
          </div>
        )}
        <datalist id="pet-projects">
          {projectsOf(tasks).map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </form>

      <div className="row">
        <div className="seg" role="group" aria-label="Filtro">
          <button aria-pressed={!onlyToday} onClick={() => setOnlyToday(false)}>
            Todas
          </button>
          <button aria-pressed={onlyToday} onClick={() => setOnlyToday(true)}>
            Hoy
          </button>
        </div>
        <span className="chip" title="Focos de hoy">
          <Icon name="tomato" size="1em" /> {today}
        </span>
        <span className="grow" />
        <button
          className="b b-ghost b-sq"
          title="Editar categorías"
          aria-label="Editar categorías"
          aria-pressed={editCats}
          onClick={() => setEditCats(!editCats)}
        >
          <Icon name="pencil" />
        </button>
        <button
          className="b b-ghost b-sq"
          title="Abrir gestor de tareas"
          aria-label="Abrir gestor de tareas"
          onClick={() => invoke("open_window", { label: "tasks" })}
        >
          <Icon name="external" />
        </button>
      </div>

      {editCats && (
        <div className="card stack" style={{ padding: ".6em", gap: ".4em" }}>
          <span className="label">Categorías</span>
          {cats.map((c) => (
            <div key={c.id} className="row">
              <input
                className="field field-sm"
                defaultValue={c.icon}
                onBlur={(e) => db.saveCategory({ ...c, icon: e.target.value })}
                style={{ width: "2.6em", textAlign: "center" }}
              />
              <input
                className="field field-sm grow"
                defaultValue={c.name}
                onBlur={(e) => db.saveCategory({ ...c, name: e.target.value })}
              />
              <input
                type="color"
                defaultValue={c.color}
                onBlur={(e) => db.saveCategory({ ...c, color: e.target.value })}
                style={{
                  width: "2em",
                  height: "2em",
                  border: 0,
                  padding: 0,
                  background: "none",
                  cursor: "pointer",
                }}
              />
            </div>
          ))}
        </div>
      )}

      {groupByCategory(shown, cats).map(({ cat: c, tasks: ts }) => (
        <section key={c?.id ?? "none"} className="stack" style={{ gap: ".35em" }}>
          <div className="row label" style={{ gap: ".4em" }}>
            <span className="dot" style={{ background: c?.color ?? "var(--muted)" }} />
            {c ? `${c.icon} ${c.name}` : "Sin categoría"}
            <span style={{ opacity: 0.6 }}>{ts.filter((t) => !t.done).length}</span>
          </div>
          <div className="card" style={{ padding: ".2em" }}>
            {ts.map((t) => (
              <div
                key={t.id}
                className="row"
                style={{
                  padding: ".5em .55em",
                  borderRadius: "var(--r-sm)",
                  background: selected === t.id ? "var(--accent-soft)" : undefined,
                  alignItems: "flex-start",
                }}
              >
                <input
                  type="checkbox"
                  className="check"
                  aria-label={`Completar ${t.title}`}
                  checked={!!t.done}
                  style={{ marginTop: ".1em" }}
                  onChange={async (e) => {
                    await db.setDone(t.id, e.target.checked);
                    if (e.target.checked) emit("task://done");
                  }}
                />
                <div className="grow" style={{ display: "grid", gap: ".15em" }}>
                  {editing === t.id ? (
                    <input
                      autoFocus
                      className="field field-sm"
                      defaultValue={t.title}
                      onBlur={async (e) => {
                        if (e.target.value.trim()) await db.renameTask(t.id, e.target.value.trim());
                        setEditing(null);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    />
                  ) : (
                    <span
                      onDoubleClick={() => setEditing(t.id)}
                      title="Doble clic para editar"
                      style={{
                        textDecoration: t.done ? "line-through" : "none",
                        opacity: t.done ? 0.45 : 1,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {t.title}
                    </span>
                  )}
                  <div
                    className="row small muted"
                    style={{ gap: ".45em", flexWrap: "wrap", opacity: t.done ? 0.5 : 1 }}
                  >
                    <span
                      className="dot"
                      title={`Prioridad ${PRIORITIES[t.priority]}`}
                      style={{ background: PRIO_COLOR[t.priority] }}
                    />
                    <span className="row" style={{ gap: ".2em" }}>
                      {t.done_pomodoros}/{t.est_pomodoros} <Icon name="tomato" size="1em" />
                    </span>
                    {t.repeat !== "none" && (
                      <span className="row" title={REPEAT_LABEL[t.repeat]} style={{ gap: ".2em" }}>
                        <Icon name="repeat" size="1em" />
                      </span>
                    )}
                    {t.project && <span className="chip">{t.project}</span>}
                    {t.due_at && (
                      <span>
                        {new Date(t.due_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                      </span>
                    )}
                  </div>
                </div>
                {!t.done && (
                  <button
                    className="b b-ghost b-sq b-sm"
                    style={selected === t.id ? { color: "var(--accent)" } : undefined}
                    title="Enfocar"
                    aria-label={`Enfocar ${t.title}`}
                    onClick={() => {
                      select(t.id);
                      onFocusTask();
                    }}
                  >
                    <Icon name="target" size="1em" />
                  </button>
                )}
                <button
                  className="b b-ghost b-sq b-sm"
                  title="Eliminar"
                  aria-label={`Eliminar ${t.title}`}
                  onClick={() => db.deleteTask(t.id)}
                >
                  <Icon name="trash" size="1em" />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
      {!shown.length && (
        <div className="stack center muted" style={{ paddingTop: "2em" }}>
          <Icon name="tasks" size="2em" />
          <span className="small">{onlyToday ? "Nada para hoy." : "Sin tareas. Escribe una arriba."}</span>
        </div>
      )}
    </div>
  );
}
