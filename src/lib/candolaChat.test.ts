import { describe, expect, it, vi } from "vitest";
import { runTools, section, systemPrompt } from "./candolaChat";

vi.mock("./db", () => ({ logChat: vi.fn() })); // db.ts necesita el webview

describe("candolaChat", () => {
  it("el prompt toma de candola.md solo personalidad y herramientas, sin terminal", () => {
    const p = systemPrompt(new Date(2026, 9, 26, 9, 30));
    expect(p).toContain("Candolita");
    expect(p).toContain("list_tasks");
    expect(p).not.toContain("Docker");
    expect(p).toContain("2026");
    expect(section("## A\nuno\n## B\ndos", "B")).toBe("dos");
    expect(section("## A\nuno", "Z")).toBe("");
  });

  it("runTools: respuesta como texto JSON, errores como texto y argumentos vacíos", async () => {
    const seen: unknown[] = [];
    const run = async (name: string, args?: Record<string, unknown>) => {
      seen.push([name, args]);
      if (name === "mal") throw new Error("no existe la tarea 9");
      return name === "texto" ? "sin coincidencias" : { ok: true };
    };
    const out = await runTools(
      [
        { id: "a", function: { name: "list_tasks", arguments: '{"filter":"today"}' } },
        { id: "b", function: { name: "mal", arguments: "" } },
        { id: "c", function: { name: "texto" } },
      ],
      run,
    );
    expect(out).toEqual([
      { role: "tool", tool_call_id: "a", content: '{"ok":true}' },
      { role: "tool", tool_call_id: "b", content: "Error: no existe la tarea 9" },
      { role: "tool", tool_call_id: "c", content: "sin coincidencias" },
    ]);
    expect(seen).toEqual([
      ["list_tasks", { filter: "today" }],
      ["mal", {}],
      ["texto", {}],
    ]);
  });
});
