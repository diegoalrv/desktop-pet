import { describe, expect, it } from "vitest";
import { CALIB_N, initCam, REBARK_MS, step, type CamEvent, type CamState, type Sample } from "./focusCam";

const P = { headDownDeg: 20, barkAfterSec: 15, awayPauseSec: 90 };
const T0 = 1_000_000;
const ok: Omit<Sample, "now"> = { face: true, pitch: 0, phone: false, idle: 0 };
const down = { ...ok, pitch: 30, idle: 999 };
const phone = { ...ok, phone: true };

/** Corre muestras cada 2 s desde `t` y junta los eventos con su instante. */
function run(s: CamState, t: number, samples: Omit<Sample, "now">[]) {
  const out: [number, CamEvent][] = [];
  for (const x of samples) {
    const r = step(s, { ...x, now: t }, P);
    s = r.state;
    r.events.forEach((e) => out.push([t - T0, e]));
    t += 2000;
  }
  return { s, t, out, types: out.map(([, e]) => e.type) };
}
const n = <T>(k: number, x: T) => Array<T>(k).fill(x);

describe("focusCam", () => {
  it("cabeza abajo 3 s sin input -> growl; con input no", () => {
    expect(run(initCam(), T0, n(3, down)).out).toEqual([[4000, { type: "growl" }]]);
    expect(run(initCam(), T0, n(10, { ...down, idle: 1 })).types).toEqual([]);
  });
  it("teléfono: 1 frame no dispara, 2 seguidos sí (aunque teclee y con la cabeza derecha)", () => {
    expect(run(initCam(), T0, [phone, ok, phone, ok]).types).toEqual([]);
    expect(run(initCam(), T0, [phone, phone]).types).toEqual(["growl"]);
  });
  it("volver antes de barkAfterSec: calm sin bark ni tiempo", () => {
    const r = run(initCam(), T0, [phone, phone, phone, ok, ok]);
    expect(r.types).toEqual(["growl", "calm"]);
    expect(r.out[1][1]).toEqual({ type: "calm", ms: 0 });
  });
  it("pasado el umbral ladra una vez, de nuevo a los 30 s, y calm reporta el resto", () => {
    // growl a los 2 s; bark a los 2+15 s -> muestra de los 18 s
    const r = run(initCam(), T0, [...n(10 + REBARK_MS / 2000, phone), ok, ok]);
    const barks = r.out.filter(([, e]) => e.type === "bark");
    expect(barks).toEqual([
      [18000, { type: "bark", first: true, ms: 16000 }],
      [48000, { type: "bark", first: false, ms: 30000 }],
    ]);
    expect(r.out[r.out.length - 1]).toEqual([52000, { type: "calm", ms: 4000 }]);
  });
  it("calibra la postura normal mientras usa el computador", () => {
    // cámara mirando desde arriba: 15° de base; 30° es solo 15 más -> no gruñe; 40° sí
    const cal = run(initCam(), T0, [...n(5, down), ...n(CALIB_N, { ...ok, pitch: 15 })]);
    expect(cal.s.pitches).toEqual(n(CALIB_N, 15)); // lo de cabeza abajo sin input no calibra
    expect(run(cal.s, cal.t, n(5, { ...down, pitch: 30 })).types).toEqual([]);
    expect(run(cal.s, cal.t, n(5, { ...down, pitch: 40 })).types).toEqual(["growl"]);
    // completa la calibración, lo que viene después no mueve la base
    expect(run(cal.s, cal.t, n(60, { ...ok, pitch: 40 })).s.pitches).toEqual(cal.s.pitches);
  });
  it("ausencia: corta no pausa; larga pausa una sola vez; volver avisa", () => {
    const gone = { ...ok, face: false, pitch: null };
    expect(run(initCam(), T0, [ok, gone, ok, ...n(20, gone)]).types).toEqual([]);
    const r = run(initCam(), T0, [ok, ...n(60, gone), ok]);
    expect(r.types).toEqual(["away", "back"]);
    expect(r.out[0][0]).toBe(92000); // primera muestra sin cara a los 2 s + 90 s
  });
  it("el teléfono delante de la cara no cuenta como irse", () => {
    const r = run(initCam(), T0, n(60, { ...phone, face: false, pitch: null }));
    expect(r.types).not.toContain("away");
    expect(r.types[0]).toBe("growl");
  });
  it("irse en plena distracción la cierra antes de pausar", () => {
    const r = run(initCam(), T0, [...n(12, down), ...n(50, { ...ok, face: false, pitch: null })]);
    expect(r.types).toEqual(["growl", "bark", "calm", "away"]);
  });
});
