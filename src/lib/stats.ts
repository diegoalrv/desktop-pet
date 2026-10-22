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

// ---- Informe de horas por proyecto (web/Report.tsx) ----

export type ProjectRow = { project: string; start: number; end: number };
export type Pivot = { days: number[]; projects: { name: string; days: number[]; total: number }[] };

const nextDay = (ms: number) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + 1);
  return d.getTime();
};

/** Redondea segundos al múltiplo más cercano de `minutes` (0 = sin redondeo). Para facturar por cuartos de hora. */
export const roundTo = (secs: number, minutes: number) =>
  minutes > 0 ? Math.round(secs / (minutes * 60)) * minutes * 60 : secs;

/** Segundos de foco por proyecto y día en [from, to). La sesión que cruza medianoche se reparte entre los días y la
 *  que empieza antes de `from` o termina después de `to` se recorta. `round` (minutos) redondea cada celda y el total
 *  es la suma de las celdas redondeadas, así la tabla cuadra. Proyecto '' = sin proyecto (va al final). */
export function pivot(rows: ProjectRow[], from: number, to: number, round = 0): Pivot {
  const days: number[] = [];
  for (let d = startOfDay(from); d < to; d = nextDay(d)) days.push(d);
  const at = new Map(days.map((d, i) => [d, i]));
  const cells = new Map<string, number[]>();
  for (const r of rows) {
    const mine = cells.get(r.project) ?? cells.set(r.project, Array<number>(days.length).fill(0)).get(r.project)!;
    for (let s = Math.max(r.start, from), e = Math.min(r.end, to); s < e; ) {
      const next = Math.min(nextDay(startOfDay(s)), e);
      mine[at.get(startOfDay(s))!] += (next - s) / 1000;
      s = next;
    }
  }
  const projects = [...cells]
    .map(([name, secs]) => {
      const d = secs.map((x) => roundTo(x, round));
      return { name, days: d, total: d.reduce((a, b) => a + b, 0) };
    })
    .filter((p) => p.total > 0)
    .sort((a, b) => +(a.name === "") - +(b.name === "") || b.total - a.total || a.name.localeCompare(b.name));
  return { days, projects };
}

/** Lunes 00:00 de la semana de `now`, desplazada `weeksAgo` semanas, y el lunes siguiente (excluido). */
export function weekRange(weeksAgo = 0, now = Date.now()) {
  const d = new Date(startOfDay(now));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * weeksAgo);
  const from = d.getTime();
  d.setDate(d.getDate() + 7);
  return { from, to: d.getTime() };
}

/** Primer día del mes de `now` y el primero del siguiente (excluido). */
export const monthRange = (now = Date.now()) => {
  const d = new Date(now);
  return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
};

/** aaaa-mm-dd en hora local (toISOString daría el día UTC). */
export const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const hours = (secs: number) => (secs / 3600).toFixed(2);
const NO_PROJECT = "Sin proyecto";

/** Tabla del informe en CSV: una fila por proyecto, horas decimales por día y total; última fila con los totales. */
export function toCsv(p: Pivot) {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const sums = p.days.map((_, i) => p.projects.reduce((a, r) => a + r.days[i], 0));
  const grand = p.projects.reduce((a, r) => a + r.total, 0);
  const line = (name: string, d: number[], t: number) => [q(name), ...d.map(hours), hours(t)].join(",");
  return [
    ["Proyecto", ...p.days.map(isoDay), "Total"].join(","),
    ...p.projects.map((r) => line(r.name || NO_PROJECT, r.days, r.total)),
    line("Total", sums, grand),
  ].join("\n");
}

/** Lo mismo en una tabla Markdown. */
export function toMarkdown(p: Pivot) {
  const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const sums = p.days.map((_, i) => p.projects.reduce((a, r) => a + r.days[i], 0));
  const grand = p.projects.reduce((a, r) => a + r.total, 0);
  return [
    row(["Proyecto", ...p.days.map(isoDay), "Total"]),
    row(["---", ...p.days.map(() => "---:"), "---:"]),
    ...p.projects.map((r) => row([(r.name || NO_PROJECT).replace(/\|/g, "\\|"), ...r.days.map(hours), hours(r.total)])),
    row(["**Total**", ...sums.map(hours), `**${hours(grand)}**`]),
  ].join("\n");
}
