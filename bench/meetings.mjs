// Benchmark de extracción de tareas en reuniones LARGAS.
//   node meetings.mjs gen                 genera data/*.json (plan con verdad conocida + transcripción), cacheado
//   node meetings.mjs run [--reps 2] [--models a,b]   extrae con cada modelo, juzga con Sonnet, guarda results/meetings.jsonl
//   node meetings.mjs report
// El prompt es el real: se lee de src-tauri/src/meeting.rs para que no se desincronice.
import fs from "node:fs";
import { MODELS, chat, cost, pool, avg, readJsonl, breaker } from "./lib.mjs";

const ROOT = new URL(".", import.meta.url).pathname;
const DATA = ROOT + "data/", OUT = ROOT + "results/meetings.jsonl";
fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(ROOT + "results", { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1]; };

const rust = fs.readFileSync(ROOT + "../src-tauri/src/meeting.rs", "utf8");
const PROMPT = (() => {
  const m = rust.match(/const PROMPT: &str = "((?:[^"\\]|\\.)*)";/s)[1];
  return m.replace(/\\\n\s*/g, "").replace(/\\n/g, "\n").replace(/\\"/g, '"');
})();

// words = tamaño objetivo; parts = secciones generadas por separado (cada una ~2500 palabras)
const SPECS = [
  { key: "s1", size: "S", words: 4500, parts: 2, nU: 3, nO: 3, nD: 2, brief: "weekly de producto de una startup chilena de software: bugs de la última versión, priorización del backlog, un cliente enojado" },
  { key: "s2", size: "S", words: 4500, parts: 2, nU: 3, nO: 3, nD: 2, brief: "llamada con un cliente (agencia de marketing) que quiere cambios en una propuesta, plazos y precio" },
  { key: "m1", size: "M", words: 10000, parts: 4, nU: 6, nO: 6, nD: 4, brief: "comité de planificación trimestral de una consultora: presupuesto, contrataciones, dos proyectos atrasados, un proveedor nuevo" },
  { key: "m2", size: "M", words: 10000, parts: 4, nU: 6, nO: 6, nD: 4, brief: "retro y planning de un equipo de datos: pipeline caído, migración a otra nube, deuda técnica, capacitación" },
  { key: "l1", size: "L", words: 20000, parts: 8, nU: 10, nO: 10, nD: 6, brief: "jornada de planificación anual de una ONG educativa (3 horas): programas, financiamiento, voluntarios, evaluación, eventos, comunicaciones" },
  { key: "l2", size: "L", words: 20000, parts: 8, nU: 10, nO: 10, nD: 6, brief: "reunión larga de coordinación de lanzamiento de un producto (3 horas): marketing, soporte, legal, ventas, fechas, riesgos" },
];

const jparse = (t) => {
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  return JSON.parse(t.slice(s, e + 1));
};

