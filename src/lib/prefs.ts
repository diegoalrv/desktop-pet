import { z } from "zod";

export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";
export const DEFAULT_FOCUS_SHORTCUT = "CommandOrControl+Shift+F";
export const PET_SIZE = { min: 64, max: 320, def: 128 };

/** Un proveedor con sus modelos en orden: si uno falla (sobrecarga, cuota…) se prueba el siguiente.
 * `provider`: "gemini" | "claude" | "openai" | "ollama" | "claude-code" (claude -p local) o la base URL de cualquier API
 * compatible con OpenAI. */
// Mismas URLs que base_url en meeting.rs: una URL conocida se guarda con su nombre (prefs migradas de llmUrl).
const PROVIDER_URLS: Record<string, string> = {
  "https://generativelanguage.googleapis.com/v1beta/openai": "gemini",
  "https://api.anthropic.com/v1": "claude",
  "https://api.openai.com/v1": "openai",
  "http://127.0.0.1:11434/v1": "ollama",
  "http://localhost:11434/v1": "ollama",
};
export const llmSchema = z.object({
  provider: z
    .string()
    .trim()
    .min(1)
    .transform((p) => PROVIDER_URLS[p.replace(/\/+$/, "")] ?? p),
  apikey: z.string().trim().catch(""),
  models: z.array(z.string().trim().min(1)).min(1),
});
export const DEFAULT_LLMS = [{ provider: "claude-code", apikey: "", models: ["sonnet"] }];

const mins = (def: number, max = 180) => z.coerce.number().int().min(1).max(max).catch(def);

export const prefsSchema = z.object({
  focusMin: mins(25),
  shortMin: mins(5),
  longMin: mins(15),
  longEvery: mins(4, 12),
  autoCycle: z.boolean().catch(true),
  trayTimer: z.boolean().catch(true), // tiempo restante junto al ícono de la barra de menú
  sound: z.boolean().catch(true),
  shortcut: z.string().min(1).catch(DEFAULT_SHORTCUT),
  focusShortcut: z.string().min(1).catch(DEFAULT_FOCUS_SHORTCUT), // iniciar/pausar/reanudar el foco
  distractions: z.array(z.string().trim().min(1)).catch([]), // bundle ids que cuentan como distracción durante un foco (macOS)
  icalUrl: z.string().trim().catch(""), // "Dirección secreta en formato iCal" de Google Calendar
  // LLMs que sacan las tareas de la reunión al terminar, en orden de fallback (meeting.rs: ask_any)
  llms: z.array(llmSchema).catch(DEFAULT_LLMS),
  // Carpeta desde la que corre Claude Code en el chat (lee su CLAUDE.md: VPS, Coolify, etc.); vacía = home
  claudeCwd: z.string().trim().catch(""),
  petSize: z.coerce.number().int().min(PET_SIZE.min).max(PET_SIZE.max).catch(PET_SIZE.def), // alto en pantalla (px lógicos)
});
export type Prefs = z.infer<typeof prefsSchema>;

/** Valida lo guardado: cada campo inválido o ausente vuelve a su valor por defecto. */
export const normalizePrefs = (raw: unknown): Prefs => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // ponytail: migración de llmUrl/llmModel/llmKey (un solo modelo); borrar cuando nadie tenga prefs viejas.
  const old = !("llms" in r) && typeof r.llmKey === "string" && r.llmKey;
  const p = prefsSchema.parse(
    old ? { ...r, llms: [{ provider: r.llmUrl, apikey: r.llmKey, models: [r.llmModel] }] } : r,
  );
  // claude-code va siempre primero (sin key ni API): prefs guardadas antes de que existiera lo heredan.
  if (!p.llms.some((l) => l.provider === "claude-code")) p.llms = [...DEFAULT_LLMS, ...p.llms];
  return p;
};

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
