import { useState } from "react";
import { timer, type Mode } from "../lib/ipc";
import { fmt } from "../lib/time";
import { MODE_COLOR } from "../pet/TimerPill";
import { useTimer } from "../store/useTimer";
import { useTasks } from "../store/useTasks";
import { useSettings } from "../store/useSettings";
import { btn, T } from "./ui";

const LABELS: { mode: Mode; label: string }[] = [
  { mode: "focus", label: "Foco" },
  { mode: "short", label: "Pausa corta" },
  { mode: "long", label: "Pausa larga" },
];
const QUICK = [...(import.meta.env.DEV ? [1] : []), 5, 15, 30];

export function TimerControls() {
  const { snap } = useTimer();
  const p = useSettings((s) => s.prefs);
  const MINS = { focus: p.focusMin, short: p.shortMin, long: p.longMin };
  const { tasks, selected, select } = useTasks();
  const [mode, setMode] = useState<Mode>("focus");
  const [custom, setCustom] = useState("");
  const active = snap.status !== "idle";
  const shown = active ? snap.mode : mode;
  const defMin = MINS[mode];
  const taskId = active ? snap.task_id : mode === "focus" ? selected : null;
  const task = tasks.find((t) => t.id === taskId);
  const start = (min: number) =>
    min > 0 && timer.start(mode, Math.round(min * 60), mode === "focus" ? selected : null);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {LABELS.map((m) => (
          <button
            key={m.mode}
            disabled={active}
            onClick={() => setMode(m.mode)}
            style={{
              ...btn,
              flex: 1,
              padding: "6px 4px",
              background: shown === m.mode ? MODE_COLOR[m.mode] : T.card,
              color: shown === m.mode ? "#fff" : T.text,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div
        style={{ textAlign: "center", font: "700 56px ui-monospace, monospace", color: MODE_COLOR[shown], textShadow: `0 0 28px ${MODE_COLOR[shown]}66` }}
      >
        {fmt(active ? snap.remaining : defMin * 60)}
      </div>

      {task && (
        <div style={{ textAlign: "center", fontSize: 13 }}>
          🎯 {task.title} · {task.done_pomodoros}/{task.est_pomodoros} 🍅{" "}
          {!active && (
            <button style={{ ...btn, padding: "0 6px" }} onClick={() => select(null)}>
              ✕
            </button>
          )}
        </div>
      )}

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
          <button style={btn} onClick={timer.restart}>
            Reiniciar
          </button>
          <button style={btn} onClick={timer.reset}>
            Terminar sesión
          </button>
        </div>
      )}
    </div>
  );
}
