import { useEffect, useState } from "react";
import { call } from "../lib/ipc";
import * as db from "../lib/db";
import { useLive, useTasks } from "../store/useTasks";
import { useSettings } from "../store/useSettings";
import { projectsOf } from "../lib/tasks";
import { Icon } from "../panel/icons";
import { countHits, download, fmtDate, Hl, SuggestionRow, usePoll } from "./kit";

type Saved = { id: number; text: string }; // id = epoch s (meetings_list en meeting.rs)
type Live = { active: boolean; status: string; lines: { who: string; text: string }[] };

const parse = (text: string) =>
  text
    .split("\n")
    .map((l) => l.match(/^(Yo|Otros): (.*)$/))
    .filter((m) => m != null)
    .map((m) => ({ who: m[1], text: m[2] }));
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const llms = () => ({ llms: useSettings.getState().prefs.llms }); // en la web Rust usa los de Ajustes

/** Proyecto con el que se crean las tareas aceptadas (autocompleta con los existentes). */
function ProjectInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const projects = projectsOf(useTasks((s) => s.tasks));
  return (
    <>
      <input
        className="d-in"
        list="d-projects"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Proyecto al aceptar (opcional)"
        style={{ width: 220 }}
      />
      <datalist id="d-projects">
        {projects.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </>
  );
}

