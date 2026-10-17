import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as db from "../lib/db";
import { useSettings } from "../store/useSettings";
import { Icon } from "./icons";

interface Snapshot {
  active: boolean;
  status: string;
  lines: { who: "Yo" | "Otros"; text: string }[];
  suggestions: Suggestion[];
}
type Suggestion = { id: number; title: string; detail: string };

/** Escucha la reunión (todo vive en Rust: meeting.rs) y muestra transcripción y tareas sugeridas. */
export function MeetingTab() {
  const prefs = useSettings((s) => s.prefs);
  const [s, setS] = useState<Snapshot | null>(null);
  const [err, setErr] = useState("");
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<Snapshot>("meeting_state").then(setS);
    const un = listen<Snapshot>("meeting://state", (e) => setS(e.payload));
    return () => void un.then((f) => f());
  }, []);
  useEffect(() => void log.current?.scrollTo(0, log.current.scrollHeight), [s?.lines.length]);

  const start = () =>
    invoke("meeting_start", { llm: { url: prefs.llmUrl, model: prefs.llmModel, key: prefs.llmKey } })
      .then(() => setErr(""))
      .catch((e) => setErr(String(e)));

  const accept = async (id: number, title: string) => {
    await db.addTask({ title, category_id: null, project: null, priority: 1, due_at: null, est_pomodoros: 1 });
    invoke("meeting_dismiss", { id });
  };

  if (!s) return null;
  return (
    <div className="stack" style={{ gap: "1em" }}>
      <div className="card stack center" style={{ gap: ".7em", padding: "1.2em 1em" }}>
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: "3.4em",
            height: "3.4em",
            borderRadius: "50%",
            color: s.active ? "#fff" : "var(--accent)",
            background: s.active ? "var(--accent)" : "var(--accent-soft)",
            boxShadow: s.active ? "0 0 0 .45em var(--accent-soft)" : undefined,
            animation: s.active ? "pn-pulse 1.8s infinite" : undefined,
          }}
        >
          <Icon name="mic" size="1.6em" />
        </div>
        <div className="stack" style={{ gap: ".2em" }}>
          <b>{s.active ? "Escuchando la reunión" : "Escuchar reunión"}</b>
          <span className="small muted" style={{ color: err ? "#ff6b6b" : undefined }}>
            {err ||
              s.status ||
              "Transcribe en tu Mac tu micrófono (“Yo”) y la llamada (“Otros”). Al terminar te propone tareas. Avisa que estás transcribiendo."}
          </span>
        </div>
        <button className={s.active ? "b" : "b b-primary"} onClick={s.active ? () => invoke("meeting_stop") : start}>
          <Icon name={s.active ? "stop" : "mic"} size="1em" /> {s.active ? "Terminar" : "Empezar"}
        </button>
      </div>

      {s.suggestions.length > 0 && (
        <section className="stack" style={{ gap: ".4em" }}>
          <span className="label">Tareas sugeridas</span>
          {s.suggestions.map((t) => (
            <div key={t.id} className="card row" style={{ padding: ".6em .7em", alignItems: "flex-start" }}>
              <div className="grow" style={{ display: "grid", gap: ".15em" }}>
                <span>{t.title}</span>
                {t.detail && <span className="small muted">{t.detail}</span>}
              </div>
              <button className="b b-sq b-sm" style={{ color: "#3cb371" }} title="Agregar a tareas" aria-label="Agregar a tareas" onClick={() => accept(t.id, t.title)}>
                <Icon name="check" size="1em" />
              </button>
              <button className="b b-ghost b-sq b-sm" title="Descartar" aria-label="Descartar" onClick={() => invoke("meeting_dismiss", { id: t.id })}>
                <Icon name="x" size="1em" />
              </button>
            </div>
          ))}
        </section>
      )}

      {s.lines.length > 0 && (
        <section className="stack" style={{ gap: ".4em" }}>
          <span className="label">Transcripción</span>
          <div ref={log} className="card stack" style={{ maxHeight: "18em", overflowY: "auto", gap: ".45em", fontSize: ".9em", lineHeight: 1.4 }}>
            {s.lines.map((l, i) => (
              <div key={i}>
                <b style={{ color: l.who === "Yo" ? "var(--accent)" : "var(--muted)" }}>{l.who}</b> {l.text}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
