// Chat con la Candola sin Claude Code (modo Windows, F19): bucle de herramientas propio contra el alias `candola` del
// proxy (`ai_chat` en ai.rs) con las mismas herramientas del MCP (mcp/tools.mjs), ejecutadas dentro de la app
// (`web_api`). Emite los mismos eventos que claude.rs, así ChatTab y la mascota no cambian.
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { makeCall, TOOLS } from "../../mcp/tools.mjs";
import candola from "../../src-tauri/src/candola.md?raw";
import { logChat } from "./db";

type ToolCall = { id: string; function: { name: string; arguments?: string } };
export type Msg = { role: string; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };

const MAX_TURNS = 8; // vueltas de herramientas por orden
const tools = TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.inputSchema },
}));
const call = makeCall((path, body) => invoke("web_api", { path, body }));

/** Sección `## título` de candola.md (sin el título); vacía si no está. */
export const section = (md: string, title: string) =>
  md
    .split(/^## /m)
    .find((s) => s.startsWith(title))
    ?.slice(title.length)
    .trim() ?? "";

/** El prompt de candola.md sin lo que acá no aplica (terminal, archivos, servidores). */
export const systemPrompt = (now: Date) =>
  [
    candola.split("\n\n")[0],
    "## Personalidad\n" + section(candola, "Personalidad"),
    "## Tu humano y su día\n" + section(candola, "Tu humano y su día"),
    "Aquí solo tienes las herramientas de la app: sin terminal, archivos ni internet. Si te piden algo de eso, " +
      "dilo en una línea y sigue con lo que sí puedes hacer.",
    `Ahora es ${now.toLocaleString("es-CL", { dateStyle: "full", timeStyle: "short" })}.`,
  ].join("\n\n");

/** Una vuelta: llama a cada herramienta pedida y devuelve sus respuestas como mensajes `tool`. */
export async function runTools(
  calls: ToolCall[],
  run: (name: string, args?: Record<string, unknown>) => Promise<unknown>,
) {
  return Promise.all(
    calls.map(async (c): Promise<Msg> => {
      let out: unknown;
      try {
        out = await run(c.function.name, JSON.parse(c.function.arguments || "{}"));
      } catch (e) {
        out = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
      return {
        role: "tool",
        tool_call_id: c.id,
        content: typeof out === "string" ? out : JSON.stringify(out),
      };
    }),
  );
}

let history: Msg[] = []; // la conversación en curso (se borra con "Nuevo chat")
let cancelled = false;
export const candolaReset = () => void (history = []);
export const candolaCancel = () => void (cancelled = true);

/** Una orden del chat: corre el bucle y avisa por `claude://event` / `claude://exit` como `claude -p`. */
export async function candolaAsk(prompt: string) {
  cancelled = false;
  await emit("claude://start");
  const msgs: Msg[] = [...history, { role: "user", content: prompt }];
  const used: string[] = [];
  let reply = "";
  let error = "";
  try {
    for (let turn = 0; ; turn++) {
      if (turn >= MAX_TURNS) throw new Error("Me enredé con las herramientas; prueba pidiéndolo más simple.");
      const system = { role: "system", content: systemPrompt(new Date()) };
      const m = await invoke<Msg>("ai_chat", { messages: [system, ...msgs], tools });
      if (cancelled) throw new Error("cancelado");
      msgs.push(m);
      const calls = m.tool_calls ?? [];
      const content = [
        ...(m.content?.trim() ? [{ type: "text", text: m.content }] : []),
        ...calls.map((c) => ({ type: "tool_use", name: c.function.name })),
      ];
      await emit("claude://event", { type: "assistant", message: { content } });
      if (!calls.length) {
        reply = m.content?.trim() ?? "";
        break;
      }
      used.push(...calls.map((c) => c.function.name));
      msgs.push(...(await runTools(calls, call)));
    }
    history = msgs;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  await emit("claude://event", { type: "result", result: reply || error, is_error: !!error });
  await emit("claude://exit", { outcome: error ? "oops" : "mission", error: "" });
  await logChat({
    prompt,
    reply: reply || error,
    tools: used.join("\n"),
    outcome: error ? "oops" : "mission",
  });
}
