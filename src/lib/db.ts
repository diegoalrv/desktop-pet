import Database from "@tauri-apps/plugin-sql";
import { emit } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { updateSql, type Category, type Repeat, type Task } from "./tasks";
import { dueFromDate, parseAction } from "./suggestions";
import { call, post } from "./ipc";
import type { Segment } from "./focusCam";

/** En el navegador (web local) no hay Tauri: el mismo SQL viaja a la app por HTTP (src-tauri/src/web.rs). */
export const IS_WEB = !isTauri();

const api = <T>(op: "select" | "execute", sql: string, args: unknown[]) =>
  post<T>(`/api/${op}`, { sql, args });

// Las migraciones corren en Rust (src-tauri/migrations) al primer load.
let db: Promise<Database> | undefined;
const get = () => (db ??= Database.load("sqlite:pet.db"));
const select = async <T>(sql: string, args: unknown[] = []) =>
  IS_WEB ? api<T[]>("select", sql, args) : (await get()).select<T[]>(sql, args);
const exec = async (sql: string, args: unknown[] = []) => {
  if (IS_WEB) {
    await api("execute", sql, args); // la app avisa a sus ventanas
    return void window.dispatchEvent(new Event("db://changed")); // y esta pestaña recarga ya
  }
  await (await get()).execute(sql, args);
  emit("db://changed"); // otras ventanas recargan
};

