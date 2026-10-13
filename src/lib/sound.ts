import { invoke } from "@tauri-apps/api/core";

// Campanilla corta con WebAudio (sin assets). "rest" sube (descansa), "work" baja (a trabajar).
// Fuerte a propósito: marca el cambio de ciclo. Si `loud`, además sube el volumen del sistema (macOS)
// mientras suena. Si el webview la bloquea por política de autoplay, falla en silencio.
export async function chime(kind: "rest" | "work" = "rest", loud = true) {
  if (loud) await invoke("boost_volume", { secs: 3 }).catch(() => {});
  try {
    const ctx = new AudioContext();
    void ctx.resume();
    const notes = kind === "rest" ? [660, 880, 1320] : [1320, 880, 660];
    [...notes, ...notes].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.18;
      o.type = "triangle"; // más armónicos = más presencia que la senoidal
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.55);
    });
    setTimeout(() => ctx.close(), 2500);
  } catch {
    /* sin audio */
  }
}
