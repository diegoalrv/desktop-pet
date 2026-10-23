import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { timer, type Mode } from "../lib/ipc";
import { fmt } from "../lib/time";
import { MODE_COLOR } from "../pet/TimerPill";
import { useTimer } from "../store/useTimer";
import { useTasks } from "../store/useTasks";
import * as db from "../lib/db";
import { compareTasks, type Task } from "../lib/tasks";
import { useSettings } from "../store/useSettings";
import { Icon } from "./icons";

const LABELS: { mode: Mode; label: string }[] = [
  { mode: "focus", label: "Foco" },
  { mode: "short", label: "Pausa corta" },
  { mode: "long", label: "Pausa larga" },
];
const QUICK = [...(import.meta.env.DEV ? [1] : []), 5, 15, 30];
const R = 52;
const C = 2 * Math.PI * R;

/** Anillo de progreso con el tiempo al centro. */
function Ring({
  frac,
  color,
  time,
  caption,
}: {
  frac: number;
  color: string;
  time: string;
  caption: string;
}) {
  return (
    <div style={{ position: "relative", width: "min(62vw, 15em)", aspectRatio: "1", margin: "0 auto" }}>
      <svg viewBox="0 0 120 120" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          style={{ transition: "stroke-dashoffset 1s linear, stroke .3s" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeContent: "center",
          justifyItems: "center",
          gap: ".1em",
        }}
      >
        <div
          style={{
            font: "700 3.1em ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: "-.03em",
            color,
          }}
        >
          {time}
        </div>
        <div className="small muted">{caption}</div>
      </div>
    </div>
  );
}

export function TimerControls() {
  const { snap } = useTimer();
  const p = useSettings((s) => s.prefs);
  const MINS = { focus: p.focusMin, short: p.shortMin, long: p.longMin };
  const { tasks, selected, select } = useTasks();
  const [mode, setMode] = useState<Mode>("focus");
  const [custom, setCustom] = useState("");
  const active = snap.status !== "idle";
  const shown = active ? snap.mode : mode;
  const color = MODE_COLOR[shown];
  const defMin = MINS[mode];
  const pending = tasks.filter((t) => !t.done).sort(compareTasks);
  // La elegida puede haberse terminado desde Tareas: entonces no cuenta.
  const sel = pending.some((t) => t.id === selected) ? selected : null;
  const taskId = active ? snap.task_id : mode === "focus" ? sel : null;
  const task = tasks.find((t) => t.id === taskId);
  const next = pending.find((t) => t.id !== taskId) ?? null;
  const pick = (id: number | null) => {
    select(id);
    timer.setTask(id);
  };
  const finish = async (t: Task) => {
    await db.setDone(t.id, true);
    pick(next?.id ?? null); // preselecciona la siguiente pendiente
  };
  const start = (min: number) =>
    min > 0 && timer.start(mode, Math.round(min * 60), mode === "focus" ? sel : null);
  const reached = task && !task.done && task.done_pomodoros >= task.est_pomodoros;
  const caption = !active
    ? `${snap.count} ${snap.count === 1 ? "foco" : "focos"} en este ciclo`
    : snap.status === "paused"
      ? "En pausa"
      : LABELS.find((l) => l.mode === snap.mode)!.label;

  return (
    <div className="stack" style={{ gap: "1.1em" }}>
      <div className="seg" role="group" aria-label="Modo">
        {LABELS.map((m) => (
          <button
            key={m.mode}
            aria-pressed={shown === m.mode}
            disabled={active}
            onClick={() => setMode(m.mode)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <Ring
        frac={active && snap.total ? snap.remaining / snap.total : 1}
        color={color}
        time={fmt(active ? snap.remaining : defMin * 60)}
        caption={caption}
      />

      {!active && mode === "focus" ? (
        <div className="row">
          <span style={{ color }}>
            <Icon name="target" />
          </span>
          <select
            className="field field-sm grow"
            aria-label="Tarea"
            value={sel ?? ""}
            onChange={(e) => pick(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Sin tarea</option>
            {pending.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} ({t.done_pomodoros}/{t.est_pomodoros})
              </option>
            ))}
          </select>
        </div>
      ) : (
        task && (
          <div className="card row" style={{ padding: ".55em .7em" }}>
            <span style={{ color }}>
              <Icon name={task.done ? "check" : "target"} />
            </span>
            <span className="grow ellipsis">{task.title}</span>
            <span className="chip">
              {task.done_pomodoros}/{task.est_pomodoros} <Icon name="tomato" size="1em" />
            </span>
            {!task.done && (
              <button className="b b-sm" onClick={() => finish(task)}>
                <Icon name="check" size="1em" /> Terminada
              </button>
            )}
          </div>
        )
      )}

      {task?.done ? (
        <div className="small muted center">
          Terminada. {next ? `Siguiente: ${next.title}` : "Elige la siguiente en Tareas."}
        </div>
      ) : (
        reached && (
          <div className="card row" style={{ padding: ".55em .7em" }}>
            <span className="grow small">
              Llegaste a {task.done_pomodoros}/{task.est_pomodoros}. ¿Terminada o seguir?
            </span>
            <button className="b b-sm" onClick={() => finish(task)}>
              <Icon name="check" size="1em" /> Terminar
            </button>
            <button
              className="b b-sm"
              onClick={() => db.updateTask(task.id, "est_pomodoros", task.est_pomodoros + 1)}
            >
              <Icon name="plus" size="1em" /> 1 foco
            </button>
          </div>
        )
      )}

      {!active ? (
        <div className="stack">
          <button
            className="b b-primary b-block"
            style={{ background: color, boxShadow: `0 6px 20px -8px ${color}`, padding: ".75em" }}
            onClick={() => start(defMin)}
          >
            <Icon name="play" /> Iniciar {defMin} min
          </button>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              start(Number(custom));
            }}
          >
            {QUICK.map((m) => (
              <button key={m} type="button" className="b b-sm grow" onClick={() => start(m)}>
                {m}′
              </button>
            ))}
            <input
              className="field field-sm"
              type="number"
              min={1}
              step={1}
              placeholder="min"
              aria-label="Minutos"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              style={{ width: "4.2em", flex: "none", textAlign: "center" }}
            />
            <button className="b b-sm b-sq" aria-label="Iniciar minutos" disabled={!Number(custom)}>
              <Icon name="play" size="1em" />
            </button>
          </form>
        </div>
      ) : (
        <div className="stack center">
          <div className="row" style={{ justifyContent: "center", gap: "1em" }}>
            <button className="b b-round" title="Reiniciar" aria-label="Reiniciar" onClick={timer.restart}>
              <Icon name="restart" />
            </button>
            {snap.status === "running" ? (
              <button
                className="b b-primary b-round"
                style={{ background: color, fontSize: "1.35em" }}
                aria-label="Pausar"
                onClick={timer.pause}
              >
                <Icon name="pause" />
              </button>
            ) : (
              <button
                className="b b-primary b-round"
                style={{ background: color, fontSize: "1.35em" }}
                aria-label="Reanudar"
                onClick={timer.resume}
              >
                <Icon name="play" />
              </button>
            )}
            <button className="b b-round" title="Saltar" aria-label="Saltar" onClick={timer.skip}>
              <Icon name="next" />
            </button>
          </div>
          <button className="b b-ghost b-sm" onClick={timer.reset}>
            <Icon name="stop" size="1em" /> Terminar sesión
          </button>
        </div>
      )}
      {p.focusCam && (
        <button className="b b-ghost b-sm" onClick={() => invoke("open_camview")}>
          <Icon name="target" size="1em" /> Ver cámara
        </button>
      )}
    </div>
  );
}
