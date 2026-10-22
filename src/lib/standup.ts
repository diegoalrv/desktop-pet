import { dayStart, isoDay } from "./stats";
import { endOfDay, startOfDay, type Task } from "./tasks";
import { fmtDur } from "./time";

type Ses = { start: number; end: number; mode: string };
const focusSecs = (rows: Ses[], from: number, to: number) =>
  rows.filter((s) => s.mode === "focus" && s.start >= from && s.start < to).reduce((a, s) => a + (s.end - s.start) / 1000, 0);
const label = (t: Task) => (t.project ? `${t.title} (${t.project})` : t.title);

export interface DaySummary {
  focusCount: number;
  focusSecs: number;
  goalSecs: number;
  goalMet: boolean;
  done: Task[]; // completadas hoy
  overdue: Task[]; // con fecha ya cumplida y sin hacer
  pendingSuggestions: number;
}

/** Lo de hoy contra la meta diaria. `sessions` debe incluir al menos las de hoy. */
export function summarize(tasks: Task[], sessions: Ses[], pendingSuggestions: number, goalMin: number, now: number): DaySummary {
  const [from, to] = [startOfDay(now), endOfDay(now) + 1];
  const today = sessions.filter((s) => s.mode === "focus" && s.start >= from && s.start < to);
  const secs = focusSecs(sessions, from, to);
  return {
    focusCount: today.length,
    focusSecs: secs,
    goalSecs: goalMin * 60,
    goalMet: secs >= goalMin * 60,
    done: tasks.filter((t) => t.done && t.done_at != null && t.done_at >= from && t.done_at < to),
    overdue: tasks.filter((t) => !t.done && t.due_at != null && t.due_at < now),
    pendingSuggestions,
  };
}

/** Clave del "ya avisé hoy": se guarda en el store de ajustes. */
export const dayKey = isoDay;

/** Toca el aviso de cierre: está activo (hora > 0), ya pasó la hora, hubo actividad hoy y no se avisó todavía. */
export const shouldClose = (dayEndHour: number, now: number, lastClosed: string | undefined, s: DaySummary) =>
  dayEndHour > 0 &&
  new Date(now).getHours() >= dayEndHour &&
  lastClosed !== dayKey(now) &&
  (s.focusCount > 0 || s.done.length > 0);

/** Texto de la notificación de cierre. */
export const closeMessage = (s: DaySummary) =>
  `${s.focusCount} ${s.focusCount === 1 ? "foco" : "focos"} · ${fmtDur(s.focusSecs)} de ${fmtDur(s.goalSecs)}` +
  (s.goalMet ? " · ¡meta cumplida!" : "") +
  (s.done.length ? ` · ${s.done.length} ${s.done.length === 1 ? "tarea hecha" : "tareas hechas"}` : "");

/** Standup en texto plano: ayer (lo hecho y el foco), hoy (lo hecho y lo que falta con fecha de hoy) y bloqueos (vencidas). */
export function standupText(tasks: Task[], sessions: Ses[], now: number) {
  const [y0, t0, t1] = [dayStart(1, now), startOfDay(now), endOfDay(now) + 1];
  const doneIn = (from: number, to: number) =>
    tasks.filter((t) => t.done && t.done_at != null && t.done_at >= from && t.done_at < to);
  const focus = (from: number, to: number) => {
    const s = focusSecs(sessions, from, to);
    return s ? [`- Foco: ${fmtDur(s)}`] : [];
  };
  const list = (lines: string[]) => (lines.length ? lines : ["- Nada"]).join("\n");
  const yesterday = [...doneIn(y0, t0).map((t) => `- ✓ ${label(t)}`), ...focus(y0, t0)];
  const todayLines = [
    ...doneIn(t0, t1).map((t) => `- ✓ ${label(t)}`),
    ...tasks.filter((t) => !t.done && t.due_at != null && t.due_at >= now && t.due_at < t1).map((t) => `- ${label(t)}`),
    ...focus(t0, t1),
  ];
  const blocked = tasks
    .filter((t) => !t.done && t.due_at != null && t.due_at < now)
    .sort((a, b) => a.due_at! - b.due_at!)
    .map((t) => `- ${label(t)} (venció el ${new Date(t.due_at!).toLocaleDateString("es", { day: "numeric", month: "short" })})`);
  return `Ayer\n${list(yesterday)}\n\nHoy\n${list(todayLines)}\n\nBloqueos\n${list(blocked)}`;
}
