import { z } from "zod";
import type { PetState } from "../pet/stateMachine";

// Nombres planos: sin "/" ni "..", así un zip no puede escribir fuera de la carpeta del skin.
const file = z.string().regex(/^[\w.-]+\.(png|webp|gif|jpe?g)$/i);
const anim = z.object({
  file,
  frames: z.number().int().min(1),
  fps: z.number().positive().default(8),
  loop: z.boolean().default(true),
});

export const manifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  name: z.string().min(1).max(60),
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
  scale: z.number().positive().default(1),
  animations: z.record(z.string(), anim).refine((a) => "idle" in a, { message: "falta la animación idle" }),
  walkSpeed: z.number().positive().default(40),
  groundOffset: z.number().default(0),
});
export type Manifest = z.infer<typeof manifestSchema>;
export type Anim = z.infer<typeof anim>;

export const parseManifest = (json: unknown): Manifest => manifestSchema.parse(json);

const ANIM_OF: Record<PetState, string> = {
  idle: "idle",
  walk: "walk",
  focus: "focus",
  celebrate: "celebrate",
  sleep: "sleep",
  dragged: "dragged",
  fall: "dragged",
  break: "idle",
  attention: "idle",
};

/** Animación para un estado; si el skin no la trae, usa `idle`. */
export function resolveAnim(m: Manifest, state: PetState): { key: string; anim: Anim } {
  const want = ANIM_OF[state];
  return want in m.animations
    ? { key: want, anim: m.animations[want] }
    : { key: "idle", anim: m.animations.idle };
}

/** Ánimos: variantes por estado que se alternan cada MOOD_S. Con música van las musicales.
 *  Solo se usan las que el skin trae; si no trae ninguna, cae a `resolveAnim`. */
export const MOOD_S = 12;
const ROCK = ["guitar", "drums", "maracas"]; // los skins traen batería o maracas
const MOODS: Partial<Record<PetState, { calm: string[]; music: string[] }>> = {
  idle: { calm: ["idle"], music: ROCK },
  break: { calm: ["tea", "idle"], music: ["tea", ...ROCK] },
  focus: { calm: ["focus", "read", "write"], music: ["listen", "read", "listen", "write"] },
};

export function pickAnim(m: Manifest, state: PetState, music: boolean, slot: number) {
  const mood = MOODS[state];
  const list = (mood ? (music ? mood.music : mood.calm) : []).filter((k) => k in m.animations);
  if (!list.length) return resolveAnim(m, state);
  const key = list[slot % list.length];
  return { key, anim: m.animations[key] };
}

/** Fracción vacía arriba del sprite (filas totalmente transparentes) en un RGBA de w×h. */
export function topInset(rgba: Uint8ClampedArray, w: number, h: number) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3]) return y / h;
  return 0;
}

/** Pack para una imagen única: todas las animaciones la reutilizan (1 frame) y el movimiento es CSS. */
export function singleImageManifest(
  id: string,
  name: string,
  imgFile: string,
  w: number,
  h: number,
): Manifest {
  const a = { file: imgFile, frames: 1, fps: 8, loop: true };
  return parseManifest({
    id,
    name,
    frameWidth: w,
    frameHeight: h,
    scale: Math.min(1, 128 / Math.max(w, h)),
    animations: { idle: a, walk: a, focus: a, celebrate: a, sleep: a, dragged: a },
  });
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "skin";

/** Quita la carpeta raíz común de un zip y descarta basura (__MACOSX, dotfiles, directorios). */
export function normalizeZipPaths(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const names = Object.keys(files).filter(
    (n) => !n.endsWith("/") && !n.startsWith("__MACOSX/") && !n.split("/").pop()!.startsWith("."),
  );
  const roots = new Set(names.map((n) => (n.includes("/") ? n.split("/")[0] : "")));
  const strip = roots.size === 1 && !roots.has("") ? roots.values().next().value + "/" : "";
  return Object.fromEntries(names.map((n) => [n.slice(strip.length), files[n]]));
}
