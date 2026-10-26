import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TaskList } from "./TaskList";
import { TimerControls } from "./TimerControls";
import { DayClose } from "./DayClose";
import { MusicPlayer } from "./MusicPlayer";
import { MeetingTab } from "./MeetingTab";
import { ChatTab, type VoicePrompt } from "./ChatTab";
import { Icon, type IconName } from "./icons";
import { PN_CSS } from "./ui";
import { fmt } from "../lib/time";
import { snapColor } from "../pet/TimerPill";
import { useTimer } from "../store/useTimer";
import { useTasks } from "../store/useTasks";
import idleSprite from "../../examples/candolita/idle.png";

type Tab = "timer" | "tasks" | "meeting" | "music" | "chat";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "timer", label: "Timer", icon: "timer" },
  { id: "tasks", label: "Tareas", icon: "tasks" },
  { id: "meeting", label: "Reunión", icon: "mic" },
  { id: "music", label: "Música", icon: "music" },
  { id: "chat", label: "Chat", icon: "terminal" },
];
const MODE_LABEL = { focus: "En foco", short: "Pausa corta", long: "Pausa larga" } as const;

/** Estado de un vistazo bajo el nombre: el timer si corre, si no los focos de hoy. */
function Status() {
  const snap = useTimer((s) => s.snap);
  const today = useTasks((s) => s.today);
  if (snap.status === "idle")
    return (
      <span className="pn-sub">
        <Icon name="tomato" size="1.1em" /> {today} {today === 1 ? "foco" : "focos"} hoy
      </span>
    );
  return (
    <span className="pn-sub" style={{ color: snapColor(snap) }}>
      <span
        className="dot"
        style={{
          background: "currentColor",
          animation: snap.status === "running" ? "pn-pulse 1.6s infinite" : undefined,
        }}
      />
      {MODE_LABEL[snap.mode]} · {fmt(snap.remaining)}
      {snap.status === "paused" && " · en pausa"}
    </span>
  );
}

export function PanelWindow() {
  const [tab, setTab] = useState<Tab>("timer");
  // Rust (open_panel_tab) abre el panel en una pestaña: el aviso de reunión lo deja en "Reunión".
  // Lo dictado con el atajo de voz (voice.rs): va al chat como si lo hubieras escrito.
  const [voice, setVoice] = useState<VoicePrompt>();
  useEffect(() => {
    const un = listen<Tab>("panel://tab", (e) => setTab(e.payload));
    const unVoice = listen<string>("voice://text", (e) => {
      setVoice((v) => ({ text: e.payload, n: (v?.n ?? 0) + 1 }));
      setTab("chat");
    });
    return () => {
      un.then((f) => f());
      unVoice.then((f) => f());
    };
  }, []);

  return (
    <div className="pn">
      <style>{PN_CSS}</style>
      <header className="pn-head">
        {/* ponytail: avatar con el idle de Candolita (skin por defecto), aunque la mascota use otro skin */}
        <div
          className="pn-avatar"
          style={{
            backgroundImage: `url(${idleSprite})`,
            backgroundSize: "10.4em 2.6em",
            animation: "pn-sprite 1s steps(4) infinite",
          }}
        />
        <div className="grow">
          <div className="pn-title">Candolita</div>
          <Status />
        </div>
        <button
          className="b b-ghost b-sq"
          title="Abrir el panel web en el navegador"
          aria-label="Abrir el panel web"
          onClick={() => invoke("open_web")}
        >
          <Icon name="external" />
        </button>
        <button
          className="b b-ghost b-sq"
          title="Ajustes"
          aria-label="Ajustes"
          onClick={() => invoke("open_window", { label: "settings" })}
        >
          <Icon name="sliders" />
        </button>
        <button
          className="b b-ghost b-sq"
          title="Cerrar"
          aria-label="Cerrar"
          onClick={() => invoke("hide_panel")}
        >
          <Icon name="x" />
        </button>
      </header>

      <main className="pn-body">
        {tab === "timer" && (
          <>
            <TimerControls />
            <DayClose />
          </>
        )}
        {tab === "tasks" && <TaskList onFocusTask={() => setTab("timer")} />}
        {tab === "meeting" && <MeetingTab />}
        {tab === "music" && <MusicPlayer />}
        {tab === "chat" && <ChatTab voice={voice} />}
      </main>

      <nav className="pn-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="pn-tab"
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            <span className="pn-tab-ico">
              <Icon name={t.icon} />
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
