import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TaskList } from "./TaskList";
import { TimerControls } from "./TimerControls";
import { MusicPlayer } from "./MusicPlayer";
import { btn, T, PANEL_CSS } from "./ui";

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
        color: T.text,
        background: `linear-gradient(160deg, #1f1f2b, ${T.bg} 60%)`,
        minHeight: "100vh",
        boxSizing: "border-box",
        alignContent: "start",
      }}
    >
      <style>{PANEL_CSS}</style>
      <div style={{ display: "flex", gap: 6 }}>
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...btn,
              flex: 1,
              background: tab === t ? T.accent : T.card,
              color: tab === t ? "#fff" : T.text,
              border: tab === t ? "1px solid transparent" : btn.border,
              fontWeight: 600,
            }}
          >
            {TABS[t]}
          </button>
        ))}
        <button
          style={{ ...btn, border: 0, color: T.dim }}
          title="Ajustes"
          onClick={() => invoke("open_window", { label: "settings" })}
        >
          ⚙
        </button>
        <button style={{ ...btn, border: 0, color: T.dim }} onClick={() => invoke("hide_panel")}>
          ✕
        </button>
      </div>
      {tab === "timer" && <TimerControls />}
      {tab === "tasks" && <TaskList focusKey={focusKey} onFocusTask={() => setTab("timer")} />}
      {tab === "music" && <MusicPlayer />}
    </div>
  );
}
