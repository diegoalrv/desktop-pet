// Herramientas de Google para el chat de la Candola (candolaChat.ts). Leer el calendario corre directo; enviar un
// correo o crear/mover/borrar un evento NUNCA: la herramienta deja una propuesta que ChatTab muestra como tarjeta y
// solo el clic en el botón ejecuta el comando de google.rs. Lo que pase (hecho, error o cancelado) vuelve al modelo
// como resultado de la herramienta.
import { invoke } from "@tauri-apps/api/core";

type Args = Record<string, unknown>;

const fn = (name: string, description: string, properties: Args, required: string[] = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const str = (description: string) => ({ type: "string", description });
const ISO = "fecha y hora ISO 8601 con offset, p. ej. 2026-11-07T10:00:00-03:00";
const ASK =
  "La app le muestra la propuesta al humano y solo se hace si aprieta el botón; no le pidas confirmación por chat.";
const ATTENDEES = {
  type: "array",
  items: { type: "string" },
  description: "correos de los invitados (se les avisa)",
};

export const GOOGLE_TOOLS = [
  fn(
    "calendar_list",
    "Eventos del Google Calendar del humano entre dos fechas, con su id (para editarlos o borrarlos).",
    { from: str(`${ISO}; por defecto ahora`), to: str(`${ISO}; por defecto en 7 días`) },
  ),
  fn(
    "email_send",
    `Propone enviar un correo de texto desde el Gmail del humano. ${ASK}`,
    { to: str("destinatarios separados por coma"), subject: str("asunto"), body: str("texto del correo") },
    ["to", "subject", "body"],
  ),
  fn(
    "calendar_create",
    `Propone crear un evento en el calendario principal. ${ASK}`,
    {
      title: str("título"),
      start: str(ISO),
      end: str(ISO),
      description: str("descripción"),
      attendees: ATTENDEES,
    },
    ["title", "start", "end"],
  ),
  fn(
    "calendar_update",
    `Propone cambiar un evento (id de calendar_list): solo los campos que cambian; start y end van juntos. ${ASK}`,
    {
      id: str("id del evento"),
      title: str("título nuevo"),
      start: str(ISO),
      end: str(ISO),
      description: str("descripción nueva"),
      attendees: ATTENDEES,
    },
    ["id"],
  ),
  fn(
    "calendar_delete",
    `Propone borrar un evento (id de calendar_list). ${ASK}`,
    { id: str("id del evento") },
    ["id"],
  ),
];
export const isGoogleTool = (name: string) => GOOGLE_TOOLS.some((t) => t.function.name === name);

/** Lo que muestra la tarjeta y el comando de google.rs que corre el botón. */
export type Proposal = { id: number; title: string; lines: string[]; ok: string; cmd: string; args: Args };
type Ev = { title: string; start: string; end: string };

const NOT_CONNECTED = "Google no está conectado: dile que conecte su cuenta en Ajustes → Conexiones.";
const CANCELLED = "El humano canceló: no se hizo nada.";

/** ISO en UTC; acepta hora local sin offset ("2026-11-07T10:00", como la entiende el navegador). */
export const toIso = (s: unknown) => {
  const d = new Date(String(s ?? ""));
  if (!s || isNaN(d.getTime())) throw new Error(`fecha inválida: ${String(s)}`);
  return d.toISOString();
};
const when = (start: string, end: string) => {
  const day = { weekday: "short", day: "numeric", month: "short" } as const;
  const hm = { hour: "2-digit", minute: "2-digit" } as const;
  const [s, e] = [new Date(start), new Date(end)];
  const t = (d: Date) => d.toLocaleTimeString("es-CL", hm);
  return `${s.toLocaleDateString("es-CL", day)}, ${t(s)}–${s.toDateString() === e.toDateString() ? t(e) : e.toLocaleString("es-CL", { ...day, ...hm })}`;
};
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown) => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);
const withPeople = (a: string[]) => (a.length ? [`Con: ${a.join(", ")} (les llega el aviso)`] : []);

