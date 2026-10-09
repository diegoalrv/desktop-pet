import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PetWindow } from "./pet/PetWindow";
import { PanelWindow } from "./panel/PanelWindow";
import { initTimerStore } from "./store/useTimer";
import { initTasksStore } from "./store/useTasks";
import { initSettingsStore } from "./store/useSettings";
import { SettingsWindow } from "./settings/SettingsWindow";

initTimerStore();
initTasksStore();
initSettingsStore();
const label = getCurrentWindow().label;
const Root = label === "panel" ? PanelWindow : label === "settings" ? SettingsWindow : PetWindow;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
