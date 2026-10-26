// Rutinas (F18): ciclos propios hechos de actividades. El timer las lee en Rust (db.rs::active_routine);
// esto es lo que necesita el editor de la web.

export type Kind = "focus" | "break";

export interface Activity {
  id: number;
  name: string;
  kind: Kind;
  min: number;
  emoji: string;
  color: string;
  archived: number;
  sort: number;
}

export interface Routine {
  id: number;
  name: string;
  active: number;
}

/** Un bloque de la rutina: la actividad y, si se pisó en esta rutina, sus minutos. */
export interface Step {
  activity_id: number;
  min: number | null;
}

export const stepMin = (s: Step, a?: Activity) => s.min ?? a?.min ?? 0;

/** Minutos por vuelta, separados en foco y pausa. */
export function totals(steps: Step[], byId: Map<number, Activity>) {
  let focus = 0;
  let rest = 0;
  for (const s of steps) {
    const a = byId.get(s.activity_id);
    if (a?.kind === "focus") focus += stepMin(s, a);
    else rest += stepMin(s, a);
  }
  return { focus, rest, all: focus + rest };
}

/** Mueve el elemento `from` a la posición `to` (la del elemento sobre el que se soltó). */
export function move<T>(xs: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= xs.length) return xs;
  const out = xs.slice();
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, x);
  return out;
}

/** Inserta en `at` (al final si es -1). */
export const insert = <T>(xs: T[], x: T, at = -1) =>
  at < 0 ? [...xs, x] : [...xs.slice(0, at), x, ...xs.slice(at)];

/** Sin al menos un foco, el timer ignora la rutina y usa el esquema clásico (igual que db.rs). */
export const usable = (steps: Step[], byId: Map<number, Activity>) =>
  steps.some((s) => byId.get(s.activity_id)?.kind === "focus");

/** "1 h 05 min", "50 min". */
export const fmtMin = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")} min` : ""}` : `${m} min`;

/** Tiempos del ciclo clásico de Ajustes (comando `timer_classic`). */
export interface Classic {
  focus_min: number;
  short_min: number;
  long_min: number;
  long_every: number;
  auto_cycle: boolean;
}

/** Una vuelta del ciclo clásico: `long_every` focos con pausa corta entre ellos y la larga al final. */
export function classicBlocks(c: Classic): { mode: "focus" | "short" | "long"; min: number }[] {
  return Array.from({ length: c.long_every }, (_, i) => [
    { mode: "focus" as const, min: c.focus_min },
    i < c.long_every - 1
      ? { mode: "short" as const, min: c.short_min }
      : { mode: "long" as const, min: c.long_min },
  ]).flat();
}
