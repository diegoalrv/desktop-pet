import { describe, expect, it } from "vitest";
import { fmtMs, groupRoutines, parseDue, rpc, search, taskChanges, TOOLS, toolsFor } from "./pet-mcp.mjs";

describe("pet-mcp", () => {
  it("JSON-RPC: initialize, notificaciones, tools/list y métodos desconocidos", async () => {
    const init = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    });
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect((await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).result.tools).toHaveLength(
      toolsFor(!process.env.PET_TOKEN).length,
    );
    expect((await rpc({ jsonrpc: "2.0", id: 3, method: "resources/list" })).error.code).toBe(-32601);
  });

  it("tools/call: resultado como texto y errores con isError", async () => {
    const req = { jsonrpc: "2.0", id: "a", method: "tools/call", params: { name: "x", arguments: { k: 1 } } };
    const ok = await rpc(req, async (n, a) => ({ n, k: a.k }));
    expect(ok.result).toEqual({ content: [{ type: "text", text: '{"n":"x","k":1}' }], isError: false });
    const err = await rpc(req, async () => {
      throw new Error("no");
    });
    expect(err.result).toEqual({ content: [{ type: "text", text: "no" }], isError: true });
  });

  it("fuera de la app no crea tareas, pero sí edita, comenta y cierra", () => {
    const names = toolsFor(true).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["suggest_task", "task_get", "update_task", "comment_task", "complete_task"]));
    expect(names).not.toContain("add_task");
    expect(names).not.toContain("suggestion_set");
    expect(toolsFor(false)).toBe(TOOLS);
  });

  it("update_task solo toca lo que viene", () => {
    expect(taskChanges({ id: 1, description: "  ficha  " })).toEqual({ description: "ficha" });
    expect(taskChanges({ description: "", project: " " })).toEqual({ description: null, project: null });
    expect(taskChanges({ due: "" })).toEqual({ due_at: null, notified: 0 });
    expect(taskChanges({ priority: 9, est_pomodoros: 0 })).toEqual({ priority: 2, est_pomodoros: 1 });
    expect(() => taskChanges({ title: " " })).toThrow("vacío");
    expect(() => taskChanges({ repeat: "yearly" })).toThrow("repeat");
    expect(taskChanges({ id: 3, done: true })).toEqual({});
  });

  it("fechas locales", () => {
    expect(fmtMs(parseDue("2026-10-24"))).toBe("2026-10-24 09:00");
    expect(fmtMs(parseDue(" 2026-10-24 17:30 "))).toBe("2026-10-24 17:30");
    expect(() => parseDue("viernes")).toThrow("fecha inválida");
    expect(() => parseDue("2026-02-30")).toThrow();
    expect(() => parseDue("2026-10-24 25:00")).toThrow();
  });

  it("busca en las transcripciones", () => {
    const ms = [
      { id: 1, text: "Yo: el plazo de Acme\nOtros: ok" },
      { id: 2, text: "Otros: Acme se atrasa" },
    ];
    expect(search(ms, "acme")).toEqual(["1 · Yo: el plazo de Acme", "2 · Otros: Acme se atrasa"]);
    expect(search(ms, "acme", 1)).toHaveLength(1);
    expect(search(ms, "  ")).toEqual([]);
  });
});

describe("rutinas", () => {
  it("agrupa los bloques por rutina, en orden", () => {
    const rows = [
      { id: 1, name: "Constanza", active: 1, activity: "Foco", min: 25 },
      { id: 1, name: "Constanza", active: 1, activity: "Descanso", min: 5 },
      { id: 1, name: "Constanza", active: 1, activity: "Pausa activa", min: 10 },
      { id: 2, name: "Vacía", active: 0, activity: null, min: null },
    ];
    expect(groupRoutines(rows)).toEqual([
      { id: 1, name: "Constanza", active: true, blocks: "Foco 25 · Descanso 5 · Pausa activa 10" },
      { id: 2, name: "Vacía", active: false, blocks: "" },
    ]);
  });
});
