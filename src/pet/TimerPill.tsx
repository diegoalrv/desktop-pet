import { fmt } from "../lib/time";
import type { TimerSnap } from "../lib/ipc";

export const MODE_COLOR = { focus: "#e8523c", short: "#3cb371", long: "#3c78e8" } as const;
/** Color del bloque en curso: el de su actividad si es de una rutina (F18), si no el del modo. */
export const snapColor = (snap: TimerSnap) => snap.color || MODE_COLOR[snap.mode];
export const PILL_H = 40; // va encima de la mascota

export function TimerPill({ snap }: { snap: TimerSnap }) {
  const active = snap.status !== "idle";
  const color = snapColor(snap);
  return (
    <div style={{ height: PILL_H, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {active && (
        <span
          style={{
            background: color,
            color: "#fff",
            font: "700 20px ui-monospace, monospace",
            padding: "4px 14px",
            boxShadow: `0 3px 14px ${color}99, inset 0 0 0 1px rgba(255,255,255,.25)`,
            letterSpacing: ".04em",
            borderRadius: 999,
            animation: snap.status === "paused" ? "blink 1s step-end infinite" : undefined,
          }}
        >
          <style>{`@keyframes blink{50%{opacity:.35}}`}</style>
          {snap.emoji && `${snap.emoji} `}
          {fmt(snap.remaining)}
        </span>
      )}
    </div>
  );
}
