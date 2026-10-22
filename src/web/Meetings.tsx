import { useEffect, useState } from "react";
import { call, meetingCtx } from "../lib/ipc";
import * as db from "../lib/db";
import { useLive, useTasks } from "../store/useTasks";
import { useSettings } from "../store/useSettings";
import { projectsOf } from "../lib/tasks";
import { Icon } from "../panel/icons";
import { countHits, download, fmtDate, Head, Hl, SuggestionRow, usePoll } from "./kit";

// id = epoch s; title/attendees: evento del calendario, si lo había (meetings_list en meeting.rs)
type Saved = { id: number; text: string; title?: string; attendees?: string[] };
type Live = { active: boolean; status: string; lines: { who: string; text: string }[] };

const parse = (text: string) =>
  text
    .split("\n")
    .map((l) => l.match(/^(Yo|Otros): (.*)$/))
    .filter((m) => m != null)
    .map((m) => ({ who: m[1], text: m[2] }));
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const llms = () => ({ llms: useSettings.getState().prefs.llms }); // en la web Rust usa los de Ajustes
const titleOf = (m: Saved) => m.title || fmtDate(m.id * 1000);
/** El .md para copiar o descargar: título, fecha, asistentes, resumen y decisiones arriba de la transcripción. */
const toMd = (m: Saved, n?: db.Notes) =>
  [
    `# ${titleOf(m)}`,
    m.title ? fmtDate(m.id * 1000) : "",
    m.attendees?.length ? `Participantes: ${m.attendees.join(", ")}` : "",
    n?.summary && `## Resumen\n\n${n.summary}`,
    db.decisionsOf(n).length && `## Decisiones\n\n${db.decisionsOf(n).map((d) => `- ${d}`).join("\n")}`,
    n ? `## Transcripción\n\n${m.text}` : m.text,
  ]
    .filter(Boolean)
    .join("\n\n");

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
    <div className="d-card" style={live.active ? { borderColor: "var(--accent-soft)" } : undefined}>
      <div className="d-row">
        <span className="d-brand" style={{ padding: 0 }}>
          <i>
            <Icon name="mic" />
          </i>
        </span>
        <b>{live.active ? "Escuchando la reunión" : "Escuchar una reunión"}</b>
        <span className="d-dim">{live.status}</span>
        <button
          className={live.active ? "d-b" : "d-b pri"}
          style={{ marginLeft: "auto" }}
          onClick={async () => {
            const args = live.active ? {} : { ...llms(), ctx: await meetingCtx("") };
            call(live.active ? "meeting_stop" : "meeting_start", args).catch((e) => onErr(String(e)));
          }}
        >
          <Icon name={live.active ? "stop" : "mic"} size="1em" /> {live.active ? "Terminar" : "Empezar"}
        </button>
      </div>
      {live.active && live.lines.length > 0 && (
        <div className="d-list" style={{ maxHeight: 220, overflowY: "auto" }}>
          {live.lines.slice(-12).map((l, i) => (
            <div key={i}>
              <b style={{ color: l.who === "Yo" ? "var(--accent)" : "var(--muted)" }}>{l.who}</b> {l.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Reuniones: listado (búsqueda en todas las transcripciones) y, por reunión, su transcripción o sus tareas.
 *  #meetings · #meetings/<id> (transcripción) · #meetings/<id>/tareas */
export function Meetings({ id, tab }: { id?: number; tab?: string }) {
  const live = usePoll<Live>("meeting_state", 1500);
  const [list, setList] = useState<Saved[]>([]);
  useEffect(() => void call<Saved[]>("meetings_list").then(setList, () => {}), [live?.active]);
  const sugs = useLive(() => db.listSuggestions()) ?? [];
  const notes = useLive(() => db.listNotes()) ?? [];
  const [q, setQ] = useState("");
  const [who, setWho] = useState<"" | "Yo" | "Otros">("");
  const [project, setProject] = useState("");
  const [err, setErr] = useState("");

  const shown = q ? list.filter((m) => countHits(m.text, q)) : list;
  const cur = id ? list.find((m) => m.id === id) : undefined;
  const of = (mid: number) => sugs.filter((s) => s.meeting === mid);
  const busy = live?.status.startsWith("Buscando tareas");

  if (cur) {
    const mine = of(cur.id);
    const note = notes.find((n) => n.meeting === cur.id);
    const decisions = db.decisionsOf(note);
    const lines = parse(cur.text).filter((l) => !who || l.who === who);
    const tasks = tab === "tareas";
    return (
      <>
        <a href="#meetings" className="d-more" style={{ marginLeft: 0 }}>
          ← Reuniones
        </a>
        <Head
          title={titleOf(cur)}
          sub={[
            cur.title && fmtDate(cur.id * 1000),
            cur.attendees?.length && cur.attendees.join(", "),
            `${words(cur.text)} palabras · ${parse(cur.text).length} intervenciones`,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <button
            className="d-b sm"
            disabled={busy || live?.active}
            title="Vuelve a mandar esta transcripción al LLM"
            onClick={() => call("meeting_retry", { id: cur.id, ...llms() }).catch((e) => setErr(String(e)))}
          >
            <Icon name="zap" size="1em" /> {busy ? "Buscando…" : "Buscar tareas de nuevo"}
          </button>
          <button className="d-b sm" onClick={() => navigator.clipboard.writeText(toMd(cur, note))}>
            <Icon name="copy" size="1em" /> Copiar
          </button>
          {db.IS_WEB && (
            <button
              className="d-b sm"
              onClick={() =>
                download(
                  `reunion-${new Date(cur.id * 1000).toISOString().slice(0, 16).replace(":", "")}.md`,
                  toMd(cur, note),
                  "text/markdown",
                )
              }
            >
              <Icon name="download" size="1em" /> .md
            </button>
          )}
        </Head>
        {err && <span style={{ color: "var(--err)" }}>{err}</span>}
        {!parse(cur.text).some((l) => l.who === "Yo") && (
          <span className="d-item" style={{ color: "var(--warn)" }}>
            No se grabó tu micrófono en esta reunión: todo quedó como “Otros”. Revisa el permiso de micrófono
            de Desktop Pet en Ajustes del Sistema → Privacidad.
          </span>
        )}
        {(note?.summary || decisions.length > 0) && (
          <div className="d-card" style={{ maxWidth: "80ch" }}>
            {note?.summary && (
              <>
                <b>Resumen</b>
                <span style={{ whiteSpace: "pre-line" }}>{note.summary}</span>
              </>
            )}
            {decisions.length > 0 && (
              <>
                <b>Decisiones</b>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {decisions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </>
            )}
            <span className="d-dim" style={{ fontSize: 12 }}>
              {note!.model}
            </span>
          </div>
        )}
        <div className="d-row">
          <div className="d-seg">
            <a href={`#meetings/${cur.id}`} className={`d-b ${tasks ? "" : "on"}`}>
              Transcripción
            </a>
            <a href={`#meetings/${cur.id}/tareas`} className={`d-b ${tasks ? "on" : ""}`}>
              Tareas ({mine.length})
            </a>
          </div>
          <span style={{ marginLeft: "auto" }} />
          {tasks ? (
            mine.some((s) => s.status === "pending") && <ProjectInput value={project} onChange={setProject} />
          ) : (
            <div className="d-seg">
              {(["", "Yo", "Otros"] as const).map((w) => (
                <button key={w} className={`d-b sm ${who === w ? "on" : ""}`} onClick={() => setWho(w)}>
                  {w || "Todos"}
                </button>
              ))}
            </div>
          )}
        </div>
        {tasks ? (
          <div className="d-card">
            <div className="d-list">
              {mine.map((s) => (
                <SuggestionRow key={s.id} s={s} project={project} />
              ))}
              {!mine.length && (
                <span className="d-empty">
                  Sin sugerencias guardadas para esta reunión. “Buscar tareas de nuevo” las pide al LLM.
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="d-card">
            <div className="d-list" style={{ gap: 10, maxWidth: "80ch" }}>
              {lines.map((l, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "48px 1fr", gap: 8 }}>
                  <b style={{ color: l.who === "Yo" ? "var(--accent)" : "var(--muted)", fontSize: 13 }}>
                    {l.who}
                  </b>
                  <span>
                    <Hl text={l.text} q={q} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <Head title="Reuniones" sub={`${list.length} transcripciones guardadas`}>
        <input
          className="d-in"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
          placeholder="Buscar en todas las transcripciones…"
          style={{ width: 320, maxWidth: "100%" }}
        />
      </Head>
      <LiveCard live={live} onErr={setErr} />
      {err && <span style={{ color: "var(--err)" }}>{err}</span>}
      <div className="d-card" style={{ padding: 8 }}>
        {shown.map((m) => {
          const s = of(m.id);
          const pending = s.filter((x) => x.status === "pending").length;
          return (
            <div key={m.id} className="d-lrow">
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
                <b>{titleOf(m)}</b>
                <span className="d-dim" style={{ fontSize: 13 }}>
                  {m.title && `${fmtDate(m.id * 1000)} · `}
                  {words(m.text)} palabras · {parse(m.text).length} intervenciones
                  {q && ` · ${countHits(m.text, q)} coincidencias`}
                </span>
              </div>
              {pending > 0 && (
                <span className="d-pill" style={{ color: "var(--accent)" }}>
                  {pending} por revisar
                </span>
              )}
              <a href={`#meetings/${m.id}`} className="d-b sm">
                <Icon name="terminal" size="1em" /> Transcripción
              </a>
              <a href={`#meetings/${m.id}/tareas`} className="d-b sm">
                <Icon name="tasks" size="1em" /> Tareas ({s.length})
              </a>
            </div>
          );
        })}
        {!shown.length && (
          <span className="d-empty" style={{ padding: 10 }}>
            {q ? "Nada coincide." : "Todavía no hay reuniones guardadas."}
          </span>
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
      <Head title="Sugerencias" sub="Tareas que el LLM encontró en tus reuniones" />
      <div className="d-row">
        <div className="d-seg">
          {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((k) => (
            <button key={k} className={`d-b ${status === k ? "on" : ""}`} onClick={() => setStatus(k)}>
              {STATUS[k]}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: "auto" }} />
        {pending.length > 0 && (
          <>
            <ProjectInput value={project} onChange={setProject} />
            <button
              className="d-b pri"
              onClick={async () => {
                for (const s of pending) await db.acceptSuggestion(s, s.title, project.trim() || null);
              }}
            >
              <Icon name="check" size="1em" /> Aceptar las {pending.length}
            </button>
            <button
              className="d-b ghost"
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
          <div className="d-row">
            <Icon name="mic" size="1em" /> <b>{fmtDate(m * 1000)}</b>
            <a href={`#meetings/${m}`} className="d-more">
              ver transcripción →
            </a>
          </div>
          <div className="d-list">
            {sugs
              .filter((s) => s.meeting === m)
              .map((s) => (
                <SuggestionRow key={s.id} s={s} project={project} />
              ))}
          </div>
        </div>
      ))}
      {!sugs.length && <span className="d-empty">Nada por aquí.</span>}
    </>
  );
}
