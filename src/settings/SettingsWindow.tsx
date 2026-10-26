import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  accelFromEvent,
  DEFAULT_FOCUS_SHORTCUT,
  DEFAULT_SHORTCUT,
  DEFAULT_VOICE_SHORTCUT,
  DEFAULT_CENTER_SHORTCUT,
  type Prefs,
} from "../lib/prefs";
import { chime } from "../lib/sound";
import { useSettings } from "../store/useSettings";
import { LlmEditor } from "./LlmEditor";
import { PetSection, sub } from "./PetSection";
import { btn, T, PANEL_CSS } from "../panel/ui";
import { listen } from "@tauri-apps/api/event";
import * as db from "../lib/db";
import { fmtMin, stepMin, type Activity, type Routine, type Step } from "../lib/routine";
import { MODE_COLOR } from "../pet/TimerPill";

// Distracciones por app y dictado a la Candola aún no existen en Windows (apps.rs, voice.rs): no se muestran.
const WIN = navigator.userAgent.includes("Windows");

// Secciones desplegables (<details> nativo); `name` compartido = se abre una a la vez.
const SECTION_CSS = `
  details.sec{background:${T.card};border:1px solid ${T.line};border-radius:12px;padding:0 14px}
  details.sec>summary{list-style:none;cursor:pointer;padding:12px 0;display:flex;align-items:baseline;gap:10px}
  details.sec>summary::-webkit-details-marker{display:none}
  details.sec>summary::after{content:"›";margin-left:auto;color:${T.dim};font-size:18px;transition:transform .15s}
  details.sec[open]>summary::after{transform:rotate(90deg)}
  details.sec[open]>summary{border-bottom:1px solid ${T.line};margin-bottom:12px}
  .rt{display:grid;gap:8px;padding:10px 12px;border:1px solid ${T.line};border-radius:10px;background:rgba(0,0,0,.18)}
  .rt table{width:100%;border-collapse:collapse;font-size:.92em}
  .rt td{padding:5px 4px;border-top:1px solid ${T.line}}
  .rt tr:first-child td{border-top:0}
  .rt td:last-child{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .rt i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px}
  .rt small{color:${T.dim}}
`;

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <details className="sec" name="settings">
      <summary>
        <b style={{ fontSize: 15 }}>{title}</b>
        <small style={{ color: T.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {hint}
        </small>
      </summary>
      <div style={{ display: "grid", gap: 10, paddingBottom: 14, gridTemplateColumns: "minmax(0, 1fr)" }}>
        {children}
      </div>
    </details>
  );
}

const note = { opacity: 0.7 } as const;

/** Número que se puede escribir: guarda apenas el valor queda dentro de [min, max] (escribir "47" pasa por "4", que
 *  si se guardara al tiro el saneo de prefs lo devolvería al valor por defecto); al salir con uno inválido, vuelve. */
function NumInput({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const ok = (s: string) => s.trim() !== "" && Number.isInteger(Number(s)) && +s >= min && +s <= max;
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (ok(e.target.value)) onCommit(Number(e.target.value));
      }}
      onBlur={() => !ok(draft) && setDraft(String(value))}
      style={{ ...btn, width: 64, padding: 4 }}
    />
  );
}

