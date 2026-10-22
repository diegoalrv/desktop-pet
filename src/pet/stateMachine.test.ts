import { describe, expect, it } from "vitest";
import { initial, transition as t, type Ctx, type PetEvent } from "./stateMachine";

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
});
