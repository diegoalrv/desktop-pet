import { useState } from "react";
import * as db from "../lib/db";
import { dayStart, isoDay } from "../lib/stats";
import { fmtDur } from "../lib/time";
import { useLive } from "../store/useTasks";
import { Bars, fmtDay, Head } from "./kit";

export const fmtTok = (n: number) =>
  n >= 1e8
    ? `${Math.round(n / 1e6).toLocaleString("es")} M`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)} M`
      : n >= 1e3
        ? `${Math.round(n / 1e3)} k`
        : String(n);

/** El proyecto es su carpeta relativa a ~ (worklog.rs): se muestra el último tramo y, debajo, de dónde viene. */
const NOISE = new Set(["Documents", "Desktop", "Library", "CloudStorage", "Mobile Documents"]);
export const projName = (k: string) => k.split("/").pop() || k;
export const projCtx = (k: string) =>
  k
    .split("/")
    .slice(0, -1)
    .filter((s) => !NOISE.has(s))
    .map((s) => s.replace(/^OneDrive-/, "").replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")) // "UniversidadTécnica" → "Universidad Técnica"
    .join(" › ");
export const projHref = (k: string) => `#claude/${encodeURIComponent(k)}`;

const PERIODS = {
  1: "Hoy",
  7: "7 días",
  30: "30 días",
  90: "90 días",
  all: "Todo",
  custom: "Rango",
} as const;
type Period = keyof typeof PERIODS;
const DAY = 86400000;
const num = { textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" } as const;
const tot = (t: db.ClaudeTokenRow) => t.input + t.output + t.cache_read + t.cache_write;
const dur = (v: number) => (v ? fmtDur(v) : "—");
const pct = (a: number, b: number) => (b ? ` · ${Math.round((a / b) * 100)}%` : "");
// `new Date("aaaa-mm-dd")` es UTC; con partes numéricas queda en hora local.
const local = (s: string, add = 0) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d + add).getTime();
};

/** Barras del período: por día hasta 3 meses, por mes si es más largo. */
function buckets(from: number, to: number) {
  const out: { s: number; e: number; title: string; label: string }[] = [];
  const monthly = to - from > 92 * DAY;
  for (let d = new Date(from); d.getTime() < to;) {
    const s = d.getTime();
    d = monthly
      ? new Date(d.getFullYear(), d.getMonth() + 1, 1)
      : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const m = new Date(s);
    out.push({
      s,
      e: d.getTime(),
      title: monthly ? m.toLocaleDateString("es", { month: "long", year: "numeric" }) : fmtDay(s),
      label: monthly ? m.toLocaleDateString("es", { month: "short" }) : String(m.getDate()),
    });
  }
  if (!monthly) {
    const every = out.length > 30 ? 7 : out.length > 7 ? 3 : 1; // etiquetas espaciadas en períodos largos
    out.forEach((b, i) => (out.length - 1 - i) % every && (b.label = ""));
  }
  return { out, monthly };
}

/** Todo el trabajo con Claude por hora (claude_hours), con o sin foco: tu atención, lo que Claude trabajó y cuánto de
 *  eso fue desatendido (de noche, sin foco o mientras mirabas otro proyecto). Con `project`, la ficha de ese proyecto. */
