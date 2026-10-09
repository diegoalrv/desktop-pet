import { describe, expect, it } from "vitest";
import { compareTasks, groupByCategory, isToday, needsReminder, type Category, type Task } from "./tasks";

const now = new Date(2026, 9, 8, 12, 0).getTime();
const mk = (o: Partial<Task>): Task => ({
  id: 1,
  title: "t",
  category_id: 1,
  priority: 1,
  done: 0,
  due_at: null,
  est_pomodoros: 1,
  done_pomodoros: 0,
  notified: 0,
  created_at: 0,
  ...o,
});

describe("tasks", () => {
  it("isToday: hoy o vencida, no mañana, no hecha", () => {
    expect(isToday(mk({ due_at: new Date(2026, 9, 8, 23, 0).getTime() }), now)).toBe(true);
    expect(isToday(mk({ due_at: new Date(2026, 9, 1).getTime() }), now)).toBe(true);
    expect(isToday(mk({ due_at: new Date(2026, 9, 9, 1, 0).getTime() }), now)).toBe(false);
    expect(isToday(mk({ due_at: now, done: 1 }), now)).toBe(false);
    expect(isToday(mk({}), now)).toBe(false);
  });
  it("needsReminder una sola vez", () => {
    expect(needsReminder(mk({ due_at: now - 1 }), now)).toBe(true);
    expect(needsReminder(mk({ due_at: now + 1 }), now)).toBe(false);
    expect(needsReminder(mk({ due_at: now - 1, notified: 1 }), now)).toBe(false);
    expect(needsReminder(mk({ due_at: now - 1, done: 1 }), now)).toBe(false);
  });
  it("orden: pendiente > prioridad > fecha", () => {
    const l = [
      mk({ id: 1, done: 1 }),
      mk({ id: 2, priority: 0 }),
      mk({ id: 3, priority: 2 }),
      mk({ id: 4, priority: 2, due_at: 5 }),
    ];
    expect(l.sort(compareTasks).map((t) => t.id)).toEqual([4, 3, 2, 1]);
  });
  it("agrupa por categoría y deja huérfanas al final", () => {
    const cats: Category[] = [
      { id: 1, name: "A", color: "", icon: "", sort: 0 },
      { id: 2, name: "B", color: "", icon: "", sort: 1 },
    ];
    const g = groupByCategory([mk({ id: 1, category_id: 2 }), mk({ id: 2, category_id: null })], cats);
    expect(g.map((x) => [x.cat?.name ?? null, x.tasks.length])).toEqual([
      ["B", 1],
      [null, 1],
    ]);
  });
});
