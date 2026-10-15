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
import { TasksWindow } from "./tasks/TasksWindow";
import { IS_WEB } from "./lib/db";

initTasksStore();
// En el navegador (web local servida por la app) solo existe el gestor de tareas.
if (!IS_WEB) {
  initTimerStore();
  initSettingsStore();
  initMusicStore();
}
const Root = IS_WEB
  ? TasksWindow
  : ({ panel: PanelWindow, settings: SettingsWindow, tasks: TasksWindow }[getCurrentWindow().label] ?? PetWindow);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
