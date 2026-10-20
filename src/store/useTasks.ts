import { useEffect, useState } from "react";
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
  const load = () => useTasks.getState().load();
  load();
  if (db.IS_WEB) {
    // ponytail: la web sondea cada 3 s; SSE desde web.rs si algún día molesta la latencia.
    setInterval(load, 3000);
    window.addEventListener("focus", load);
    window.addEventListener("db://changed", load);
    document.title = "Tareas · Pet";
  } else listen("db://changed", load);
}

/** Resultado de `load`, recargado cada vez que cambia la BD (useTasks recarga en db://changed y, en la web, cada 3 s). */
export function useLive<T>(load: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const rev = useTasks((s) => s.tasks);
  const [v, setV] = useState<T>();
  useEffect(() => {
    let alive = true;
    load().then((x) => alive && setV(x));
    return () => {
      alive = false;
    };
  }, [rev, ...deps]);
  return v;
}
