// Campanilla corta con WebAudio (sin assets). "rest" sube (descansa), "work" baja (a trabajar).
// Si el webview la bloquea por política de autoplay, falla en silencio.
export function chime(kind: "rest" | "work" = "rest") {
  try {
    const ctx = new AudioContext();
    void ctx.resume();
    (kind === "rest" ? [660, 880, 1320] : [1320, 880, 660]).forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.18;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.55);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    /* sin audio */
  }
}