export function SettingsWindow() {
  const { prefs, setPrefs } = useSettings();
  const [auto, setAuto] = useState(false);
  const [shortcutErr, setShortcutErr] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<{ bundle: string; name: string }[]>([]);
  useEffect(() => {
    isEnabled()
      .then(setAuto)
      .catch(() => {});
  }, []);

  // Rangos iguales a los de prefsSchema (lib/prefs.ts).
  const RANGE = {
    focusMin: [1, 180],
    shortMin: [1, 180],
    longMin: [1, 180],
    longEvery: [1, 12],
    headDownDeg: [5, 60],
    barkAfterSec: [2, 300],
    awayPauseSec: [5, 900],
    dayEndHour: [0, 23],
    dailyGoalMin: [1, 960],
  } as const;
  const num = (key: keyof typeof RANGE, label: string) => (
    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      {label}
      <NumInput
        value={prefs[key]}
        min={RANGE[key][0]}
        max={RANGE[key][1]}
        onCommit={(n) => setPrefs({ [key]: n })}
      />
    </label>
  );

  type ShortcutKey = "shortcut" | "focusShortcut" | "voiceShortcut" | "centerShortcut";
  const setShortcut = async (kind: string, key: ShortcutKey, accel: string) => {
    try {
      await invoke("set_quick_shortcut", { kind, accel });
      setShortcutErr((m) => ({ ...m, [kind]: "" }));
      await setPrefs({ [key]: accel } as Partial<Prefs>);
    } catch (err) {
      setShortcutErr((m) => ({ ...m, [kind]: String(err) }));
    }
  };

  const shortcutField = (kind: string, key: ShortcutKey, label: string, def: string) => (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ width: 130 }}>{label}</span>
        <input
          readOnly
          value={prefs[key]}
          onKeyDown={(e) => {
            e.preventDefault();
            const accel = accelFromEvent(e.nativeEvent);
            if (accel) setShortcut(kind, key, accel);
          }}
          title="Haz clic y pulsa la combinación"
          style={{ ...btn, flex: 1, cursor: "text" }}
        />
        <button style={btn} onClick={() => setShortcut(kind, key, def)}>
          Restablecer
        </button>
      </div>
      {shortcutErr[kind] && <small style={{ color: "#ff6b6b" }}>{shortcutErr[kind]}</small>}
    </>
  );

  return (
    <div
      style={{
        font: "14px system-ui",
        padding: 20,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)", // sin esto la columna toma el ancho del texto más largo y se sale
        gap: 10,
        color: T.text,
        background: `linear-gradient(160deg, #1f1f2b, ${T.bg} 60%)`,
        minHeight: "100vh",
        boxSizing: "border-box",
        alignContent: "start",
      }}
    >
      <style>{PANEL_CSS + SECTION_CSS}</style>
      <Section title="Personaliza tu mascota" hint="aspecto, animaciones, sonidos">
        <PetSection />
      </Section>

      <Section title="Modo Foco" hint="timer, distracciones y cuándo te llama la atención">
        <h3 style={sub}>Timer</h3>
        <RoutinePicker>
          {num("focusMin", "Foco (min)")}
          {num("shortMin", "Pausa corta (min)")}
          {num("longMin", "Pausa larga (min)")}
          {num("longEvery", "Pausa larga cada (focos)")}
        </RoutinePicker>
        <label>
          <input
            type="checkbox"
            checked={prefs.autoCycle}
            onChange={(e) => setPrefs({ autoCycle: e.target.checked })}
          />{" "}
          Ciclo automático (al terminar una pausa arranca el siguiente foco)
        </label>
        <label>
          <input
            type="checkbox"
            checked={prefs.trayTimer}
            onChange={(e) => setPrefs({ trayTimer: e.target.checked })}
          />{" "}
          Mostrar el tiempo en la barra de menú
        </label>

        <h3 style={sub}>Aviso al terminar</h3>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <label>
            <input
              type="checkbox"
              checked={prefs.sound}
              onChange={(e) => setPrefs({ sound: e.target.checked })}
            />{" "}
            Sonar al terminar
          </label>
          <span style={{ display: "flex", gap: 6 }}>
            <button style={{ ...btn, padding: "2px 8px" }} onClick={() => chime("rest")}>
              Probar descanso
            </button>
            <button style={{ ...btn, padding: "2px 8px" }} onClick={() => chime("work")}>
              Probar trabajo
            </button>
          </span>
        </div>

        {!WIN && (
          <>
            <h3 style={sub}>Distracciones durante el foco</h3>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {prefs.distractions.map((id) => (
                <button
                  key={id}
                  style={{ ...btn, padding: "2px 8px" }}
                  title="Quitar"
                  onClick={() => setPrefs({ distractions: prefs.distractions.filter((d) => d !== id) })}
                >
                  {running.find((a) => a.bundle === id)?.name ?? id} ✕
                </button>
              ))}
              {!prefs.distractions.length && <small style={{ color: T.dim }}>Ninguna.</small>}
            </div>
            <select
              style={{ ...btn, padding: 4 }}
              value=""
              onFocus={() =>
                invoke<typeof running>("running_apps")
                  .then(setRunning)
                  .catch(() => {})
              }
              onChange={(e) =>
                e.target.value &&
                setPrefs({ distractions: [...new Set([...prefs.distractions, e.target.value])] })
              }
            >
              <option value="">Agregar una app abierta…</option>
              {running
                .filter((a) => !prefs.distractions.includes(a.bundle))
                .map((a) => (
                  <option key={a.bundle} value={a.bundle}>
                    {a.name}
                  </option>
                ))}
            </select>
            <small style={{ opacity: 0.7 }}>
              Si abres una de estas apps en pleno foco, tu mascota se queja; si te quedas más de 1 min, avisa.
              El tiempo por app de cada foco se ve en la web (Foco).
            </small>
          </>
        )}

        <h3 style={sub}>Cámara durante el foco</h3>
        <label>
          <input
            type="checkbox"
            checked={prefs.focusCam}
            onChange={(e) => setPrefs({ focusCam: e.target.checked })}
          />{" "}
          Usar la cámara durante el foco
        </label>
        {prefs.focusCam && (
          <>
            <CamSelect value={prefs.camId} onChange={(camId) => setPrefs({ camId })} />
            {num("headDownDeg", "Cabeza abajo desde (grados bajo tu postura normal)")}
            {num("barkAfterSec", "Llamar la atención tras advertir (s)")}
            {num("awayPauseSec", "Pausar si no te ve por (s)")}
          </>
        )}
        <small style={{ opacity: 0.7 }}>
          Si miras el teléfono (cabeza abajo sin usar el computador, o teléfono a la vista), tu mascota te
          advierte; si sigues, te llama la atención y cuenta como distracción. Si te vas, pausa el foco.
        </small>

        <h3 style={sub}>Cierre del día</h3>
        {num("dayEndHour", "Avisar a las (hora, 0 = apagado)")}
        {num("dailyGoalMin", "Meta de foco diaria (min)")}
      </Section>

      <Section title="Permisos" hint="cámara, micrófono, pantalla, notificaciones">
        {(
          [
            [
              "camera",
              "Cámara",
              "Modo Foco: nota si miras el teléfono o te vas. Se procesa en tu computador, no se guarda ninguna imagen (solo las mediciones, para calibrarla) y solo se enciende durante el foco.",
            ],
            [
              "mic",
              "Micrófono",
              WIN ? "Transcribir reuniones." : "Transcribir reuniones y hablarle a la Candola con el atajo.",
            ],
            ...(WIN
              ? []
              : [
                  [
                    "screen",
                    "Grabación de pantalla",
                    "Captar el audio de las reuniones (macOS lo pide aunque solo se use el sonido).",
                  ],
                ]),
            ["notifications", "Notificaciones", "Avisos de fin de foco, reuniones y cierre del día."],
          ] as const
        ).map(([pane, label, why]) => (
          <div key={pane} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ flex: 1 }}>
              {label}
              <br />
              <small style={note}>{why}</small>
            </span>
            <button
              style={{ ...btn, padding: "2px 8px", whiteSpace: "nowrap" }}
              onClick={() => invoke("open_privacy", { pane })}
            >
              Abrir ajustes
            </button>
          </div>
        ))}
        <small style={note}>
          El sistema pide cada permiso la primera vez que se usa; desde aquí puedes revisarlo o quitarlo.
        </small>
      </Section>

      <Section title="Asistente" hint="chat con Claude y reuniones">
        <h3 style={sub}>Chat con Claude Code</h3>
        <input
          placeholder="~ (home)"
          defaultValue={prefs.claudeCwd}
          onBlur={(e) => setPrefs({ claudeCwd: e.target.value })}
          style={{ ...btn, padding: 4 }}
        />
        <small style={{ opacity: 0.7 }}>
          Carpeta base del chat: Claude corre ahí y lee su CLAUDE.md (tus docs de servidores, despliegues,
          etc.). Vacía = tu home.
        </small>
        <label>
          <input
            type="checkbox"
            checked={prefs.voice}
            onChange={(e) => setPrefs({ voice: e.target.checked })}
          />{" "}
          Leer en voz alta las respuestas a lo que le dices con el atajo
        </label>

        <h3 style={sub}>Reuniones (sugerir tareas)</h3>
        <input
          placeholder="Tu nombre (quién es “Yo” en las reuniones)"
          defaultValue={prefs.userName}
          onBlur={(e) => setPrefs({ userName: e.target.value })}
          style={{ ...btn, padding: 4 }}
        />
        <LlmEditor value={prefs.llms} onSave={(llms) => setPrefs({ llms })} />
        <small style={{ opacity: 0.7 }}>
          Al terminar la reunión se manda el texto (nunca el audio) al primer modelo; si falla, al siguiente.
          En el nivel gratis de Gemini, Google puede usar el texto para mejorar sus productos.
        </small>
      </Section>

      <Section title="Atajos" hint="combinaciones globales">
        {shortcutField("panel", "shortcut", "Abrir el panel", DEFAULT_SHORTCUT)}
        {shortcutField("focus", "focusShortcut", "Iniciar/pausar foco", DEFAULT_FOCUS_SHORTCUT)}
        {!WIN && shortcutField("voice", "voiceShortcut", "Hablarle a la Candola", DEFAULT_VOICE_SHORTCUT)}
        {shortcutField("center", "centerShortcut", "Traer a la mascota al centro", DEFAULT_CENTER_SHORTCUT)}
        {!WIN && (
          <small style={{ opacity: 0.7 }}>
            Mantén el atajo de la Candola mientras hablas (hasta 10 s) y suéltalo: la orden entra al chat. Usa
            el micrófono y el modelo de voz de las reuniones.
          </small>
        )}
      </Section>

      <Section title="Conexiones" hint="calendario">
        <input
          type="password"
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          defaultValue={prefs.icalUrl}
          onBlur={(e) => setPrefs({ icalUrl: e.target.value })}
          style={{ ...btn, padding: 4 }}
        />
        <small style={{ opacity: 0.7 }}>
          Google Calendar → Configuración → tu calendario → “Dirección secreta en formato iCal”. Avisa 2 min
          antes de cada reunión.
        </small>
      </Section>

      <Section title="Sistema" hint="inicio automático">
        <label>
          <input
            type="checkbox"
            checked={auto}
            onChange={async (e) => {
              await (e.target.checked ? enable() : disable());
              setAuto(await isEnabled());
            }}
          />{" "}
          Iniciar al encender el equipo
        </label>
      </Section>
    </div>
  );
}

