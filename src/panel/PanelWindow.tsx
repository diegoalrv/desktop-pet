import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TaskList } from "./TaskList";
import { TimerControls } from "./TimerControls";
import { MusicPlayer } from "./MusicPlayer";
import { btn } from "./ui";

type Tab = "timer" | "tasks" | "music";
const TABS: Record<Tab, string> = { timer: "Timer", tasks: "Tareas", music: "Música" };

export function PanelWindow() {
  const [tab, setTab] = useState<Tab>("timer");
  const [focusKey, setFocusKey] = useState(0);

  // Atajo global (Cmd/Ctrl+Shift+Space): abre Tareas con el input enfocado.
  useEffect(() => {
    const un = listen("panel://quick-capture", () => {
      setTab("tasks");
      setFocusKey((k) => k + 1);
    });
    return () => void un.then((f) => f());
  }, []);

  return (
    <div
      style={{
        font: "14px system-ui",
        padding: 16,
        display: "grid",
        gap: 14,
        color: "#222",
        alignContent: "start",
      }}
    >
      <div style={{ display: "flex", gap: 6 }}>
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...btn,
              flex: 1,
              background: tab === t ? "#222" : "#fff",
              color: tab === t ? "#fff" : "#222",
            }}
          >
            {TABS[t]}
          </button>
        ))}
        <button
          style={{ ...btn, border: 0, color: "#888" }}
          title="Ajustes"
          onClick={() => invoke("open_settings")}
        >
          ⚙
        </button>
        <button style={{ ...btn, border: 0, color: "#888" }} onClick={() => getCurrentWindow().hide()}>
          ✕
        </button>
      </div>
      {tab === "timer" && <TimerControls />}
      {tab === "tasks" && <TaskList focusKey={focusKey} onFocusTask={() => setTab("timer")} />}
      {tab === "music" && <MusicPlayer />}
    </div>
  );
}
