import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as db from "../lib/db";
import { useSettings } from "../store/useSettings";
import { Icon } from "./icons";
import idleSprite from "../../examples/candolita/idle.png";
import { candolaAsk, candolaCancel, candolaReset } from "../lib/candolaChat";

type Line = { kind: "you" | "text" | "tool" | "err"; text: string };
type Denial = { tool_name: string; tool_input: { command?: string } };
/** Línea de `claude -p --output-format stream-json` (solo los campos que usa el panel). */
type ClaudeEvent = {
  type: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  permission_denials?: Denial[];
  message?: {
    content?: {
      type: string;
      text?: string;
      name?: string;
      input?: { command?: string; file_path?: string; pattern?: string };
    }[];
  };
};

/** Regla de --allowedTools para aprobar exactamente lo que Claude intentó. */
export const ruleFor = (d: Denial) =>
  d.tool_name === "Bash" && d.tool_input.command ? `Bash(${d.tool_input.command})` : d.tool_name;
const label = (d: Denial) => d.tool_input.command ?? d.tool_name;
// "Nuevo chat" se recuerda entre aperturas del panel: el historial solo trae lo posterior.
// ponytail: localStorage del webview del panel; el chat_log completo sigue en la DB como traza.
const CLEARED = "chat:clearedAt";
const clearedAt = () => Number(localStorage.getItem(CLEARED)) || 0;

const SUGGESTIONS = ["¿Qué tengo para hoy?", "¿Qué quedó de la última reunión?", "¿Cómo va mi semana?"];

/** Orden dictada con el atajo de voz; `n` sube con cada una. */
export type VoicePrompt = { text: string; n: number };
// La pestaña se monta y desmonta: cada orden dictada corre una sola vez, aunque se vuelva a montar.
let voiceDone = 0;