export function Claude({ project }: { project?: string }) {
  const [period, setPeriod] = useState<Period>(7);
  const [a, setA] = useState(() => isoDay(dayStart(6)));
  const [b, setB] = useState(() => isoDay(Date.now()));
  const end = dayStart(-1); // mañana a las 0:00: hoy entra completo
  const [from, to] =
    period === "all"
      ? [0, end]
      : period === "custom"
        ? [local(a), local(b, 1)]
        : [dayStart(Number(period) - 1), end];
  const valid = Number.isFinite(from) && Number.isFinite(to) && to > from;
  const load =
    <T,>(f: (a: number, b: number) => Promise<T[]>) =>
    () =>
      valid ? f(from, to) : Promise.resolve([]);
  const allHours = useLive(load(db.listClaudeHours), [from, to]) ?? [];
  const allToks = useLive(load(db.listClaudeTokens), [from, to]) ?? [];
  const titles = useLive(load(db.listClaudeTitles), [from, to]) ?? [];
  const meta = useLive(() => db.listClaudeProjects()) ?? [];
  const mine = <T extends { project: string }>(r: T[]) =>
    project ? r.filter((x) => x.project === project) : r;
  const [hours, toks] = [mine(allHours), mine(allToks)];

  const s = (k: keyof db.ClaudeHourRow, rows = hours) => rows.reduce((a, r) => a + (r[k] as number), 0);
  const tokens = toks.reduce((a, t) => a + tot(t), 0);
  const tokensAway = toks.reduce((a, t) => a + t.unattended, 0);
  const first = period === "all" ? dayStart(0, Math.min(...hours.map((h) => h.hour), dayStart(6))) : from;
  const { out: bars, monthly } = buckets(first, to);
  const byBar = bars.map((x) => hours.filter((h) => h.hour >= x.s && h.hour < x.e));
  const byHour = Array.from({ length: 24 }, (_, h) =>
    hours.filter((r) => new Date(r.hour).getHours() === h).reduce((a, r) => a + r.unattended_secs, 0),
  );
  const info = meta.find((m) => m.project === project);

  return (
    <>
      <Head
        title={project ? projName(project) : "Claude"}
        sub={
          project ? (
            <>
              <a href="#claude">Claude</a>
              {projCtx(project) && ` › ${projCtx(project)}`}
            </>
          ) : (
            "Tu tiempo con Claude y lo que trabajó solo, con o sin foco"
          )
        }
      >
        <div className="d-seg">
          {(Object.keys(PERIODS) as Period[]).map((k) => (
            <button
              key={k}
              className={`d-b ${String(period) === String(k) ? "on" : ""}`}
              onClick={() => setPeriod(isNaN(Number(k)) ? k : (Number(k) as Period))}
            >
              {PERIODS[k]}
            </button>
          ))}
        </div>
      </Head>
      {period === "custom" && (
        <div className="d-row">
          <input className="d-in" type="date" value={a} max={b} onChange={(e) => setA(e.target.value)} />
          <span className="d-dim">→</span>
          <input className="d-in" type="date" value={b} min={a} onChange={(e) => setB(e.target.value)} />
        </div>
      )}
      {info && (
        <div className="d-row d-dim" style={{ fontSize: 13, flexWrap: "wrap" }}>
          <span title="Carpeta">{info.path}</span>
          {info.remote && (
            <a href={`https://${info.remote}`} target="_blank" rel="noreferrer">
              {info.remote}
            </a>
          )}
        </div>
      )}
      <div className="d-stats">
        {[
          ["Tu tiempo", fmtDur(s("you_secs"))],
          ["Claude trabajó", fmtDur(s("claude_secs"))],
          [`Desatendido${pct(s("unattended_secs"), s("claude_secs"))}`, fmtDur(s("unattended_secs"))],
          [`Tokens · desatendidos${pct(tokensAway, tokens)}`, fmtTok(tokens)],
          [`Commits · ${s("unattended_commits")} sin ti`, String(s("commits"))],
          ["Features", String(s("features"))],
        ].map(([k, v]) => (
          <div key={k}>
            <span className="d-big">{v}</span>
            <span className="d-dim" style={{ fontSize: 13 }}>
              {k}
            </span>
          </div>
        ))}
      </div>
      {bars.length > 1 && (
        <div className="d-card">
          <span className="d-label">Claude por {monthly ? "mes" : "día"}</span>
          <Bars
            hi={bars.findIndex((x) => Date.now() >= x.s && Date.now() < x.e)}
            data={bars.map((x, i) => ({
              v: s("claude_secs", byBar[i]),
              title: `${x.title} (desatendido ${fmtDur(s("unattended_secs", byBar[i]))})`,
              label: x.label,
            }))}
          />
        </div>
      )}
      <div className="d-card">
        <span className="d-label">¿A qué hora trabaja solo?</span>
        <Bars
          hi={new Date().getHours()}
          data={byHour.map((v, h) => ({ v, title: `${h}:00, desatendido`, label: h % 3 ? "" : String(h) }))}
        />
      </div>
      {project ? (
        <Sessions rows={titles.filter((t) => t.project === project)} />
      ) : (
        <Projects hours={hours} toks={toks} />
      )}
    </>
  );
}

function Models({ models, total }: { models: Map<string, number>; total: number }) {
  if (!total) return null;
  return (
    <small className="d-dim" style={{ display: "block" }}>
      {[...models]
        .sort((a, b) => b[1] - a[1])
        .map(([m, v]) => `${m} ${Math.round((v / total) * 100)}%`)
        .join(" · ")}
    </small>
  );
}

