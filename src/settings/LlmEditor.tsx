import { useRef, useState } from "react";
import { z } from "zod";
import { llmSchema } from "../lib/prefs";
import { Icon } from "../panel/icons";
import { btn, T } from "../panel/ui";

type Llm = z.infer<typeof llmSchema>;

/** Proveedores con nombre (meeting.rs: base_url); cualquier otro valor de `provider` es una URL. */
const KNOWN: Record<string, { name: string; keyHint?: string }> = {
  gemini: { name: "Gemini", keyHint: "aistudio.google.com/apikey" },
  claude: { name: "Claude", keyHint: "console.anthropic.com" },
  openai: { name: "OpenAI", keyHint: "platform.openai.com/api-keys" },
  ollama: { name: "Ollama (local, sin key)" },
  "claude-code": { name: "Claude Code (claude -p, sin key)" },
};
const NO_KEY = ["ollama", "claude-code"];
const CUSTOM = "url";

const CSS = `
  .llm-dlg{width:min(440px,calc(100vw - 24px));max-height:calc(100vh - 24px);padding:0;border:1px solid ${T.line};border-radius:14px;
    background:#1b1b24;color:${T.text};font:inherit;box-shadow:0 20px 60px -10px rgba(0,0,0,.7)}
  .llm-dlg::backdrop{background:rgba(0,0,0,.55);backdrop-filter:blur(2px)}
  .llm-dlg[open]{display:grid;grid-template-rows:auto minmax(0,1fr) auto}
  .llm-dlg header,.llm-dlg footer{padding:14px 16px;display:flex;gap:8px;align-items:center}
  .llm-dlg footer{border-top:1px solid ${T.line};justify-content:flex-end}
  .llm-body{overflow-y:auto;padding:0 16px 14px;display:grid;gap:10px;align-content:start}
  .llm-card{border:1px solid ${T.line};border-radius:12px;background:${T.card};padding:10px;display:grid;gap:8px}
  .llm-row{display:flex;gap:6px;align-items:center;min-width:0}
  .llm-in{flex:1;min-width:0;padding:6px 8px;border-radius:8px;border:1px solid ${T.line};background:${T.bg};color:${T.text};font:inherit}
  .llm-ico{padding:4px 7px;border:0;border-radius:7px;background:none;color:${T.dim};cursor:pointer;font:inherit;line-height:1}
  .llm-ico:hover:not(:disabled){background:rgba(255,255,255,.08);color:${T.text}}
  .llm-n{width:18px;text-align:right;color:${T.dim};font-size:12px;flex:none}
  .llm-badge{font-size:11px;padding:2px 7px;border-radius:999px;background:rgba(232,82,60,.16);color:${T.accent};flex:none}
`;