async function gen(spec) {
  const f = DATA + spec.key + ".json";
  if (fs.existsSync(f)) return;
  console.log("generando", spec.key);
  const G = "sonnet-5.5";
  const plan = jparse((await chat(G, {
    system: "Diseñas reuniones sintéticas realistas en español de Chile para evaluar un asistente. Respondes solo JSON.",
    messages: [{ role: "user", content: `Reunión: ${spec.brief}. Usuario ("Yo"): Diego. Diseña el guion con verdad conocida:
- "titulo", "participantes" (4 a 7 nombres, sin Diego)
- "tareas_usuario": ${spec.nU} compromisos o pedidos que le tocan a Diego, cada uno {"id":"U1..","titulo":"verbo infinitivo + qué","como_surge":"cómo sale en la conversación, con plazo si hay"}. Mezcla: algunos explícitos ("yo lo hago"), otros implícitos (le piden algo y asiente), uno que se menciona de nuevo en otra sección (debe contar UNA vez) y uno cuyo plazo cambia más tarde.
- "tareas_otros": ${spec.nO} compromisos de OTRAS personas, {"id":"O1..","titulo","quien","como_surge"}. Incluye 2 donde alguien dice "yo lo hago/reviso" tras un pedido que parecía dirigido a Diego.
- "temas_sin_compromiso": 4 ideas o temas conversados que NO son tareas de nadie, {"id":"T1..","titulo"}.
- "decisiones": ${spec.nD} acuerdos explícitos, {"id":"D1..","texto"}.
- "secciones": ${spec.parts} secciones en orden, {"resumen":"qué se discute","incluye":["ids de U/O/T/D que aparecen en esta sección"]}. Reparte todo; el id de la tarea repetida y el del plazo cambiado aparecen en 2 secciones.
JSON: {"titulo","participantes","tareas_usuario","tareas_otros","temas_sin_compromiso","decisiones","secciones"}` }],
    json: true, maxTokens: 8000,
  })).text);

  const perPart = Math.round(spec.words / spec.parts);
  const all = [], items = Object.fromEntries([...plan.tareas_usuario, ...plan.tareas_otros, ...plan.temas_sin_compromiso, ...plan.decisiones].map((x) => [x.id, x]));
  for (let i = 0; i < plan.secciones.length; i++) {
    const s = plan.secciones[i];
    const prev = all.join("\n").split("\n").slice(-6).join("\n");
    const r = await chat(G, {
      system: "Escribes transcripciones automáticas de reuniones en español de Chile, realistas. Solo la transcripción, sin comentarios.",
      messages: [{ role: "user", content: `Reunión "${plan.titulo}". Participantes: Diego ("Yo") y ${plan.participantes.join(", ")} (todos ellos aparecen como "Otros:"; se nombran entre sí en el texto). Parte ${i + 1} de ${plan.secciones.length}.
Qué se discute: ${s.resumen}
Debe aparecer de forma natural (sin decir "esto es tarea de X" ni listar nada; con rodeos, bromas, interrupciones y charla irrelevante entre medio):
${s.incluye.map((id) => `- ${id}: ${JSON.stringify(items[id])}`).join("\n")}
Formato: una línea por intervención, "Yo: ..." o "Otros: ...". Estilo de transcripción automática: muletillas, frases cortadas, sin tildes o puntuación perfectas, algún nombre o término mal reconocido. Unas ${perPart} palabras.${i ? `\nContinúa justo después de:\n${prev}` : "\nEmpieza con el saludo."}${i < plan.secciones.length - 1 ? "" : "\nTermina con el cierre de la reunión."}` }],
      maxTokens: 12000,
    });
    all.push(r.text.trim());
  }
  const transcript = all.join("\n");
  fs.writeFileSync(f, JSON.stringify({ spec, plan, transcript, words: transcript.split(/\s+/).length }, null, 1));
}

const userMsg = (d) => d.transcript;
const sysFor = (d) => PROMPT + `\nReunión: ${d.plan.titulo}. Participantes: ${d.plan.participantes.join(", ")}. "Yo" es Diego.`;

async function judge(d, out) {
  const p = d.plan;
  const r = await chat("sonnet-5.5", {
    system: "Eres un evaluador estricto. Respondes solo JSON.",
    messages: [{ role: "user", content: `Verdad conocida de una reunión (Diego = el usuario).
Tareas de Diego: ${JSON.stringify(p.tareas_usuario.map((t) => ({ id: t.id, titulo: t.titulo })))}
Tareas de OTROS (no deben aparecer): ${JSON.stringify(p.tareas_otros.map((t) => ({ id: t.id, titulo: t.titulo, quien: t.quien })))}
Temas sin compromiso (no deben aparecer): ${JSON.stringify(p.temas_sin_compromiso)}
Decisiones: ${JSON.stringify(p.decisiones)}

Salida del modelo evaluado:
Tareas: ${JSON.stringify((out.tareas ?? []).map((t, i) => ({ i, titulo: t.titulo, detalle: t.detalle })))}
Decisiones: ${JSON.stringify(out.decisiones ?? [])}

Para cada tarea evaluada indica a qué id de la verdad conocida corresponde (U*, O*, T*) o null si no corresponde a nada. Para las decisiones, lista los ids D* que quedan cubiertos por alguna decisión evaluada.
JSON: {"tareas":[{"i":0,"id":"U1"|"O2"|"T1"|null}],"decisiones":["D1"]}` }],
    json: true, maxTokens: 3000,
  });
  return jparse(r.text);
}

function score(d, out, j) {
  const U = d.plan.tareas_usuario.length, D = d.plan.decisiones.length;
  const ids = (j.tareas ?? []).map((x) => x.id);
  const hitU = new Set(ids.filter((x) => x?.startsWith("U")));
  const n = ids.length;
  return {
    recall: hitU.size / U,
    wrongOwner: ids.filter((x) => x?.startsWith("O")).length,
    noCommit: ids.filter((x) => x?.startsWith("T")).length,
    unmatched: ids.filter((x) => !x).length,
    dup: ids.filter((x) => x?.startsWith("U")).length - hitU.size,
    n, U,
    precision: n ? hitU.size / n : 1,
    decRecall: (new Set(j.decisiones ?? []).size) / D,
    titleOk: (out.tareas ?? []).filter((t) => t.titulo && t.titulo.length <= 80).length / Math.max(1, n),
  };
}

