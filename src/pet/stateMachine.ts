export type PetState = "idle" | "walk" | "focus" | "celebrate" | "break" | "sleep" | "dragged" | "fall";

export type PetEvent =
  | { type: "tick"; dt: number }
  | { type: "arrive" }
  | { type: "drag" }
  | { type: "drop" }
  | { type: "land" }
  | { type: "input" }
  | { type: "timerStart" } // arranca un foco
  | { type: "breakStart" } // arranca una pausa a mano
  | { type: "timerStop" } // reset / fin de pausa: vuelve a idle
  | { type: "timerEnd" } // fin de foco -> celebrate -> break; fin de break -> idle
  | { type: "taskDone" };

export interface Ctx {
  state: PetState;
  /** segundos restantes del estado actual (idle/celebrate); Infinity si no aplica */
  left: number;
  /** estado al que volver tras celebrate */
  after: PetState;
  /** segundos sin input (solo cuenta fuera de focus/break) */
  quiet: number;
}

export const IDLE_MIN = 5;
export const IDLE_SPAN = 10; // 5-15 s
export const CELEBRATE_S = 2;
export const SLEEP_AFTER_S = 600;

const idleFor = (r: number) => IDLE_MIN + r * IDLE_SPAN;
const to = (c: Ctx, state: PetState, left = Infinity, after = c.after): Ctx => ({ ...c, state, left, after });
const goIdle = (c: Ctx, r: number) => to(c, "idle", idleFor(r));

export const initial = (r = Math.random()): Ctx =>
  goIdle({ state: "idle", left: 0, after: "idle", quiet: 0 }, r);

/** Transición pura. `r` en [0,1) aporta la aleatoriedad (inyectable para tests). */
export function transition(c: Ctx, ev: PetEvent, r = Math.random()): Ctx {
  switch (ev.type) {
    case "drag":
      return c.state === "dragged"
        ? c
        : { ...to(c, "dragged", Infinity, c.state === "fall" ? c.after : c.state), quiet: 0 };
    case "drop":
      return c.state === "dragged" ? to(c, "fall") : c;
    case "land":
      if (c.state !== "fall") return c;
      return c.after === "focus" || c.after === "break" ? to(c, c.after) : goIdle(c, r);
    case "timerStart":
      return c.state === "dragged" || c.state === "fall"
        ? { ...c, after: "focus" }
        : { ...to(c, "focus"), quiet: 0 };
    case "breakStart":
      if (c.state === "dragged" || c.state === "fall") return { ...c, after: "break" };
      return c.state === "idle" || c.state === "walk" || c.state === "sleep"
        ? { ...to(c, "break"), quiet: 0 }
        : c;
    case "timerStop":
      if (c.state === "focus" || c.state === "break") return goIdle(c, r);
      return (c.state === "dragged" || c.state === "fall") && (c.after === "focus" || c.after === "break")
        ? { ...c, after: "idle" }
        : c;
    case "timerEnd":
      if (c.state === "focus") return to(c, "celebrate", CELEBRATE_S, "break");
      if (c.state === "break") return goIdle(c, r);
      if (c.after === "focus") return { ...c, after: "break" }; // terminó mientras la arrastraban
      return c;
    case "taskDone": {
      if (c.state === "dragged" || c.state === "fall" || c.state === "celebrate") return c;
      return to(c, "celebrate", CELEBRATE_S, c.state === "sleep" ? "idle" : c.state);
    }
    case "input":
      return c.state === "sleep" ? goIdle({ ...c, quiet: 0 }, r) : { ...c, quiet: 0 };
    case "arrive":
      return c.state === "walk" ? goIdle(c, r) : c;
    case "tick": {
      const resting = c.state === "idle" || c.state === "walk";
      const quiet = resting ? c.quiet + ev.dt : c.quiet;
      if (resting && quiet >= SLEEP_AFTER_S) return to({ ...c, quiet }, "sleep");
      const left = c.left - ev.dt;
      if (left > 0) return { ...c, left, quiet };
      if (c.state === "idle") return { ...to(c, "walk"), quiet };
      if (c.state === "celebrate")
        return c.after === "walk" ? goIdle({ ...c, quiet }, r) : to({ ...c, quiet }, c.after);
      return { ...c, left, quiet };
    }
  }
}
