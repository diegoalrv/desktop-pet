export interface Category {
  id: number;
  name: string;
  color: string;
  icon: string;
  sort: number;
}
export interface Task {
  id: number;
  title: string;
  category_id: number | null;
  project: string | null; // frente al que pertenece (texto libre)
  priority: number; // 0 baja, 1 media, 2 alta
  done: number;
  due_at: number | null; // ms epoch
  est_pomodoros: number;
  done_pomodoros: number;
  notified: number;
  created_at: number;
}

export const PRIORITIES = ["Baja", "Media", "Alta"] as const;

export const startOfDay = (now: number) => new Date(now).setHours(0, 0, 0, 0);
export const endOfDay = (now: number) => new Date(now).setHours(23, 59, 59, 999);

/** Pendiente con fecha de hoy o vencida (vista "Hoy"). */
export const isToday = (t: Task, now: number) => !t.done && t.due_at != null && t.due_at <= endOfDay(now);

/** Con fecha ya cumplida, sin avisar y sin terminar: toca recordatorio. */
export const needsReminder = (t: Task, now: number) =>
  !t.done && !t.notified && t.due_at != null && t.due_at <= now;

/** Pendientes primero, luego prioridad alta, luego fecha más cercana, luego antigüedad. */
export const compareTasks = (a: Task, b: Task) =>
  a.done - b.done ||
  b.priority - a.priority ||
  (a.due_at ?? Infinity) - (b.due_at ?? Infinity) ||
  a.id - b.id;

export function groupByCategory(tasks: Task[], cats: Category[]) {
  const sorted = [...tasks].sort(compareTasks);
  const groups = cats.map((cat) => ({
    cat: cat as Category | null,
    tasks: sorted.filter((t) => t.category_id === cat.id),
  }));
  const rest = sorted.filter((t) => !cats.some((c) => c.id === t.category_id));
  if (rest.length) groups.push({ cat: null, tasks: rest });
  return groups.filter((g) => g.tasks.length);
}

/** Proyectos distintos en uso, ordenados (para autocompletar y filtrar). */
export const projectsOf = (tasks: Task[]) =>
  [...new Set(tasks.map((t) => t.project).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b));