async function run() {
  const models = arg("models", Object.keys(MODELS).join(",")).split(",");
  const reps = +arg("reps", 2);
  const done = new Set(readJsonl(OUT).map((r) => `${r.model}|${r.key}|${r.rep}`));
  const jobs = [];
  for (const spec of SPECS) for (const model of models) for (let rep = 0; rep < reps; rep++) if (!done.has(`${model}|${spec.key}|${rep}`)) jobs.push({ spec, model, rep });
  console.log(jobs.length, "trabajos");
  const br = breaker((model, err) => { fs.appendFileSync(OUT, JSON.stringify({ model, dropped: err.slice(0, 200) }) + "\n"); console.log("DESCARTADO", model, err.slice(0, 120)); });
  await pool(jobs, 6, async ({ spec, model, rep }) => {
    if (br.dropped(model)) return;
    const d = JSON.parse(fs.readFileSync(DATA + spec.key + ".json", "utf8"));
    const row = { model, key: spec.key, size: spec.size, rep, words: d.words };
    try {
      const r = await chat(model, { system: sysFor(d), messages: [{ role: "user", content: userMsg(d) }], json: true, maxTokens: 6000, timeoutMs: 120000 });
      row.usage = r.usage; row.ms = r.ms; row.usd = cost(model, r.usage);
      let out = null;
      try { out = jparse(r.text); row.validJson = true; } catch { row.validJson = false; row.raw = r.text.slice(0, 300); }
      if (out) { row.out = out; Object.assign(row, score(d, out, await judge(d, out))); }
      br.ok(model);
    } catch (e) { row.error = String(e).replace(/^Error: /, "").slice(0, 300); if (!/^(CUOTA|LATENCIA|CAIDO)/.test(row.error) || row.usage) {} else br.fail(model, row.error); }
    fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
    console.log(model, spec.key, row.error ? "ERR " + row.error.slice(0, 80) : `recall ${row.recall?.toFixed(2)} wrong ${row.wrongOwner} ${row.ms}ms`);
  });
}

function report() {
  const all = readJsonl(OUT), rows = all.filter((r) => !r.dropped);
  const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "n/d");
  const line = (name, rs) => {
    const ok = rs.filter((r) => !r.error);
    const g = rs.filter((r) => r.validJson);
    return `| ${name} | ${rs.length} | ${f(100 * ok.filter((r) => r.validJson).length / rs.length, 0)}% | ${f(avg(g.map((r) => r.recall)))} | ${f(avg(g.map((r) => r.precision)))} | ${f(avg(g.map((r) => r.wrongOwner)), 1)} | ${f(avg(g.map((r) => r.noCommit)), 1)} | ${f(avg(g.map((r) => r.unmatched)), 1)} | ${f(avg(g.map((r) => r.dup)), 1)} | ${f(avg(g.map((r) => r.decRecall)))} | ${f(avg(ok.map((r) => r.ms / 1000)), 1)} | ${f(avg(ok.map((r) => r.usage.in)), 0)} | ${f(avg(ok.map((r) => r.usage.out)), 0)} | $${f(avg(ok.map((r) => r.usd)), 4)} |`;
  };
  const head = "| modelo | n | JSON ok | recall | precisión | tarea ajena | sin compromiso | inventadas | duplicadas | recall decisiones | seg | tok in | tok out | USD/reunión |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const models = [...new Set(rows.map((r) => r.model))];
  console.log("## Global (6 reuniones: 2 cortas ~6k tok, 2 medias ~15k, 2 largas ~30k)\n" + head);
  for (const m of models) console.log(line(m, rows.filter((r) => r.model === m)));
  for (const size of ["S", "M", "L"]) {
    console.log(`\n## Tamaño ${size} (~${rows.find((r) => r.size === size)?.words} palabras)\n` + head);
    for (const m of models) console.log(line(m, rows.filter((r) => r.model === m && r.size === size)));
  }
  console.log("\n## Costo por 1000 reuniones (USD) según tamaño");
  console.log("| modelo | S | M | L |\n|---|---|---|---|");
  for (const m of models) console.log(`| ${m} | ` + ["S", "M", "L"].map((s) => "$" + f(1000 * avg(rows.filter((r) => r.model === m && r.size === s && !r.error).map((r) => r.usd)), 0)).join(" | ") + " |");
  for (const d of all.filter((r) => r.dropped)) console.log(`\nDESCARTADO ${d.model}: ${d.dropped}`);
  const kinds = {};
  for (const e of rows.filter((r) => r.error)) { const k = `${e.model} · ${e.error.split(":")[0].split(" ")[0]}`; kinds[k] = (kinds[k] ?? 0) + 1; }
  if (Object.keys(kinds).length) console.log("\nFallos de API por tipo:", JSON.stringify(kinds));
}

const cmd = process.argv[2];
if (cmd === "gen") await pool(SPECS, 6, gen);
else if (cmd === "run") await run();
else report();
