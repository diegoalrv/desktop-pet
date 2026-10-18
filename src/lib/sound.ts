// Campanillas suaves con WebAudio (sin assets), inspiradas en las de Toggl Track:
// "work" (a trabajar) = arpegio tipo marimba que sube; "rest" (descansa) = baja y resuelve en un acorde grave.
// [segundo de inicio, Hz, duración, volumen relativo]
type Note = [number, number, number, number];
const SONGS: Record<"rest" | "work", Note[]> = {
  work: [
    [0.0, 1760, 0.6, 0.5],
    [0.22, 440, 0.8, 0.9],
    [0.44, 1175, 0.6, 0.55],
    [0.66, 587, 0.8, 0.8],
    [0.88, 988, 1.1, 0.7],
  ],
  rest: [
    [0.0, 2217, 0.5, 0.4],
    [0.2, 1760, 0.5, 0.45],
    [0.4, 1480, 0.6, 0.5],
    [0.6, 220, 1.9, 0.6],
    [0.6, 277, 1.9, 0.6],
    [0.6, 440, 1.7, 0.45],
  ],
};
const GAIN = 0.22; // ponytail: volumen a oído; súbelo si no se escucha sobre la música

// Suena a volumen fijo, sin tocar el del sistema ni la música.
// Si el webview la bloquea por política de autoplay, falla en silencio.
export function chime(kind: "rest" | "work" = "rest") {
  try {
    const ctx = new AudioContext();
    void ctx.resume();
    const out = ctx.createGain();
    out.gain.value = GAIN;
    out.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.05;
    for (const [at, f, dur, vol] of SONGS[kind]) {
      // Fundamental senoidal + 4º parcial que se apaga rápido: "plink" de marimba, sin aspereza.
      for (const [mult, v, d] of [[1, vol, dur], [4, vol * 0.15, dur * 0.25]]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const t = t0 + at;
        o.frequency.value = f * mult;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(v, t + 0.015); // ataque suave, sin clic
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + d + 0.05);
      }
    }
    setTimeout(() => ctx.close(), 3500);
  } catch {
    /* sin audio */
  }
}
