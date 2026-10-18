import { z } from "zod";

export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";
export const PET_SIZE = { min: 64, max: 320, def: 128 };

const mins = (def: number, max = 180) => z.coerce.number().int().min(1).max(max).catch(def);

export const prefsSchema = z.object({
  focusMin: mins(25),
  shortMin: mins(5),
  longMin: mins(15),
  longEvery: mins(4, 12),
  autoCycle: z.boolean().catch(true),
  sound: z.boolean().catch(true),
  shortcut: z.string().min(1).catch(DEFAULT_SHORTCUT),
  icalUrl: z.string().trim().catch(""), // "Dirección secreta en formato iCal" de Google Calendar
  // LLM que saca las tareas de la reunión al terminar: cualquier API compatible con OpenAI (Gemini, Claude, Ollama)
  llmUrl: z.string().trim().min(1).catch("https://generativelanguage.googleapis.com/v1beta/openai"),
  llmModel: z.string().trim().min(1).catch("gemini-3.8-flash"),
  llmKey: z.string().trim().catch(""),
  // Carpeta desde la que corre Claude Code en el chat (lee su CLAUDE.md: VPS, Coolify, etc.); vacía = home
  claudeCwd: z.string().trim().catch(""),
  petSize: z.coerce.number().int().min(PET_SIZE.min).max(PET_SIZE.max).catch(PET_SIZE.def), // alto en pantalla (px lógicos)
});
export type Prefs = z.infer<typeof prefsSchema>;

/** Valida lo guardado: cada campo inválido o ausente vuelve a su valor por defecto. */
export const normalizePrefs = (raw: unknown): Prefs =>
  prefsSchema.parse(raw && typeof raw === "object" ? raw : {});

/** Atajo en formato de Tauri a partir de un keydown; null si no hay tecla final o falta modificador. */
export function accelFromEvent(
  e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): string | null {
  if (/^(Meta|Control|Alt|Shift)/.test(e.code)) return null;
  const mods = [
    e.metaKey || e.ctrlKey ? "CommandOrControl" : "",
    e.altKey ? "Alt" : "",
    e.shiftKey ? "Shift" : "",
  ].filter(Boolean);
  if (!mods.length) return null;
  return [...mods, e.code.replace(/^Key|^Digit/, "")].join("+");
}
