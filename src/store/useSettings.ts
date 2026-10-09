import { create } from "zustand";
import { emit, listen } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";
import { BUILTIN } from "../skins/loader";

interface S {
  skin: string;
  /** sube en cada cambio/importación del skin activo, para recargarlo en caliente */
  skinRev: number;
  setSkin: (id: string) => Promise<void>;
  reloadSkin: () => Promise<void>;
}

const store = () => load("settings.json", { autoSave: true, defaults: {} });

export const useSettings = create<S>((set, get) => ({
  skin: BUILTIN,
  skinRev: 0,
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
  // Cambios hechos desde la ventana de Settings llegan a la mascota por evento.
  listen<{ skin: string }>("settings://skin", (e) =>
    useSettings.setState((s) => ({ skin: e.payload.skin, skinRev: s.skinRev + 1 })),
  );
}
