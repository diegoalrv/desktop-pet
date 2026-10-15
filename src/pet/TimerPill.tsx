import { fmt } from "../lib/time";
import type { TimerSnap } from "../lib/ipc";

export const MODE_COLOR = { focus: "#e8523c", short: "#3cb371", long: "#3c78e8" } as const;
export const PILL_H = 40; // va encima de la mascota

export function TimerPill({ snap }: { snap: TimerSnap }) {
  const active = snap.status !== "idle";
  return (
    <div style={{ height: PILL_H, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {active && (
        <span
          style={{
            background: MODE_COLOR[snap.mode],
            color: "#fff",
            font: "700 20px ui-monospace, monospace",
            padding: "4px 14px",
            boxShadow: `0 3px 14px ${MODE_COLOR[snap.mode]}99, inset 0 0 0 1px rgba(255,255,255,.25)`,
            letterSpacing: ".04em",
            borderRadius: 999,
            animation: snap.status === "paused" ? "blink 1s step-end infinite" : undefined,
          }}
        >
          <style>{`@keyframes blink{50%{opacity:.35}}`}</style>
          {fmt(snap.remaining)}
        </span>
      )}
    </div>
  );
}
