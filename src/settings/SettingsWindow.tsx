import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  accelFromEvent,
  DEFAULT_FOCUS_SHORTCUT,
  DEFAULT_SHORTCUT,
  DEFAULT_VOICE_SHORTCUT,
  PET_SIZE,
  type Prefs,
} from "../lib/prefs";
import { chime } from "../lib/sound";
import { importFile, importFolder, listSkins, removeSkin, BUILTIN, DEFAULT } from "../skins/loader";
import { useSettings } from "../store/useSettings";
import { LlmEditor } from "./LlmEditor";
import { btn, T, PANEL_CSS } from "../panel/ui";

const h = {
  margin: "8px 0 0",
  fontSize: 13,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: T.accent,
} as const;

export function SettingsWindow() {
  const { skin, setSkin, reloadSkin, prefs, setPrefs } = useSettings();
  const [skins, setSkins] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [auto, setAuto] = useState(false);
  const [shortcutErr, setShortcutErr] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<{ bundle: string; name: string }[]>([]);
  const refresh = useCallback(() => listSkins().then(setSkins), []);
  useEffect(() => {
    refresh();
    isEnabled()
      .then(setAuto)
      .catch(() => {});
  }, [refresh]);

  const run = async (pick: () => Promise<string | null>, imp: (p: string) => Promise<string>) => {
    try {
      const p = await pick();
      if (!p) return;
      const id = await imp(p);
      await refresh();
      await setSkin(id);
      await reloadSkin(); // reimportar el mismo id también refresca en caliente
      setMsg(`Skin "${id}" importado y aplicado.`);
    } catch (e) {
      setMsg(`No se pudo importar: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const num = (
    key: "focusMin" | "shortMin" | "longMin" | "longEvery" | "headDownDeg" | "barkAfterSec" | "awayPauseSec",
    label: string,
  ) => (
    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      {label}
      <input
        type="number"
        min={1}
        value={prefs[key]}
        onChange={(e) => setPrefs({ [key]: Number(e.target.value) })}
        style={{ ...btn, width: 64, padding: 4 }}
      />
    </label>
  );

  type ShortcutKey = "shortcut" | "focusShortcut" | "voiceShortcut";
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
        gap: 10,
        color: T.text,
        background: `linear-gradient(160deg, #1f1f2b, ${T.bg} 60%)`,
        minHeight: "100vh",
        boxSizing: "border-box",
        alignContent: "start",
      }}
    >
      <style>{PANEL_CSS}</style>
      <h2 style={{ ...h, marginTop: 0 }}>Skin de la mascota</h2>
      <div style={{ display: "grid", gap: 6 }}>
        {skins.map((s) => (
          <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ flex: 1, display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="radio" name="skin" checked={skin === s.id} onChange={() => setSkin(s.id)} />
              {s.name} <small style={{ color: T.dim }}>{s.id}</small>
            </label>
            {s.id !== BUILTIN && s.id !== DEFAULT && (
              <button
                style={{ ...btn, padding: "2px 8px" }}
                onClick={async () => {
                  if (skin === s.id) await setSkin(DEFAULT);
                  await removeSkin(s.id);
                  refresh();
                }}
              >
                Quitar
              </button>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          style={btn}
          onClick={() => run(async () => (await open({ directory: true })) as string | null, importFolder)}
        >
          Importar carpeta…
        </button>
        <button
          style={btn}
          onClick={() =>
            run(
              async () =>
                (await open({
                  filters: [
                    {
                      name: "Skin (.zip) o imagen",
                      extensions: ["zip", "png", "webp", "gif", "jpg", "jpeg"],
                    },
                  ],
                })) as string | null,
              importFile,
            )
          }
        >
          Importar .zip / imagen…
        </button>
      </div>
      {msg && <div style={{ fontSize: 12, color: T.dim }}>{msg}</div>}
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        Tamaño en pantalla
        <input
          type="range"
          min={PET_SIZE.min}
          max={PET_SIZE.max}
          step={8}
          value={prefs.petSize}
          onChange={(e) => setPrefs({ petSize: Number(e.target.value) })}
          style={{ flex: 1 }}
        />
        <span style={{ width: 52, textAlign: "right", color: T.dim }}>{prefs.petSize} px</span>
        {prefs.petSize !== PET_SIZE.def && (
          <button style={{ ...btn, padding: "2px 8px" }} onClick={() => setPrefs({ petSize: PET_SIZE.def })}>
            Restablecer
          </button>
        )}
      </label>

      <h2 style={h}>Timer</h2>
      {num("focusMin", "Foco (min)")}
      {num("shortMin", "Pausa corta (min)")}
      {num("longMin", "Pausa larga (min)")}
      {num("longEvery", "Pausa larga cada (focos)")}
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

      <h2 style={h}>Distracciones durante el foco</h2>
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
        onFocus={() => invoke<typeof running>("running_apps").then(setRunning).catch(() => {})}
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
        Solo macOS. Si abres una de estas apps en pleno foco, Candolita se queja; si te quedas más de 1 min,
        avisa. El tiempo por app de cada foco se ve en la web (Foco).
      </small>

      <h2 style={h}>Cámara durante el foco</h2>
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
          {num("headDownDeg", "Cabeza abajo desde (grados bajo tu postura normal)")}
          {num("barkAfterSec", "Ladrar pasados (s de distracción)")}
          {num("awayPauseSec", "Pausar si no te ve por (s)")}
        </>
      )}
      <small style={{ opacity: 0.7 }}>
        Si miras el teléfono (cabeza abajo sin usar el computador, o teléfono a la vista), Candolita gruñe; si
        sigues, ladra y cuenta como distracción. Si te vas, pausa el foco. Todo se procesa en tu Mac y no se guarda
        ninguna imagen (solo las mediciones, para calibrarla); la cámara solo se enciende durante el foco. macOS pide permiso la primera vez (Ajustes del
        Sistema → Privacidad → Cámara).
      </small>

      <h2 style={h}>Cierre del día</h2>
      <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        Avisar a las (hora, 0 = apagado)
        <input
          type="number"
          min={0}
          max={23}
          value={prefs.dayEndHour}
          onChange={(e) => setPrefs({ dayEndHour: Number(e.target.value) })}
          style={{ ...btn, width: 64, padding: 4 }}
        />
      </label>
      <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        Meta de foco diaria (min)
        <input
          type="number"
          min={1}
          max={960}
          value={prefs.dailyGoalMin}
          onChange={(e) => setPrefs({ dailyGoalMin: Number(e.target.value) })}
          style={{ ...btn, width: 64, padding: 4 }}
        />
      </label>

      <h2 style={h}>Sonido</h2>
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

      <h2 style={h}>Atajos globales</h2>
      {shortcutField("panel", "shortcut", "Abrir el panel", DEFAULT_SHORTCUT)}
      {shortcutField("focus", "focusShortcut", "Iniciar/pausar foco", DEFAULT_FOCUS_SHORTCUT)}
      {shortcutField("voice", "voiceShortcut", "Hablarle a la Candola", DEFAULT_VOICE_SHORTCUT)}
      <small style={{ opacity: 0.7 }}>
        Mantén el atajo de la Candola mientras hablas (hasta 10 s) y suéltalo: la orden entra al chat. Usa el
        micrófono y el modelo de voz de las reuniones (macOS).
      </small>

      <h2 style={h}>Calendario</h2>
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

      <h2 style={h}>Reuniones (sugerir tareas)</h2>
      <input
        placeholder="Tu nombre (quién es “Yo” en las reuniones)"
        defaultValue={prefs.userName}
        onBlur={(e) => setPrefs({ userName: e.target.value })}
        style={{ ...btn, padding: 4 }}
      />
      <LlmEditor value={prefs.llms} onSave={(llms) => setPrefs({ llms })} />
      <small style={{ opacity: 0.7 }}>
        Al terminar la reunión se manda el texto (nunca el audio) al primer modelo; si falla, al siguiente. En
        el nivel gratis de Gemini, Google puede usar el texto para mejorar sus productos.
      </small>

      <h2 style={h}>Chat con Claude Code</h2>
      <input
        placeholder="~ (home)"
        defaultValue={prefs.claudeCwd}
        onBlur={(e) => setPrefs({ claudeCwd: e.target.value })}
        style={{ ...btn, padding: 4 }}
      />
      <small style={{ opacity: 0.7 }}>
        Carpeta base del chat: Claude corre ahí y lee su CLAUDE.md (docs del VPS, Coolify, etc.). Vacía = tu
        home.
      </small>
      <label>
        <input type="checkbox" checked={prefs.voice} onChange={(e) => setPrefs({ voice: e.target.checked })} />{" "}
        Leer en voz alta las respuestas a lo que le dices con el atajo
      </label>

      <h2 style={h}>Sistema</h2>
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
    </div>
  );
}