/** Reunión en curso (o estado de la última búsqueda de tareas), con empezar/terminar. */
function LiveCard({ live, onErr }: { live: Live | undefined; onErr: (e: string) => void }) {
  if (!live) return null;
  return (
    <div className="d-card">
      <div className="d-row">
        <Icon name="mic" />
        <b>{live.active ? "Escuchando la reunión" : "Escuchar una reunión"}</b>
        <span className="d-dim">{live.status}</span>
        <button
          className={live.active ? "d-b" : "d-b pri"}
          style={{ marginLeft: "auto" }}
          onClick={() =>
            call(live.active ? "meeting_stop" : "meeting_start", llms()).catch((e) => onErr(String(e)))
          }
        >
          <Icon name={live.active ? "stop" : "mic"} size="1em" /> {live.active ? "Terminar" : "Empezar"}
        </button>
      </div>
      {live.active && live.lines.length > 0 && (
        <div className="d-list" style={{ maxHeight: 220, overflowY: "auto" }}>
          {live.lines.slice(-12).map((l, i) => (
            <div key={i}>
              <b style={{ color: l.who === "Yo" ? "var(--accent,#e8523c)" : undefined }}>{l.who}</b> {l.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Transcripciones pasadas: búsqueda en todas, lectura, tareas sugeridas de cada una y reintento del LLM. */
export function Meetings({ id }: { id?: number }) {
  const live = usePoll<Live>("meeting_state", 1500);
  const [list, setList] = useState<Saved[]>([]);
  useEffect(() => void call<Saved[]>("meetings_list").then(setList, () => {}), [live?.active]);
  const sugs = useLive(() => db.listSuggestions()) ?? [];
  const [q, setQ] = useState("");
  const [who, setWho] = useState<"" | "Yo" | "Otros">("");
  const [project, setProject] = useState("");
  const [err, setErr] = useState("");

  const shown = q ? list.filter((m) => countHits(m.text, q)) : list;
  const cur = list.find((m) => m.id === id) ?? shown[0];
  const mine = sugs.filter((s) => s.meeting === cur?.id);
  const lines = cur ? parse(cur.text).filter((l) => !who || l.who === who) : [];
  const pendingOf = (mid: number) => sugs.filter((s) => s.meeting === mid && s.status === "pending").length;
  const busy = live?.status.startsWith("Buscando tareas");

  return (
    <>
      <h1 className="d-h1">Reuniones</h1>
      <LiveCard live={live} onErr={setErr} />
      {err && <span style={{ color: "#ff6b6b" }}>{err}</span>}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(220px,300px) minmax(0,1fr)",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div className="d-card" style={{ position: "sticky", top: 16 }}>
          <input
            className="d-in"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar en todas las transcripciones…"
          />
          <div className="d-list" style={{ maxHeight: "70vh", overflowY: "auto" }}>
            {shown.map((m) => (
              <a
                key={m.id}
                href={`#meetings/${m.id}`}
                className="d-nav"
                aria-current={m.id === cur?.id ? "page" : undefined}
                style={{ display: "grid", gap: 2, alignItems: "start" }}
              >
                <span style={{ color: "inherit", fontWeight: 600 }}>{fmtDate(m.id * 1000)}</span>
                <span style={{ fontSize: 12 }}>
                  {words(m.text)} palabras
                  {q && ` · ${countHits(m.text, q)} coincidencias`}
                  {pendingOf(m.id) > 0 && ` · ${pendingOf(m.id)} por revisar`}
                </span>
              </a>
            ))}
            {!shown.length && (
              <span className="d-dim">{q ? "Nada coincide." : "Todavía no hay reuniones guardadas."}</span>
            )}
          </div>
        </div>

        {cur && (
          <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
            <div className="d-card">
              <div className="d-row">
                <b style={{ fontSize: 16 }}>{fmtDate(cur.id * 1000)}</b>
                <span className="d-dim">
                  {words(cur.text)} palabras · {parse(cur.text).length} intervenciones
                </span>
                <span style={{ marginLeft: "auto" }} />
                <button
                  className="d-b sm"
                  disabled={busy || live?.active}
                  title="Vuelve a mandar esta transcripción al LLM"
                  onClick={() =>
                    call("meeting_retry", { id: cur.id, ...llms() }).catch((e) => setErr(String(e)))
                  }
                >
                  <Icon name="zap" size="1em" /> {busy ? "Buscando…" : "Buscar tareas de nuevo"}
                </button>
                <button className="d-b sm" onClick={() => navigator.clipboard.writeText(cur.text)}>
                  <Icon name="copy" size="1em" /> Copiar
                </button>
                {db.IS_WEB && (
                  <button
                    className="d-b sm"
                    onClick={() =>
                      download(
                        `reunion-${new Date(cur.id * 1000).toISOString().slice(0, 16).replace(":", "")}.md`,
                        cur.text,
                        "text/markdown",
                      )
                    }
                  >
                    <Icon name="download" size="1em" /> .md
                  </button>
                )}
              </div>
              <div className="d-row">
                <span className="d-label">Tareas sugeridas</span>
                <span style={{ marginLeft: "auto" }} />
                {mine.some((s) => s.status === "pending") && (
                  <ProjectInput value={project} onChange={setProject} />
                )}
              </div>
              <div className="d-list">
                {mine.map((s) => (
                  <SuggestionRow key={s.id} s={s} project={project} />
                ))}
                {!mine.length && (
                  <span className="d-dim">
                    Sin sugerencias guardadas para esta reunión. “Buscar tareas de nuevo” las pide al LLM.
                  </span>
                )}
              </div>
            </div>

            <div className="d-card">
              <div className="d-row">
                <span className="d-label">Transcripción</span>
                <span style={{ marginLeft: "auto" }} />
                {(["", "Yo", "Otros"] as const).map((w) => (
                  <button key={w} className={`d-b sm ${who === w ? "on" : ""}`} onClick={() => setWho(w)}>
                    {w || "Todos"}
                  </button>
                ))}
              </div>
              <div className="d-list" style={{ gap: 8 }}>
                {lines.map((l, i) => (
                  <div key={i}>
                    <b style={{ color: l.who === "Yo" ? "#e8523c" : "#8b8b99" }}>{l.who}</b>{" "}
                    <Hl text={l.text} q={q} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const STATUS = {
  pending: "Pendientes",
  accepted: "Aceptadas",
  dismissed: "Descartadas",
  "": "Todas",
} as const;

/** Sugerencias de tareas de todas las reuniones, agrupadas por reunión. */
export function Suggestions() {
  const [status, setStatus] = useState<keyof typeof STATUS>("pending");
  const [project, setProject] = useState("");
  const sugs = useLive(() => db.listSuggestions(status || undefined), [status]) ?? [];
  const meetings = [...new Set(sugs.map((s) => s.meeting))];
  const pending = sugs.filter((s) => s.status === "pending");

  return (
    <>
      <h1 className="d-h1">Sugerencias de reuniones</h1>
      <div className="d-row">
        {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((k) => (
          <button key={k} className={`d-b ${status === k ? "on" : ""}`} onClick={() => setStatus(k)}>
            {STATUS[k]}
          </button>
        ))}
        <span style={{ marginLeft: "auto" }} />
        {pending.length > 0 && (
          <>
            <ProjectInput value={project} onChange={setProject} />
            <button
              className="d-b"
              onClick={async () => {
                for (const s of pending) await db.acceptSuggestion(s, s.title, project.trim() || null);
              }}
            >
              <Icon name="check" size="1em" /> Aceptar las {pending.length}
            </button>
            <button
              className="d-b"
              onClick={async () => {
                for (const s of pending) await db.setSuggestion(s.id, "dismissed");
              }}
            >
              Descartar todas
            </button>
          </>
        )}
      </div>
      {meetings.map((m) => (
        <div key={m} className="d-card">
          <a href={`#meetings/${m}`} className="d-row" style={{ color: "inherit", textDecoration: "none" }}>
            <Icon name="mic" size="1em" /> <b>{fmtDate(m * 1000)}</b>{" "}
            <span className="d-dim">ver transcripción →</span>
          </a>
          <div className="d-list">
            {sugs
              .filter((s) => s.meeting === m)
              .map((s) => (
                <SuggestionRow key={s.id} s={s} project={project} />
              ))}
          </div>
        </div>
      ))}
      {!sugs.length && <span className="d-dim">Nada por aquí.</span>}
    </>
  );
}
