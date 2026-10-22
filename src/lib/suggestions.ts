import { PRIORITIES, type Task } from "./tasks";

/** Acción del modo gestión (meeting.rs `Action`), guardada como JSON en meeting_tasks.action. */
export interface Action {
  op: "crear" | "editar" | "completar";
  id?: number;
  titulo?: string;
  proyecto?: string;
  prioridad?: number;
  fecha?: string; // AAAA-MM-DD
  pomodoros?: number;
  detalle?: string;
}

export const parseAction = (json: string | null | undefined): Action | null => {
  if (!json) return null;
  try {
    const a = JSON.parse(json) as Action;
    return ["crear", "editar", "completar"].includes(a?.op) ? a : null;
  } catch {
    return null;
  }
};

/** "AAAA-MM-DD" → ms epoch local. ponytail: a las 9:00, para que el recordatorio salga en la mañana. */
export const dueFromDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day, 9, 0).getTime();
};

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("es", { day: "numeric", month: "short" });

/** Qué cambia, para la lista de aprobación: "fecha 20 oct → 23 oct", "prioridad media → alta", "✓ completar". */
export function describeAction(a: Action, tasks: Task[]): string[] {
  const t = tasks.find((x) => x.id === a.id);
  const arrow = (before: string | null | undefined, after: string) =>
    before ? `${before} → ${after}` : after;
  if (a.op === "completar") return ["✓ completar"];
  const out: string[] = [];
  if (a.op === "editar" && a.titulo) out.push(`título ${arrow(t?.title, a.titulo)}`);
  if (a.proyecto) out.push(`proyecto ${a.op === "editar" ? arrow(t?.project, a.proyecto) : a.proyecto}`);
  if (a.prioridad != null) {
    const after = PRIORITIES[a.prioridad] ?? String(a.prioridad);
    out.push(`prioridad ${a.op === "editar" ? arrow(t && PRIORITIES[t.priority], after) : after}`);
  }
  if (a.fecha)
    out.push(
      `fecha ${a.op === "editar" ? arrow(t?.due_at ? fmtDay(t.due_at) : null, fmtDay(dueFromDate(a.fecha))) : fmtDay(dueFromDate(a.fecha))}`,
    );
  if (a.pomodoros != null)
    out.push(
      `🍅 ${a.op === "editar" ? arrow(t && String(t.est_pomodoros), String(a.pomodoros)) : a.pomodoros}`,
    );
  if (a.op === "crear") out.unshift("+ nueva");
  return out;
}
