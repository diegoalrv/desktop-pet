import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import * as db from "../lib/db";
import type { TimerSnap } from "../lib/ipc";
import {
  classicBlocks,
  fmtMin,
  insert,
  move,
  stepMin,
  totals,
  usable,
  type Activity,
  type Classic,
  type Kind,
  type Step,
} from "../lib/routine";
import { useLive } from "../store/useTasks";
import { MODE_COLOR } from "../pet/TimerPill";
import { Icon } from "../panel/icons";
import { Head, usePoll } from "./kit";

const CSS = `
  .r-cols{display:grid;gap:16px;grid-template-columns:minmax(240px,320px) minmax(0,1fr);align-items:start}
  @media (max-width:900px){ .r-cols{grid-template-columns:minmax(0,1fr)} }
  .r-acts{display:grid;gap:8px}
  .r-act{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:var(--surface-2);border:1px solid var(--line);border-left:4px solid var(--c);cursor:grab;user-select:none}
  .r-act:hover{background:var(--hover)}
  .r-act:active{cursor:grabbing}
  .r-act .e{font-size:20px;width:26px;text-align:center}
  .r-act b{display:block;font-weight:600}
  .r-act small{color:var(--muted);font-size:12px}
  .r-act .d-b{margin-left:auto}
  .r-form{display:grid;gap:8px;padding:12px;border-radius:12px;background:var(--surface-2);border:1px solid var(--line-2)}
  .r-form .d-row>.d-in{flex:1}
  .r-sw{gap:6px}
  .r-sw button{width:26px;height:26px;border-radius:50%;border:2px solid transparent;padding:0;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)}
  .r-sw button[aria-checked=true]{border-color:var(--text);transform:scale(1.12)}
  .r-sw input[type=color]{width:30px;height:28px;padding:1px;border-radius:8px;border:1px solid var(--line-2);background:var(--surface-2);cursor:pointer}
  .r-tabs{display:flex;gap:6px;flex-wrap:wrap}
  .r-tl{display:flex;height:46px;border-radius:12px;overflow:hidden;gap:2px;background:var(--line)}
  .r-tl>div{position:relative;display:flex;align-items:center;justify-content:center;gap:4px;min-width:0;overflow:hidden;background:var(--c);color:#fff;font-size:12px;font-weight:600;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.35)}
  .r-tl>div.brk{opacity:.72}
  .r-tl>div.now{box-shadow:inset 0 0 0 2px #fff;opacity:1}
  .r-tl>div.now::after{content:"";position:absolute;left:0;bottom:0;height:3px;width:var(--p);background:#fff}
  .r-steps{display:grid;gap:4px;min-height:64px;padding:6px;border-radius:12px;border:1px dashed var(--line-2)}
  .r-steps.hot{border-color:var(--accent);background:var(--accent-soft)}
  .r-step{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--surface-2);border:1px solid transparent;cursor:grab}
  .r-step.now{border-color:var(--c)}
  .r-step .h{color:var(--muted);letter-spacing:-2px;font-size:14px}
  .r-step .dot{width:10px;height:10px;border-radius:50%;background:var(--c);flex:none}
  .r-step .n{flex:1;min-width:0}
  .r-step .min{width:4.2em;text-align:center}
  .r-step .k{font-size:11.5px;color:var(--muted)}
  .r-drop{height:3px;border-radius:2px;background:var(--accent);margin:-2px 0}
  .r-hint{font-size:12.5px;color:var(--muted)}
  .r-warn{font-size:13px;color:var(--warn)}
`;

const KIND_LABEL: Record<Kind, string> = { focus: "Foco", break: "Pausa" };
// Los tres primeros son los del ciclo clásico (MODE_COLOR): foco, pausa corta y pausa larga.
const SWATCHES = [
  ["#e8523c", "Rojo (foco)"],
  ["#3cb371", "Verde (pausa corta)"],
  ["#3c78e8", "Azul (pausa larga)"],
  ["#e8a33c", "Naranjo"],
  ["#9b59d0", "Morado"],
  ["#e84c8b", "Rosado"],
  ["#1fb5a8", "Turquesa"],
  ["#d4b21f", "Amarillo"],
] as const;
const CLASSIC_LABEL = { focus: "Foco", short: "Pausa corta", long: "Pausa larga" } as const;
const ACT = "application/x-activity";
const STEP = "application/x-step";

