import { invoke } from "@tauri-apps/api/core";

export type Mode = "focus" | "short" | "long";
export interface TimerSnap {
  mode: Mode;
  status: "idle" | "running" | "paused";
  remaining: number; // s
  total: number; // s
  count: number; // focos completados
}

export const timer = {
  get: () => invoke<TimerSnap>("timer_get"),
  start: (mode: Mode, seconds: number) => invoke("timer_start", { mode, seconds }),
  pause: () => invoke("timer_pause"),
  resume: () => invoke("timer_resume"),
  reset: () => invoke("timer_reset"),
  skip: () => invoke("timer_skip"),
};
export const togglePanel = () => invoke("toggle_panel");
