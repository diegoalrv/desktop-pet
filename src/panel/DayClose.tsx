import { useState } from "react";
import * as db from "../lib/db";
import { dayStart } from "../lib/stats";
import { standupText, summarize } from "../lib/standup";
import { fmtDur } from "../lib/time";
import { useSettings } from "../store/useSettings";
import { useLive, useTasks } from "../store/useTasks";
import { Icon } from "./icons";

/** Cierre del día (pref `dayEndHour`): pasada la hora y con actividad, resume focos y tiempo contra la meta, tareas
 *  hechas, vencidas y sugerencias sin revisar, y copia el standup. */
export function DayClose() {
  const tasks = useTasks((s) => s.tasks);
  const p = useSettings((s) => s.prefs);
  // desde ayer: el standup también cuenta el foco de ayer
  const sessions = useLive(() => db.listSessions(dayStart(1))) ?? [];
  const pending = useLive(() => db.listSuggestions("pending")) ?? [];
  const [copied, setCopied] = useState(false);
  const now = Date.now();
  if (!p.dayEndHour || new Date(now).getHours() < p.dayEndHour) return null;
  const s = summarize(tasks, sessions, pending.length, p.dailyGoalMin, now);
  if (!s.focusCount && !s.done.length) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(standupText(tasks, sessions, now));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="card stack" style={{ padding: ".8em", gap: ".5em", marginTop: "1em" }}>
      <span className="label">Cierre del día</span>
      <div className="row">
        <b>
          {fmtDur(s.focusSecs)} <span className="muted">de {fmtDur(s.goalSecs)}</span>
        </b>
        <span className="muted small">
          · {s.focusCount} {s.focusCount === 1 ? "foco" : "focos"}
        </span>
        {s.goalMet && <span className="chip">¡meta cumplida!</span>}
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, (s.focusSecs / s.goalSecs) * 100)}%`,
            background: s.goalMet ? "#3cb371" : "var(--accent)",
          }}
        />
      </div>
      <div className="small muted stack" style={{ gap: ".15em" }}>
        <span>✓ {s.done.length} {s.done.length === 1 ? "tarea hecha" : "tareas hechas"}</span>
        <span>
          {s.overdue.length} {s.overdue.length === 1 ? "vencida" : "vencidas"} sin hacer
          {s.overdue.length > 0 && `: ${s.overdue.slice(0, 3).map((t) => t.title).join(", ")}${s.overdue.length > 3 ? "…" : ""}`}
        </span>
        <span>
          {s.pendingSuggestions} {s.pendingSuggestions === 1 ? "sugerencia" : "sugerencias"} sin revisar
        </span>
      </div>
      <button className="b b-sm" onClick={copy}>
        <Icon name="copy" size="1em" /> {copied ? "Copiado" : "Copiar como standup"}
      </button>
    </div>
  );
}
