// Cámara durante el foco (F17): lógica pura. Cada ~2 s llega una muestra (cara, inclinación, teléfono a la vista,
// segundos sin teclado ni mouse) y sale qué hacer: gruñir, ladrar, calmarse, pausar por ausencia o avisar al volver.

export interface Sample {
  face: boolean;
  pitch: number | null; // grados, positivo = cabeza hacia abajo
  phone: boolean; // teléfono visto en esta muestra
  idle: number; // s sin teclado ni mouse
  now: number; // ms
}

export interface CamPrefs {
  headDownDeg: number;
  barkAfterSec: number;
  awayPauseSec: number;
}

export type CamEvent =
  | { type: "growl" } // aviso: no cuenta como distracción
  | { type: "bark"; first: boolean; ms: number } // cuenta (first) y suma `ms` de distracción desde el último reporte
  | { type: "calm"; ms: number } // se acabó la distracción; `ms` sin reportar (0 si nunca ladró)
  | { type: "away" } // sin cara `awayPauseSec`: pausar el foco
  | { type: "back" }; // volvió después de un `away`

export interface CamState {
  pitches: number[]; // calibración: primeras muestras usando el computador
  downSince: number | null; // cabeza abajo sin input desde
  phoneRun: number; // muestras seguidas con teléfono
  phoneGone: number; // muestras seguidas sin teléfono
  phoneOn: boolean;
  since: number | null; // distracción en curso desde (gruñó)
  barked: number | null; // último ladrido
  reported: number; // hasta dónde se reportó el tiempo de distracción
  noFace: number | null; // sin cara desde
  away: boolean;
}

export const CALIB_N = 30; // ~1 min de muestras tecleando o con el mouse
const ACTIVE_S = 3; // input hace menos de esto = está usando el computador
export const HEAD_MS = 3_000; // cabeza abajo sin input antes de gruñir
export const REBARK_MS = 30_000;
const PHONE_SAMPLES = 2; // muestras seguidas para encender/apagar "teléfono a la vista"

export const initCam = (): CamState => ({
  pitches: [],
  downSince: null,
  phoneRun: 0,
  phoneGone: 0,
  phoneOn: false,
  since: null,
  barked: null,
  reported: 0,
  noFace: null,
  away: false,
});

const median = (xs: number[]) => {
  if (!xs.length) return 0; // ponytail: sin calibrar se asume cámara de frente (pitch 0)
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function step(prev: CamState, x: Sample, p: CamPrefs): { state: CamState; events: CamEvent[] } {
  const s: CamState = { ...prev };
  const events: CamEvent[] = [];
  const { now } = x;

  // Calibración: postura normal = mediana del pitch mientras usa el computador (no mientras mira el teléfono).
  if (x.face && x.pitch !== null && x.idle < ACTIVE_S && s.pitches.length < CALIB_N)
    s.pitches = [...s.pitches, x.pitch];
  const base = median(s.pitches);

  // Teléfono a la vista, con histéresis para que un frame suelto no prenda ni apague.
  s.phoneRun = x.phone ? s.phoneRun + 1 : 0;
  s.phoneGone = x.phone ? 0 : s.phoneGone + 1;
  if (s.phoneRun >= PHONE_SAMPLES) s.phoneOn = true;
  if (s.phoneGone >= PHONE_SAMPLES) s.phoneOn = false;

  // Cabeza abajo sin teclado ni mouse: la ventana arranca en el último input.
  const down = x.face && x.pitch !== null && x.pitch - base >= p.headDownDeg;
  s.downSince = down ? Math.max(s.downSince ?? now, now - x.idle * 1000) : null;
  const head = s.downSince !== null && now - s.downSince >= HEAD_MS;

  const endDistraction = () => {
    if (s.since === null) return;
    events.push({ type: "calm", ms: s.barked !== null ? now - s.reported : 0 });
    s.since = s.barked = null;
  };

  // Presencia (el teléfono delante de la cara también la tapa: eso no es irse).
  if (x.face || s.phoneOn) {
    s.noFace = null;
    if (s.away) {
      s.away = false;
      events.push({ type: "back" });
    }
  } else {
    s.noFace ??= now;
    if (!s.away && now - s.noFace >= p.awayPauseSec * 1000) {
      endDistraction();
      s.away = true;
      events.push({ type: "away" });
    }
  }
  if (s.away) return { state: s, events };

  if (!(head || s.phoneOn)) {
    endDistraction();
    return { state: s, events };
  }
  if (s.since === null) {
    s.since = now;
    events.push({ type: "growl" });
  } else if (s.barked === null ? now - s.since >= p.barkAfterSec * 1000 : now - s.barked >= REBARK_MS) {
    events.push({
      type: "bark",
      first: s.barked === null,
      ms: now - (s.barked === null ? s.since : s.reported),
    });
    s.barked = s.reported = now;
  }
  return { state: s, events };
}
