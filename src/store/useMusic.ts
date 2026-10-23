import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface MusicState {
  title: string;
  artist: string;
  art: string;
  playing: boolean;
  t: number;
  d: number;
  vol: number;
  /** lo que sigue en la cola; `i` es el índice absoluto para `jump` */
  q?: { t: string; a: string; i: number }[];
}

// Estado de la ventana de música (llega cada ~1 s vía `music://state`). null = ventana no abierta o cambiando de proveedor.
export const useMusic = create<{ s: MusicState | null }>(() => ({ s: null }));

export const music = (cmd: string, arg?: number | string) => invoke("music_cmd", { cmd, arg });
export const openMusic = (show = true) => invoke("music_open", { show });

let started = false;
export function initMusicStore() {
  if (started) return;
  started = true;
  listen<string>("music://state", (e) => {
    try {
      useMusic.setState({ s: JSON.parse(e.payload) });
    } catch {
      /* título ajeno */
    }
  });
}
