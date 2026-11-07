import { describe, expect, it, vi } from "vitest";
import {
  cancelProposals,
  decide,
  onProposals,
  propose,
  runGoogleTool,
  toIso,
  type Proposal,
} from "./googleTools";

/** `invoke` falso: responde por comando y anota lo que se llamó. */
const fake = (email: string | null, replies: Record<string, unknown> = {}) => {
  const calls: [string, unknown][] = [];
  const run = vi.fn(async (cmd: string, args?: unknown) => {
    calls.push([cmd, args]);
    if (cmd === "google_status") return { configured: true, email };
    if (cmd in replies) return replies[cmd];
    throw new Error(`no esperado: ${cmd}`);
  });
  return { run: run as never, calls };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("googleTools: propuestas", () => {
  it("correo: tarjeta con destinatario y asunto; el botón corre gmail_send", () => {
    const p = propose(
      "email_send",
      { to: "juan@x.com", subject: "Hola", body: "¿Nos vemos mañana?" },
      new Map(),
    );
    expect(p).toMatchObject({ title: "Enviar correo", ok: "Enviar", cmd: "gmail_send" });
    expect(p.lines).toEqual(["Para: juan@x.com", "Asunto: Hola", "¿Nos vemos mañana?"]);
    expect(p.args).toEqual({ to: "juan@x.com", subject: "Hola", body: "¿Nos vemos mañana?" });
    expect(() => propose("email_send", { to: "", body: "x" }, new Map())).toThrow("falta to");
  });

  it("crear evento: fechas a UTC y asistentes solo si vienen", () => {
    const a = { title: "Daily", start: "2026-11-07T10:00:00-03:00", end: "2026-11-07T10:30:00-03:00" };
    const p = propose("calendar_create", a, new Map());
    expect(p.cmd).toBe("calendar_event_create");
    expect(p.args).toEqual({
      title: "Daily",
      start: "2026-11-07T13:00:00.000Z",
      end: "2026-11-07T13:30:00.000Z",
    });
    expect(p.lines[0]).toBe("«Daily»");
    const con = propose(
      "calendar_create",
      { ...a, attendees: ["ana@x.com"], description: "pauta" },
      new Map(),
    );
    expect(con.args).toMatchObject({ attendees: ["ana@x.com"], description: "pauta" });
    expect(con.lines[con.lines.length - 1]).toBe("Con: ana@x.com (les llega el aviso)");
    expect(() => propose("calendar_create", { ...a, start: "mañana" }, new Map())).toThrow("fecha inválida");
  });

  it("mover y borrar: nombra el evento visto en calendar_list", () => {
    const known = new Map([
      ["e1", { title: "Cliente", start: "2026-11-07T13:00:00Z", end: "2026-11-07T14:00:00Z" }],
    ]);
    const mv = propose(
      "calendar_update",
      { id: "e1", start: "2026-11-08T13:00:00Z", end: "2026-11-08T14:00:00Z" },
      known,
    );
    expect(mv).toMatchObject({ title: "Mover evento", ok: "Guardar", cmd: "calendar_event_update" });
    expect(mv.args).toEqual({ id: "e1", start: "2026-11-08T13:00:00.000Z", end: "2026-11-08T14:00:00.000Z" });
    expect(mv.lines[0]).toMatch(/^«Cliente» \(/);
    expect(mv.lines[1]).toMatch(/^Nueva hora: /);
    expect(propose("calendar_update", { id: "e1", title: "Cliente (Zoom)" }, known)).toMatchObject({
      title: "Editar evento",
      args: { id: "e1", title: "Cliente (Zoom)" },
    });
    expect(() => propose("calendar_update", { id: "e1", start: "2026-11-08T13:00:00Z" }, known)).toThrow(
      "juntos",
    );
    expect(() => propose("calendar_update", { id: "e1" }, known)).toThrow("nada que cambiar");
    const del = propose("calendar_delete", { id: "e1" }, known);
    expect(del).toMatchObject({
      title: "Borrar evento",
      ok: "Borrar",
      cmd: "calendar_event_delete",
      args: { id: "e1" },
    });
    expect(propose("calendar_delete", { id: "zz" }, known).lines).toEqual(["evento zz"]);
  });

  it("toIso acepta offset y hora local, rechaza texto", () => {
    expect(toIso("2026-11-07T10:00:00-03:00")).toBe("2026-11-07T13:00:00.000Z");
    expect(toIso("2026-11-07T10:00")).toBe(new Date(2026, 10, 7, 10).toISOString());
    expect(() => toIso(undefined)).toThrow();
  });
});

describe("googleTools: nada corre sin el clic", () => {
  it("sin sesión de Google responde que hay que conectar", async () => {
    const { run, calls } = fake(null);
    expect(await runGoogleTool("email_send", { to: "a@x.com", body: "x" }, run)).toMatch(
      /Ajustes → Conexiones/,
    );
    expect(calls.map((c) => c[0])).toEqual(["google_status"]);
  });

  it("la propuesta espera; Enviar ejecuta y el resultado vuelve como texto", async () => {
    const { run, calls } = fake("yo@x.com", { gmail_send: { sent: true, id: "m1" } });
    let seen: Proposal[] = [];
    const off = onProposals((ps) => (seen = ps));
    const out = runGoogleTool("email_send", { to: "a@x.com", subject: "Hola", body: "x" }, run);
    await tick();
    expect(seen).toHaveLength(1);
    expect(calls.map((c) => c[0])).toEqual(["google_status"]); // todavía no se envió nada
    await decide(seen[0].id, true, run);
    expect(await out).toBe('{"sent":true,"id":"m1"}');
    expect(calls[calls.length - 1]).toEqual(["gmail_send", { to: "a@x.com", subject: "Hola", body: "x" }]);
    expect(seen).toEqual([]);
    off();
  });

  it("Cancelar (o cancelar el chat) no ejecuta nada", async () => {
    const { run, calls } = fake("yo@x.com");
    let seen: Proposal[] = [];
    const off = onProposals((ps) => (seen = ps));
    const a = runGoogleTool("calendar_delete", { id: "e9" }, run);
    const b = runGoogleTool("calendar_delete", { id: "e8" }, run);
    await tick();
    await decide(seen[0].id, false, run);
    expect(await a).toMatch(/canceló/);
    cancelProposals();
    expect(await b).toMatch(/canceló/);
    expect(calls.every((c) => c[0] === "google_status")).toBe(true);
    off();
  });

  it("calendar_list lee directo y recuerda los títulos para las tarjetas", async () => {
    const ev = { id: "e1", title: "Cliente", start: "2026-11-07T13:00:00Z", end: "2026-11-07T14:00:00Z" };
    const { run, calls } = fake("yo@x.com", { calendar_events: [ev] });
    expect(await runGoogleTool("calendar_list", { from: "2026-11-07T00:00:00Z" }, run)).toEqual([ev]);
    expect(calls[1]).toEqual([
      "calendar_events",
      { from: "2026-11-07T00:00:00.000Z", to: "2026-11-14T00:00:00.000Z" },
    ]);
    let seen: Proposal[] = [];
    const off = onProposals((ps) => (seen = ps));
    const out = runGoogleTool("calendar_delete", { id: "e1" }, run);
    await tick();
    expect(seen[0].lines[0]).toMatch(/^«Cliente»/);
    cancelProposals();
    await out;
    off();
  });

  it("un error del comando vuelve al modelo como texto", async () => {
    const { run } = fake("yo@x.com");
    let seen: Proposal[] = [];
    const off = onProposals((ps) => (seen = ps));
    const out = runGoogleTool(
      "calendar_create",
      { title: "X", start: "2026-11-07T13:00:00Z", end: "2026-11-07T14:00:00Z" },
      run,
    );
    await tick();
    await decide(seen[0].id, true, run);
    expect(await out).toMatch(/^Error: .*no esperado: calendar_event_create/);
    off();
  });
});
