import { invoke, isTauri } from "@tauri-apps/api/core";

/** Comando de la app: `invoke` en las ventanas; en la web local, POST a /api/invoke (src-tauri/src/web.rs).
 *  Desde la web los comandos de reunión usan los LLMs de Ajustes (Rust los lee de settings.json). */
export const call = async <T = void>(cmd: string, args: Record<string, unknown> = {}): Promise<T> => {
  if (isTauri()) return invoke<T>(cmd, args);
  const r = await fetch("/api/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd, args }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

export type Mode = "focus" | "short" | "long";
export interface TimerSnap {
  mode: Mode;
  status: "idle" | "running" | "paused";
  remaining: number; // s
  total: number; // s
  count: number; // focos completados
  task_id: number | null;
}

export const timer = {
  get: () => invoke<TimerSnap>("timer_get"),
  start: (mode: Mode, seconds: number, taskId: number | null = null) =>
    invoke("timer_start", { mode, seconds, taskId }),
  pause: () => invoke("timer_pause"),
  resume: () => invoke("timer_resume"),
  reset: () => invoke("timer_reset"),
  restart: () => invoke("timer_restart"),
  skip: () => invoke("timer_skip"),
};
export const togglePanel = () => invoke("toggle_panel");
export const notify = (title: string, body: string) => invoke("send_notification", { title, body });
