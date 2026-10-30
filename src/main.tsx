import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PetWindow } from "./pet/PetWindow";
import { PanelWindow } from "./panel/PanelWindow";
import { initTimerStore } from "./store/useTimer";
import { initTasksStore } from "./store/useTasks";
import { initSettingsStore } from "./store/useSettings";
import { initMusicStore } from "./store/useMusic";
import { SettingsWindow } from "./settings/SettingsWindow";
import { CamWindow } from "./camview/CamWindow";
import { Dashboard } from "./web/Dashboard";
import { LocalPlayer } from "./music/LocalPlayer";
import { IS_WEB } from "./lib/db";
import { askErrorReports, initErrorReports } from "./lib/errors";
import { invoke } from "@tauri-apps/api/core";

const label = IS_WEB ? "" : getCurrentWindow().label;
// "music" = reproductor local (music.rs): solo lee las prefs y no tiene permisos para más.
if (label !== "music") initTasksStore();
// En el navegador (web local servida por la app) solo existe el panel web.
if (!IS_WEB) {
  const settings = initSettingsStore();
  initErrorReports();
  if (label === "settings") void settings.then(askErrorReports).catch(() => {});
}
if (!IS_WEB && label !== "music") {
  initTimerStore();
  initMusicStore();
}
const Root = IS_WEB
  ? Dashboard
  : ({ panel: PanelWindow, settings: SettingsWindow, tasks: Dashboard, camview: CamWindow, music: LocalPlayer }[
      label
    ] ?? PetWindow);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
if (label === "pet") void invoke("boot_ok"); // errors.rs: el arranque terminó