/** Tramo de la cámara del foco (F17, migración 011). Sin `db://changed`: nadie lo muestra. */
export const logCamSegment = async (g: Segment) => {
  const avg = (r: [number, number, number] | null) => (r ? r[0] / g.n : null);
  const [p, y] = [g.pitch, g.yaw];
  await (await get()).execute(
    `INSERT INTO cam_segments (start, end, n, face, pitch, pitch_min, pitch_max, yaw, yaw_min, yaw_max, roll, phone,
       active, base, events) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [g.start, g.end, g.n, g.face ? 1 : 0, avg(p), p?.[1] ?? null, p?.[2] ?? null, avg(y), y?.[1] ?? null,
      y?.[2] ?? null, g.face ? g.roll / g.n : null, g.phone, g.active, g.base, g.events.join(",") || null],
  );
};

/** Consulta libre de solo lectura (vistas del panel web: historial, estadísticas). */
export const query = select;

export const listCategories = () => select<Category>("SELECT * FROM categories ORDER BY sort, id");
export const listTasks = () => select<Task>("SELECT * FROM tasks");

export interface NewTask {
  title: string;
  category_id: number | null;
  project: string | null;
  priority: number;
  due_at: number | null;
  est_pomodoros: number;
  repeat: Repeat;
}
export const addTask = (t: NewTask) =>
  exec(
    "INSERT INTO tasks (title, category_id, project, priority, due_at, est_pomodoros, repeat, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [t.title, t.category_id, t.project, t.priority, t.due_at, t.est_pomodoros, t.repeat, Date.now()],
  );
/** Edita un campo de la tarea (el nombre de columna sale del tipo, nunca del usuario). */
export const updateTask = <K extends keyof NewTask>(id: number, field: K, value: NewTask[K]) =>
  exec(updateSql(field), [value, id]);
export const renameTask = (id: number, title: string) =>
  exec("UPDATE tasks SET title = $1 WHERE id = $2", [title, id]);
/** Completar pasa por Rust (db.rs `task_set_done`): si la tarea se repite, crea la siguiente. Lo mismo hará el MCP. */
export const setDone = async (id: number, done: boolean) => {
  await call("task_set_done", { id, done }); // la app avisa a sus ventanas
  if (IS_WEB) window.dispatchEvent(new Event("db://changed")); // y esta pestaña recarga ya
};
export const deleteTask = (id: number) => exec("DELETE FROM tasks WHERE id = $1", [id]);
export const markNotified = (id: number) => exec("UPDATE tasks SET notified = 1 WHERE id = $1", [id]);

export const saveCategory = (c: Category) =>
  exec("UPDATE categories SET name = $1, color = $2, icon = $3 WHERE id = $4", [
    c.name,
    c.color,
    c.icon,
    c.id,
  ]);

// Las sesiones las registra el timer en Rust (src-tauri/src/db.rs).
export const focusCountSince = async (since: number) =>
  (
    await select<{ c: number }>("SELECT COUNT(*) AS c FROM sessions WHERE mode = 'focus' AND start >= $1", [
      since,
    ])
  )[0].c;

/** Segundos de foco por tarea desde `since` (ms epoch). task_id null = focos sin tarea. */
export const focusByTask = (since: number) =>
  select<{ task_id: number | null; secs: number }>(
    "SELECT task_id, SUM(end - start) / 1000 AS secs FROM sessions WHERE mode = 'focus' AND start >= $1 GROUP BY task_id",
    [since],
  );

/** Sesiones de foco que tocan [from, to) con el proyecto de su tarea ('' = sin proyecto). Se traen las que empiezan
 *  antes del rango y terminan dentro (y al revés): `pivot` las recorta. */
export const focusByProjectDay = (from: number, to: number) =>
  select<{ project: string; start: number; end: number }>(
    "SELECT COALESCE(t.project, '') AS project, s.start, s.end FROM sessions s LEFT JOIN tasks t ON t.id = s.task_id WHERE s.mode = 'focus' AND s.end > $1 AND s.start < $2",
    [from, to],
  );

export type ChatRow = {
  id: number;
  at: number;
  session: string | null;
  prompt: string;
  reply: string | null;
  tools: string | null;
  outcome: string;
  god: number;
};
/** Últimas órdenes desde `since` (epoch ms: cuándo se empezó el chat actual). */
export const chatHistory = (since = 0, limit = 30) =>
  select<ChatRow>(
    "SELECT * FROM (SELECT * FROM chat_log WHERE at > $1 ORDER BY id DESC LIMIT $2) ORDER BY id",
    [since, limit],
  );

export type Suggestion = {
  id: number;
  meeting: number;
  title: string;
  detail: string;
  status: "pending" | "accepted" | "dismissed";
  action: string | null; // modo gestión: JSON de lib/suggestions.ts `Action`; null = sugerencia de reunión
};
/** Tareas sugeridas por el LLM (meeting.rs las guarda al terminar cada reunión o sesión de gestión). */
export const listSuggestions = (status?: Suggestion["status"]) =>
  status
    ? select<Suggestion>("SELECT * FROM meeting_tasks WHERE status = $1 ORDER BY meeting DESC, id", [status])
    : select<Suggestion>("SELECT * FROM meeting_tasks ORDER BY meeting DESC, id");
/** Resumen y decisiones de cada reunión (meeting.rs, tabla meeting_notes); `decisions` es JSON. */
export type Notes = { meeting: number; summary: string; decisions: string; model: string; at: number };
export const listNotes = () => select<Notes>("SELECT * FROM meeting_notes");
export const decisionsOf = (n?: Notes): string[] => {
  try {
    return n ? JSON.parse(n.decisions) : [];
  } catch {
    return [];
  }
};
export const setSuggestion = (id: number, status: Suggestion["status"]) =>
  exec("UPDATE meeting_tasks SET status = $1 WHERE id = $2", [status, id]);
/** Aplica la sugerencia y la marca como aceptada: crea la tarea (título editable, proyecto opcional) o, en modo
 *  gestión, la acción que trae (crear con sus campos, editar los campos presentes, completar). */
export const acceptSuggestion = async (s: Suggestion, title = s.title, project: string | null = null) => {
  const a = parseAction(s.action);
  if (!a || a.op === "crear") {
    await addTask({
      title: a?.titulo ?? title,
      category_id: null,
      project: a?.proyecto ?? project,
      priority: a?.prioridad ?? 1,
      due_at: a?.fecha ? dueFromDate(a.fecha) : null,
      est_pomodoros: a?.pomodoros ?? 1,
      repeat: "none",
    });
  } else if (a.op === "completar") await setDone(a.id!, true);
  else {
    if (a.titulo) await renameTask(a.id!, a.titulo);
    if (a.proyecto) await updateTask(a.id!, "project", a.proyecto);
    if (a.prioridad != null) await updateTask(a.id!, "priority", a.prioridad);
    if (a.fecha) await updateTask(a.id!, "due_at", dueFromDate(a.fecha));
    if (a.pomodoros != null) await updateTask(a.id!, "est_pomodoros", a.pomodoros);
  }
  await setSuggestion(s.id, "accepted");
};

export type SessionRow = { id: number; start: number; end: number; mode: string; task_id: number | null };
export const listSessions = (since: number) =>
  select<SessionRow>("SELECT * FROM sessions WHERE start >= $1 ORDER BY start DESC", [since]);
export const deleteSession = async (id: number) => {
  await exec("DELETE FROM session_apps WHERE session_id = $1", [id]);
  await exec("DELETE FROM sessions WHERE id = $1", [id]);
};

/** Tiempo por app durante cada foco (F11, solo macOS); `hits` = veces que se abrió como distracción. */
export type AppUseRow = { session_id: number; start: number; bundle: string; name: string; secs: number; hits: number };
export const listAppUse = (since: number) =>
  select<AppUseRow>(
    "SELECT a.*, s.start FROM session_apps a JOIN sessions s ON s.id = a.session_id WHERE s.start >= $1",
    [since],
  );
