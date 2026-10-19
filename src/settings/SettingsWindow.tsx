import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { z } from "zod";
import { accelFromEvent, DEFAULT_SHORTCUT, llmSchema, PET_SIZE } from "../lib/prefs";
import { chime } from "../lib/sound";
import { importFile, importFolder, listSkins, removeSkin, BUILTIN, DEFAULT } from "../skins/loader";
import { useSettings } from "../store/useSettings";
import { btn, T, PANEL_CSS } from "../panel/ui";

const h = { margin: "8px 0 0", fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase", color: T.accent } as const;

export function SettingsWindow() {
  const { skin, setSkin, reloadSkin, prefs, setPrefs } = useSettings();
  const [skins, setSkins] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [auto, setAuto] = useState(false);
  const [shortcutErr, setShortcutErr] = useState("");
  const [llmErr, setLlmErr] = useState("");
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

  const num = (key: "focusMin" | "shortMin" | "longMin" | "longEvery", label: string) => (
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

  const captureShortcut = async (e: React.KeyboardEvent) => {
    e.preventDefault();
    const accel = accelFromEvent(e.nativeEvent);
    if (!accel) return;
    try {
      await invoke("set_quick_shortcut", { accel });
      setShortcutErr("");
      await setPrefs({ shortcut: accel });
    } catch (err) {
      setShortcutErr(String(err));
    }
  };

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

      <h2 style={h}>Atajo del panel</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          readOnly
          value={prefs.shortcut}
          onKeyDown={captureShortcut}
          title="Haz clic y pulsa la combinación"
          style={{ ...btn, flex: 1, cursor: "text" }}
        />
        <button
          style={btn}
          onClick={() =>
            invoke("set_quick_shortcut", { accel: DEFAULT_SHORTCUT }).then(() =>
              setPrefs({ shortcut: DEFAULT_SHORTCUT }),
            )
          }
        >
          Restablecer
        </button>
      </div>
      {shortcutErr && <small style={{ color: "#ff6b6b" }}>{shortcutErr}</small>}

      <h2 style={h}>Calendario</h2>
      <input
        type="password"
        placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
        defaultValue={prefs.icalUrl}
        onBlur={(e) => setPrefs({ icalUrl: e.target.value })}
        style={{ ...btn, padding: 4 }}
      />
      <small style={{ opacity: 0.7 }}>
        Google Calendar → Configuración → tu calendario → “Dirección secreta en formato iCal”. Avisa 2 min antes de
        cada reunión.
      </small>

      <h2 style={h}>Reuniones (sugerir tareas)</h2>
      <textarea
        rows={10}
        spellCheck={false}
        defaultValue={JSON.stringify(prefs.llms, null, 2)}
        onBlur={(e) => {
          try {
            setPrefs({ llms: z.array(llmSchema).min(1).parse(JSON.parse(e.target.value)) });
            setLlmErr("");
          } catch (err) {
            setLlmErr(`No se guardó: ${err instanceof SyntaxError ? err.message : "cada proveedor necesita provider y al menos un modelo"}`);
          }
        }}
        style={{ ...btn, padding: 4, fontFamily: "ui-monospace, monospace", fontSize: 12, resize: "vertical" }}
      />
      {llmErr && <small style={{ color: "#ff6b6b" }}>{llmErr}</small>}
      <small style={{ opacity: 0.7 }}>
        Al terminar la reunión se manda el texto (nunca el audio) al primer modelo de la lista; si falla (sobrecarga,
        cuota…) pasa al siguiente modelo y luego al siguiente proveedor. provider: gemini (key en aistudio.google.com/apikey;
        en el nivel gratis Google puede usar el texto), claude, openai, ollama (sin key) o la URL de cualquier API compatible
        con OpenAI.
      </small>

      <h2 style={h}>Chat con Claude Code</h2>
      <input
        placeholder="~ (home)"
        defaultValue={prefs.claudeCwd}
        onBlur={(e) => setPrefs({ claudeCwd: e.target.value })}
        style={{ ...btn, padding: 4 }}
      />
      <small style={{ opacity: 0.7 }}>
        Carpeta base del chat: Claude corre ahí y lee su CLAUDE.md (docs del VPS, Coolify, etc.). Vacía = tu home.
      </small>

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
