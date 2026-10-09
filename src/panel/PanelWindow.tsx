import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { timer, type Mode } from "../lib/ipc";
import { fmt } from "../lib/time";
import { useTimer } from "../store/useTimer";
import { MODE_COLOR } from "../pet/TimerPill";

const MODES: { mode: Mode; label: string; min: number }[] = [
  { mode: "focus", label: "Foco", min: 25 },
  { mode: "short", label: "Pausa corta", min: 5 },
  { mode: "long", label: "Pausa larga", min: 15 },
];
const QUICK = [...(import.meta.env.DEV ? [1] : []), 5, 15, 30];

const btn = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #ccc",
  background: "#fff",
  cursor: "pointer",
} as const;

export function PanelWindow() {
  const { snap } = useTimer();
  const [mode, setMode] = useState<Mode>("focus");
  const [custom, setCustom] = useState("");
  const active = snap.status !== "idle";
  const shown = active ? snap.mode : mode;
  const defMin = MODES.find((m) => m.mode === mode)!.min;
  const start = (min: number) => min > 0 && timer.start(mode, Math.round(min * 60));

  return (
    <div style={{ font: "14px system-ui", padding: 16, display: "grid", gap: 14, color: "#222" }}>
      <div style={{ display: "flex", gap: 6 }}>
        {MODES.map((m) => (
          <button
            key={m.mode}
            disabled={active}
            onClick={() => setMode(m.mode)}
            style={{
              ...btn,
              flex: 1,
              padding: "6px 4px",
              background: shown === m.mode ? MODE_COLOR[m.mode] : "#fff",
              color: shown === m.mode ? "#fff" : "#222",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div
        style={{ textAlign: "center", font: "700 56px ui-monospace, monospace", color: MODE_COLOR[shown] }}
      >
        {fmt(active ? snap.remaining : defMin * 60)}
      </div>

      {!active ? (
        <>
          <button
            style={{ ...btn, background: MODE_COLOR[mode], color: "#fff", border: 0 }}
            onClick={() => start(defMin)}
          >
            Iniciar {defMin} min
          </button>
          <div style={{ display: "flex", gap: 6 }}>
            {QUICK.map((m) => (
              <button key={m} style={{ ...btn, flex: 1 }} onClick={() => start(m)}>
                {m} min
              </button>
            ))}
          </div>
          <form
            style={{ display: "flex", gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              start(Number(custom));
            }}
          >
            <input
              type="number"
              min={1}
              step={1}
              placeholder="Minutos"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              style={{ ...btn, flex: 1, minWidth: 0 }}
            />
            <button style={btn}>Iniciar</button>
          </form>
        </>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          {snap.status === "running" ? (
            <button style={{ ...btn, flex: 1 }} onClick={timer.pause}>
              Pausar
            </button>
          ) : (
            <button style={{ ...btn, flex: 1 }} onClick={timer.resume}>
              Reanudar
            </button>
          )}
          <button style={btn} onClick={timer.skip}>
            Saltar
          </button>
          <button style={btn} onClick={timer.reset}>
            Reiniciar
          </button>
        </div>
      )}

      <div style={{ color: "#888", fontSize: 12, textAlign: "center" }}>Focos completados: {snap.count}</div>
      <button style={{ ...btn, border: 0, color: "#888" }} onClick={() => getCurrentWindow().hide()}>
        Cerrar
      </button>
    </div>
  );
}
