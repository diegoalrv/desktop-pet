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
});