const move = <X,>(xs: X[], i: number, d: number) => {
  const j = i + d;
  if (j < 0 || j >= xs.length) return xs;
  const out = [...xs];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

/** Resumen de la cadena de fallback + botón que abre el editor. Guarda solo con "Guardar". */
export function LlmEditor({ value, onSave }: { value: Llm[]; onSave: (v: Llm[]) => Promise<void> }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Llm[]>(value);
  const [err, setErr] = useState("");

  const openDlg = () => {
    setDraft(structuredClone(value));
    setErr("");
    dlg.current?.showModal();
  };
  const set = (i: number, patch: Partial<Llm>) => setDraft((d) => d.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const save = async () => {
    const clean = draft.map((p) => ({ ...p, models: p.models.map((m) => m.trim()).filter(Boolean) }));
    const r = z.array(llmSchema).min(1).safeParse(clean);
    if (!r.success) {
      setErr(clean.length ? "Cada proveedor necesita un proveedor/URL y al menos un modelo." : "Agrega al menos un proveedor.");
      return;
    }
    await onSave(r.data);
    dlg.current?.close();
  };

  const first = value.find((p) => p.models.length);
  const backups = value.reduce((n, p) => n + p.models.length, 0) - 1;
  const host = (p: Llm) => KNOWN[p.provider]?.name.split(" ")[0] ?? p.provider.replace(/^https?:\/\//, "").split("/")[0];

  return (
    <>
      <style>{CSS}</style>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
          {first ? (
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {first.models[0]} <small style={{ color: T.dim }}>· {host(first)}</small>
            </span>
          ) : (
            <span style={{ color: "#ff6b6b" }}>Sin modelos configurados</span>
          )}
          {backups > 0 && <small style={{ color: T.dim }}>+{backups} de respaldo</small>}
        </div>
        <button style={btn} onClick={openDlg}>
          Configurar modelos…
        </button>
      </div>

      <dialog ref={dlg} className="llm-dlg" onCancel={() => setErr("")}>
        <header>
          <b style={{ flex: 1 }}>Modelos para sugerir tareas</b>
          <button className="llm-ico" aria-label="Cerrar" onClick={() => dlg.current?.close()}>
            <Icon name="x" size="1em" />
          </button>
        </header>
        <div className="llm-body">
          <small style={{ color: T.dim }}>
            Se prueba de arriba hacia abajo: si un modelo falla (sobrecarga, cuota, key inválida) pasa al siguiente, y al
            acabar los modelos de un proveedor, al siguiente proveedor.
          </small>
          {draft.map((p, i) => (
            <Provider
              key={i}
              p={p}
              i={i}
              last={i === draft.length - 1}
              onChange={(patch) => set(i, patch)}
              onMove={(d) => setDraft((x) => move(x, i, d))}
              onRemove={() => setDraft((x) => x.filter((_, k) => k !== i))}
            />
          ))}
          <button
            style={{ ...btn, borderStyle: "dashed", background: "none" }}
            onClick={() => setDraft((d) => [...d, { provider: "gemini", apikey: "", models: [] }])}
          >
            <Icon name="plus" size="1em" /> Agregar proveedor
          </button>
        </div>
        <footer>
          {err && <small style={{ color: "#ff6b6b", flex: 1 }}>{err}</small>}
          <button style={btn} onClick={() => dlg.current?.close()}>
            Cancelar
          </button>
          <button style={{ ...btn, background: T.accent, borderColor: "transparent", color: "#fff", fontWeight: 600 }} onClick={save}>
            Guardar
          </button>
        </footer>
      </dialog>
    </>
  );
}

function Provider(props: {
  p: Llm;
  i: number;
  last: boolean;
  onChange: (patch: Partial<Llm>) => void;
  onMove: (d: number) => void;
  onRemove: () => void;
}) {
  const { p, i, last, onChange, onMove, onRemove } = props;
  const [newModel, setNewModel] = useState("");
  const known = p.provider in KNOWN;
  const add = () => {
    if (!newModel.trim()) return;
    onChange({ models: [...p.models, newModel.trim()] });
    setNewModel("");
  };

  return (
    <div className="llm-card">
      <div className="llm-row">
        <span className="llm-badge">{i + 1}</span>
        <select
          className="llm-in"
          aria-label="Proveedor"
          value={known ? p.provider : CUSTOM}
          onChange={(e) => onChange({ provider: e.target.value === CUSTOM ? "" : e.target.value })}
        >
          {Object.entries(KNOWN).map(([id, k]) => (
            <option key={id} value={id}>
              {k.name}
            </option>
          ))}
          <option value={CUSTOM}>Otra API compatible con OpenAI…</option>
        </select>
        <button className="llm-ico" aria-label="Subir proveedor" disabled={i === 0} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button className="llm-ico" aria-label="Bajar proveedor" disabled={last} onClick={() => onMove(1)}>
          ↓
        </button>
        <button className="llm-ico" aria-label="Quitar proveedor" onClick={onRemove}>
          <Icon name="trash" size="1em" />
        </button>
      </div>
      {!known && (
        <input
          className="llm-in"
          placeholder="https://…/v1"
          value={p.provider}
          onChange={(e) => onChange({ provider: e.target.value })}
        />
      )}
      {!NO_KEY.includes(p.provider) && (
        <input
          className="llm-in"
          type="password"
          aria-label="API key"
          placeholder={`API key${KNOWN[p.provider]?.keyHint ? ` (${KNOWN[p.provider].keyHint})` : ""}`}
          value={p.apikey}
          onChange={(e) => onChange({ apikey: e.target.value })}
        />
      )}
      <div style={{ display: "grid", gap: 4 }}>
        {p.models.map((m, k) => (
          <div key={k} className="llm-row">
            <span className="llm-n">{k + 1}</span>
            <input
              className="llm-in"
              aria-label={`Modelo ${k + 1}`}
              value={m}
              onChange={(e) => onChange({ models: p.models.map((x, j) => (j === k ? e.target.value : x)) })}
            />
            <button className="llm-ico" aria-label="Subir modelo" disabled={k === 0} onClick={() => onChange({ models: move(p.models, k, -1) })}>
              ↑
            </button>
            <button
              className="llm-ico"
              aria-label="Bajar modelo"
              disabled={k === p.models.length - 1}
              onClick={() => onChange({ models: move(p.models, k, 1) })}
            >
              ↓
            </button>
            <button className="llm-ico" aria-label="Quitar modelo" onClick={() => onChange({ models: p.models.filter((_, j) => j !== k) })}>
              <Icon name="x" size="1em" />
            </button>
          </div>
        ))}
        <div className="llm-row">
          <span className="llm-n" />
          <input
            className="llm-in"
            placeholder={p.provider === "ollama" ? "Agregar modelo (ej. qwen3.5:9b)" : p.provider === "claude-code" ? "Agregar modelo (ej. sonnet)" : "Agregar modelo"}
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="llm-ico" aria-label="Agregar modelo" disabled={!newModel.trim()} onClick={add}>
            <Icon name="plus" size="1em" />
          </button>
        </div>
      </div>
    </div>
  );
}
