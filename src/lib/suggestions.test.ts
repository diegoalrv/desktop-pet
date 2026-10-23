import { describe, expect, it } from "vitest";
import { describeAction, dueFromDate, parseAction } from "./suggestions";
import type { Task } from "./tasks";

const task: Task = {
  id: 14,
  title: "Enviar propuesta",
  category_id: null,
  project: "Acme",
  priority: 1,
  done: 0,
  due_at: new Date(2026, 9, 20, 9).getTime(),
  est_pomodoros: 2,
  done_pomodoros: 0,
  notified: 0,
  created_at: 0,
  repeat: "none",
  done_at: null,
};

describe("suggestions", () => {
  it("parseAction: JSON válido con op conocida, si no null", () => {
    expect(parseAction('{"op":"completar","id":9}')).toEqual({ op: "completar", id: 9 });
    expect(parseAction('{"op":"borrar","id":9}')).toBeNull();
    expect(parseAction("{")).toBeNull();
    expect(parseAction(null)).toBeNull();
  });
  it("dueFromDate: fecha local a las 9:00", () => {
    expect(new Date(dueFromDate("2026-10-23")).toString()).toBe(new Date(2026, 9, 23, 9).toString());
  });
  it("describeAction: antes → después en editar, valores en crear", () => {
    expect(describeAction({ op: "editar", id: 14, fecha: "2026-10-23", prioridad: 2 }, [task])).toEqual([
      "prioridad Media → Alta",
      "fecha 20 oct → 23 oct",
    ]);
    expect(describeAction({ op: "completar", id: 14 }, [task])).toEqual(["✓ completar"]);
    expect(
      describeAction({ op: "crear", titulo: "Revisar deploy", proyecto: "pet", pomodoros: 2 }, []),
    ).toEqual(["+ nueva", "proyecto pet", "🍅 2"]);
  });
});
