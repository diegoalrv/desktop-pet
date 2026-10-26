import { describe, expect, it } from "vitest";
import { fmtMs, parseDue, rpc, search, TOOLS, toolsFor } from "./pet-mcp.mjs";

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

  it("fuera de la app solo sugiere", () => {
    const names = toolsFor(true).map((t) => t.name);
    expect(names).toContain("suggest_task");
    expect(names).not.toContain("add_task");
    expect(names).not.toContain("complete_task");
    expect(names).not.toContain("suggestion_set");
    expect(toolsFor(false)).toBe(TOOLS);
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
