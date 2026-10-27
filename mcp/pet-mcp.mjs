#!/usr/bin/env node
// Servidor MCP de Desktop Pet: la Candola (chat con `claude -p`) lee y maneja tareas, timer, reuniones y sugerencias.
// Proyecto aparte de la app: corre por stdio (lo lanza Claude Code con --mcp-config) y habla con la app solo por la
// API de la web local (`/api/select`, `/api/execute`, `/api/invoke`) con el token por arranque.
// Env: PET_PORT (4747 en la app instalada, 4748 en dev) y PET_TOKEN (lo pone la app al lanzar `claude`).
// Sin PET_TOKEN (lanzado por Claude Code o Claude Desktop/Cowork) lee el token que la app deja en
// `<app_data>/web-<PORT>.token` en cada pedido, así sobrevive a que la app se reinicie.
// ponytail: sin @modelcontextprotocol/sdk; el protocolo por stdio es JSON-RPC por líneas y así no hay node_modules
// que empaquetar con la app. Si algún día hacen falta recursos, prompts o notificaciones, pasar al SDK.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { makeCall, toolsFor } from "./tools.mjs";

const PROTOCOL = "2025-06-18";
const PORT = process.env.PET_PORT || "4747";
// Mismo app_data_dir que Tauri para el identifier xyz.spadelab.pet.
const DATA =
  process.platform === "win32"
    ? join(process.env.APPDATA || "", "xyz.spadelab.pet")
    : process.platform === "darwin"
      ? join(homedir(), "Library/Application Support/xyz.spadelab.pet")
      : join(process.env.XDG_DATA_HOME || join(homedir(), ".local/share"), "xyz.spadelab.pet");
const token = () => {
  if (process.env.PET_TOKEN) return process.env.PET_TOKEN;
  try {
    return readFileSync(join(DATA, `web-${PORT}.token`), "utf8").trim();
  } catch {
    return "";
  }
};

async function api(path, body) {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Pet-Token": token() },
    body: JSON.stringify(body),
  });
  const v = await r.json().catch(() => null);
  if (r.status === 401) throw new Error("la app se reinició o no está abierta: token inválido");
  if (!r.ok) throw new Error(typeof v === "string" ? v : `la app respondió ${r.status}`);
  return v;
}
export { fmtMs, groupRoutines, parseDue, search, TOOLS, toolsFor } from "./tools.mjs";
const EXTERNAL = !process.env.PET_TOKEN;
export const call = makeCall(api, EXTERNAL);

/** Una petición JSON-RPC → su respuesta (`null` para notificaciones). `run` ejecuta las herramientas. */
export async function rpc(req, run = call) {
  if (req.id === undefined) return null; // notificación: no se responde
  const ok = (result) => ({ jsonrpc: "2.0", id: req.id, result });
  switch (req.method) {
    case "initialize":
      return ok({
        protocolVersion: req.params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "pet", version: "0.1.0" },
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: toolsFor(EXTERNAL) });
    case "tools/call":
      try {
        const out = await run(req.params?.name, req.params?.arguments ?? {});
        return ok({
          content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }],
          isError: false,
        });
      } catch (e) {
        return ok({ content: [{ type: "text", text: e.message }], isError: true });
      }
    default:
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: `método desconocido: ${req.method}` },
      };
  }
}

// stdio: un mensaje JSON por línea; stdout es solo del protocolo.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } }) +
          "\n",
      );
      continue;
    }
    const res = await rpc(req);
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  }
}
