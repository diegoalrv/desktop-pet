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
import { IS_WEB } from "./lib/db";

initTasksStore();
// En el navegador (web local servida por la app) solo existe el panel web.
if (!IS_WEB) {
  initTimerStore();
  initSettingsStore();
  initMusicStore();
}
const Root = IS_WEB
  ? Dashboard
  : ({ panel: PanelWindow, settings: SettingsWindow, tasks: Dashboard, camview: CamWindow }[getCurrentWindow().label] ??
    PetWindow);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
