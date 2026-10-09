import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import * as db from "../lib/db";
import { groupByCategory, isToday, PRIORITIES } from "../lib/tasks";
import { useTasks } from "../store/useTasks";
import { btn } from "./ui";

const tiny = { ...btn, padding: "2px 6px", border: 0, background: "transparent" } as const;

export function TaskList({ focusKey, onFocusTask }: { focusKey: number; onFocusTask: () => void }) {
  const { tasks, cats, today, selected, select } = useTasks();
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState<number | null>(null);
  const [prio, setPrio] = useState(1);
  const [est, setEst] = useState(1);
  const [due, setDue] = useState("");
  const [onlyToday, setOnlyToday] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editCats, setEditCats] = useState(false);

  useEffect(() => input.current?.focus(), [focusKey]);
  const catId = cat ?? cats[0]?.id ?? null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await db.addTask({
      title: title.trim(),
      category_id: catId,
      priority: prio,
      est_pomodoros: est,
      due_at: due ? new Date(due).getTime() : null,
    });
    setTitle("");
    setDue("");
  };

  const now = Date.now();
  const shown = onlyToday ? tasks.filter((t) => isToday(t, now)) : tasks;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <form onSubmit={add} style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            ref={input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nueva tarea…"
            style={{ ...btn, flex: 1, minWidth: 0 }}
          />
          <button style={btn}>Añadir</button>
        </div>
        <div style={{ display: "flex", gap: 6, fontSize: 12 }}>
          <select
            value={catId ?? ""}
            onChange={(e) => setCat(Number(e.target.value))}
            style={{ ...btn, padding: 4, flex: 1, minWidth: 0 }}
          >
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <select
            value={prio}
            onChange={(e) => setPrio(Number(e.target.value))}
            style={{ ...btn, padding: 4 }}
          >
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
            style={{ ...btn, padding: 4, width: 44 }}
          />
        </div>
        <input
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          title="Fecha y hora (recordatorio)"
          style={{ ...btn, padding: 4, fontSize: 12 }}
        />
      </form>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
        <span>
          🍅 Hoy: <b>{today}</b>
        </span>
        <span>
          <button style={{ ...tiny, fontWeight: onlyToday ? 400 : 700 }} onClick={() => setOnlyToday(false)}>
            Todas
          </button>
          <button style={{ ...tiny, fontWeight: onlyToday ? 700 : 400 }} onClick={() => setOnlyToday(true)}>
            Hoy
          </button>
          <button style={tiny} title="Editar categorías" onClick={() => setEditCats(!editCats)}>
            ⚙
          </button>
        </span>
      </div>

      {editCats &&
        cats.map((c) => (
          <div key={c.id} style={{ display: "flex", gap: 6 }}>
            <input
              defaultValue={c.icon}
              onBlur={(e) => db.saveCategory({ ...c, icon: e.target.value })}
              style={{ ...btn, width: 36, padding: 4 }}
            />
            <input
              defaultValue={c.name}
              onBlur={(e) => db.saveCategory({ ...c, name: e.target.value })}
              style={{ ...btn, flex: 1, minWidth: 0, padding: 4 }}
            />
            <input
              type="color"
              defaultValue={c.color}
              onBlur={(e) => db.saveCategory({ ...c, color: e.target.value })}
              style={{ width: 36, border: 0, background: "none" }}
            />
          </div>
        ))}

      {groupByCategory(shown, cats).map(({ cat: c, tasks: ts }) => (
        <div key={c?.id ?? "none"}>
          <div style={{ fontSize: 12, fontWeight: 700, color: c?.color ?? "#888", margin: "4px 0" }}>
            {c ? `${c.icon} ${c.name}` : "Sin categoría"}
          </div>
          {ts.map((t) => (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 0",
                borderLeft: `3px solid ${["#bbb", "#e8a33c", "#e8523c"][t.priority]}`,
                paddingLeft: 6,
              }}
            >
              <input
                type="checkbox"
                checked={!!t.done}
                onChange={async (e) => {
                  await db.setDone(t.id, e.target.checked);
                  if (e.target.checked) emit("task://done");
                }}
              />
              {editing === t.id ? (
                <input
                  autoFocus
                  defaultValue={t.title}
                  onBlur={async (e) => {
                    if (e.target.value.trim()) await db.renameTask(t.id, e.target.value.trim());
                    setEditing(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  style={{ ...btn, flex: 1, minWidth: 0, padding: 2 }}
                />
              ) : (
                <span
                  onDoubleClick={() => setEditing(t.id)}
                  style={{
                    flex: 1,
                    textDecoration: t.done ? "line-through" : "none",
                    opacity: t.done ? 0.5 : 1,
                    fontSize: 13,
                  }}
                >
                  {t.title}
                  <small style={{ color: "#888" }}>
                    {" "}
                    {t.done_pomodoros}/{t.est_pomodoros}🍅
                    {t.due_at
                      ? ` · ${new Date(t.due_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
                      : ""}
                  </small>
                </span>
              )}
              {!t.done && (
                <button
                  style={{ ...tiny, outline: selected === t.id ? "2px solid #e8523c" : "none" }}
                  title="Enfocar"
                  onClick={() => {
                    select(t.id);
                    onFocusTask();
                  }}
                >
                  🎯
                </button>
              )}
              <button style={tiny} title="Eliminar" onClick={() => db.deleteTask(t.id)}>
                🗑
              </button>
            </div>
          ))}
        </div>
      ))}
      {!shown.length && <div style={{ color: "#888", textAlign: "center", fontSize: 13 }}>Sin tareas.</div>}
    </div>
  );
}
