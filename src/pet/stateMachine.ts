export type PetState =
  | "idle"
  | "walk"
  | "focus"
  | "celebrate"
  | "break"
  | "sleep"
  | "dragged"
  | "fall"
  | "attention"
  | "work"
  | "mission"
  | "oops"
  | "ask" // Claude Code: trabajando, misión cumplida, falló, espera tu ok
  | "tea" // cierre del día sin cumplir la meta: un té tranquilo
  | "listen"; // le estás hablando (atajo de voz mantenido)

/** Cómo terminó una orden a Claude Code. */
export type ClaudeOutcome = "mission" | "oops" | "ask";

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
  | { type: "taskDone" }
  | { type: "distracted" } // abrió una app de la lista de distracciones durante el foco
  | { type: "panelOpen" } // se abrió el panel: quieta y atenta
  | { type: "panelClose" } // se cerró: sigue con lo suyo
  | { type: "claudeStart" }
  | { type: "claudeEnd"; outcome: ClaudeOutcome }
  | { type: "voiceStart" } // mantienes el atajo de voz: te escucha
  | { type: "voiceEnd" } // lo soltaste: vuelve a lo suyo (si la orden llega, Claude la pone a trabajar)
  | { type: "dayEnd"; met: boolean }; // cierre del día: meta cumplida -> celebra; si no, toma té

export interface Ctx {
  state: PetState;
  /** segundos restantes del estado actual (idle/celebrate); Infinity si no aplica */
  left: number;
  /** estado al que volver tras celebrate */
  after: PetState;
  /** segundos sin input (solo cuenta fuera de focus/break) */
  quiet: number;
  /** el panel está abierto: al quedar libre se queda en `attention` en vez de idle/walk */
  watching: boolean;
}

export const IDLE_MIN = 5;
export const IDLE_SPAN = 10; // 5-15 s
export const CELEBRATE_S = 2;
export const SLEEP_AFTER_S = 600;
export const DISTRACT_S = 3; // oops por una distracción en pleno foco
export const OUTCOME_S = 4; // misión cumplida / falló
export const ASK_S = 60; // esperando tu ok
export const TEA_S = 8; // té del cierre del día

/** Estados libres: Claude puede ponerla a trabajar (en foco/pausa no la interrumpe). */
const FREE: PetState[] = ["idle", "walk", "sleep", "attention", "work", "mission", "oops", "ask", "tea", "listen"];

/** oops por distracción: al terminar vuelve al foco (o a la pausa si el foco terminó mientras tanto). */
const backToTimer = (c: Ctx) => c.state === "oops" && (c.after === "focus" || c.after === "break");

const idleFor = (r: number) => IDLE_MIN + r * IDLE_SPAN;
const to = (c: Ctx, state: PetState, left = Infinity, after = c.after): Ctx => ({ ...c, state, left, after });
const goIdle = (c: Ctx, r: number) => (c.watching ? to(c, "attention") : to(c, "idle", idleFor(r)));

export const initial = (r = Math.random()): Ctx =>
  goIdle({ state: "idle", left: 0, after: "idle", quiet: 0, watching: false }, r);

/** Transición pura. `r` en [0,1) aporta la aleatoriedad (inyectable para tests). */
export function transition(c: Ctx, ev: PetEvent, r = Math.random()): Ctx {
  switch (ev.type) {
    case "drag":
      return c.state === "dragged"
        ? c
        : {
            ...to(c, "dragged", Infinity, c.state === "fall" || c.state === "celebrate" || backToTimer(c) ? c.after : c.state),
            quiet: 0,
          };
    case "drop":
      return c.state === "dragged" ? to(c, "fall") : c;
    case "land":
      if (c.state !== "fall") return c;
      return c.after === "focus" || c.after === "break" || c.after === "work" ? to(c, c.after) : goIdle(c, r);
    case "timerStart":
      return c.state === "dragged" || c.state === "fall"
        ? { ...c, after: "focus" }
        : { ...to(c, "focus"), quiet: 0 };
    case "breakStart":
      if (c.state === "dragged" || c.state === "fall") return { ...c, after: "break" };
      return c.state === "idle" || c.state === "walk" || c.state === "sleep" || c.state === "attention"
        ? { ...to(c, "break"), quiet: 0 }
        : c;
    case "timerStop":
      if (c.state === "focus" || c.state === "break") return goIdle(c, r);
      if (backToTimer(c)) return { ...c, after: "idle" };
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
    case "distracted":
      return c.state === "focus" ? to(c, "oops", DISTRACT_S, "focus") : c;
    case "panelOpen": {
      const w = { ...c, watching: true, quiet: 0 };
      return w.state === "idle" || w.state === "walk" || w.state === "sleep" ? to(w, "attention") : w;
    }
    case "panelClose": {
      const w = { ...c, watching: false };
      return w.state === "attention" ? goIdle(w, r) : w;
    }
    case "claudeStart":
      if (c.state === "dragged" || c.state === "fall" || c.state === "celebrate")
        return { ...c, after: "work" };
      return FREE.includes(c.state) ? { ...to(c, "work"), quiet: 0 } : c;
    case "claudeEnd":
      if (c.state === "work") return to(c, ev.outcome, ev.outcome === "ask" ? ASK_S : OUTCOME_S, "attention");
      return c.after === "work" ? { ...c, after: "attention" } : c; // terminó mientras la arrastraban
    case "voiceStart":
      return FREE.includes(c.state) ? { ...to(c, "listen"), quiet: 0 } : c;
    case "voiceEnd":
      return c.state === "listen" ? goIdle(c, r) : c;
    case "dayEnd":
      if (ev.met) return transition(c, { type: "taskDone" }, r);
      return FREE.includes(c.state) ? { ...to(c, "tea", TEA_S, "attention"), quiet: 0 } : c;
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
      if (backToTimer(c)) return to({ ...c, quiet }, c.after);
      if (c.state === "mission" || c.state === "oops" || c.state === "ask" || c.state === "tea") return goIdle({ ...c, quiet }, r);
      if (c.state === "celebrate")
        return c.after === "walk" || c.after === "attention"
          ? goIdle({ ...c, quiet }, r)
          : to({ ...c, quiet }, c.after);
      return { ...c, left, quiet };
    }
  }
}
