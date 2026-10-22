import { invoke, isTauri } from "@tauri-apps/api/core";
import { currentMeeting, meetingsBetween, type MeetingCtx } from "./calendar";

/** Token por arranque de la app (web.rs): llega en `?t=` al abrir la web desde la app y se guarda en localStorage. */
const TOKEN = "pet-token";
if (!isTauri()) {
  const t = new URLSearchParams(location.search).get("t");
  if (t) {
    localStorage.setItem(TOKEN, t);
    history.replaceState(null, "", location.pathname + location.hash);
  }
}
const RESTARTED = "La app se reinició: ábrela de nuevo desde el menú de la barra (Abrir web de tareas)";
let warned = false;

/** POST JSON a la app (web local) con el token; 401 = la app arrancó de nuevo y el token ya no sirve. */
export const post = async <T>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Pet-Token": localStorage.getItem(TOKEN) ?? "" },
    body: JSON.stringify(body),
  });
  if (r.status === 401) {
    if (!warned) alert(RESTARTED); // ponytail: alert; un banner si molesta
    warned = true;
    throw new Error(RESTARTED);
  }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

/** Comando de la app: `invoke` en las ventanas; en la web local, POST a /api/invoke (src-tauri/src/web.rs).
 *  Desde la web los comandos de reunión usan los LLMs de Ajustes (Rust los lee de settings.json). */
export const call = <T = void>(cmd: string, args: Record<string, unknown> = {}): Promise<T> =>
  isTauri() ? invoke<T>(cmd, args) : post<T>("/api/invoke", { cmd, args });

/** El evento del calendario que está ocurriendo, para guardarlo con la reunión; null si no hay calendario o falla.
 *  En la web Rust usa la URL de Ajustes (el navegador no tiene las prefs). */
export async function meetingCtx(icalUrl: string): Promise<MeetingCtx | null> {
  const now = Date.now();
  try {
    const ics = await call<string>("fetch_ical", { url: icalUrl });
    const m = currentMeeting(meetingsBetween(ics, now - 86_400_000, now + 3_600_000), now);
    return m ? { title: m.title, attendees: m.attendees } : null;
  } catch {
    return null;
  }
}

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
  setTask: (taskId: number | null) => invoke("timer_set_task", { taskId }),
};
export const togglePanel = () => invoke("toggle_panel");
export const notify = (title: string, body: string) => invoke("send_notification", { title, body });
