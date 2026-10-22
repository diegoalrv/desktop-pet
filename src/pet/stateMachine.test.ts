import { describe, expect, it } from "vitest";
import { initial, TEA_S, transition as t, type Ctx, type PetEvent } from "./stateMachine";

const run = (c: Ctx, ...evs: PetEvent[]) => evs.reduce((acc, e) => t(acc, e, 0.5), c);
const tick = (dt: number): PetEvent => ({ type: "tick", dt });

describe("stateMachine", () => {
  it("idle -> walk tras 5-15 s -> idle al llegar", () => {
    const c = run(initial(0), tick(5.1));
    expect(c.state).toBe("walk");
    expect(run(c, { type: "arrive" }).state).toBe("idle");
  });
  it("idle no camina antes de tiempo", () => {
    expect(run(initial(1), tick(14)).state).toBe("idle");
  });
  it("drag -> drop -> land vuelve a idle", () => {
    const c = run(initial(), { type: "drag" });
    expect(c.state).toBe("dragged");
    const f = run(c, { type: "drop" });
    expect(f.state).toBe("fall");
    expect(run(f, { type: "land" }).state).toBe("idle");
  });
  it("foco: start -> focus; end -> celebrate -> break -> idle", () => {
    let c = run(initial(), { type: "timerStart" });
    expect(c.state).toBe("focus");
    c = run(c, { type: "timerEnd" });
    expect(c.state).toBe("celebrate");
    c = run(c, tick(2.1));
    expect(c.state).toBe("break");
    expect(run(c, { type: "timerEnd" }).state).toBe("idle");
  });
  it("focus no se duerme ni camina", () => {
    expect(run(initial(), { type: "timerStart" }, tick(5000)).state).toBe("focus");
  });
  it("taskDone celebra 2 s y vuelve al estado previo", () => {
    const c = run(initial(), { type: "timerStart" }, { type: "taskDone" });
    expect(c.state).toBe("celebrate");
    expect(run(c, tick(2.1)).state).toBe("focus");
  });
  it("10 min sin input -> sleep; input despierta", () => {
    const c = run(initial(), tick(300), tick(301));
    expect(c.state).toBe("sleep");
    expect(run(c, { type: "input" }).state).toBe("idle");
  });
  it("distracción en foco: ladra 3 s y vuelve a focus; fuera del foco no hace nada", () => {
    let c = run(initial(), { type: "timerStart" }, { type: "distracted" });
    expect(c.state).toBe("bark");
    expect(run(c, tick(2.9)).state).toBe("bark");
    expect(run(c, tick(3.1)).state).toBe("focus");
    expect(run(initial(), { type: "distracted" }).state).not.toBe("bark");
    // el foco termina durante los ladridos: sigue a la pausa; reset durante los ladridos: idle
    c = run(c, { type: "timerEnd" });
    expect(run(c, tick(3.1)).state).toBe("break");
    c = run(initial(), { type: "timerStart" }, { type: "distracted" }, { type: "timerStop" });
    expect(run(c, tick(3.1)).state).toBe("idle");
  });
  it("teléfono (cámara): gruñe 3 s y vuelve a focus; si cuenta, ladra; fuera del foco nada", () => {
    const c = run(initial(), { type: "timerStart" }, { type: "growl" });
    expect(c.state).toBe("growl");
    expect(run(c, tick(3.1)).state).toBe("focus");
    expect(run(c, { type: "distracted" }).state).toBe("bark");
    expect(run(c, { type: "distracted" }, { type: "growl" }).state).toBe("bark"); // no baja de ladrar a gruñir
    expect(run(c, { type: "timerEnd" }, { type: "distracted" }, tick(3.1)).state).toBe("break");
    expect(run(initial(), { type: "growl" }).state).toBe("idle");
  });
  it("ausencia (cámara): focus -> away; back -> focus; reset estando ausente -> idle", () => {
    const c = run(initial(), { type: "timerStart" }, { type: "away" });
    expect(c.state).toBe("away");
    expect(run(c, tick(700), { type: "input" }, { type: "panelOpen" }).state).toBe("away");
    expect(run(c, { type: "back" }).state).toBe("focus");
    expect(run(c, { type: "timerStop" }, { type: "back" }).state).toBe("idle");
    for (const type of ["distracted", "growl"] as const)
      expect(run(initial(), { type: "timerStart" }, { type }, { type: "away" }).state).toBe("away");
    expect(run(initial(), { type: "away" }).state).toBe("idle"); // fuera del foco no hace nada
    expect(run(initial(), { type: "back" }).state).toBe("idle");
    expect(run(initial(), tick(300), tick(301), { type: "back" }).state).toBe("sleep"); // dormida de verdad: no la despierta
    // arrastrarla estando ausente: vuelve a esperar; reset mientras tanto: idle
    const drag = [{ type: "drag" }, { type: "drop" }] as PetEvent[];
    expect(run(c, ...drag, { type: "land" }).state).toBe("away");
    expect(run(c, ...drag, { type: "timerStop" }, { type: "land" }).state).toBe("idle");
  });
  it("arrastrarla durante los ladridos o el gruñido no pierde el foco", () => {
    for (const type of ["distracted", "growl"] as const) {
      const c = run(initial(), { type: "timerStart" }, { type }, { type: "drag" }, { type: "drop" });
      expect(run(c, { type: "land" }).state).toBe("focus");
    }
  });
  it("drag mientras focus: tras land vuelve a focus", () => {
    const c = run(initial(), { type: "timerStart" }, { type: "drag" }, { type: "drop" }, { type: "land" });
    expect(c.state).toBe("focus");
  });
  it("pausa a mano y reset", () => {
    let c = run(initial(), { type: "breakStart" });
    expect(c.state).toBe("break");
    c = run(c, { type: "timerStop" });
    expect(c.state).toBe("idle");
  });
  it("reset mientras la arrastran vuelve a idle", () => {
    const c = run(
      initial(),
      { type: "timerStart" },
      { type: "drag" },
      { type: "timerStop" },
      { type: "drop" },
      { type: "land" },
    );
    expect(c.state).toBe("idle");
  });
  it("panel abierto: quieta y atenta; al cerrar vuelve a idle", () => {
    let c = run(initial(0), { type: "panelOpen" });
    expect(c.state).toBe("attention");
    expect(run(c, tick(300)).state).toBe("attention"); // ni camina ni se duerme
    c = run(c, { type: "panelClose" });
    expect(c.state).toBe("idle");
    expect(run(c, tick(10.1)).state).toBe("walk"); // r=0.5 -> espera de 10 s
  });
  it("panel abierto mientras camina o duerme: se queda quieta", () => {
    const walking = run(initial(0), tick(5.1));
    expect(run(walking, { type: "panelOpen" }).state).toBe("attention");
    const asleep = run(initial(), tick(300), tick(301));
    expect(run(asleep, { type: "panelOpen" }).state).toBe("attention");
  });
  it("focus no cambia con el panel; al terminar con el panel abierto queda atenta", () => {
    let c = run(initial(), { type: "timerStart" }, { type: "panelOpen" });
    expect(c.state).toBe("focus");
    c = run(c, { type: "timerStop" });
    expect(c.state).toBe("attention");
    expect(run(c, { type: "panelClose" }).state).toBe("idle");
  });
  it("celebrate con panel abierto vuelve a atenta y al cerrar a idle (no se queda pegada)", () => {
    let c = run(initial(), { type: "panelOpen" }, { type: "taskDone" }, tick(2.1));
    expect(c.state).toBe("attention");
    c = run(initial(), { type: "panelOpen" }, { type: "taskDone" }, { type: "panelClose" }, tick(2.1));
    expect(c.state).toBe("idle");
  });
  it("arrastrada estando atenta: al soltar vuelve a atenta o idle según el panel", () => {
    const base = run(initial(), { type: "panelOpen" }, { type: "drag" }, { type: "drop" });
    expect(run(base, { type: "land" }).state).toBe("attention");
    expect(run(base, { type: "panelClose" }, { type: "land" }).state).toBe("idle");
  });
  it("arrastrada mientras celebra una tarea en foco: al aterrizar sigue en foco (no camina)", () => {
    const c = run(
      initial(),
      { type: "timerStart" },
      { type: "taskDone" },
      { type: "drag" },
      { type: "drop" },
      { type: "land" },
    );
    expect(c.state).toBe("focus");
    expect(run(c, tick(60)).state).toBe("focus");
  });
  it("Claude: trabaja, termina (misión/falló/espera ok) y vuelve; en foco no la interrumpe", () => {
    const start: PetEvent = { type: "claudeStart" };
    const end = (outcome: "mission" | "oops" | "ask"): PetEvent => ({ type: "claudeEnd", outcome });
    let c = run(initial(), { type: "panelOpen" }, start);
    expect(c.state).toBe("work");
    expect(run(c, tick(700)).state).toBe("work"); // no se duerme trabajando
    c = run(c, end("mission"));
    expect(c.state).toBe("mission");
    expect(run(c, tick(4.1)).state).toBe("attention");
    expect(run(initial(), start, end("ask"), tick(59)).state).toBe("ask");
    expect(run(initial(), start, end("oops"), tick(4.1)).state).toBe("idle");
    expect(run(initial(), { type: "timerStart" }, start).state).toBe("focus");
    // termina mientras la arrastran: al aterrizar no queda pegada trabajando
    expect(
      run(initial(), start, { type: "drag" }, end("mission"), { type: "drop" }, { type: "land" }).state,
    ).toBe("idle");
  });
  it("cierre del día: celebra si cumplió la meta, toma té si no, sin interrumpir foco ni arrastre", () => {
    const meta = run(initial(), { type: "dayEnd", met: true });
    expect(meta.state).toBe("celebrate");
    expect(run(meta, tick(2.1)).state).toBe("idle");
    const te = run(initial(), { type: "dayEnd", met: false });
    expect(te.state).toBe("tea");
    expect(run(te, tick(TEA_S + 0.1)).state).toBe("idle");
    expect(run(initial(), { type: "timerStart" }, { type: "dayEnd", met: false }).state).toBe("focus");
    expect(run(initial(), { type: "drag" }, { type: "dayEnd", met: false }).state).toBe("dragged");
  });
  it("voz: escucha mientras mantienes el atajo, sin interrumpir el foco ni el arrastre", () => {
    const on: PetEvent = { type: "voiceStart" };
    const off: PetEvent = { type: "voiceEnd" };
    const c = run(initial(), on);
    expect(c.state).toBe("listen");
    expect(run(c, tick(700)).state).toBe("listen"); // no se duerme ni camina mientras le hablas
    expect(run(c, off).state).toBe("idle");
    expect(run(initial(), { type: "panelOpen" }, on, off).state).toBe("attention");
    expect(run(c, off, { type: "claudeStart" }).state).toBe("work");
    expect(run(initial(), { type: "timerStart" }, on).state).toBe("focus");
    expect(run(initial(), { type: "drag" }, on, off).state).toBe("dragged");
  });
});
