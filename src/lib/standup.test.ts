import { describe, expect, it } from "vitest";
import { closeMessage, shouldClose, standupText, summarize } from "./standup";
import type { Task } from "./tasks";

const now = new Date(2026, 9, 22, 18, 30).getTime(); // jueves
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();
const mk = (o: Partial<Task>): Task => ({
  id: 1,
  title: "t",
  category_id: null,
  project: null,
  priority: 1,
  done: 0,
  due_at: null,
  est_pomodoros: 1,
  done_pomodoros: 0,
  notified: 0,
  created_at: 0,
  repeat: "none",
  done_at: null,
  ...o,
});
const focus = (day: number, h: number, min: number) => ({ start: at(day, h), end: at(day, h, min), mode: "focus" });

describe("standup", () => {
  const tasks = [
    mk({ id: 1, title: "Enviar propuesta", project: "Colbún", done: 1, done_at: at(21, 16) }),
    mk({ id: 2, title: "Revisar informe", done: 1, done_at: at(22, 11) }),
    mk({ id: 3, title: "Llamar a Acme", due_at: at(22, 20) }), // hoy, aún no vence
    mk({ id: 4, title: "Pagar patente", due_at: at(20, 9) }), // vencida
    mk({ id: 5, title: "Vencida pero hecha", done: 1, done_at: at(20, 10), due_at: at(19, 9) }),
  ];
  const sessions = [focus(21, 9, 50), focus(22, 9, 25), focus(22, 10, 25), { ...focus(22, 12, 5), mode: "short" }];

  it("summarize: focos, meta, hechas hoy y vencidas", () => {
    const s = summarize(tasks, sessions, 2, 50, now);
    expect(s).toMatchObject({ focusCount: 2, focusSecs: 3000, goalSecs: 3000, goalMet: true, pendingSuggestions: 2 });
    expect(s.done.map((t) => t.id)).toEqual([2]);
    expect(s.overdue.map((t) => t.id)).toEqual([4]);
    expect(summarize(tasks, sessions, 0, 51, now).goalMet).toBe(false);
  });
  it("shouldClose: pasó la hora, hubo actividad y no se avisó hoy", () => {
    const s = summarize(tasks, sessions, 0, 120, now);
    const vacio = summarize([], [], 0, 120, now);
    expect(shouldClose(18, now, undefined, s)).toBe(true);
    expect(shouldClose(18, now, "2026-10-21", s)).toBe(true);
    expect(shouldClose(18, now, "2026-10-22", s)).toBe(false); // ya avisó hoy
    expect(shouldClose(19, now, undefined, s)).toBe(false); // todavía no es la hora
    expect(shouldClose(0, now, undefined, s)).toBe(false); // apagado
    expect(shouldClose(18, now, undefined, vacio)).toBe(false); // sin actividad
    expect(shouldClose(18, now, undefined, summarize([tasks[1]], [], 0, 120, now))).toBe(true); // solo tareas hechas
  });
  it("closeMessage", () => {
    expect(closeMessage(summarize(tasks, sessions, 0, 50, now))).toBe("2 focos · 50m de 50m · ¡meta cumplida! · 1 tarea hecha");
    expect(closeMessage(summarize([], [focus(22, 9, 25)], 0, 120, now))).toBe("1 foco · 25m de 2h 00m");
  });
  it("standupText: ayer, hoy y bloqueos", () => {
    expect(standupText(tasks, sessions, now)).toBe(
      [
        "Ayer",
        "- ✓ Enviar propuesta (Colbún)",
        "- Foco: 50m",
        "",
        "Hoy",
        "- ✓ Revisar informe",
        "- Llamar a Acme",
        "- Foco: 50m",
        "",
        "Bloqueos",
        `- Pagar patente (venció el ${new Date(at(20, 9)).toLocaleDateString("es", { day: "numeric", month: "short" })})`,
      ].join("\n"),
    );
    expect(standupText([], [], now)).toBe("Ayer\n- Nada\n\nHoy\n- Nada\n\nBloqueos\n- Nada");
  });
});
