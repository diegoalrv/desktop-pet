import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { timer, type TimerSnap } from "../lib/ipc";

const idle: TimerSnap = {
  mode: "focus",
  status: "idle",
  remaining: 0,
  total: 0,
  count: 0,
  task_id: null,
  step: 0,
  steps: 0,
  label: "",
  emoji: "",
  color: "",
  next_label: "",
};

// El timer vive en Rust; esto solo espeja `timer://tick`.
export const useTimer = create<{ snap: TimerSnap }>(() => ({ snap: idle }));

let started = false;
export function initTimerStore() {
  if (started) return;
  started = true;
  listen<TimerSnap>("timer://tick", (e) => useTimer.setState({ snap: e.payload }));
  timer.get().then((snap) => useTimer.setState({ snap }));
}
