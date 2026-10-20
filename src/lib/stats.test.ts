import { describe, expect, it } from "vitest";
import { byHour, dayStart, perDay, streak } from "./stats";

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
});
