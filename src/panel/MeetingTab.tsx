import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as db from "../lib/db";
import { useSettings } from "../store/useSettings";
import { useLive, useTasks } from "../store/useTasks";
import { describeAction, parseAction } from "../lib/suggestions";
import { Icon } from "./icons";

interface Snapshot {
  active: boolean;
  manage: boolean;
  status: string;
  lines: { who: "Yo" | "Otros"; text: string }[];
}

const HELP = {
  meeting: "Transcribe en tu Mac tu micrófono (“Yo”) y la llamada (“Otros”). Al terminar te propone tareas. Avisa que estás transcribiendo.",
  manage: "Dicta qué hacer con tus tareas: crear, cambiar fecha, prioridad o proyecto, o dar por hechas. Al terminar te propone los cambios.",
};

/** Escucha la reunión o el dictado de gestión (todo vive en Rust: meeting.rs) y muestra transcripción y propuestas. */
export function MeetingTab() {
  const prefs = useSettings((s) => s.prefs);
  const tasks = useTasks((s) => s.tasks);
  const [s, setS] = useState<Snapshot | null>(null);
  const [manage, setManage] = useState(false);
  const [err, setErr] = useState("");
  const suggestions = useLive(() => db.listSuggestions("pending")) ?? [];
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<Snapshot>("meeting_state").then(setS);
    const un = listen<Snapshot>("meeting://state", (e) => setS(e.payload));
    return () => void un.then((f) => f());
  }, []);
  useEffect(() => void log.current?.scrollTo(0, log.current.scrollHeight), [s?.lines.length]);

  const call = (cmd: string) =>
    invoke(cmd, { llms: prefs.llms, manage })
      .then(() => setErr(""))
      .catch((e) => setErr(String(e)));
  const busy = s?.status.startsWith("Buscando tareas") || s?.status.startsWith("Ordenando");

  if (!s) return null;
  const mode = s.active ? s.manage : manage;
  return (
    <div className="stack" style={{ gap: "1em" }}>
      <div className="card stack center" style={{ gap: ".7em", padding: "1.2em 1em" }}>
        <div className="seg" style={{ width: "100%" }}>
          <button aria-pressed={!mode} disabled={s.active} onClick={() => setManage(false)}>Reunión</button>
          <button aria-pressed={mode} disabled={s.active} onClick={() => setManage(true)}>Gestión</button>
        </div>
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
          <b>{mode ? (s.active ? "Escuchando tus tareas" : "Ordenar tareas por voz") : s.active ? "Escuchando la reunión" : "Escuchar reunión"}</b>
          <span className="small muted" style={{ color: err ? "#ff6b6b" : undefined }}>
            {err || s.status || (mode ? HELP.manage : HELP.meeting)}
          </span>
        </div>
        <button className={s.active ? "b" : "b b-primary"} onClick={s.active ? () => invoke("meeting_stop") : () => call("meeting_start")}>
          <Icon name={s.active ? "stop" : "mic"} size="1em" /> {s.active ? "Terminar" : "Empezar"}
        </button>
        {!s.active && (
          <div className="row" style={{ gap: ".4em", justifyContent: "center", flexWrap: "wrap" }}>
            <button className="b b-ghost b-sm" disabled={busy} onClick={() => call("meeting_retry")} title="Vuelve a mandar al LLM la última transcripción guardada (reunión o gestión)">
              {busy ? "Buscando tareas…" : "Reintentar la última"}
            </button>
            {(s.status || s.lines.length > 0) && !busy && (
              <button
                className="b b-ghost b-sm"
                onClick={() => invoke("meeting_reset").then(() => setErr(""))}
                title="Limpia el panel. La transcripción guardada y las tareas sugeridas se mantienen."
              >
                <Icon name="x" size="1em" /> Limpiar
              </button>
            )}
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <section className="stack" style={{ gap: ".4em" }}>
          <span className="label">Propuestas</span>
          {suggestions.map((t) => {
            const a = parseAction(t.action);
            return (
            <div key={t.id} className="card row" style={{ padding: ".6em .7em", alignItems: "flex-start" }}>
              <div className="grow" style={{ display: "grid", gap: ".25em" }}>
                <span style={{ textDecoration: a?.op === "completar" ? "line-through" : undefined }}>{t.title}</span>
                {a && (
                  <div className="row" style={{ gap: ".3em", flexWrap: "wrap" }}>
                    {describeAction(a, tasks).map((c) => (
                      <span key={c} className="chip">{c}</span>
                    ))}
                  </div>
                )}
                {t.detail && <span className="small muted">{t.detail}</span>}
              </div>
              <button className="b b-sq b-sm" style={{ color: "#3cb371" }} title={a ? "Aplicar" : "Agregar a tareas"} aria-label={a ? "Aplicar" : "Agregar a tareas"} onClick={() => db.acceptSuggestion(t)}>
                <Icon name="check" size="1em" />
              </button>
              <button className="b b-ghost b-sq b-sm" title="Descartar" aria-label="Descartar" onClick={() => db.setSuggestion(t.id, "dismissed")}>
                <Icon name="x" size="1em" />
              </button>
            </div>
            );
          })}
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
