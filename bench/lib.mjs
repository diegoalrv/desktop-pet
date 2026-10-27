// Cliente mínimo para el benchmark: Anthropic nativo + OpenAI-compatible (Gemini, DeepSeek). Sin dependencias.
// Mensajes internos en formato OpenAI; precios en USD por millón de tokens (docs de cada proveedor, 27-oct-2026).
import fs from "node:fs";

const envFile = process.env.HOME + "/SpadeLab/ai-proxy/providers.env";
export const env = Object.fromEntries(
  fs.readFileSync(envFile, "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).replace(/^export /, ""), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]),
);

// ponytail: DeepSeek cobra la mitad fuera de hora punta (0.15/0.60); acá el precio de punta, el conservador.
export const MODELS = {
  "haiku-5.5": { p: "anthropic", id: "claude-haiku-5-5", in: 0.1, out: 0.5 },
  "sonnet-5.5": { p: "anthropic", id: "claude-sonnet-5-5", in: 2, out: 10 },
  "opus-5.5": { p: "anthropic", id: "claude-opus-5-5", in: 4, out: 20 },
  "gemini-3.5-flash-lite": { p: "gemini", id: "gemini-3.5-flash-lite", in: 0.3, out: 2.5 },
  "gemini-3.1-flash-lite": { p: "gemini", id: "gemini-3.1-flash-lite", in: 0.25, out: 1.5 },
  "gemini-3.5-flash": { p: "gemini", id: "gemini-3.5-flash", in: 1.5, out: 9 }, // precio de trackers (la página oficial no lo mostró)
  // 3.8-flash da 503 por saturación y 3.1-pro no tiene cuota en esta key: fuera de la lista.
  "deepseek-flash": { p: "deepseek", id: "deepseek-flash", in: 0.3, out: 1.2 },
};

export const cost = (m, u) => (MODELS[m].in == null ? NaN : (u.in * MODELS[m].in + u.out * MODELS[m].out) / 1e6);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Errores con prefijo fijo (CUOTA / LATENCIA / CAIDO) para que los benchmarks los registren y descarten el modelo.
async function post(url, headers, body, timeoutMs) {
  for (let i = 0; ; i++) {
    const t = Date.now();
    let res, text;
    try {
      res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      text = await res.text();
    } catch (e) {
      if (e.name === "TimeoutError" || e.name === "AbortError") throw new Error(`LATENCIA: sin respuesta en ${timeoutMs / 1000}s`);
      if (i < 2) { await sleep(1500); continue; }
      throw new Error("CAIDO: " + e.message);
    }
    if (res.ok) return { json: JSON.parse(text), ms: Date.now() - t };
    if (res.status === 429 && /quota|billing/i.test(text)) throw new Error("CUOTA: " + text.replace(/\s+/g, " ").slice(0, 200));
    if (i < 2 && [429, 500, 502, 503, 504, 529].includes(res.status)) await sleep(2000 * 2 ** i);
    else throw new Error(`${[500, 502, 503, 504, 529].includes(res.status) ? "CAIDO" : "ERROR"} ${res.status}: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}

/** Corta un modelo tras 4 fallos seguidos (caído, sin cuota o lento): se anota una vez y se salta el resto. */
export function breaker(onDrop) {
  const st = {};
  return {
    dropped: (m) => st[m]?.drop,
    ok: (m) => { (st[m] ??= { n: 0 }).n = 0; },
    fail: (m, err) => { const s = (st[m] ??= { n: 0 }); if (++s.n >= 4 && !s.drop) { s.drop = err.split(":")[0]; onDrop(m, err); } },
  };
}

const toAnthropic = (messages) => {
  const out = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const b = { type: "tool_result", tool_use_id: m.tool_call_id, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result") last.content.push(b);
      else out.push({ role: "user", content: [b] });
    } else if (m.role === "assistant" && m.tool_calls) {
      out.push({
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.tool_calls.map((c) => ({ type: "tool_use", id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments || "{}") })),
        ],
      });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
};

/** -> { text, calls:[{id,name,args,raw}], msg (para el historial), usage:{in,out}, ms } */
export async function chat(model, { system, messages, tools, json = false, maxTokens = 4096, timeoutMs = 60000 }) {
  const M = MODELS[model];
  if (M.p === "anthropic") {
    const { json: j, ms } = await post(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID },
      {
        model: M.id, max_tokens: maxTokens, system, messages: toAnthropic(messages),
        ...(tools && { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) }),
      },
      timeoutMs,
    );
    const text = j.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const calls = j.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, args: b.input, raw: JSON.stringify(b.input) }));
    const u = j.usage;
    return {
      text, calls, ms,
      usage: { in: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), out: u.output_tokens },
      msg: { role: "assistant", content: text, ...(calls.length && { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.raw } })) }) },
    };
  }
  const gem = M.p === "gemini";
  const body = {
    model: M.id, temperature: 0.2, max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, ...messages],
    ...(tools && { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }),
    ...(json && { response_format: { type: "json_object" } }),
    ...(gem ? { reasoning_effort: M.effort ?? "low" } : { thinking: { type: "disabled" } }), // sin razonamiento: es lo que usaría la app
  };
  const { json: j, ms } = await post(
    gem ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" : "https://api.deepseek.com/chat/completions",
    { authorization: "Bearer " + (gem ? env.GEMINI_API_KEY : env.DEEPSEEK_API_KEY) },
    body,
    timeoutMs,
  );
  const m = j.choices[0].message;
  const calls = (m.tool_calls ?? []).map((c, i) => {
    let args = {};
    try { args = JSON.parse(c.function.arguments || "{}"); } catch { args = { __invalid: c.function.arguments }; }
    return { id: c.id || `call_${i}`, name: c.function.name, args, raw: c.function.arguments, extra: c.extra_content };
  });
  const u = j.usage;
  return {
    text: m.content ?? "", calls, ms,
    // Gemini cuenta el razonamiento aparte de completion_tokens; total - prompt lo incluye (se factura como salida).
    usage: { in: u.prompt_tokens, out: gem ? u.total_tokens - u.prompt_tokens : u.completion_tokens },
    msg: { role: "assistant", content: m.content ?? "", ...(calls.length && { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.raw }, ...(c.extra && { extra_content: c.extra }) })) }) },
  };
}

/** Corre fn sobre items con n en paralelo. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
