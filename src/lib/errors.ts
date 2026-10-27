import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../store/useSettings";

// Errores del front a GlitchTip, con el mismo proyecto, UUID, versión y SO que errors.rs. Solo con el opt-in de
// Ajustes (`prefs.errorReports`): apagado no sale ninguna petición. ponytail: un fetch al endpoint `store` de Sentry
// en vez de @sentry/browser (que además junta breadcrumbs con textos de la UI que acá no queremos).
const STORE =
  "https://glitchtip.spadelab.xyz/api/2/store/?sentry_key=4434a0f3412c4f1d96a7dc5aaed0078e&sentry_version=7";
const MAX_PER_RUN = 20; // un error en un bucle no inunda GlitchTip

type Info = { id: string; release: string; environment: string };
let info: Promise<Info> | undefined;
let sent = 0;

/** Igual que `scrub` de errors.rs: rutas sin nombre de usuario (`/Users/x/…` → `~/…`) y textos cortos. */
export const scrub = (s: string) => s.replace(/([a-z]:)?[\\/](users|home)[\\/][^\\/\n:()'"]+/gi, "~").slice(0, 300);

/** Frames de un `error.stack` de WebKit (`fn@url:1:2`) o Chromium/WebView2 (`at fn (url:1:2)`), del más viejo al más nuevo. */
export const frames = (stack = "") =>
  stack
    .split("\n")
    .flatMap((l) => {
      const m = l.match(/^\s*(?:at\s+)?(?:(.*?)\s*\(|(.*?)@)?(.+?):(\d+):(\d+)\)?\s*$/);
      return m ? [{ function: m[1] || m[2] || "?", filename: scrub(m[3]), lineno: +m[4], colno: +m[5] }] : [];
    })
    .slice(0, 50)
    .reverse();

async function report(err: unknown) {
  if (!useSettings.getState().prefs.errorReports || sent >= MAX_PER_RUN) return;
  sent++;
  const e = err instanceof Error ? err : new Error(String(err));
  const { id, release, environment } = await (info ??= invoke<Info>("error_reports_info"));
  await fetch(STORE, {
    method: "POST",
    body: JSON.stringify({
      event_id: crypto.randomUUID().replace(/-/g, ""),
      platform: "javascript",
      level: "error",
      release,
      environment,
      user: { id },
      exception: { values: [{ type: e.name, value: scrub(e.message), stacktrace: { frames: frames(e.stack) } }] },
    }),
  });
}

export function initErrorReports() {
  addEventListener("error", (ev) => void report(ev.error ?? ev.message).catch(() => {}));
  addEventListener("unhandledrejection", (ev) => void report(ev.reason).catch(() => {}));
}
