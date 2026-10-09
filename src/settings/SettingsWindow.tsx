import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { accelFromEvent, DEFAULT_SHORTCUT } from "../lib/prefs";
import { chime } from "../lib/sound";
import { importFile, importFolder, listSkins, removeSkin, BUILTIN } from "../skins/loader";
import { useSettings } from "../store/useSettings";
import { btn } from "../panel/ui";

const h = { margin: "8px 0 0", fontSize: 15 } as const;

export function SettingsWindow() {
  const { skin, setSkin, reloadSkin, prefs, setPrefs } = useSettings();
  const [skins, setSkins] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [auto, setAuto] = useState(false);
  const [shortcutErr, setShortcutErr] = useState("");
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
        color: "#222",
        alignContent: "start",
      }}
    >
      <h2 style={{ ...h, marginTop: 0 }}>Skin de la mascota</h2>
      <div style={{ display: "grid", gap: 6 }}>
        {skins.map((s) => (
          <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ flex: 1, display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="radio" name="skin" checked={skin === s.id} onChange={() => setSkin(s.id)} />
              {s.name} <small style={{ color: "#888" }}>{s.id}</small>
            </label>
            {s.id !== BUILTIN && (
              <button
                style={{ ...btn, padding: "2px 8px" }}
                onClick={async () => {
                  if (skin === s.id) await setSkin(BUILTIN);
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
      {msg && <div style={{ fontSize: 12, color: "#666" }}>{msg}</div>}

      <h2 style={h}>Timer</h2>
      {num("focusMin", "Foco (min)")}
      {num("shortMin", "Pausa corta (min)")}
      {num("longMin", "Pausa larga (min)")}
      {num("longEvery", "Pausa larga cada (focos)")}

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
        <button style={{ ...btn, padding: "2px 8px" }} onClick={chime}>
          Probar
        </button>
      </div>

      <h2 style={h}>Captura rápida</h2>
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
      {shortcutErr && <small style={{ color: "#c33" }}>{shortcutErr}</small>}

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
