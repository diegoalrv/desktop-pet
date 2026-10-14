import { fmt } from "../lib/time";
import type { TimerSnap } from "../lib/ipc";

export const MODE_COLOR = { focus: "#e8523c", short: "#3cb371", long: "#3c78e8" } as const;
export const PILL_H = 28;

export function TimerPill({ snap }: { snap: TimerSnap }) {
  const active = snap.status !== "idle";
  return (
    <div style={{ height: PILL_H, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {active && (
        <span
          style={{
            background: MODE_COLOR[snap.mode],
            color: "#fff",
            font: "600 13px ui-monospace, monospace",
            padding: "3px 10px",
            boxShadow: `0 2px 10px ${MODE_COLOR[snap.mode]}88, inset 0 0 0 1px rgba(255,255,255,.25)`,
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