function Projects({ hours, toks }: { hours: db.ClaudeHourRow[]; toks: db.ClaudeTokenRow[] }) {
  const s = (k: keyof db.ClaudeHourRow, rows: db.ClaudeHourRow[]) =>
    rows.reduce((a, r) => a + (r[k] as number), 0);
  type P = { rows: db.ClaudeHourRow[]; tokens: number; away: number; models: Map<string, number> };
  const by = new Map<string, P>();
  const get = (k: string) => {
    if (!by.has(k)) by.set(k, { rows: [], tokens: 0, away: 0, models: new Map() });
    return by.get(k)!;
  };
  hours.forEach((h) => get(h.project).rows.push(h));
  toks.forEach((t) => {
    const p = get(t.project);
    p.tokens += tot(t);
    p.away += t.unattended;
    const m = t.model.replace("claude-", "");
    p.models.set(m, (p.models.get(m) ?? 0) + tot(t));
  });
  const projects = [...by].sort(
    (a, b) => s("claude_secs", b[1].rows) - s("claude_secs", a[1].rows) || b[1].tokens - a[1].tokens,
  );
  return (
    <div className="d-card">
      <span className="d-label">Por proyecto</span>
      <table className="d-table">
        <thead>
          <tr className="d-dim">
            <td>Proyecto</td>
            <td style={num}>Tú</td>
            <td style={num}>Claude</td>
            <td style={num}>Desatendido</td>
            <td style={num}>Tokens</td>
            <td style={num}>Commits</td>
            <td style={num}>Líneas</td>
            <td style={num}>Features</td>
          </tr>
        </thead>
        <tbody>
          {projects.map(([k, p]) => {
            const [added, removed, commits] = [
              s("added", p.rows),
              s("removed", p.rows),
              s("commits", p.rows),
            ];
            return (
              <tr key={k} style={{ cursor: "pointer" }} onClick={() => (location.hash = projHref(k))}>
                <td style={{ width: "100%" }}>
                  <a href={projHref(k)}>{projName(k)}</a>
                  {projCtx(k) && <small className="d-dim"> · {projCtx(k)}</small>}
                  <Models models={p.models} total={p.tokens} />
                </td>
                <td style={num}>{dur(s("you_secs", p.rows))}</td>
                <td style={num}>{dur(s("claude_secs", p.rows))}</td>
                <td style={num}>{dur(s("unattended_secs", p.rows))}</td>
                <td style={num} title={`${fmtTok(p.away)} desatendidos`}>
                  {p.tokens ? fmtTok(p.tokens) : "—"}
                </td>
                <td style={num}>
                  {commits || "—"}
                  {!!s("unattended_commits", p.rows) && (
                    <small className="d-dim"> ({s("unattended_commits", p.rows)} sin ti)</small>
                  )}
                </td>
                <td style={num}>
                  {added || removed ? (
                    <>
                      <span style={{ color: "var(--ok)" }}>+{added}</span>{" "}
                      <span style={{ color: "var(--err)" }}>−{removed}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td style={num}>{s("features", p.rows) || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!projects.length && <span className="d-empty">Sin actividad con Claude en este período.</span>}
      <small className="d-dim">
        Tú: desde cada mensaje tuyo en Claude Code o Cowork hasta el siguiente (máx. 10 min). Claude: mientras
        su sesión escribe algo al menos cada 3 min. Desatendido: Claude trabajando en un proyecto sin tu
        atención en ese proyecto. Se actualiza cada 15 min.
      </small>
    </div>
  );
}

/** En qué se trabajó: cada sesión de Claude del proyecto (su título, o tu primer mensaje si no tiene). */
function Sessions({ rows }: { rows: db.ClaudeTitleRow[] }) {
  const by = new Map<string, [number, number]>();
  rows.forEach((r) => {
    const v = by.get(r.title) ?? [0, 0];
    by.set(r.title, [v[0] + r.you_secs, v[1] + r.claude_secs]);
  });
  const list = [...by].sort((a, b) => b[1][0] + b[1][1] - (a[1][0] + a[1][1]));
  return (
    <div className="d-card">
      <span className="d-label">Sesiones de Claude</span>
      <table className="d-table">
        <thead>
          <tr className="d-dim">
            <td>Sesión</td>
            <td style={num}>Tú</td>
            <td style={num}>Claude</td>
          </tr>
        </thead>
        <tbody>
          {list.map(([t, [you, claude]]) => (
            <tr key={t}>
              <td style={{ width: "100%" }}>{t || <span className="d-dim">Sin título</span>}</td>
              <td style={num}>{dur(you)}</td>
              <td style={num}>{dur(claude)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.length && <span className="d-empty">Sin sesiones en este período.</span>}
    </div>
  );
}
