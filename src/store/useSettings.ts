import { create } from "zustand";
import { emit, listen } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";
import { DEFAULT } from "../skins/loader";
import { normalizePrefs, type Prefs } from "../lib/prefs";

interface S {
  skin: string;
  /** sube en cada cambio/importación del skin activo, para recargarlo en caliente */
  skinRev: number;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => Promise<void>;
  setSkin: (id: string) => Promise<void>;
  reloadSkin: () => Promise<void>;
}

const store = () => load("settings.json", { autoSave: true, defaults: {} });

export const useSettings = create<S>((set, get) => ({
  skin: DEFAULT,
  skinRev: 0,
  prefs: normalizePrefs(undefined),
  setPrefs: async (patch) => {
    const prefs = normalizePrefs({ ...get().prefs, ...patch });
    await (await store()).set("prefs", prefs);
    set({ prefs });
    emit("settings://prefs", prefs);
  },
  setSkin: async (skin) => {
    await (await store()).set("skin", skin);
    set({ skin });
    emit("settings://skin", { skin });
  },
  reloadSkin: async () => emit("settings://skin", { skin: get().skin }),
}));

let started = false;
export async function initSettingsStore() {
  if (started) return;
  started = true;
  const skin = await (await store()).get<string>("skin");
  if (skin) useSettings.setState({ skin });
  useSettings.setState({ prefs: normalizePrefs(await (await store()).get("prefs")) });
  listen<Prefs>("settings://prefs", (e) => useSettings.setState({ prefs: e.payload }));
  // Cambios hechos desde la ventana de Settings llegan a la mascota por evento.
  listen<{ skin: string }>("settings://skin", (e) =>
    useSettings.setState((s) => ({ skin: e.payload.skin, skinRev: s.skinRev + 1 })),
  );
}
