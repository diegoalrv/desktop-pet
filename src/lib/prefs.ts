import { z } from "zod";

export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";

const mins = (def: number, max = 180) => z.coerce.number().int().min(1).max(max).catch(def);

export const prefsSchema = z.object({
  focusMin: mins(25),
  shortMin: mins(5),
  longMin: mins(15),
  longEvery: mins(4, 12),
  sound: z.boolean().catch(true),
  shortcut: z.string().min(1).catch(DEFAULT_SHORTCUT),
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