/** Rutina activa (F18) y su detalle. Las propias se arman en la web (vista Rutinas); la clásica se arma con los
 *  tiempos de Ajustes (`children`), que quedan escondidos tras "Cambiar tiempos". */
function RoutinePicker({ children }: { children: React.ReactNode }) {
  const p = useSettings((s) => s.prefs);
  const [rs, setRs] = useState<Routine[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [acts, setActs] = useState(new Map<number, Activity>());
  const [editing, setEditing] = useState(false);
  const active = rs.find((r) => r.active);
  useEffect(() => {
    const load = () =>
      Promise.all([db.listRoutines(), db.allActivities()]).then(
        ([r, a]) => {
          setRs(r);
          setActs(new Map(a.map((x) => [x.id, x])));
        },
        () => {},
      );
    load();
    const un = listen("db://changed", load);
    return () => void un.then((f) => f());
  }, []);
  useEffect(() => {
    if (active) db.routineSteps(active.id).then(setSteps, () => {});
  }, [active?.id, rs]);

  const row = (color: string, name: string, detail: string, key?: number) => (
    <tr key={key ?? name}>
      <td>
        <i style={{ background: color }} />
        {name}
      </td>
      <td>{detail}</td>
    </tr>
  );
  const classicLap = p.longEvery * p.focusMin + (p.longEvery - 1) * p.shortMin + p.longMin;
  const lap = steps.reduce((t, s) => t + stepMin(s, acts.get(s.activity_id)), 0);

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label htmlFor="routine">Rutina</label>
        <select
          id="routine"
          style={{ ...btn, padding: 4, flex: 1 }}
          value={active?.id ?? ""}
          onChange={(e) => db.setActiveRoutine(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Clásica</option>
          {rs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <button style={btn} onClick={() => invoke("open_web", { view: "routines" })}>
          {rs.length ? "Editar ↗" : "Crear ↗"}
        </button>
      </div>
      <div className="rt">
        {active ? (
          <>
            <table>
              <tbody>
                {steps.map((s, i) => {
                  const a = acts.get(s.activity_id);
                  return row(
                    a?.color ?? T.dim,
                    `${a?.emoji ?? ""} ${a?.name ?? "?"}`.trim(),
                    `${stepMin(s, a)} min`,
                    i,
                  );
                })}
              </tbody>
            </table>
            <small>
              {steps.length} {steps.length === 1 ? "bloque" : "bloques"} · {fmtMin(lap)} por vuelta. Al
              terminar vuelve a empezar.
            </small>
          </>
        ) : (
          <>
            <table>
              <tbody>
                {row(MODE_COLOR.focus, "🍅 Foco", `${p.focusMin} min`)}
                {row(MODE_COLOR.short, "☕ Pausa corta", `${p.shortMin} min`)}
                {row(MODE_COLOR.long, "🛋️ Pausa larga", `${p.longMin} min, cada ${p.longEvery} focos`)}
              </tbody>
            </table>
            <small>
              Una vuelta: {p.longEvery} focos con pausa corta entre ellos y la larga al final (
              {fmtMin(classicLap)}).
            </small>
            {editing ? (
              <div style={{ display: "grid", gap: 8 }}>
                {children}
                <button style={{ ...btn, justifySelf: "start" }} onClick={() => setEditing(false)}>
                  Listo
                </button>
              </div>
            ) : (
              <button
                style={{ ...btn, justifySelf: "start", padding: "4px 10px" }}
                onClick={() => setEditing(true)}
              >
                Cambiar tiempos
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Cámaras conectadas (se actualiza al enchufar/desenchufar). Sin permiso WebKit no da nombres: se pide una vez. */
function CamSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const md = navigator.mediaDevices;
    const list = () => md.enumerateDevices().then((d) => d.filter((x) => x.kind === "videoinput"));
    const refresh = async () => {
      let v = await list();
      if (v.length && !v[0].label) {
        const s = await md.getUserMedia({ video: true }).catch(() => null);
        s?.getTracks().forEach((t) => t.stop());
        if (s) v = await list();
      }
      setCams(v);
    };
    void refresh();
    md.addEventListener("devicechange", refresh);
    return () => md.removeEventListener("devicechange", refresh);
  }, []);
  const missing = value && !cams.some((c) => c.deviceId === value);
  return (
    <label>
      Cámara{" "}
      <select style={{ ...btn, padding: 4 }} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">La del sistema</option>
        {cams.map((c, i) => (
          <option key={c.deviceId} value={c.deviceId}>
            {c.label || `Cámara ${i + 1}`}
          </option>
        ))}
        {missing && <option value={value}>Desconectada (usa la del sistema)</option>}
      </select>
    </label>
  );
}
