import { useState } from "react";
import * as db from "../lib/db";
import { isoDay, monthRange, pivot, toCsv, toMarkdown, weekRange } from "../lib/stats";
import { fmtDur } from "../lib/time";
import { Icon } from "../panel/icons";
import { useLive } from "../store/useTasks";
import { download, Head } from "./kit";

const RANGES = { week: "Esta semana", last: "Semana pasada", month: "Este mes", custom: "Fechas" } as const;
type Range = keyof typeof RANGES;

/** Informe de horas de foco por proyecto y día, para facturar. */
export function Report() {
  const [range, setRange] = useState<Range>("week");
  const [round, setRound] = useState(false);
  const [a, setA] = useState(() => isoDay(weekRange().from));
  const [b, setB] = useState(() => isoDay(Date.now()));
  // `new Date("aaaa-mm-dd")` es UTC; con partes numéricas queda en hora local. El día final entra completo.
  const local = (v: string, plus = 0) => {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d + plus).getTime();
  };
  const { from, to } =
    range === "week"
      ? weekRange()
      : range === "last"
        ? weekRange(1)
        : range === "month"
          ? monthRange()
          : { from: local(a), to: local(b, 1) };
  const valid = Number.isFinite(from) && Number.isFinite(to) && to > from;
  const rows = useLive(() => (valid ? db.focusByProjectDay(from, to) : Promise.resolve([])), [from, to]);
  const p = pivot(rows ?? [], from, valid ? to : from, round ? 15 : 0);
  const sums = p.days.map((_, i) => p.projects.reduce((s, r) => s + r.days[i], 0));
  const grand = p.projects.reduce((s, r) => s + r.total, 0);
  const name = `horas-${isoDay(from)}_${isoDay(to - 1)}`;
  const cell = (s: number) => (s ? fmtDur(s) : "·");
  const th = { textAlign: "right", padding: "8px 6px", whiteSpace: "nowrap" } as const;

  return (
    <>
      <Head title="Informe" sub="Horas de foco por proyecto y día">
        <div className="d-seg">
          {(Object.keys(RANGES) as Range[]).map((k) => (
            <button key={k} className={`d-b ${range === k ? "on" : ""}`} onClick={() => setRange(k)}>
              {RANGES[k]}
            </button>
          ))}
        </div>
      </Head>
      <div className="d-row">
        {range === "custom" && (
          <>
            <input className="d-in" type="date" value={a} max={b} onChange={(e) => setA(e.target.value)} />
            <span className="d-dim">→</span>
            <input className="d-in" type="date" value={b} min={a} onChange={(e) => setB(e.target.value)} />
          </>
        )}
        <label className="d-row" title="Redondea cada proyecto y día al cuarto de hora más cercano">
          <input type="checkbox" checked={round} onChange={(e) => setRound(e.target.checked)} /> Redondear a 15 min
        </label>
        <span style={{ flex: 1 }} />
        <button className="d-b" disabled={!p.projects.length} onClick={() => download(`${name}.csv`, toCsv(p), "text/csv")}>
          <Icon name="download" /> CSV
        </button>
        <button className="d-b" disabled={!p.projects.length} onClick={() => download(`${name}.md`, toMarkdown(p) + "\n")}>
          <Icon name="download" /> Markdown
        </button>
      </div>
      <div className="d-card" style={{ overflowX: "auto" }}>
        {!valid ? (
          <div className="d-empty">Elige un rango válido.</div>
        ) : !p.projects.length ? (
          <div className="d-empty">{rows ? "Sin focos en este rango." : "Cargando…"}</div>
        ) : (
          <table className="d-table">
            <thead>
              <tr className="d-dim">
                <th style={{ ...th, textAlign: "left" }}>Proyecto</th>
                {p.days.map((d) => (
                  <th key={d} style={th} title={isoDay(d)}>
                    {new Date(d).toLocaleDateString("es", { weekday: "short", day: "numeric" })}
                  </th>
                ))}
                <th style={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {p.projects.map((r) => (
                <tr key={r.name}>
                  <td className={r.name ? undefined : "d-dim"}>{r.name || "Sin proyecto"}</td>
                  {r.days.map((s, i) => (
                    <td key={i} className={s ? undefined : "d-dim"} style={{ textAlign: "right" }}>
                      {cell(s)}
                    </td>
                  ))}
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtDur(r.total)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>Total</td>
                {sums.map((s, i) => (
                  <td key={i} style={{ textAlign: "right" }}>
                    {cell(s)}
                  </td>
                ))}
                <td style={{ textAlign: "right" }}>{fmtDur(grand)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
