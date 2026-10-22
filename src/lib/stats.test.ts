import { describe, expect, it } from "vitest";
import {
  byHour,
  byWeekday,
  dayStart,
  durTicks,
  isoDay,
  monthRange,
  perDay,
  pivot,
  roundTo,
  streak,
  toCsv,
  toMarkdown,
  weekRange,
} from "./stats";

const now = new Date(2026, 9, 20, 15).getTime();
const at = (ago: number, h = 10, min = 25) => {
  const start = dayStart(ago, now) + h * 3600_000;
  return { start, end: start + min * 60_000, mode: "focus" };
};

describe("stats", () => {
  it("suma el foco por día e ignora pausas", () => {
    const rows = [at(0), at(0), at(2), { ...at(0), mode: "short" }];
    expect(perDay(rows, 3, now).map((d) => d.secs)).toEqual([1500, 0, 3000]);
  });
  it("cuenta la racha desde hoy o desde ayer", () => {
    expect(streak([at(0), at(1), at(2), at(4)], now)).toBe(3);
    expect(streak([at(1), at(2)], now)).toBe(2);
    expect(streak([at(2)], now)).toBe(0);
    expect(streak([], now)).toBe(0);
  });
  it("agrupa por hora de inicio", () => {
    expect(byHour([at(0, 9), at(1, 9), at(0, 22)])[9]).toBe(3000);
  });
  it("eje Y con marcas redondas", () => {
    expect(durTicks(0)).toEqual([0, 300]);
    expect(durTicks(100 * 60)).toEqual([0, 1800, 3600, 5400, 7200]);
    expect(durTicks(7 * 3600)).toEqual([0, 7200, 14400, 21600, 28800]);
  });
  it("media por día de la semana, lunes primero", () => {
    const days = perDay([at(0), at(7)], 14, now); // 20 oct 2026 es martes
    expect(byWeekday(days)[1]).toBe(1500);
    expect(byWeekday(days)[0]).toBe(0);
  });
});

describe("informe por proyecto", () => {
  // martes 20-oct-2026 a jueves 22 (excluido): dos días
  const from = new Date(2026, 9, 20).getTime();
  const to = new Date(2026, 9, 22).getTime();
  const h = (day: number, hour: number, min = 0) => new Date(2026, 9, day, hour, min).getTime();

  it("agrupa por proyecto y día, sin proyecto al final", () => {
    const p = pivot(
      [
        { project: "", start: h(20, 9), end: h(20, 11) },
        { project: "Colbún", start: h(20, 10), end: h(20, 10, 30) },
        { project: "Colbún", start: h(21, 10), end: h(21, 11) },
        { project: "SIMBIO", start: h(21, 8), end: h(21, 8, 15) },
      ],
      from,
      to,
    );
    expect(p.days).toEqual([from, h(21, 0)]);
    expect(p.projects.map((r) => [r.name, r.days, r.total])).toEqual([
      ["Colbún", [1800, 3600], 5400],
      ["SIMBIO", [0, 900], 900],
      ["", [7200, 0], 7200],
    ]);
  });
  it("reparte entre días la sesión que cruza medianoche", () => {
    const p = pivot([{ project: "A", start: h(20, 23), end: h(21, 1, 30) }], from, to);
    expect(p.projects[0].days).toEqual([3600, 5400]);
  });
  it("recorta la sesión que se sale del rango por ambos lados", () => {
    const p = pivot(
      [
        { project: "A", start: h(19, 23), end: h(20, 1) }, // empezó antes: solo cuenta 1 h del 20
        { project: "A", start: h(21, 23), end: h(22, 2) }, // termina después: solo cuenta 1 h del 21
        { project: "B", start: h(22, 9), end: h(22, 10) }, // fuera del rango: no aparece
      ],
      from,
      to,
    );
    expect(p.projects.map((r) => [r.name, r.days])).toEqual([["A", [3600, 3600]]]);
  });
  it("redondea cada celda a 15 min y el total es la suma de las celdas", () => {
    expect(roundTo(7 * 60, 15)).toBe(0);
    expect(roundTo(8 * 60, 15)).toBe(900);
    expect(roundTo(40 * 60, 15)).toBe(2700);
    expect(roundTo(1234, 0)).toBe(1234);
    const p = pivot(
      [
        { project: "A", start: h(20, 9), end: h(20, 9, 40) },
        { project: "A", start: h(21, 9), end: h(21, 9, 20) },
      ],
      from,
      to,
      15,
    );
    expect(p.projects[0]).toMatchObject({ days: [2700, 900], total: 3600 });
  });
  it("semana (lunes primero) y mes", () => {
    const now = new Date(2026, 9, 22, 15).getTime(); // jueves
    expect(weekRange(0, now)).toEqual({ from: new Date(2026, 9, 19).getTime(), to: new Date(2026, 9, 26).getTime() });
    expect(weekRange(1, now)).toEqual({ from: new Date(2026, 9, 12).getTime(), to: new Date(2026, 9, 19).getTime() });
    expect(monthRange(now)).toEqual({ from: new Date(2026, 9, 1).getTime(), to: new Date(2026, 10, 1).getTime() });
    const sunday = new Date(2026, 9, 25, 23).getTime();
    expect(weekRange(0, sunday).from).toBe(new Date(2026, 9, 19).getTime());
  });
  it("exporta CSV y Markdown con totales", () => {
    const p = pivot(
      [
        { project: 'Co, "SA"', start: h(20, 9), end: h(20, 10, 30) },
        { project: "", start: h(21, 9), end: h(21, 10) },
      ],
      from,
      to,
    );
    expect(isoDay(from)).toBe("2026-10-20");
    expect(toCsv(p)).toBe(
      ["Proyecto,2026-10-20,2026-10-21,Total", '"Co, ""SA""",1.50,0.00,1.50', "Sin proyecto,0.00,1.00,1.00", "Total,1.50,1.00,2.50"].join("\n"),
    );
    expect(toMarkdown(p).split("\n")).toEqual([
      "| Proyecto | 2026-10-20 | 2026-10-21 | Total |",
      "| --- | ---: | ---: | ---: |",
      '| Co, "SA" | 1.50 | 0.00 | 1.50 |',
      "| Sin proyecto | 0.00 | 1.00 | 1.00 |",
      "| **Total** | 1.50 | 1.00 | **2.50** |",
    ]);
  });
});