/** Chat estilo CLI con Claude Code (claude.rs). Solo lectura por defecto; lo demás se confirma o va en modo dios. */
export function ChatTab({ voice }: { voice?: VoicePrompt }) {
  const cwd = useSettings((s) => s.prefs.claudeCwd);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [god, setGod] = useState(false); // ponytail: no se guarda; al reabrir la pestaña vuelve a seguro
  const [pending, setPending] = useState<Denial[]>([]);
  const session = useRef<string | null>(null);
  const spoken = useRef(false); // la orden en curso vino por voz: su respuesta se lee en voz alta
  const log = useRef<HTMLDivElement>(null);
  // Modo Windows (F19): sin Claude Code, el chat va al proxy con las herramientas de la app (candolaChat.ts).
  const [proxy, setProxy] = useState(false);
  useEffect(() => {
    invoke<boolean>("ai_proxy")
      .then(setProxy)
      .catch(() => {});
  }, []);
  const add = (l: Line) => setLines((ls) => [...ls, l]);

  // Historial (chat_log): muestra lo último y retoma la última conversación.
  useEffect(() => {
    let alive = true; // StrictMode monta dos veces en dev: solo cuenta la última carga
    db.chatHistory(clearedAt()).then((rows) => {
      if (!alive) return;
      setLines((ls) => [
        ...rows.flatMap((r): Line[] => [
          { kind: "you", text: r.prompt },
          ...(r.tools ? r.tools.split("\n").map((t): Line => ({ kind: "tool", text: t })) : []),
          ...(r.reply ? [{ kind: r.outcome === "oops" ? "err" : "text", text: r.reply } as Line] : []),
        ]),
        ...ls,
      ]);
      session.current ??= rows[rows.length - 1]?.session ?? null;
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const unEv = listen<ClaudeEvent>("claude://event", ({ payload: e }) => {
      if (e.session_id) session.current = e.session_id;
      if (e.type === "assistant")
        for (const c of e.message?.content ?? []) {
          if (c.type === "text" && c.text?.trim()) add({ kind: "text", text: c.text.trim() });
          if (c.type === "tool_use")
            add({
              kind: "tool",
              text: c.input?.command ?? c.input?.file_path ?? c.input?.pattern ?? c.name ?? "?",
            });
        }
      if (e.type === "result") {
        if (e.is_error) add({ kind: "err", text: e.result ?? "error" });
        setPending(e.permission_denials ?? []);
        if (spoken.current && !e.is_error && e.result && useSettings.getState().prefs.voice)
          invoke("voice_say", { text: e.result }).catch(() => {});
        spoken.current = false;
      }
    });
    const unExit = listen<{ error: string }>("claude://exit", ({ payload }) => {
      if (payload.error) add({ kind: "err", text: payload.error });
      setBusy(false);
    });
    return () => {
      unEv.then((f) => f());
      unExit.then((f) => f());
    };
  }, []);
  useEffect(() => void log.current?.scrollTo(0, log.current.scrollHeight), [lines.length, pending.length]);

  const ask = (prompt: string, allow: string[] = []) => {
    setBusy(true);
    setPending([]);
    const run = proxy
      ? candolaAsk(prompt)
      : invoke("claude_ask", { prompt, session: session.current, allow, god, cwd });
    run.catch((e) => {
      add({ kind: "err", text: String(e) });
      setBusy(false);
    });
  };
  const run = (p: string, byVoice = false) => {
    spoken.current = byVoice;
    add({ kind: "you", text: byVoice ? `🎙 ${p}` : p });
    ask(p);
  };
  // Lo dictado espera a que termine la orden en curso (claude.rs corre una a la vez).
  useEffect(() => {
    if (!voice || voice.n <= voiceDone || busy) return;
    voiceDone = voice.n;
    run(voice.text, true);
  });
  const send = () => {
    const p = input.trim();
    if (!p || busy) return;
    setInput("");
    run(p);
  };
  const approve = () => {
    add({ kind: "you", text: "✓ aprobado" });
    ask("Aprobado, ejecútalo tal cual.", pending.map(ruleFor));
  };

  const color = { you: "var(--accent)", text: "var(--text)", tool: "var(--muted)", err: "#ff6b6b" };
  const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
  return (
    <div className="stack" style={{ gap: ".7em" }}>
      <div
        ref={log}
        className="card"
        style={{
          // ocupa el alto que dejan encabezado, input y navegación
          height: "calc(100vh - 20.8em)",
          minHeight: "12em",
          overflowY: "auto",
          display: "grid",
          gap: ".55em",
          alignContent: "start",
          background: "#0e0e14",
          borderColor: god ? "#ff6b6b88" : undefined,
          boxShadow: god ? "0 0 0 3px #ff6b6b22" : undefined,
          fontFamily: mono,
          fontSize: ".82em",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {lines.length === 0 && (
          <div
            className="stack center"
            style={{ paddingTop: "1.5em", fontFamily: "system-ui", whiteSpace: "normal", gap: ".8em" }}
          >
            <div
              className="pn-avatar"
              style={{
                width: "3.6em",
                height: "3.6em",
                backgroundImage: `url(${idleSprite})`,
                backgroundSize: "14.4em 3.6em",
                animation: "pn-sprite-lg 1s steps(4) infinite",
              }}
            />
            <b>¡Guau! Soy la Candola</b>
            <span className="small muted" style={{ maxWidth: "22em" }}>
              {proxy
                ? "Tu mascota asistente. Manejo tus tareas, el timer y tus reuniones."
                : "Tu mascota asistente. Reviso tu computador, Docker y tus servidores; lo que cambie algo te lo pregunto antes."}
            </span>
            <div className="stack" style={{ width: "100%", gap: ".4em", marginTop: ".3em" }}>
              {SUGGESTIONS.map((p) => (
                <button
                  key={p}
                  className="b b-sm"
                  style={{ justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left" }}
                  disabled={busy}
                  onClick={() => run(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {lines.map((l, i) =>
          l.kind === "tool" ? (
            <div key={i} className="row" style={{ color: color.tool, gap: ".4em", alignItems: "flex-start" }}>
              <span style={{ marginTop: ".2em" }}>
                <Icon name="terminal" size=".95em" />
              </span>
              <span className="grow">{l.text}</span>
            </div>
          ) : (
            <div
              key={i}
              style={{
                color: color[l.kind],
                marginTop: l.kind === "you" && i ? ".5em" : 0,
                fontWeight: l.kind === "you" ? 600 : 400,
              }}
            >
              {l.kind === "you" && "› "}
              {l.text}
            </div>
          ),
        )}
        {busy && (
          <span className="muted" style={{ animation: "pn-pulse 1.4s infinite" }}>
            Candola está pensando…{" "}
            <button
              className="b b-ghost b-sm"
              onClick={() => (proxy ? candolaCancel() : invoke("claude_cancel"))}
            >
              Cancelar
            </button>
          </span>
        )}
        {pending.length > 0 && !busy && (
          <div
            className="stack"
            style={{
              gap: ".5em",
              padding: ".7em",
              borderRadius: "var(--r-sm)",
              border: "1px solid var(--accent)",
              background: "var(--accent-soft)",
              fontFamily: "system-ui",
              whiteSpace: "normal",
            }}
          >
            <b>Quiere ejecutar</b>
            {pending.map((d, i) => (
              <code key={i} style={{ color: "#ffd479", fontFamily: mono, overflowWrap: "anywhere" }}>
                {label(d)}
              </code>
            ))}
            <div className="row">
              <button className="b b-primary b-sm" onClick={approve}>
                <Icon name="check" size="1em" /> Sí, hazlo
              </button>
              <button className="b b-ghost b-sm" onClick={() => setPending([])}>
                No
              </button>
            </div>
          </div>
        )}
      </div>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="field-wrap grow">
          <span
            style={{
              position: "absolute",
              left: ".8em",
              color: "var(--accent)",
              fontFamily: mono,
              fontWeight: 700,
              pointerEvents: "none",
            }}
          >
            ›
          </span>
          <input
            className="field"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={busy ? "esperando…" : "escribe una orden"}
            style={{ fontFamily: mono, fontSize: ".9em", paddingLeft: "2em" }}
          />
        </div>
        <button className="b b-primary b-sq" aria-label="Enviar" disabled={busy || !input.trim()}>
          <Icon name="send" />
        </button>
      </form>

      <div className="row small" style={{ justifyContent: "space-between" }}>
        <label
          className="row"
          style={{
            gap: ".5em",
            cursor: "pointer",
            color: god ? "#ff6b6b" : "var(--muted)",
            visibility: proxy ? "hidden" : undefined, // sin terminal no hay nada que aprobar
          }}
        >
          <input
            type="checkbox"
            className="switch"
            checked={god}
            onChange={(e) => setGod(e.target.checked)}
          />
          <Icon name="zap" size="1em" />
          {god ? "Modo dios: sin pedir permiso" : "Modo dios"}
        </label>
        <button
          className="b b-ghost b-sm"
          disabled={busy}
          onClick={() => {
            localStorage.setItem(CLEARED, String(Date.now()));
            session.current = null;
            candolaReset();
            setLines([]);
            setPending([]);
          }}
        >
          <Icon name="plus" size="1em" /> Nuevo chat
        </button>
      </div>
    </div>
  );
}