/** Arma la propuesta de una herramienta que escribe; `known` = eventos vistos en calendar_list (para nombrarlos). */
export function propose(name: string, a: Args, known: Map<string, Ev>, id = 0): Proposal {
  const need = (k: string) => {
    const v = text(a[k]);
    if (!v) throw new Error(`falta ${k}`);
    return v;
  };
  const opt = <T>(k: string, v: T) => (a[k] === undefined || a[k] === null ? {} : { [k]: v });
  if (name === "email_send") {
    const [to, subject, body] = [need("to"), text(a.subject), need("body")];
    const preview = body.length > 400 ? body.slice(0, 400) + "…" : body;
    return {
      id,
      title: "Enviar correo",
      lines: [`Para: ${to}`, `Asunto: ${subject || "(sin asunto)"}`, preview],
      ok: "Enviar",
      cmd: "gmail_send",
      args: { to, subject, body },
    };
  }
  if (name === "calendar_create") {
    const [title, start, end] = [need("title"), toIso(a.start), toIso(a.end)];
    const attendees = list(a.attendees);
    return {
      id,
      title: "Crear evento",
      lines: [`«${title}»`, when(start, end), ...withPeople(attendees)],
      ok: "Crear",
      cmd: "calendar_event_create",
      args: { title, start, end, ...opt("description", text(a.description)), ...opt("attendees", attendees) },
    };
  }
  const ev = need("id");
  const old = known.get(ev);
  const name0 = old ? `«${old.title || "(sin título)"}» (${when(old.start, old.end)})` : `evento ${ev}`;
  if (name === "calendar_delete")
    return {
      id,
      title: "Borrar evento",
      lines: [name0],
      ok: "Borrar",
      cmd: "calendar_event_delete",
      args: { id: ev },
    };
  if (name !== "calendar_update") throw new Error(`herramienta desconocida: ${name}`);
  if (!a.start !== !a.end) throw new Error("start y end van juntos");
  const moved = a.start ? { start: toIso(a.start), end: toIso(a.end) } : {};
  const attendees = list(a.attendees);
  const lines = [
    name0,
    ...(moved.start ? [`Nueva hora: ${when(moved.start, moved.end)}`] : []),
    ...(text(a.title) ? [`Nuevo título: «${text(a.title)}»`] : []),
    ...(a.description !== undefined ? ["Nueva descripción"] : []),
    ...(a.attendees !== undefined ? withPeople(attendees) : []),
  ];
  if (lines.length === 1) throw new Error("no hay nada que cambiar");
  return {
    id,
    title: moved.start ? "Mover evento" : "Editar evento",
    lines,
    ok: "Guardar",
    cmd: "calendar_event_update",
    args: {
      id: ev,
      ...moved,
      ...(text(a.title) ? { title: text(a.title) } : {}),
      ...opt("description", text(a.description)),
      ...opt("attendees", attendees),
    },
  };
}

// Propuestas esperando el clic. ponytail: en memoria del webview del panel (cerrar la app las descarta).
const waiting = new Map<number, { p: Proposal; done: (r: string) => void }>();
const subs = new Set<(ps: Proposal[]) => void>();
const notify = () => subs.forEach((f) => f([...waiting.values()].map((w) => w.p)));
const known = new Map<string, Ev>();
let seq = 0;

/** ChatTab se suscribe a las propuestas pendientes (recibe las actuales al tiro). */
export function onProposals(f: (ps: Proposal[]) => void) {
  subs.add(f);
  f([...waiting.values()].map((w) => w.p));
  return () => void subs.delete(f);
}

/** El clic de la tarjeta: `ok` ejecuta el comando; si no, se cancela. El resultado vuelve al modelo. */
export async function decide(id: number, ok: boolean, run = invoke) {
  const w = waiting.get(id);
  if (!w) return;
  waiting.delete(id);
  notify();
  if (!ok) return w.done(CANCELLED);
  try {
    w.done(JSON.stringify((await run(w.p.cmd, w.p.args)) ?? "hecho"));
  } catch (e) {
    w.done(`Error: ${String(e)}`);
  }
}
export const cancelProposals = () => [...waiting.keys()].forEach((id) => decide(id, false));

/** Corre una herramienta de Google pedida por el modelo; las que escriben esperan a `decide`. */
export async function runGoogleTool(name: string, a: Args = {}, run = invoke): Promise<unknown> {
  const st = await run<{ email: string | null }>("google_status");
  if (!st.email) return NOT_CONNECTED;
  if (name === "calendar_list") {
    const from = a.from ? toIso(a.from) : new Date().toISOString();
    const to = a.to ? toIso(a.to) : new Date(Date.parse(from) + 7 * 86_400_000).toISOString();
    const evs = await run<(Ev & { id: string })[]>("calendar_events", { from, to });
    for (const e of evs) known.set(e.id, e);
    return evs;
  }
  const p = propose(name, a, known, ++seq);
  return new Promise<string>((done) => {
    waiting.set(p.id, { p, done });
    notify();
  });
}
