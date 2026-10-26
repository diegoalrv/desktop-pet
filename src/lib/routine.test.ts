import { describe, expect, it } from "vitest";
import { classicBlocks, fmtMin, insert, move, totals, usable, type Activity, type Step } from "./routine";

const act = (id: number, kind: Activity["kind"], min: number): Activity => ({
  id,
  name: `a${id}`,
  kind,
  min,
  emoji: "",
  color: "#000",
  archived: 0,
  sort: 0,
});
const byId = new Map([act(1, "focus", 25), act(2, "break", 5), act(4, "break", 10)].map((a) => [a.id, a]));

describe("rutinas", () => {
  it("suma la vuelta de Constanza con un bloque pisado", () => {
    const steps: Step[] = [
      { activity_id: 1, min: null },
      { activity_id: 2, min: null },
      { activity_id: 1, min: null },
      { activity_id: 4, min: 12 },
    ];
    expect(totals(steps, byId)).toEqual({ focus: 50, rest: 17, all: 67 });
    expect(usable(steps, byId)).toBe(true);
    expect(usable([{ activity_id: 2, min: null }], byId)).toBe(false);
  });

  it("reordena e inserta", () => {
    expect(move(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(move(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(move(["a", "b", "c"], 0, 9)).toEqual(["b", "c", "a"]); // más allá del final: al final
    expect(move(["a"], 5, 0)).toEqual(["a"]);
    expect(insert(["a", "b"], "x", 1)).toEqual(["a", "x", "b"]);
    expect(insert(["a", "b"], "x")).toEqual(["a", "b", "x"]);
  });

  it("formatea minutos", () => {
    expect(fmtMin(50)).toBe("50 min");
    expect(fmtMin(60)).toBe("1 h");
    expect(fmtMin(65)).toBe("1 h 05 min");
  });

  it("arma la vuelta clásica: 25/5 x4 con la cuarta pausa de 20", () => {
    const b = classicBlocks({ focus_min: 25, short_min: 5, long_min: 20, long_every: 4, auto_cycle: true });
    expect(b.map((x) => `${x.mode}${x.min}`).join(" ")).toBe(
      "focus25 short5 focus25 short5 focus25 short5 focus25 long20",
    );
    expect(
      classicBlocks({ focus_min: 50, short_min: 5, long_min: 15, long_every: 1, auto_cycle: false }),
    ).toEqual([
      { mode: "focus", min: 50 },
      { mode: "long", min: 15 },
    ]);
  });
});
