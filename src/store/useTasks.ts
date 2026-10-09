import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import * as db from "../lib/db";
import { startOfDay, type Category, type Task } from "../lib/tasks";

interface S {
  tasks: Task[];
  cats: Category[];
  today: number; // focos de hoy
  selected: number | null; // tarea elegida para el próximo foco
  load: () => Promise<void>;
  select: (id: number | null) => void;
}

export const useTasks = create<S>((set) => ({
  tasks: [],
  cats: [],
  today: 0,
  selected: null,
  load: async () => {
    const [tasks, cats, today] = await Promise.all([
      db.listTasks(),
      db.listCategories(),
      db.focusCountSince(startOfDay(Date.now())),
    ]);
    set({ tasks, cats, today });
  },
  select: (selected) => set({ selected }),
}));

let started = false;
export function initTasksStore() {
  if (started) return;
  started = true;
  useTasks.getState().load();
  listen("db://changed", () => useTasks.getState().load());
}
