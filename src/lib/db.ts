import Database from "@tauri-apps/plugin-sql";
import { emit } from "@tauri-apps/api/event";
import type { Category, Task } from "./tasks";

// Las migraciones corren en Rust (src-tauri/migrations) al primer load.
let db: Promise<Database> | undefined;
const get = () => (db ??= Database.load("sqlite:pet.db"));
const select = async <T>(sql: string, args: unknown[] = []) => (await get()).select<T[]>(sql, args);
const exec = async (sql: string, args: unknown[] = []) => {
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

export async function recordSession(s: { start: number; end: number; mode: string; task_id: number | null }) {
  await exec("INSERT INTO sessions (start, end, mode, task_id) VALUES ($1,$2,$3,$4)", [
    s.start,
    s.end,
    s.mode,
    s.task_id,
  ]);
  if (s.mode === "focus" && s.task_id != null)
    await exec("UPDATE tasks SET done_pomodoros = done_pomodoros + 1 WHERE id = $1", [s.task_id]);
}
export const focusCountSince = async (since: number) =>
  (
    await select<{ c: number }>("SELECT COUNT(*) AS c FROM sessions WHERE mode = 'focus' AND start >= $1", [
      since,
    ])
  )[0].c;
