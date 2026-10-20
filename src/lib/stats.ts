import { startOfDay } from "./tasks";

type Ses = { start: number; end: number; mode: string };
const focusSecs = (s: Ses) => (s.mode === "focus" ? (s.end - s.start) / 1000 : 0);

/** Medianoche local de hace `ago` días (con setDate, así los cambios de horario no corren el día). */
export const dayStart = (ago: number, now = Date.now()) => {
  const d = new Date(startOfDay(now));
  d.setDate(d.getDate() - ago);
  return d.getTime();
};

/** Segundos de foco por día en los últimos `days` días, del más antiguo a hoy. */
export function perDay(rows: Ses[], days: number, now = Date.now()) {
  const m = new Map<number, number>();
  rows.forEach((r) => m.set(startOfDay(r.start), (m.get(startOfDay(r.start)) ?? 0) + focusSecs(r)));
  return Array.from({ length: days }, (_, i) => {
    const day = dayStart(days - 1 - i, now);
    return { day, secs: m.get(day) ?? 0 };
  });
}

/** Días seguidos con al menos un foco, hasta hoy (o ayer si hoy todavía no hay). */
export function streak(rows: Ses[], now = Date.now()) {
  const days = new Set(rows.filter((r) => r.mode === "focus").map((r) => startOfDay(r.start)));
  let ago = days.has(dayStart(0, now)) ? 0 : 1;
  while (days.has(dayStart(ago, now))) ago++;
  return days.has(dayStart(0, now)) ? ago : ago - 1;
}

/** Segundos de foco según la hora del día en que empezó (0–23). */
export function byHour(rows: Ses[]) {
  const h = Array<number>(24).fill(0);
  rows.forEach((r) => (h[new Date(r.start).getHours()] += focusSecs(r)));
  return h;
}

const STEPS = [5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 720, 1440].map((m) => m * 60);
/** Marcas "redondas" del eje Y para duraciones en segundos (≤ 4 tramos): [0, 30m, 1h, 1h 30m]. */
export function durTicks(max: number) {
  const step = STEPS.find((s) => s * 4 >= max) ?? Math.ceil(max / 4 / 3600) * 3600;
  return Array.from({ length: Math.max(1, Math.ceil(max / step)) + 1 }, (_, i) => i * step);
}

/** Media de foco por día de la semana (lunes primero), a partir de perDay. */
export function byWeekday(days: { day: number; secs: number }[]) {
  const sum = Array<number>(7).fill(0);
  const n = Array<number>(7).fill(0);
  days.forEach((d) => {
    const w = (new Date(d.day).getDay() + 6) % 7;
    sum[w] += d.secs;
    n[w]++;
  });
  return sum.map((s, i) => (n[i] ? s / n[i] : 0));
}
