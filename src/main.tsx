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

initTimerStore();
initTasksStore();
initSettingsStore();
initMusicStore();
const label = getCurrentWindow().label;
const Root = { panel: PanelWindow, settings: SettingsWindow, tasks: TasksWindow }[label] ?? PetWindow;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
