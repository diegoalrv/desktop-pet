import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { importFile, importFolder, listSkins, removeSkin, BUILTIN } from "../skins/loader";
import { useSettings } from "../store/useSettings";
import { btn } from "../panel/ui";

export function SettingsWindow() {
  const { skin, setSkin, reloadSkin } = useSettings();
  const [skins, setSkins] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState("");
  const refresh = useCallback(() => listSkins().then(setSkins), []);
  useEffect(() => void refresh(), [refresh]);

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

  return (
    <div
      style={{
        font: "14px system-ui",
        padding: 20,
        display: "grid",
        gap: 14,
        color: "#222",
        alignContent: "start",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Skin de la mascota</h2>
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
      <small style={{ color: "#888" }}>
        Un pack es una carpeta o .zip con manifest.json y sprite sheets horizontales. Una sola imagen se anima
        con efectos CSS.
      </small>
    </div>
  );
}