type Draft = Omit<Activity, "id" | "archived" | "sort"> & { id?: number };
const blank: Draft = { name: "", kind: "break", min: 10, emoji: "🤸", color: "#e8a33c" };

function ActivityForm({ init, onDone }: { init: Draft; onDone: () => void }) {
  const [a, setA] = useState(init);
  const ok = a.name.trim() && a.min >= 1 && a.min <= 180;
  return (
    <form
      className="r-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok) return;
        await db.saveActivity({ ...a, name: a.name.trim(), emoji: a.emoji.trim() });
        onDone();
      }}
    >
      <div className="d-row">
        <input
          className="d-in"
          style={{ width: "3.2em", flex: "none", textAlign: "center" }}
          aria-label="Emoji"
          value={a.emoji}
          maxLength={4}
          onChange={(e) => setA({ ...a, emoji: e.target.value })}
        />
        <input
          className="d-in"
          aria-label="Nombre"
          placeholder="Pausa activa, agua, caminar…"
          value={a.name}
          autoFocus
          onChange={(e) => setA({ ...a, name: e.target.value })}
        />
      </div>
      <div className="d-row">
        <div className="d-seg" role="group" aria-label="Tipo">
          {(["focus", "break"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`d-b sm${a.kind === k ? " on" : ""}`}
              aria-pressed={a.kind === k}
              onClick={() => setA({ ...a, kind: k })}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <input
          className="d-in"
          type="number"
          min={1}
          max={180}
          aria-label="Minutos"
          value={a.min}
          style={{ width: "5em", flex: "none" }}
          onChange={(e) => setA({ ...a, min: Number(e.target.value) })}
        />
        <span className="d-dim">min</span>
      </div>
      <div className="d-row r-sw" role="radiogroup" aria-label="Color del ciclo">
        {SWATCHES.map(([c, n]) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={a.color === c}
            aria-label={n}
            title={n}
            style={{ background: c }}
            onClick={() => setA({ ...a, color: c })}
          />
        ))}
        <input
          type="color"
          title="Otro color"
          aria-label="Otro color"
          value={a.color}
          onChange={(e) => setA({ ...a, color: e.target.value })}
        />
      </div>
      <div className="d-row">
        <button className="d-b sm pri" disabled={!ok}>
          <Icon name="check" size="1em" /> Guardar
        </button>
        <button type="button" className="d-b sm ghost" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function Routines() {
  const acts = useLive(db.listActivities) ?? [];
  const byId = new Map((useLive(db.allActivities) ?? []).map((a) => [a.id, a])); // incluye archivadas en uso
  const routines = useLive(db.listRoutines);
  const classic = usePoll<Classic>("timer_classic", 5000);
  const autoCycle = classic?.auto_cycle ?? true;
  const snap = usePoll<TimerSnap>("timer_get", 1000);
  // Sin elegir nada se muestra la activa; sin rutina activa, la clásica (cur undefined).
  const [sel, setSel] = useState<number | "classic" | null>(null);
  const cur =
    sel === "classic"
      ? undefined
      : (routines?.find((r) => r.id === sel) ?? (sel == null ? routines?.find((r) => r.active) : undefined));
  const classicActive = !routines?.some((r) => r.active);
  const [steps, setSteps] = useState<Step[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [name, setName] = useState("");
  const [over, setOver] = useState<number | null>(null); // dónde caería lo que se arrastra

  // Bloques: se cargan al cambiar de rutina y después manda el estado local (guardar recarga a medias).
  // Gana la última carga: al crear una rutina, la vista la ve antes de que terminen de guardarse sus bloques.
  const req = useRef(0);
  const load = (id: number) => {
    const n = ++req.current;
    db.routineSteps(id).then((s) => n === req.current && setSteps(s));
  };
  useEffect(() => {
    setName(cur?.name ?? "");
    if (cur) load(cur.id);
    else setSteps([]);
  }, [cur?.id]);

  const save = (next: Step[]) => {
    setSteps(next);
    if (cur) db.saveSteps(cur.id, next);
  };
  const t = totals(steps, byId);
  const isActive = !!cur?.active;
  // Bloque que corre ahora, si esta es la rutina activa (el snap trae la posición, no la rutina).
  const nowAt = isActive && snap && snap.status !== "idle" && snap.label ? snap.step : -1;
  const progress = snap && snap.total ? 1 - snap.remaining / snap.total : 0;

  const newRoutine = async () => {
    const f = acts.find((a) => a.kind === "focus");
    const b = acts.find((a) => a.kind === "break");
    const start = [f, b].filter((a): a is Activity => !!a).map((a) => ({ activity_id: a.id, min: null }));
    const id = await db.addRoutine(`Rutina ${(routines?.length ?? 0) + 1}`, start);
    setSel(id);
    load(id);
  };

  // Copia editable de la clásica, con las actividades de ejemplo y los minutos de Ajustes.
  const copyClassic = async () => {
    if (!classic) return;
    const brk = acts.filter((a) => a.kind === "break");
    const pick = {
      focus: acts.find((a) => a.kind === "focus"),
      short: brk.find((a) => a.min < 15) ?? brk[0],
      long: brk.find((a) => a.min >= 15) ?? brk[0],
    };
    const blocks = classicBlocks(classic).flatMap((b) =>
      pick[b.mode] ? [{ activity_id: pick[b.mode]!.id, min: b.min }] : [],
    );
    const id = await db.addRoutine("Mi clásica", blocks);
    setSel(id);
    load(id);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const at = over ?? steps.length;
    setOver(null);
    const act = e.dataTransfer.getData(ACT);
    const from = e.dataTransfer.getData(STEP);
    if (act) save(insert(steps, { activity_id: Number(act), min: null }, at));
    else if (from !== "") {
      const i = Number(from);
      save(move(steps, i, i < at ? at - 1 : at));
    }
  };
  const overRow = (e: DragEvent, i: number) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setOver(e.clientY > r.top + r.height / 2 ? i + 1 : i);
  };

  return (
    <>
      <style>{CSS}</style>
      <Head
        title="Rutinas"
        sub="Arma tus ciclos para el modo Foco con tus propias actividades. Sin rutina activa se usa el ciclo clásico de Ajustes."
      />
      <div className="r-cols">
        <section className="d-card">
          <div className="d-row">
            <span className="d-label">Actividades</span>
            <span className="r-hint" style={{ marginLeft: "auto" }}>
              arrástralas a la rutina
            </span>
          </div>
          <div className="r-acts">
            {acts.map((a) =>
              editing?.id === a.id ? (
                <ActivityForm key={a.id} init={editing} onDone={() => setEditing(null)} />
              ) : (
                <div
                  key={a.id}
                  className="r-act"
                  style={{ "--c": a.color } as CSSProperties}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData(ACT, String(a.id))}
                  title="Arrastra a la rutina, o usa +"
                >
                  <span className="e">{a.emoji || "•"}</span>
                  <span>
                    <b>{a.name}</b>
                    <small>
                      {KIND_LABEL[a.kind]} · {a.min} min
                    </small>
                  </span>
                  <button
                    className="d-b sm ghost"
                    aria-label={`Agregar ${a.name} a la rutina`}
                    disabled={!cur}
                    onClick={() => save([...steps, { activity_id: a.id, min: null }])}
                  >
                    <Icon name="plus" size="1em" />
                  </button>
                  <button
                    className="d-b sm ghost"
                    aria-label={`Editar ${a.name}`}
                    onClick={() => setEditing(a)}
                  >
                    <Icon name="pencil" size="1em" />
                  </button>
                  <button
                    className="d-b sm ghost"
                    aria-label={`Archivar ${a.name}`}
                    onClick={() =>
                      confirm(`¿Archivar "${a.name}"? Las rutinas que la usan la conservan.`) &&
                      db.archiveActivity(a.id)
                    }
                  >
                    <Icon name="trash" size="1em" />
                  </button>
                </div>
              ),
            )}
            {editing && !editing.id ? (
              <ActivityForm init={editing} onDone={() => setEditing(null)} />
            ) : (
              <button className="d-b" onClick={() => setEditing(blank)}>
                <Icon name="plus" size="1em" /> Nueva actividad
              </button>
            )}
          </div>
        </section>

        <section className="d-card">
          <div className="r-tabs">
            <button
              className={`d-b sm${!cur ? " on" : ""}`}
              aria-pressed={!cur}
              onClick={() => setSel("classic")}
            >
              {classicActive ? "★ " : ""}Clásica
            </button>
            {routines?.map((r) => (
              <button
                key={r.id}
                className={`d-b sm${r.id === cur?.id ? " on" : ""}`}
                aria-pressed={r.id === cur?.id}
                onClick={() => setSel(r.id)}
              >
                {r.active ? "★ " : ""}
                {r.name}
              </button>
            ))}
            <button className="d-b sm ghost" onClick={newRoutine}>
              <Icon name="plus" size="1em" /> Nueva rutina
            </button>
          </div>

          {!cur ? (
            <>
              <div className="d-row">
                <b style={{ flex: "1 1 180px", fontSize: 16, padding: "7px 0" }}>Clásica</b>
                {classicActive ? (
                  <span className="d-pill">★ Activa</span>
                ) : (
                  <button className="d-b sm pri" onClick={() => db.setActiveRoutine(null)}>
                    ★ Usar la clásica
                  </button>
                )}
                <button className="d-b sm" onClick={copyClassic} disabled={!classic}>
                  <Icon name="copy" size="1em" /> Copiar como rutina
                </button>
              </div>
              {classic && (
                <>
                  <div className="r-tl" aria-label="Línea de tiempo de una vuelta">
                    {classicBlocks(classic).map((b, i) => (
                      <div
                        key={i}
                        className={b.mode === "focus" ? "" : "brk"}
                        style={{ flex: b.min, "--c": MODE_COLOR[b.mode] } as CSSProperties}
                        title={`${CLASSIC_LABEL[b.mode]} · ${b.min} min`}
                      >
                        {b.min}′
                      </div>
                    ))}
                  </div>
                  <div className="d-row r-hint">
                    <b style={{ color: "var(--text)" }}>
                      {fmtMin(classicBlocks(classic).reduce((t, b) => t + b.min, 0))} por vuelta
                    </b>
                    <span>
                      · {classic.long_every} focos de {classic.focus_min} min, pausa corta de{" "}
                      {classic.short_min} y la larga de {classic.long_min} al final
                    </span>
                  </div>
                </>
              )}
              <div className="r-hint">
                Sus tiempos se cambian en Ajustes → Modo Foco → Cambiar tiempos. Para armar tu propio ciclo,
                crea una rutina nueva o copia esta y arrastra actividades.
              </div>
            </>
          ) : (
            <>
              <div className="d-row">
                <input
                  className="d-in"
                  aria-label="Nombre de la rutina"
                  style={{ flex: "1 1 180px", fontWeight: 600, fontSize: 16 }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => name.trim() && name !== cur.name && db.renameRoutine(cur.id, name.trim())}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
                {isActive ? (
                  <button
                    className="d-b sm"
                    onClick={() => db.setActiveRoutine(null)}
                    title="Volver al ciclo clásico"
                  >
                    ★ Activa · desactivar
                  </button>
                ) : (
                  <button className="d-b sm pri" onClick={() => db.setActiveRoutine(cur.id)}>
                    ★ Usar esta rutina
                  </button>
                )}
                <button
                  className="d-b sm ghost"
                  title="Duplicar"
                  aria-label="Duplicar"
                  onClick={async () => {
                    const id = await db.addRoutine(`${cur.name} (copia)`, steps);
                    setSel(id);
                    load(id);
                  }}
                >
                  <Icon name="copy" size="1em" />
                </button>
                <button
                  className="d-b sm ghost"
                  title="Borrar"
                  aria-label="Borrar"
                  onClick={async () => {
                    if (!confirm(`¿Borrar la rutina "${cur.name}"?`)) return;
                    await db.deleteRoutine(cur.id);
                    setSel(null);
                  }}
                >
                  <Icon name="trash" size="1em" />
                </button>
              </div>

              {steps.length > 0 && (
                <div className="r-tl" aria-label="Línea de tiempo de una vuelta">
                  {steps.map((s, i) => {
                    const a = byId.get(s.activity_id);
                    const m = stepMin(s, a);
                    return (
                      <div
                        key={i}
                        className={`${a?.kind === "break" ? "brk" : ""}${i === nowAt ? " now" : ""}`}
                        style={
                          { flex: m, "--c": a?.color ?? "#555", "--p": `${progress * 100}%` } as CSSProperties
                        }
                        title={`${a?.name ?? "?"} · ${m} min`}
                      >
                        {a?.emoji} {m}′
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="d-row r-hint">
                <b style={{ color: "var(--text)" }}>{fmtMin(t.all)} por vuelta</b>
                <span>· foco {fmtMin(t.focus)}</span>
                <span>· pausas {fmtMin(t.rest)}</span>
                {nowAt >= 0 && snap && (
                  <span style={{ marginLeft: "auto" }}>
                    Ahora: {snap.emoji} {snap.label} ({nowAt + 1}/{snap.steps})
                  </span>
                )}
              </div>
              {steps.length > 0 && !usable(steps, byId) && (
                <div className="r-warn">
                  Agrega al menos un foco: una rutina sin focos no se usa (manda el ciclo clásico).
                </div>
              )}

              <div
                className={`r-steps${over != null ? " hot" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (e.target === e.currentTarget) setOver(steps.length);
                }}
                onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
                onDrop={onDrop}
              >
                {steps.length === 0 && (
                  <div className="d-empty">Suelta aquí las actividades, en el orden del ciclo.</div>
                )}
                {steps.map((s, i) => {
                  const a = byId.get(s.activity_id);
                  return (
                    <div key={i} style={{ display: "contents" }}>
                      {over === i && <div className="r-drop" />}
                      <div
                        className={`r-step${i === nowAt ? " now" : ""}`}
                        style={{ "--c": a?.color ?? "#555" } as CSSProperties}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData(STEP, String(i))}
                        onDragOver={(e) => overRow(e, i)}
                        onDragEnd={() => setOver(null)}
                      >
                        <span className="h" aria-hidden>
                          ⋮⋮
                        </span>
                        <span className="dot" />
                        <span className="n">
                          {a?.emoji} {a?.name ?? "(actividad borrada)"}{" "}
                          <span className="k">
                            {a ? KIND_LABEL[a.kind] : ""}
                            {a?.archived ? " · archivada" : ""}
                          </span>
                        </span>
                        <input
                          className="d-in min"
                          type="number"
                          min={1}
                          max={180}
                          aria-label={`Minutos de ${a?.name ?? "bloque"}`}
                          placeholder={String(a?.min ?? "")}
                          title="Vacío = los minutos de la actividad"
                          value={s.min ?? ""}
                          onChange={(e) => {
                            const v =
                              e.target.value === ""
                                ? null
                                : Math.min(180, Math.max(1, Number(e.target.value)));
                            save(steps.map((x, j) => (j === i ? { ...x, min: v } : x)));
                          }}
                        />
                        <button
                          className="d-b sm ghost"
                          aria-label="Subir"
                          disabled={i === 0}
                          onClick={() => save(move(steps, i, i - 1))}
                        >
                          ↑
                        </button>
                        <button
                          className="d-b sm ghost"
                          aria-label="Bajar"
                          disabled={i === steps.length - 1}
                          onClick={() => save(move(steps, i, i + 1))}
                        >
                          ↓
                        </button>
                        <button
                          className="d-b sm ghost"
                          aria-label="Quitar"
                          onClick={() => save(steps.filter((_, j) => j !== i))}
                        >
                          <Icon name="x" size="1em" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {over === steps.length && steps.length > 0 && <div className="r-drop" />}
              </div>
              <div className="r-hint">
                Al terminar el último bloque vuelve a empezar.{" "}
                {autoCycle
                  ? "Con el ciclo automático, cada pausa arranca sola el bloque siguiente."
                  : "El ciclo automático está apagado (Ajustes): cada pausa termina en reposo y el siguiente bloque espera a que lo inicies."}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
