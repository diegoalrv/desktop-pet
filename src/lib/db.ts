import Database from "@tauri-apps/plugin-sql";
import { emit } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import type { Category, Task } from "./tasks";

/** En el navegador (web local) no hay Tauri: el mismo SQL viaja a la app por HTTP (src-tauri/src/web.rs). */
export const IS_WEB = !isTauri();

const api = async <T>(op: "select" | "execute", sql: string, args: unknown[]) => {
  const r = await fetch(`/api/${op}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, args }),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as T;
};

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

export const listCategories = () => select<Category>("SELECT * FROM categories ORDER BY sort, id");
export const listTasks = () => select<Task>("SELECT * FROM tasks");

export interface NewTask {
  title: string;
  category_id: number | null;
  project: string | null;
  priority: number;
  due_at: number | null;
  est_pomodoros: number;
}
export const addTask = (t: NewTask) =>
  exec(
    "INSERT INTO tasks (title, category_id, project, priority, due_at, est_pomodoros, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [t.title, t.category_id, t.project, t.priority, t.due_at, t.est_pomodoros, Date.now()],
  );
/** Edita un campo de la tarea (el nombre de columna sale del tipo, nunca del usuario). */
export const updateTask = <K extends keyof NewTask>(id: number, field: K, value: NewTask[K]) =>
  exec(`UPDATE tasks SET ${field} = $1 WHERE id = $2`, [value, id]);
export const renameTask = (id: number, title: string) =>
  exec("UPDATE tasks SET title = $1 WHERE id = $2", [title, id]);
export const setDone = (id: number, done: boolean) =>
  exec("UPDATE tasks SET done = $1 WHERE id = $2", [done ? 1 : 0, id]);
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

export type ChatRow = { id: number; at: number; session: string | null; prompt: string; reply: string | null; tools: string | null; outcome: string; god: number };
/** Últimas órdenes desde `since` (epoch ms: cuándo se empezó el chat actual). */
export const chatHistory = (since = 0, limit = 30) =>
  select<ChatRow>("SELECT * FROM (SELECT * FROM chat_log WHERE at > $1 ORDER BY id DESC LIMIT $2) ORDER BY id", [since, limit]);
